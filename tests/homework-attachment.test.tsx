// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const activity = '61000000-0000-4000-8000-000000000001';
const h = vi.hoisted(() => {
  const state = { insideExternal: false, pickedInside: [] as boolean[], input: null as null | { value: string; onChangeText(value: string): void } };
  return {
    state,
    whileExternal: vi.fn(async <T,>(work: () => Promise<T>) => { state.insideExternal = true; try { return await work(); } finally { state.insideExternal = false; } }),
    pick: vi.fn(),
    upload: vi.fn(),
  };
});
vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() }, Platform: { OS: 'android' },
  KeyboardAvoidingView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TextInput: (props: { value: string; onChangeText(value: string): void }) => { h.state.input = props; return <textarea readOnly value={props.value} />; },
}));
vi.mock('expo-router', () => ({ router: { back: vi.fn(), replace: vi.fn(), canGoBack: () => true }, useLocalSearchParams: () => ({ activity }), usePreventRemove: () => {} }));
vi.mock('expo-crypto', () => ({ randomUUID: () => '62000000-0000-4000-8000-000000000001' }));
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn(), WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0 }));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: h.pick }));
vi.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  File: class { exists = true; size = 4; constructor(public uri: string) {} async arrayBuffer() { return new ArrayBuffer(4); } async delete() { this.exists = false; } },
}));
vi.mock('lucide-react-native', () => ({ Paperclip: () => null }));
vi.mock('../src/auth/provider', () => ({ useAuth: () => ({ role: 'student', access: { userId: 'student-a', schoolId: 'school-a' }, client: {}, whileExternal: h.whileExternal }) }));
vi.mock('../src/data/homework', () => ({
  definitiveHomeworkError: () => false, homeworkError: () => 'Homework failed.', homeworkUuid: (value: unknown) => typeof value === 'string',
  getHomework: vi.fn(), loadSubmission: vi.fn(), submitHomework: vi.fn(),
}));
vi.mock('../src/data/homework-files', () => ({ discardHomeworkFile: vi.fn(), homeworkFileMaxBytes: 10 * 1024 * 1024, uploadHomeworkFile: h.upload }));
vi.mock('../src/data/pending-homework', () => ({ createPendingHomeworkStore: () => ({ read: vi.fn(), prepare: vi.fn(), complete: vi.fn() }) }));
vi.mock('../src/ui/family', () => ({ ChildPicker: () => null, useFamily: () => ({ loading: false, error: null, children: [], selected: { id: 'pupil-a' }, refresh: vi.fn() }) }));
vi.mock('../src/ui/theme', () => ({ usePalette: () => ({}) }));
vi.mock('../src/ui/use-load', () => ({ useLoad: () => ({ loading: false, error: null, reload: vi.fn(),
  data: { work: { title: 'Fractions', dueDate: null, maxMarks: null, description: null, sectionId: 'section-a' }, saved: null, intent: null } }) }));
vi.mock('../src/ui/primitives', () => ({
  Screen: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  Card: ({ children }: { children: ReactNode }) => <article>{children}</article>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ label, onPress, disabled }: { label: string; onPress(): void; disabled?: boolean }) => <button disabled={disabled} onClick={onPress}>{label}</button>,
  BackArrow: () => null, Title: () => null, Skeleton: () => null, ErrorCard: ({ message }: { message: string }) => <p role="alert">{message}</p>,
}));
import Homework from '../src/app/(school)/homework';

let root: ReturnType<typeof createRoot> | null = null;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  h.state.pickedInside = []; h.pick.mockReset(); h.upload.mockReset(); h.whileExternal.mockClear();
});
afterEach(async () => { await act(async () => root?.unmount()); root = null; vi.unstubAllGlobals(); });

async function typeAndAttach() {
  const container = document.createElement('div'); root = createRoot(container);
  await act(async () => root!.render(<Homework />));
  await act(async () => h.state.input!.onChangeText('My typed answer'));
  const attach = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Attach PDF or photo')!;
  await act(async () => attach.click());
  return container;
}

it('opens the Android picker as an app-owned external activity and uploads the picked file with the typed answer kept', async () => {
  h.pick.mockImplementation(async () => {
    h.state.pickedInside.push(h.state.insideExternal);
    return { canceled: false, assets: [{ uri: 'file:///cache/DocumentPicker/report.pdf', name: 'report.pdf', mimeType: 'application/pdf' }] };
  });
  h.upload.mockResolvedValue({ path: 'school-a/pupil-a/report.pdf', name: 'report.pdf' });
  const container = await typeAndAttach();
  expect(h.state.pickedInside).toEqual([true]);
  expect(h.upload).toHaveBeenCalledOnce();
  expect(container.textContent).toContain('report.pdf');
  expect(h.state.input!.value).toBe('My typed answer');
});

it('keeps the typed answer and uploads nothing when the picker is cancelled', async () => {
  h.pick.mockImplementation(async () => { h.state.pickedInside.push(h.state.insideExternal); return { canceled: true, assets: null }; });
  const container = await typeAndAttach();
  expect(h.state.pickedInside).toEqual([true]);
  expect(h.upload).not.toHaveBeenCalled();
  expect(h.state.input!.value).toBe('My typed answer');
  expect(container.textContent).toContain('Attach PDF or photo');
});
