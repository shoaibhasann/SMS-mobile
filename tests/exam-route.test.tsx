// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ back: vi.fn(), replace: vi.fn(), canGoBack: vi.fn(() => true), props: null as null | { assessment: string | string[]; back(): void } }));
vi.mock('expo-router', () => ({ router: { back: h.back, replace: h.replace, canGoBack: h.canGoBack }, useLocalSearchParams: () => ({ assessment: 'exam-id' }) }));
vi.mock('../src/ui/exam-schedule', () => ({ ExamSchedule: (props: { assessment: string; back(): void }) => { h.props = props; return null; } }));
import Exam from '../src/app/(school)/exam';

let root: ReturnType<typeof createRoot> | null = null;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); h.back.mockReset(); h.replace.mockReset();
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(<Exam />));
});
afterEach(async () => { await act(async () => root?.unmount()); root = null; vi.unstubAllGlobals(); });

it('passes the assessment param through and goes back within the stack', () => {
  expect(h.props?.assessment).toBe('exam-id');
  h.canGoBack.mockReturnValue(true);
  h.props!.back();
  expect(h.back).toHaveBeenCalledOnce();
  expect(h.replace).not.toHaveBeenCalled();
});

it('falls back to the Updates tab when opened with no history', () => {
  h.canGoBack.mockReturnValue(false);
  h.props!.back();
  expect(h.replace).toHaveBeenCalledExactlyOnceWith('/(school)/(tabs)/notifications');
  expect(h.back).not.toHaveBeenCalled();
});
