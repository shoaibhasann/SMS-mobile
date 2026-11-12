// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

type Load = { loading: boolean; error: string | null; data: unknown; reload: () => void };
const h = vi.hoisted(() => ({
  params: {} as Record<string, string>, refresh: vi.fn(), rows: null as unknown as Load, other: null as unknown as Load,
  setParams: vi.fn(), keys: [] as string[],
}));
vi.mock('react-native', () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, onPress, accessibilityLabel }: { children: ReactNode; onPress(): void; accessibilityLabel?: string }) =>
    <button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>,
}));
vi.mock('expo-router', () => ({ router: { back: vi.fn(), replace: vi.fn(), canGoBack: () => true, setParams: h.setParams }, useLocalSearchParams: () => h.params }));
vi.mock('lucide-react-native', () => ({ CalendarDays: () => null, Check: () => null, ChevronDown: () => null, SlidersHorizontal: () => null,
  BookOpen: () => null, GraduationCap: () => null, UserRound: () => null }));
vi.mock('../src/auth/provider', () => ({ useAuth: () => ({ role: 'parent', access: { userId: 'guardian' }, client: {} }) }));
vi.mock('../src/data', async () => ({ ...await import('../src/data/family'), loadClassTeachers: vi.fn() }));
vi.mock('../src/ui/family', () => ({ ChildPicker: () => null,
  useFamily: () => ({ loading: false, error: null, children: [{ id: 'pupil' }], selected: { id: 'pupil' }, select: vi.fn(), refresh: h.refresh }) }));
vi.mock('../src/ui/use-load', () => ({ useLoad: (key: string) => { h.keys.push(key); return key.startsWith('[') ? h.rows : h.other; } }));
vi.mock('../src/ui/theme', () => ({ usePalette: () => ({}) }));
vi.mock('../src/ui/primitives', () => ({
  Screen: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  Card: ({ children }: { children: ReactNode }) => <article>{children}</article>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ label, onPress }: { label: string; onPress(): void }) => <button onClick={onPress}>{label}</button>,
  ErrorCard: ({ message, retry }: { message: string; retry?: () => void }) => <p role="alert">{message}{retry && <button onClick={retry}>Retry</button>}</p>,
  BackArrow: () => null, Title: () => null, Skeleton: () => null,
}));
import Attendance from '../src/app/(school)/(tabs)/attendance';
import Teachers from '../src/app/(school)/teachers';

const ok = (data: unknown): Load => ({ loading: false, error: null, data, reload: vi.fn() });
const failed = (error: string): Load => ({ loading: false, error, data: null, reload: vi.fn() });
let root: ReturnType<typeof createRoot> | null = null, container: HTMLElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); h.params = {}; h.refresh.mockReset(); h.setParams.mockReset(); h.keys = [];
  h.rows = ok({ rows: [], count: 0 }); h.other = ok({ years: [], today: '2026-11-11' });
  container = document.createElement('div'); root = createRoot(container);
});
afterEach(async () => { await act(async () => root?.unmount()); root = null; vi.unstubAllGlobals(); });
const button = (label: string) => Array.from(container.querySelectorAll('button')).find(value => value.textContent === label || value.getAttribute('aria-label')?.startsWith(label))!;
const filters = () => container.querySelector('button[aria-label^="Attendance filters"]')!;
async function chooseStatus(label: string) {
  await act(async () => (filters() as HTMLElement).click());
  await act(async () => button('Status:').click());
  await act(async () => button(label).click());
}

it('resets the Attendance filters and page when an alert opens the same child', async () => {
  await act(async () => root!.render(<Attendance />));
  await chooseStatus('Present');
  expect(filters().textContent).toContain('All academic years · Present');
  h.params = { alert: 'absence-row:1' };
  await act(async () => root!.render(<Attendance />));
  expect(filters().textContent).toContain('All academic years');
  expect(filters().textContent).not.toContain('Present');
});

