// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import Notifications from '../src/app/(school)/(tabs)/notifications';
import type { FamilyNotification } from '../src/data/notifications';

const { push, navigate, select, load, subscribe } = vi.hoisted(() => ({ push: vi.fn(), navigate: vi.fn(), select: vi.fn(), load: vi.fn(), subscribe: vi.fn(() => () => {}) }));
vi.mock('expo-router', () => ({ router: { push, navigate }, useLocalSearchParams: () => ({}) }));
vi.mock('react-native', () => ({ Alert: {}, View: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('lucide-react-native', () => ({ Bell: () => null, CheckCheck: () => null }));
vi.mock('../src/auth/provider', () => ({ useAuth: () => ({ role: 'student', access: { userId: 'student' }, client: {} }) }));
vi.mock('../src/data', () => ({ loadFamilyNotificationInbox: vi.fn(), markFamilyNotificationRead: vi.fn(), markAllFamilyNotificationsRead: vi.fn() }));
vi.mock('../src/push', () => ({ subscribePushInboxRefresh: subscribe }));
vi.mock('../src/ui/use-load', () => ({ useLoad: load }));
vi.mock('../src/ui/family', () => ({ useFamily: () => ({ children: [{ id: 'pupil' }], select }) }));
vi.mock('../src/ui/exam-schedule', () => ({ ExamSchedule: () => null }));
vi.mock('../src/ui/gate-alert-preferences', () => ({ GateAlertPreferences: () => null }));
vi.mock('../src/ui/theme', () => ({ usePalette: () => ({}) }));
vi.mock('../src/ui/primitives', () => ({
  Screen: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  Card: ({ children }: { children: ReactNode }) => <article>{children}</article>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ label, onPress }: { label: string; onPress(): void }) => <button onClick={onPress}>{label}</button>,
  Title: () => null, Skeleton: () => null, ErrorCard: () => null,
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
    expect(container.textContent).not.toContain('Open in SMS Web');
    expect(container.textContent).not.toContain('QA student');
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.filter(button => button.textContent === 'Mark as read')).toHaveLength(5);
    await act(async () => buttons.find(button => button.textContent === 'View homework')?.click());
    expect(push).toHaveBeenCalledExactlyOnceWith({ pathname: '/(school)/homework', params: { activity: homework.id } });
    await act(async () => buttons.find(button => button.textContent === 'View attendance')?.click());
    expect(select).toHaveBeenCalledExactlyOnceWith('pupil');
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/(school)/(tabs)/attendance');
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
