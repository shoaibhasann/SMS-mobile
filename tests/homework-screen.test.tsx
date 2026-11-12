// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const uuid = (n: number) => `65000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const h = vi.hoisted(() => ({
  secure: new Map<string, string>(), submit: vi.fn(), external: vi.fn(), next: 0, prevent: [] as boolean[], saved: null as unknown,
  input: null as null | { onChangeText(value: string): void }, loadError: '', refresh: vi.fn(), reload: vi.fn(),
}));
vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() }, Platform: { OS: 'android' },
  KeyboardAvoidingView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TextInput: (props: { value: string; onChangeText(value: string): void }) => { h.input = props; return <textarea readOnly value={props.value} />; },
}));
vi.mock('expo-router', () => ({ router: { back: vi.fn(), replace: vi.fn(), canGoBack: () => true }, useLocalSearchParams: () => ({ activity: uuid(9) }),
  usePreventRemove: (prevent: boolean) => { h.prevent.push(prevent); } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => uuid(100 + ++h.next) }));
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0,
  getItemAsync: async (key: string) => h.secure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { h.secure.set(key, value); },
  deleteItemAsync: async (key: string) => { h.secure.delete(key); },
}));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: vi.fn() }));
vi.mock('expo-file-system', () => ({ Paths: { cache: { uri: 'file:///cache/' } }, File: class {} }));
vi.mock('lucide-react-native', () => ({ Paperclip: () => null }));
vi.mock('../src/auth/provider', () => ({ useAuth: () => ({ role: 'student', access: { userId: uuid(1), schoolId: uuid(2) }, client: {}, whileExternal: h.external }) }));
vi.mock('../src/data/homework', async importOriginal => ({ ...await importOriginal<typeof import('../src/data/homework')>(), getHomework: vi.fn(), loadSubmission: vi.fn(), submitHomework: h.submit }));
vi.mock('../src/data/homework-files', () => ({ discardHomeworkFile: vi.fn(), homeworkFileMaxBytes: 1, uploadHomeworkFile: vi.fn() }));
vi.mock('../src/ui/family', () => ({ ChildPicker: () => null, useFamily: () => ({ loading: false, error: null, children: [], selected: { id: uuid(3) }, refresh: h.refresh }) }));
vi.mock('../src/ui/theme', () => ({ usePalette: () => ({}) }));
vi.mock('../src/ui/use-load', () => ({ useLoad: () => h.loadError ? { loading: false, error: h.loadError, data: null, reload: h.reload } : ({ loading: false, error: null, reload: vi.fn(),
  data: { work: { id: uuid(9), title: 'Fractions', dueDate: null, maxMarks: null, description: null, sectionId: uuid(4) }, saved: h.saved, intent: null } }) }));
vi.mock('../src/ui/primitives', () => ({
  Screen: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  Card: ({ children }: { children: ReactNode }) => <article>{children}</article>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ label, onPress, disabled }: { label: string; onPress(): void; disabled?: boolean }) => <button disabled={disabled} onClick={onPress}>{label}</button>,
  BackArrow: ({ disabled }: { disabled?: boolean }) => <button disabled={disabled}>Back</button>,
  Title: () => null, Skeleton: () => null, ErrorCard: ({ message, retry }: { message: string; retry?(): void }) => <><p role="alert">{message}</p>{retry && <button onClick={retry}>Retry error</button>}</>,
}));
import Homework from '../src/app/(school)/homework';

let root: ReturnType<typeof createRoot> | null = null, container: HTMLElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); h.secure.clear(); h.submit.mockReset(); h.external.mockReset(); h.prevent = []; h.saved = null; h.loadError = ''; h.refresh.mockReset(); h.reload.mockReset();
  container = document.createElement('div'); root = createRoot(container);
});
afterEach(async () => { await act(async () => root?.unmount()); root = null; vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const button = (label: string) => Array.from(container.querySelectorAll('button')).find(value => value.textContent === label)!;
const stalled = () => h.submit.mockImplementation((...args: unknown[]) => new Promise((_, reject) => (args[6] as AbortSignal | undefined)?.addEventListener('abort', () =>
  reject(Object.assign(new Error('Homework action cancelled.'), { name: 'AbortError' })))));

it('bounds a stalled submit with a timeout and shows it as unconfirmed with a retry', async () => {
  vi.useFakeTimers();
  stalled();
  await act(async () => root!.render(<Homework />));
  await act(async () => h.input!.onChangeText('My answer'));
  await act(async () => button('Submit homework').click());
  expect(button('Please wait…')).toBeDefined();
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect((h.submit.mock.calls[0][6] as AbortSignal).aborted).toBe(true);
  expect(container.textContent).toContain('Submission not confirmed yet');
  expect(container.textContent).toContain('The school did not respond in time');
  expect(button('Retry the same submission').disabled).toBe(false);
});

it('never traps navigation while busy, and leaving aborts the in-flight submit', async () => {
  stalled();
  await act(async () => root!.render(<Homework />));
  await act(async () => h.input!.onChangeText('My answer'));
  await act(async () => button('Submit homework').click());
  expect(button('Please wait…')).toBeDefined();
  expect(button('Back').disabled).toBe(false);
  expect(h.prevent.at(-1)).toBe(false);
  await act(async () => root!.unmount()); root = null;
  expect((h.submit.mock.calls[0][6] as AbortSignal).aborted).toBe(true);
});

it('allows leaving while an attachment pick or upload is in progress', async () => {
  h.external.mockReturnValue(new Promise(() => {}));
  await act(async () => root!.render(<Homework />));
  await act(async () => button('Attach PDF or photo').click());
  expect(button('Attach PDF or photo').disabled).toBe(true);
  expect(button('Back').disabled).toBe(false);
  expect(h.prevent.at(-1)).toBe(false);
});

it('shows the saved time in IST whatever the device timezone', async () => {
  h.saved = { id: uuid(5), revision: 1, status: 'submitted', text_response: 'Done', file_path: null, file_name: null, submitted_at: '2026-11-11T19:00:00Z', marks: null, feedback: null };
  vi.stubEnv('TZ', 'UTC');
  await act(async () => root!.render(<Homework />));
  expect(container.textContent).toMatch(/Saved 12 Nov 2026, 12:30\s?am IST/i);
});

it('re-checks the linked children when a failed homework read is retried, but retries locally while an unsent draft is open', async () => {
  h.loadError = 'This homework is no longer available.';
  await act(async () => root!.render(<Homework />));
  await act(async () => button('Retry error').click());
  expect(h.refresh).toHaveBeenCalledOnce();
  h.loadError = '';
  await act(async () => root!.render(<Homework />));
  await act(async () => h.input!.onChangeText('My unsent answer'));
  h.loadError = 'Connection lost.';
  await act(async () => root!.render(<Homework />));
  await act(async () => button('Retry error').click());
  expect(h.refresh).toHaveBeenCalledOnce();
  expect(h.reload).toHaveBeenCalledOnce();
});
