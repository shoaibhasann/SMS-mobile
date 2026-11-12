// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const uuid = (n: number) => `64000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const h = vi.hoisted(() => ({
  secure: new Map<string, string>(), submit: vi.fn(), reload: vi.fn(), next: 0,
  input: null as null | { value: string; editable?: boolean; onChangeText(value: string): void },
}));
vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() }, Platform: { OS: 'android' },
  KeyboardAvoidingView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TextInput: (props: { value: string; editable?: boolean; onChangeText(value: string): void }) => { h.input = props; return <textarea readOnly value={props.value} />; },
}));
vi.mock('expo-router', () => ({ router: { back: vi.fn(), replace: vi.fn(), canGoBack: () => true }, useLocalSearchParams: () => ({ activity: uuid(9) }), usePreventRemove: () => {} }));
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
vi.mock('../src/auth/provider', () => ({ useAuth: () => ({ role: 'student', access: { userId: uuid(1), schoolId: uuid(2) }, client: {}, whileExternal: vi.fn() }) }));
vi.mock('../src/data/homework', async importOriginal => ({ ...await importOriginal<typeof import('../src/data/homework')>(), getHomework: vi.fn(), loadSubmission: vi.fn(), submitHomework: h.submit }));
vi.mock('../src/data/homework-files', () => ({ discardHomeworkFile: vi.fn(), homeworkFileMaxBytes: 1, uploadHomeworkFile: vi.fn() }));
vi.mock('../src/ui/family', () => ({ ChildPicker: () => null, useFamily: () => ({ loading: false, error: null, children: [], selected: { id: uuid(3) }, refresh: vi.fn() }) }));
vi.mock('../src/ui/theme', () => ({ usePalette: () => ({}) }));
vi.mock('../src/ui/use-load', () => ({ useLoad: () => ({ loading: false, error: null, reload: h.reload,
  data: { work: { id: uuid(9), title: 'Fractions', dueDate: null, maxMarks: null, description: null, sectionId: null }, saved: null, intent: null } }) }));
vi.mock('../src/ui/primitives', () => ({
  Screen: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  Card: ({ children }: { children: ReactNode }) => <article>{children}</article>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ label, onPress, disabled }: { label: string; onPress(): void; disabled?: boolean }) => <button disabled={disabled} onClick={onPress}>{label}</button>,
  BackArrow: () => null, Title: () => null, Skeleton: () => null, ErrorCard: ({ message }: { message: string }) => <p role="alert">{message}</p>,
}));
import Homework from '../src/app/(school)/homework';

let root: ReturnType<typeof createRoot> | null = null;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); h.secure.clear(); h.submit.mockReset(); });
afterEach(async () => { await act(async () => root?.unmount()); root = null; vi.unstubAllGlobals(); });
const button = (container: HTMLElement, label: string) => Array.from(container.querySelectorAll('button')).find(value => value.textContent === label)!;

async function lockedAfterLostResponse() {
  const container = document.createElement('div'); root = createRoot(container);
  await act(async () => root!.render(<Homework />));
  await act(async () => h.input!.onChangeText('My answer'));
  h.submit.mockRejectedValueOnce(new Error('Network request failed'));
  await act(async () => button(container, 'Submit homework').click());
  expect(container.textContent).toContain('Submission not confirmed yet');
  expect(button(container, 'Refresh homework').disabled).toBe(true);
  expect(h.input!.editable).toBe(false);
  return container;
}

it.each(['PT409', '22023'])('unlocks a retried request the server rejected with %s after its request-id lookup, keeping the answer', async code => {
  const container = await lockedAfterLostResponse();
  h.submit.mockRejectedValueOnce(Object.assign(new Error('rejected'), { code }));
  await act(async () => button(container, 'Retry the same submission').click());
  expect(container.textContent).not.toContain('Submission not confirmed yet');
  expect(button(container, 'Refresh homework').disabled).toBe(false);
  expect(h.input!.editable).toBe(true);
  expect(h.input!.value).toBe('My answer');
  expect([...h.secure.keys()].filter(key => key.startsWith('sms.homework.pending'))).toEqual([]);
});

it('keeps a retried request locked on 42501, which the server can raise before its request-id lookup', async () => {
  const container = await lockedAfterLostResponse();
  h.submit.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: '42501' }));
  await act(async () => button(container, 'Retry the same submission').click());
  expect(container.textContent).toContain('Submission not confirmed yet');
  expect(button(container, 'Refresh homework').disabled).toBe(true);
  expect([...h.secure.keys()].some(key => key.startsWith('sms.homework.pending'))).toBe(true);
});
