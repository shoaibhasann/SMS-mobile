// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const uuid = (n: number) => `67000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const h = vi.hoisted(() => ({ refresh: vi.fn(), reload: vi.fn(), inputs: new Map<string, (value: string) => void>() }));
vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() }, Platform: { OS: 'android' },
  KeyboardAvoidingView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress?(): void }) => <button onClick={onPress}>{children}</button>,
  TextInput: (props: { value: string; accessibilityLabel: string; onChangeText(value: string): void }) => { h.inputs.set(props.accessibilityLabel, props.onChangeText); return <input readOnly value={props.value} />; },
}));
vi.mock('expo-router', () => ({ router: { back: vi.fn(), push: vi.fn(), replace: vi.fn(), setParams: vi.fn(), canGoBack: () => true }, useLocalSearchParams: () => ({}) }));
vi.mock('expo-crypto', () => ({ randomUUID: () => uuid(100) }));
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0, getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
vi.mock('../src/auth/provider', () => ({ useAuth: () => ({ role: 'parent', access: { userId: uuid(1), schoolId: uuid(2) }, client: {}, revision: 0 }) }));
vi.mock('../src/ui/family', () => ({ ChildPicker: () => null,
  useFamily: () => ({ loading: false, error: null, children: [{ id: uuid(3), status: 'active' }], selected: { id: uuid(3), status: 'active' }, select: vi.fn(), refresh: h.refresh }) }));
// Every read fails (for example the child link was revoked), except the leave decision read, which has no request.
vi.mock('../src/ui/use-load', () => ({ useLoad: (key: string) => ({ loading: false, data: null, error: key.includes(':decision:') ? null : 'Student access is no longer available.', reload: h.reload }) }));
vi.mock('../src/ui/theme', () => ({ usePalette: () => ({}) }));
vi.mock('../src/ui/primitives', () => ({
  Screen: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  Card: ({ children }: { children: ReactNode }) => <article>{children}</article>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ label, onPress, disabled }: { label: string; onPress(): void; disabled?: boolean }) => <button disabled={disabled} onClick={onPress}>{label}</button>,
  BackArrow: () => null, Title: () => null, Skeleton: () => null,
  ErrorCard: ({ message, retry }: { message: string; retry?(): void }) => <p role="alert">{message}{retry && <button onClick={retry}>Retry</button>}</p>,
}));
import Results from '../src/app/(school)/results';
import AcademicAnalysis from '../src/app/(school)/academic-analysis';
import Leave from '../src/app/(school)/leave';

let root: ReturnType<typeof createRoot> | null = null, container: HTMLElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); h.refresh.mockReset(); h.reload.mockReset(); h.inputs.clear(); container = document.createElement('div'); root = createRoot(container); });
afterEach(async () => { await act(async () => root?.unmount()); root = null; vi.unstubAllGlobals(); });
const click = (label: string) => act(async () => Array.from(container.querySelectorAll('button')).find(value => value.textContent === label)!.click());

it('re-checks the linked children when a failed published-results read is retried or refreshed', async () => {
  await act(async () => root!.render(<Results />));
  await click('Retry');
  await click('Refresh published results');
  expect(h.refresh).toHaveBeenCalledTimes(2);
  expect(h.reload).not.toHaveBeenCalled();
});

it('re-checks the linked children when a failed academic analysis is retried', async () => {
  await act(async () => root!.render(<AcademicAnalysis />));
  await click('Retry');
  expect(h.refresh).toHaveBeenCalledOnce();
  expect(h.reload).not.toHaveBeenCalled();
});

it('re-checks the linked children when failed leave history is retried, but keeps an unsent draft by retrying locally', async () => {
  await act(async () => root!.render(<Leave />));
  await click('Retry');
  await click('Refresh history');
  expect(h.refresh).toHaveBeenCalledTimes(2);
  expect(h.reload).not.toHaveBeenCalled();
  await act(async () => h.inputs.get('Reason for leave')!('Family function'));
  await click('Retry');
  expect(h.refresh).toHaveBeenCalledTimes(2);
  expect(h.reload).toHaveBeenCalledOnce();
});
