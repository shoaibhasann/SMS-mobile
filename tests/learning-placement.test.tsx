// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

const load = vi.hoisted(() => vi.fn());
vi.mock('react-native', () => {
  const Box = ({ children, accessibilityLabel }: { children?: ReactNode; accessibilityLabel?: string }) => <div aria-label={accessibilityLabel}>{children}</div>;
  return { View: Box, Pressable: Box };
});
vi.mock('lucide-react-native', () => ({ BookOpen: () => null, CalendarDays: () => null, ChartNoAxesColumnIncreasing: () => null, ChevronRight: () => null, GraduationCap: () => null }));
vi.mock('expo-router', () => ({ router: { push: vi.fn(), back: vi.fn(), replace: vi.fn(), canGoBack: () => true } }));
vi.mock('../src/auth/provider', () => ({ useAuth: () => ({ role: 'parent', access: { userId: 'u', schoolId: 's' }, client: {} }) }));
vi.mock('../src/ui/family', () => ({ ChildPicker: () => null, useFamily: () => ({ loading: false, error: null, children: [{ id: 'p' }], selected: { id: 'p' }, refresh: vi.fn() }) }));
vi.mock('../src/ui/use-load', () => ({ useLoad: load }));
vi.mock('../src/ui/theme', () => ({ usePalette: () => ({}) }));
vi.mock('../src/ui/primitives', () => ({
  Screen: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  Card: ({ children }: { children: ReactNode }) => <article>{children}</article>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ label }: { label: string }) => <button>{label}</button>,
  BackArrow: () => null, Title: () => null, Skeleton: () => null, ErrorCard: () => null,
}));
import Learning from '../src/app/(school)/(tabs)/learning';
import AcademicAnalysis from '../src/app/(school)/academic-analysis';

let root: ReturnType<typeof createRoot> | null = null;
afterEach(async () => { await act(async () => root?.unmount()); root = null; vi.unstubAllGlobals(); vi.useRealTimers(); });
async function render(node: ReactNode) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div'); root = createRoot(container);
  await act(async () => root!.render(node));
  return container;
}
const page = (placed: boolean, rows: unknown[] = [], statuses = new Map<string, string>()) => ({ loading: false, error: null, reload: vi.fn(), data: { rows, total: rows.length, offset: 0, placed, statuses } });

it('tells families of an unplaced pupil there is no current class instead of “no homework yet”', async () => {
  load.mockReturnValue(page(false));
  const container = await render(<Learning />);
  expect(container.textContent).toContain('No current class placement');
  expect(container.textContent).not.toContain('No homework yet');
});

it('keeps “No homework yet” for a placed pupil and marks unsubmitted past-due work as overdue in IST', async () => {
  load.mockReturnValue(page(true));
  expect((await render(<Learning />)).textContent).toContain('No homework yet');
  await act(async () => root!.unmount());
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-10T19:00:00Z')); // 11 Nov, 00:30 IST
  const base = { maxMarks: null, title: 'Task' };
  load.mockReturnValue(page(true, [{ ...base, id: 'due-today', dueDate: '2026-11-11' }, { ...base, id: 'late', dueDate: '2026-11-10' }, { ...base, id: 'done', dueDate: '2026-11-01' }],
    new Map([['done', 'submitted']])));
  const container = await render(<Learning />);
  const labels = Array.from(container.querySelectorAll('[aria-label]')).map(node => node.getAttribute('aria-label')).filter(label => label?.startsWith('Task'));
  expect(labels).toEqual(['Task, Due 11 Nov 2026, Not submitted', 'Task, Due 10 Nov 2026, Overdue, Not submitted', 'Task, Due 1 Nov 2026, Submitted']);
});

it('does not call past-due work overdue when the submission status read failed', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-10T19:00:00Z'));
  load.mockReturnValue(page(true, [{ id: 'late', dueDate: '2026-11-01', maxMarks: null, title: 'Task' }], null as unknown as Map<string, string>));
  const container = await render(<Learning />);
  expect(container.querySelector('[aria-label^="Task"]')?.getAttribute('aria-label')).toBe('Task, Due 1 Nov 2026');
  expect(container.textContent).not.toContain('Overdue');
  expect(container.textContent).toContain('Submission status is unavailable');
});

it('says academic analysis has no current class placement instead of “0 published tasks”', async () => {
  load.mockReturnValue({ loading: false, error: null, reload: vi.fn(), data: { results: { rows: [], total_count: 0 }, homeworkCount: 0, homeworkPlaced: false, summary: null } });
  const container = await render(<AcademicAnalysis />);
  expect(container.textContent).toContain('No current class placement this session');
  expect(container.textContent).not.toContain('published tasks');
});
