// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';

type Choice = { text: string; onPress?(): void };
const h = vi.hoisted(() => ({ alert: vi.fn(), markAll: vi.fn(async () => undefined), auth: { role: 'parent' as 'parent' | 'student' } }));
vi.mock('expo-router', () => ({ router: { push: vi.fn(), navigate: vi.fn(), setParams: vi.fn() }, useLocalSearchParams: () => ({}) }));
vi.mock('react-native', () => ({ Alert: { alert: h.alert }, Linking: { openURL: vi.fn() }, View: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('lucide-react-native', () => ({ Bell: () => null, CheckCheck: () => null }));
vi.mock('../src/auth/provider', () => ({ useAuth: () => ({ role: h.auth.role, access: { userId: 'guardian' }, client: {} }) }));
vi.mock('../src/data', () => ({ loadFamilyNotificationInbox: vi.fn(), markFamilyNotificationRead: vi.fn(), markAllFamilyNotificationsRead: h.markAll, resolveHomeworkChild: vi.fn(), homeworkError: vi.fn() }));
vi.mock('../src/push', () => ({ subscribePushInboxRefresh: () => () => {} }));
vi.mock('../src/ui/use-load', () => ({ useLoad: () => ({ reload: vi.fn(), loading: false, error: null, data: { unread_count: 2, next_cursor: null, notifications: [] } }) }));
vi.mock('../src/ui/family', () => ({ useFamily: () => ({ loading: false, error: null, children: [], select: vi.fn() }) }));
vi.mock('../src/ui/gate-alert-preferences', () => ({ GateAlertPreferences: () => null }));
vi.mock('../src/ui/theme', () => ({ usePalette: () => ({}) }));
vi.mock('../src/ui/primitives', () => ({
  Screen: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  Card: ({ children }: { children: ReactNode }) => <article>{children}</article>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ label, onPress, selected }: { label: string; onPress(): void; selected?: boolean }) => <button aria-selected={selected} onClick={onPress}>{label}</button>,
  Title: () => null, Skeleton: () => null, ErrorCard: () => null,
}));
import Notifications from '../src/app/(school)/(tabs)/notifications';

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); h.alert.mockReset(); h.markAll.mockClear(); h.auth.role = 'parent'; });
async function mount() {
  const container = document.createElement('div'), root = createRoot(container);
  await act(async () => root.render(<Notifications />));
  return { container, unmount: () => act(async () => root.unmount()) };
}
async function openConfirmation() {
  const view = await mount();
  await act(async () => Array.from(view.container.querySelectorAll('button')).find(button => button.textContent === 'Mark all as read')!.click());
  const confirm = (h.alert.mock.calls.at(-1)![2] as Choice[]).find(choice => choice.text === 'Mark all as read')!;
  return { ...view, confirm };
}

it('marks all read from a mounted inbox', async () => {
  const view = await openConfirmation();
  await act(async () => view.confirm.onPress!());
  expect(h.markAll).toHaveBeenCalledExactlyOnceWith({}, 'parent');
  await view.unmount();
});

it('applies a confirmation made in a dialog that outlived backgrounding through the remounted inbox', async () => {
  const stale = await openConfirmation();
  await stale.unmount();
  const live = await mount();
  await act(async () => stale.confirm.onPress!());
  expect(h.markAll).toHaveBeenCalledExactlyOnceWith({}, 'parent');
  await live.unmount();
});

it('never drops a stale confirmation silently when no matching inbox is on screen', async () => {
  const stale = await openConfirmation();
  await stale.unmount();
  h.auth.role = 'student';
  const other = await mount();
  await act(async () => stale.confirm.onPress!());
  expect(h.markAll).not.toHaveBeenCalled();
  expect(h.alert).toHaveBeenLastCalledWith('Updates not marked', 'Reopen Updates and try again.');
  await other.unmount();
  await act(async () => stale.confirm.onPress!());
  expect(h.markAll).not.toHaveBeenCalled();
});

it('marks the active All/Unread filter as selected for screen readers', async () => {
  const view = await mount();
  const filter = (label: string) => Array.from(view.container.querySelectorAll('button')).find(button => button.textContent === label)!;
  expect(filter('All').getAttribute('aria-selected')).toBe('true');
  expect(filter('Unread').getAttribute('aria-selected')).toBe('false');
  await act(async () => filter('Unread').click());
  expect(filter('All').getAttribute('aria-selected')).toBe('false');
  expect(filter('Unread').getAttribute('aria-selected')).toBe('true');
  await view.unmount();
});
