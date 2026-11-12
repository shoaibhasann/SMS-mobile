// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { StudentLeaveRequest } from '../src/data/leave';

const uuid = (n: number) => `66000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const h = vi.hoisted(() => ({ history: [] as unknown[] }));
vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() }, Platform: { OS: 'android' },
  KeyboardAvoidingView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, onPress, accessibilityLabel }: { children: ReactNode; onPress?(): void; accessibilityLabel?: string }) => <button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>,
  TextInput: (props: { value: string }) => <input readOnly value={props.value} />,
}));
vi.mock('expo-router', () => ({ router: { back: vi.fn(), replace: vi.fn(), setParams: vi.fn(), canGoBack: () => true }, useLocalSearchParams: () => ({}) }));
vi.mock('expo-crypto', () => ({ randomUUID: () => uuid(100) }));
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0, getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
vi.mock('../src/auth/provider', () => ({ useAuth: () => ({ role: 'parent', access: { userId: uuid(1), schoolId: uuid(2) }, client: {} }) }));
vi.mock('../src/data/leave', async importOriginal => ({ ...await importOriginal<typeof import('../src/data/leave')>(), submitStudentLeave: vi.fn(), listFamilyStudentLeave: vi.fn(), getFamilyNotificationLeave: vi.fn() }));
vi.mock('../src/ui/family', () => ({ ChildPicker: () => null,
  useFamily: () => ({ loading: false, error: null, children: [{ id: uuid(3), status: 'active' }], selected: { id: uuid(3), status: 'active' }, select: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../src/ui/use-load', () => ({ useLoad: (key: string) => ({ loading: false, error: null, data: key.includes(':decision:') ? null : h.history, reload: vi.fn() }) }));
vi.mock('../src/ui/theme', () => ({ usePalette: () => ({}) }));
vi.mock('../src/ui/primitives', () => ({
  Screen: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  Card: ({ children }: { children: ReactNode }) => <article>{children}</article>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ label, onPress, disabled }: { label: string; onPress(): void; disabled?: boolean }) => <button disabled={disabled} onClick={onPress}>{label}</button>,
  BackArrow: () => null, Title: () => null, Skeleton: () => null, ErrorCard: ({ message }: { message: string }) => <p role="alert">{message}</p>,
}));
import Leave from '../src/app/(school)/leave';

let root: ReturnType<typeof createRoot> | null = null;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubEnv('TZ', 'UTC'); });
afterEach(async () => { await act(async () => root?.unmount()); root = null; vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('shows leave request and decision dates in IST whatever the device timezone', async () => {
  const row: StudentLeaveRequest = { id: uuid(5), school_id: uuid(2), student_id: uuid(3), student_name: 'QA pupil', admission_no: 'A1', academic_year_id: uuid(6),
    academic_year_name: '2026–27', class_name: 'Class 5', section_name: 'A', start_date: '2026-11-13', end_date: '2026-11-13', reason: 'Family function', status: 'approved',
    requester_id: uuid(1), requester_name: 'QA guardian', created_at: '2026-11-11T19:00:00Z', reviewed_by: uuid(7), reviewer_name: 'Office',
    review_note: 'Approved', reviewed_at: '2026-11-11T19:30:00Z', total_count: 1 };
  h.history = [row];
  const container = document.createElement('div'); root = createRoot(container);
  await act(async () => root!.render(<Leave />));
  await act(async () => (container.querySelector('button[aria-label="Show leave details"]') as HTMLElement).click());
  expect(container.textContent).toContain('Requested by QA guardian · 12 Nov 2026');
  expect(container.textContent).toContain('Office · 12 Nov 2026');
});
