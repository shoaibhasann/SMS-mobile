// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const uuid = (n: number) => `65000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Input = { value: string; editable?: boolean; onChangeText(value: string): void };
const h = vi.hoisted(() => ({ secure: new Map<string, string>(), submit: vi.fn(), next: 0, inputs: {} as Record<string, Input>, pickerDisabled: null as boolean | null }));
vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() }, Platform: { OS: 'android' },
  KeyboardAvoidingView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TextInput: (props: Input & { accessibilityLabel: string }) => { h.inputs[props.accessibilityLabel] = props; return <input readOnly value={props.value} />; },
}));
vi.mock('expo-router', () => ({ router: { back: vi.fn(), replace: vi.fn(), setParams: vi.fn(), canGoBack: () => true }, useLocalSearchParams: () => ({}) }));
vi.mock('expo-crypto', () => ({ randomUUID: () => uuid(100 + ++h.next) }));
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0,
  getItemAsync: async (key: string) => h.secure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { h.secure.set(key, value); },
  deleteItemAsync: async (key: string) => { h.secure.delete(key); },
}));
vi.mock('../src/auth/provider', () => ({ useAuth: () => ({ role: 'parent', access: { userId: uuid(1), schoolId: uuid(2) }, client: {} }) }));
vi.mock('../src/data/leave', async importOriginal => ({ ...await importOriginal<typeof import('../src/data/leave')>(), submitStudentLeave: h.submit, listFamilyStudentLeave: vi.fn(), getFamilyNotificationLeave: vi.fn() }));
vi.mock('../src/ui/family', () => ({
  ChildPicker: ({ disabled }: { disabled?: boolean }) => { h.pickerDisabled = !!disabled; return null; },
  useFamily: () => ({ loading: false, error: null, children: [{ id: uuid(3), status: 'active' }, { id: uuid(4), status: 'active' }], selected: { id: uuid(3), status: 'active' }, select: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('../src/ui/use-load', () => ({ useLoad: () => ({ loading: false, error: null, data: null, reload: vi.fn() }) }));
vi.mock('../src/ui/theme', () => ({ usePalette: () => ({}) }));
vi.mock('../src/ui/primitives', () => ({
  Screen: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  Card: ({ children }: { children: ReactNode }) => <article>{children}</article>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ label, onPress, disabled }: { label: string; onPress(): void; disabled?: boolean }) => <button disabled={disabled} onClick={onPress}>{label}</button>,
  BackArrow: () => null, Title: () => null, Skeleton: () => null, ErrorCard: ({ message }: { message: string }) => <p role="alert">{message}</p>,
}));
import Leave from '../src/app/(school)/leave';
import { StudentLeaveError } from '../src/data/leave';

let root: ReturnType<typeof createRoot> | null = null;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); h.secure.clear(); h.submit.mockReset(); });
afterEach(async () => { await act(async () => root?.unmount()); root = null; vi.unstubAllGlobals(); });
const button = (container: HTMLElement, label: string) => Array.from(container.querySelectorAll('button')).find(value => value.textContent === label)!;

async function lockedAfterLostResponse() {
  const container = document.createElement('div'); root = createRoot(container);
  await act(async () => root!.render(<Leave />));
  await act(async () => {
    h.inputs['Start date, YYYY-MM-DD'].onChangeText('2026-11-10');
    h.inputs['End date, YYYY-MM-DD'].onChangeText('2026-11-10');
    h.inputs['Reason for leave'].onChangeText('Family function');
  });
  h.submit.mockRejectedValueOnce(new Error('Network request failed'));
  await act(async () => button(container, 'Submit leave request').click());
  expect(container.textContent).toContain('Confirm your submitted request');
  expect(h.inputs['Reason for leave'].editable).toBe(false);
  expect(h.pickerDisabled).toBe(true);
  return container;
}

it('unlocks a retried leave request that now overlaps a saved request (PT409), keeping its dates and reason', async () => {
  const container = await lockedAfterLostResponse();
  h.submit.mockRejectedValueOnce(new StudentLeaveError('This request conflicts with a saved request.', 'PT409'));
  await act(async () => button(container, 'Retry this same request').click());
  expect(container.textContent).toContain('Request leave');
  expect(container.textContent).not.toContain('Confirm your submitted request');
  expect(h.inputs['Reason for leave']).toMatchObject({ editable: true, value: 'Family function' });
  expect(h.inputs['Start date, YYYY-MM-DD'].value).toBe('2026-11-10');
  expect(h.pickerDisabled).toBe(false);
  expect([...h.secure.keys()].filter(key => key.startsWith('sms.leave.pending'))).toEqual([]);
});

it('keeps a retried leave request locked on 42501, which the server can raise before its idempotency lookup', async () => {
  const container = await lockedAfterLostResponse();
  h.submit.mockRejectedValueOnce(new StudentLeaveError('Access could not be verified.', '42501'));
  await act(async () => button(container, 'Retry this same request').click());
  expect(container.textContent).toContain('Confirm your submitted request');
  expect(h.pickerDisabled).toBe(true);
});