it('announces the active filter scope on the Filters control', async () => {
  await act(async () => root!.render(<Attendance />));
  expect(filters().getAttribute('aria-label')).toBe('Attendance filters, All academic years');
  await chooseStatus('Absent');
  expect(filters().getAttribute('aria-label')).toBe('Attendance filters, All academic years · Absent');
});

it('re-checks the linked children when Attendance is retried from an access error', async () => {
  h.rows = failed('Your family access could not be verified. Sign in again or contact your school.');
  await act(async () => root!.render(<Attendance />));
  await act(async () => button('Retry').click());
  await act(async () => button('Refresh attendance').click());
  expect(h.refresh).toHaveBeenCalledTimes(2);
  expect(h.rows.reload).not.toHaveBeenCalled();
});

it('keeps a successful Attendance refresh local, with the filters kept', async () => {
  await act(async () => root!.render(<Attendance />));
  await chooseStatus('Late');
  await act(async () => button('Refresh attendance').click());
  expect(h.rows.reload).toHaveBeenCalledOnce();
  expect(h.other.reload).toHaveBeenCalledOnce();
  expect(h.refresh).not.toHaveBeenCalled();
  expect(filters().textContent).toContain('Late');
});

it('re-checks the linked children when Teachers is retried from an error', async () => {
  h.other = failed('Your family access could not be verified. Sign in again or contact your school.');
  await act(async () => root!.render(<Teachers />));
  await act(async () => button('Retry').click());
  expect(h.refresh).toHaveBeenCalledOnce();
  expect(h.other.reload).not.toHaveBeenCalled();
});

const yearId = '71000000-0000-4000-8000-000000000001';
const lastRows = () => JSON.parse(h.keys.filter(key => key.startsWith('[')).at(-1)!) as [string, number, Record<string, string>];

it('keeps the chosen filters and page in the route so a background return can restore them', async () => {
  h.rows = ok({ rows: [], count: 95 });
  await act(async () => root!.render(<Attendance />));
  await chooseStatus('Present');
  expect(h.setParams).toHaveBeenLastCalledWith({ child: 'pupil', year: undefined, month: undefined, status: 'present', page: undefined });
  await act(async () => button('Next').click());
  expect(h.setParams).toHaveBeenLastCalledWith({ child: 'pupil', year: undefined, month: undefined, status: 'present', page: '1' });
  expect(lastRows()).toEqual(['guardian:parent:pupil', 30, { status: 'present' }]);
});

it('opens on the saved filters and page from the route', async () => {
  h.params = { child: 'pupil', year: yearId, month: '2026-10-01', status: 'absent', page: '2' };
  h.other = ok({ years: [{ id: yearId, name: '2026-27', start_date: '2026-04-01', end_date: '2027-03-31' }], today: '2026-11-11' });
  await act(async () => root!.render(<Attendance />));
  expect(lastRows()).toEqual(['guardian:parent:pupil', 60, { yearId, month: '2026-10-01', status: 'absent' }]);
  expect(filters().textContent).toContain('2026-27 · October 2026 · Absent');
});

it('does not carry another child\'s saved filters over to this child', async () => {
  h.params = { child: 'sibling', status: 'absent', page: '2' };
  await act(async () => root!.render(<Attendance />));
  expect(lastRows()).toEqual(['guardian:parent:pupil', 0, {}]);
});

it('ignores route filters it cannot trust and opens page 1 with no filters', async () => {
  h.params = { child: 'pupil', year: 'not-a-year', month: '2026-10-01', status: 'bogus', page: '-3' };
  await act(async () => root!.render(<Attendance />));
  expect(lastRows()).toEqual(['guardian:parent:pupil', 0, {}]);
  h.params = { child: 'pupil', month: '2026-10-01', page: '1.5' };
  await act(async () => root!.unmount()); root = createRoot(container);
  await act(async () => root!.render(<Attendance />));
  expect(lastRows()).toEqual(['guardian:parent:pupil', 0, {}]);
});
