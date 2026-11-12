// @vitest-environment jsdom
import { act, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

const { auth, mounts, refreshPush, route, router, hints } = vi.hoisted(() => ({
  auth: { status: 'ready', foreground: true, role: 'parent', revision: 0, tokenRevision: 0, client: {} as object, access: { userId: 'guardian-a', schoolId: 'school-a' } },
  mounts: { count: 0 }, refreshPush: vi.fn(async () => {}),
  route: { pathname: '/homework', params: {} as Record<string, string> },
  router: { navigate: vi.fn(), push: vi.fn(), dismissTo: vi.fn() },
  hints: { open: null as null | ((kind: 'received' | 'opened') => void) },
}));
vi.mock('expo-router', () => ({ Stack: () => <main />, Redirect: () => null, router, usePathname: () => route.pathname, useGlobalSearchParams: () => route.params }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('../src/auth/provider', () => ({ useAuth: () => auth }));
vi.mock('../src/ui/family', () => ({ FamilyProvider: function FamilyProvider({ children }: { children: ReactNode }) {
  useEffect(() => { mounts.count += 1; }, []); return <>{children}</>;
} }));
vi.mock('../src/ui/theme', () => ({ usePalette: () => ({ bg: '#fff' }) }));
vi.mock('../src/ui/primitives', () => ({ Screen: ({ children }: { children: ReactNode }) => <>{children}</>, Skeleton: () => <p>loading</p> }));
vi.mock('../src/ui/auth-problem', () => ({ AuthProblem: () => null }));
vi.mock('../src/ui/mfa-verification', () => ({ MfaVerification: () => null }));
vi.mock('../src/push', () => ({ attachPushInboxHints: async ({ onInboxHint }: { onInboxHint(kind: 'received' | 'opened'): void }) => { hints.open = onInboxHint; return () => {}; }, subscribePushRegistration: () => () => {}, refreshNativePushRegistration: refreshPush }));
import SchoolLayout from '../src/app/(school)/_layout';

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => { roots.splice(0).forEach(root => root.unmount()); }); vi.unstubAllGlobals(); });

it('keeps the signed-in Stack mounted through an in-place recheck, but remounts after a full reload', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(document.createElement('div')); roots.push(root);
  await act(async () => root.render(<SchoolLayout />));
  expect(mounts.count).toBe(1);
  auth.revision = 1;
  await act(async () => root.render(<SchoolLayout />));
  expect(mounts.count).toBe(1);
  auth.status = 'checking';
  await act(async () => root.render(<SchoolLayout />));
  auth.status = 'ready'; auth.revision = 2;
  await act(async () => root.render(<SchoolLayout />));
  expect(mounts.count).toBe(2);
});

it('refreshes this phone\'s push registration on start and again after a token refresh', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.assign(auth, { status: 'ready', revision: 0, tokenRevision: 0, client: {} }); refreshPush.mockClear();
  const root = createRoot(document.createElement('div')); roots.push(root);
  await act(async () => root.render(<SchoolLayout />));
  expect(refreshPush).toHaveBeenCalledOnce();
  expect(refreshPush).toHaveBeenLastCalledWith(expect.objectContaining({ client: auth.client, userId: 'guardian-a', role: 'parent', label: 'Android phone' }));
  await act(async () => root.render(<SchoolLayout />));
  expect(refreshPush).toHaveBeenCalledOnce();
  auth.tokenRevision += 1;
  await act(async () => root.render(<SchoolLayout />));
  expect(refreshPush).toHaveBeenCalledTimes(2);
});

const ready = { status: 'ready', foreground: true, role: 'parent', revision: 0, tokenRevision: 0, access: { userId: 'guardian-a', schoolId: 'school-a' } };
async function background(render: () => Promise<void>, back: Partial<typeof ready> = {}) {
  Object.assign(auth, { status: 'checking', foreground: false }); route.pathname = '/'; route.params = {};
  await render();
  Object.assign(auth, ready, back, { revision: auth.revision + 1 });
  await render();
}
async function layout() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.assign(auth, ready); Object.values(router).forEach(fn => fn.mockClear());
  const root = createRoot(document.createElement('div')); roots.push(root);
  const render = async () => { await act(async () => root.render(<SchoolLayout />)); };
  return render;
}

it('returns the same family to its last tab, filters and stack screen after a background recheck', async () => {
  const render = await layout();
  route.pathname = '/attendance'; route.params = { status: 'present', page: '2' }; await render();
  route.pathname = '/homework'; route.params = { child: 'pupil', activity: 'task' }; await render();
  await background(render);
  expect(router.navigate).toHaveBeenCalledExactlyOnceWith({ pathname: '/attendance', params: { status: 'present', page: '2' } });
  expect(router.push).toHaveBeenCalledExactlyOnceWith({ pathname: '/homework', params: { child: 'pupil', activity: 'task' } });
  expect(router.navigate.mock.invocationCallOrder[0]).toBeLessThan(router.push.mock.invocationCallOrder[0]);
});

it('restores a tab with its params, and a stack screen opened from Home, without extra history', async () => {
  const render = await layout();
  route.pathname = '/attendance'; route.params = { status: 'absent', __internal_expo_router_no_animation: 'true' }; await render();
  await background(render);
  expect(router.navigate).toHaveBeenCalledExactlyOnceWith({ pathname: '/attendance', params: { status: 'absent' } });
  expect(router.push).not.toHaveBeenCalled();
  route.pathname = '/attendance'; route.params = { status: 'absent' }; await render();
  route.pathname = '/'; route.params = {}; await render();
  route.pathname = '/teachers'; await render();
  router.navigate.mockClear();
  await background(render);
  expect(router.navigate).not.toHaveBeenCalled();
  expect(router.push).toHaveBeenCalledExactlyOnceWith({ pathname: '/teachers', params: {} });
});

it.each([['another role', { role: 'student' }], ['another school', { access: { userId: 'guardian-a', schoolId: 'school-b' } }]] as const)(
  'opens Home instead of the previous screen when access returns for %s', async (_, back) => {
    const render = await layout();
    route.pathname = '/homework'; route.params = { child: 'pupil', activity: 'task' }; await render();
    await background(render, back);
    expect(router.navigate).not.toHaveBeenCalled(); expect(router.push).not.toHaveBeenCalled();
  });

it('opens Home after sign-out and a later sign-in, not the previous account\'s screen', async () => {
  const render = await layout();
  route.pathname = '/learning'; await render();
  Object.assign(auth, { status: 'signedOut' }); route.pathname = '/'; await render();
  Object.assign(auth, ready); await render();
  expect(router.navigate).not.toHaveBeenCalled();
});

it('pops screens above the tabs when a push tap opens Updates, instead of stacking another tabs entry', async () => {
  const render = await layout();
  route.pathname = '/exam'; route.params = { assessment: 'exam' }; await render();
  await act(async () => hints.open?.('opened'));
  expect(router.dismissTo).toHaveBeenCalledExactlyOnceWith('/(school)/(tabs)/notifications');
  expect(router.navigate).not.toHaveBeenCalled(); expect(router.push).not.toHaveBeenCalled();
  await act(async () => hints.open?.('received'));
  expect(router.dismissTo).toHaveBeenCalledOnce();
});
