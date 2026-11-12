// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FamilyProvider, useFamily } from '../src/ui/family';

const { load, auth } = vi.hoisted(() => ({ load: vi.fn(), auth: { role: 'parent', access: { userId: 'guardian-a', schoolId: 'school-a' }, client: {} } }));
vi.mock('../src/data', () => ({ listChildren: load }));
vi.mock('../src/auth/provider', () => ({ useAuth: () => auth }));
vi.mock('../src/ui/theme', () => ({ usePalette: () => ({}) }));
vi.mock('../src/ui/primitives', () => ({ Text: ({ children }: { children: ReactNode }) => <span>{children}</span> }));
vi.mock('lucide-react-native', () => ({ Check: () => null, ChevronDown: () => null, UserRound: () => null }));
vi.mock('react-native', () => ({ View: ({ children }: { children: ReactNode }) => <div>{children}</div>, Pressable: () => null }));

const asha = { id: 'a', first_name: 'Asha', last_name: 'Sharma', admission_no: 'QA-01' };
const dev = { id: 'b', first_name: 'Dev', last_name: 'Sharma', admission_no: 'QA-02' };
let family: ReturnType<typeof useFamily>;
function Probe() { family = useFamily(); return <output>{family.selected?.id}</output>; }
let root: ReturnType<typeof createRoot> | null = null, container: HTMLDivElement;
// Each mount is a fresh FamilyProvider, as after the layout's Skeleton during a background re-check.
async function remount(students: (typeof asha)[]) {
  await act(async () => root?.unmount());
  load.mockReset().mockResolvedValue(students);
  container = document.createElement('div'); root = createRoot(container);
  await act(async () => root!.render(<FamilyProvider><Probe /></FamilyProvider>));
  return container.querySelector('output')?.textContent;
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); Object.assign(auth, { role: 'parent', access: { userId: 'guardian-a', schoolId: 'school-a' } }); });
afterEach(async () => { await act(async () => root?.unmount()); root = null; vi.unstubAllGlobals(); });

it('keeps the chosen sibling after the workspace remounts on return to the app', async () => {
  expect(await remount([asha, dev])).toBe('a');
  await act(async () => family.select('b'));
  expect(await remount([asha, dev])).toBe('b');
});

it('falls back to the first linked child when the remembered child is no longer linked', async () => {
  await remount([asha, dev]); await act(async () => family.select('b'));
  expect(await remount([asha])).toBe('a');
});

it('never carries a selection into another account or workspace', async () => {
  await remount([asha, dev]); await act(async () => family.select('b'));
  auth.access = { userId: 'guardian-b', schoolId: 'school-a' };
  expect(await remount([asha, dev])).toBe('a');
  auth.access = { userId: 'guardian-a', schoolId: 'school-a' }; auth.role = 'student';
  expect(await remount([asha, dev])).toBe('a');
});
