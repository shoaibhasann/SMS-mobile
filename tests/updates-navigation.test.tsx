// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import Notifications from '../src/app/(school)/(tabs)/notifications';
import type { FamilyNotification } from '../src/data/notifications';

const { push, navigate, select, load, subscribe, openURL, resolve, auth, alert } = vi.hoisted(() => ({ push: vi.fn(), navigate: vi.fn(), select: vi.fn(), load: vi.fn(), subscribe: vi.fn(() => () => {}),
  openURL: vi.fn(async () => true), resolve: vi.fn(), auth: { role: 'student' as 'student' | 'parent' }, alert: vi.fn() }));
vi.mock('expo-router', () => ({ router: { push, navigate }, useLocalSearchParams: () => ({}) }));
vi.mock('react-native', () => ({ Alert: { alert }, Linking: { openURL }, View: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('lucide-react-native', () => ({ Bell: () => null, CheckCheck: () => null }));
vi.mock('../src/auth/provider', () => ({ useAuth: () => ({ role: auth.role, access: { userId: 'student' }, client: {} }) }));
vi.mock('../src/data', () => ({ loadFamilyNotificationInbox: vi.fn(), markFamilyNotificationRead: vi.fn(), markAllFamilyNotificationsRead: vi.fn(),
  resolveHomeworkChild: resolve, homeworkError: (cause: Error) => cause.message }));
vi.mock('../src/push', () => ({ subscribePushInboxRefresh: subscribe }));
vi.mock('../src/ui/use-load', () => ({ useLoad: load }));
vi.mock('../src/ui/family', () => ({ useFamily: () => ({ loading: false, error: null, children: [{ id: 'pupil' }], select }) }));
vi.mock('../src/ui/gate-alert-preferences', () => ({ GateAlertPreferences: () => null }));
vi.mock('../src/ui/theme', () => ({ usePalette: () => ({}) }));
vi.mock('../src/ui/primitives', () => ({
  Screen: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  Card: ({ children }: { children: ReactNode }) => <article>{children}</article>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ label, onPress }: { label: string; onPress(): void }) => <button onClick={onPress}>{label}</button>,
  Title: () => null, Skeleton: () => null, ErrorCard: ({ message }: { message: string }) => <p role="alert">{message}</p>,
}));

function update(id: string, kind: FamilyNotification['kind'], title: string, status: FamilyNotification['status']): FamilyNotification {
  return { id, kind, title, status, source_id: id, assessment_id: null, student_id: null, student_name: null, created_at: '2026-11-10T08:30:00Z',
    event_date: '2026-11-10', read_at: null, occurred_at: null, delayed: false };
}

it('keeps summaries readable and opens homework and attendance in the app', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div'), root = createRoot(container);
  const homework = update('51000000-0000-4000-8000-000000000001', 'homework_assigned', 'Practice question', 'published');
  const reload = vi.fn();
  load.mockReturnValue({ reload, data: { unread_count: 5, next_cursor: null, notifications: [
    homework, update('notice', 'announcement', 'Term notice', 'published'), update('fee', 'fee_due', 'November reminder', 'due'),
    update('receipt', 'fee_payment', 'November receipt', 'paid'), { ...update('absence', 'absence', 'Attendance update', 'absent'), student_id: 'pupil', student_name: 'QA student' },
  ] } });
  try {
    await act(async () => root.render(<Notifications />));
    expect(subscribe).toHaveBeenCalledWith({ userId: 'student', role: 'student' }, reload);
    expect(container.textContent).toContain('November receipt');
    expect(container.textContent).not.toContain('QA student');
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.filter(button => button.textContent === 'Mark as read')).toHaveLength(5);
    resolve.mockResolvedValueOnce({ id: 'pupil' });
    await act(async () => buttons.find(button => button.textContent === 'View homework')?.click());
    expect(resolve).toHaveBeenCalledExactlyOnceWith({}, { userId: 'student' }, 'student', [{ id: 'pupil' }], homework.id);
    expect(select).toHaveBeenCalledExactlyOnceWith('pupil');
    expect(push).toHaveBeenCalledExactlyOnceWith({ pathname: '/(school)/homework', params: { child: 'pupil', activity: homework.id } });
    select.mockClear();
    await act(async () => buttons.find(button => button.textContent === 'View attendance')?.click());
    expect(select).toHaveBeenCalledExactlyOnceWith('pupil');
    expect(navigate).toHaveBeenCalledExactlyOnceWith({ pathname: '/(school)/(tabs)/attendance', params: { alert: expect.stringMatching(/^absence:\d+$/) } });
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

async function renderInbox(notifications: FamilyNotification[]) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div'), root = createRoot(container);
  load.mockReturnValue({ reload: vi.fn(), data: { unread_count: notifications.length, next_cursor: null, notifications } });
  await act(async () => root.render(<Notifications />));
  return { container, done: async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); } };
}

it('opens a homework alert that no linked child can see with a clear unavailable message instead of navigating', async () => {
  push.mockClear(); select.mockClear();
  resolve.mockRejectedValueOnce(new Error('This homework is not available for your linked children. Refresh updates or contact your school.'));
  const view = await renderInbox([update('51000000-0000-4000-8000-000000000002', 'homework_assigned', 'Old task', 'published')]);
  try {
    await act(async () => Array.from(view.container.querySelectorAll('button')).find(button => button.textContent === 'View homework')?.click());
    expect(view.container.textContent).toContain('not available for your linked children');
    expect(push).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled();
  } finally { await view.done(); }
});

it.each([['student', ''], ['parent', 'child=pupil&view=guardian&']] as const)('opens notice and fee records on SMS Web for the %s view', async (role, prefix) => {
  auth.role = role; openURL.mockClear();
  const rows = [update('notice', 'announcement', 'Term notice', 'published'), update('fee', 'fee_due', 'November reminder', 'due'), update('receipt', 'fee_payment', 'November receipt', 'paid')]
    .map(row => role === 'parent' ? { ...row, student_id: 'pupil' } : row);
  const view = await renderInbox(rows);
  try {
    const web = Array.from(view.container.querySelectorAll('button')).filter(button => button.textContent === 'Open in SMS Web');
    expect(web).toHaveLength(3);
    for (const button of web) await act(async () => button.click());
    const base = 'https://sms-web-shoaibhasann.vercel.app/modules';
    expect(openURL.mock.calls).toEqual([[`${base}/notices?${prefix}notice=notice`], [`${base}/invoices?${prefix}fee=fee`], [`${base}/invoices?${prefix}payment=receipt`]]);
  } finally { auth.role = 'student'; await view.done(); }
});

it('opens an exam schedule as a stack screen so back returns to the same inbox', async () => {
  push.mockClear();
  const exam = update('61000000-0000-4000-8000-000000000001', 'exam_schedule', 'Unit test 2', 'scheduled');
  const view = await renderInbox([exam]);
  try {
    await act(async () => Array.from(view.container.querySelectorAll('button')).find(button => button.textContent === 'View exam schedule')?.click());
    expect(push).toHaveBeenCalledExactlyOnceWith({ pathname: '/(school)/exam', params: { assessment: exam.source_id } });
    expect(view.container.textContent).toContain('Unit test 2');
  } finally { await view.done(); }
});
