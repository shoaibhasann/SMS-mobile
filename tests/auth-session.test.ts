// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSessionGate } from '../src/auth/session-gate';
import type { FamilyAccess } from '../src/data';
import { AuthProvider, useAuth } from '../src/auth/provider';

type Session = { access_token: string; user: { id: string } };
type AuthListener = (event: string, session: Session | null) => void;
const native = vi.hoisted(() => {
  let session: Session | null = null;
  let authListener: AuthListener = () => {}, appListener: (state: string) => void = () => {};
  const app = { currentState: 'active', addEventListener: vi.fn((_kind: string, callback: (state: string) => void) => {
    appListener = callback; return { remove: vi.fn() };
  }) };
  const client = { auth: {
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    onAuthStateChange: vi.fn((callback: AuthListener) => { authListener = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
    startAutoRefresh: vi.fn(), stopAutoRefresh: vi.fn(),
    signInWithPassword: vi.fn<(credentials: { email: string; password: string }) => Promise<{ error: unknown }>>(),
    signOut: vi.fn<(options: { scope: string }) => Promise<{ error: unknown }>>(),
  } };
  return { app, client,
    access: vi.fn<(client: unknown, signal?: AbortSignal) => Promise<FamilyAccess>>(),
    bound: vi.fn<(token: string) => SupabaseClient>(),
    cleanup: vi.fn<() => Promise<{ nativeCleared: boolean }>>(),
    disconnect: vi.fn<(owner: unknown) => Promise<{ nativeCleared: boolean; serverRevoked: boolean }>>(),
    getSavedSession() { return session; },
    setSession(value: Session | null) { session = value; },
    emitAuth(event: string, value: Session | null) { session = value; authListener(event, value); },
    emitApp(state: string) { app.currentState = state; appListener(state); },
  };
});
vi.mock('react-native', () => ({ AppState: native.app }));
vi.mock('../src/auth/client', () => ({ configError: null, schoolClient: () => native.client, familyClient: native.bound }));
vi.mock('../src/data', () => ({ readFamilyAccess: native.access }));
vi.mock('../src/push', () => ({ cleanupSavedPushOnAuthLoss: native.cleanup, disconnectNativePush: native.disconnect }));

const guardian: FamilyAccess = { userId: 'guardian-a', schoolId: 'school-a', name: 'Guardian A', roles: ['parent', 'student'] };
const sessionA: Session = { access_token: 'synthetic-session-a', user: { id: guardian.userId } };
let root: Root | null = null, node: HTMLDivElement | null = null, auth: ReturnType<typeof useAuth>;
function Probe() { const value = useAuth(); useEffect(() => { auth = value; }, [value]); return null; }
async function mount() {
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
  await act(async () => { root!.render(createElement(AuthProvider, null, createElement(Probe))); });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks(); native.setSession(sessionA); native.app.currentState = 'active';
  native.access.mockReset().mockResolvedValue(guardian);
  native.bound.mockReset().mockImplementation(token => ({ sessionToken: token }) as unknown as SupabaseClient);
  native.cleanup.mockReset().mockResolvedValue({ nativeCleared: true });
  native.disconnect.mockReset().mockResolvedValue({ nativeCleared: true, serverRevoked: true });
  native.client.auth.getSession.mockImplementation(async () => ({ data: { session: native.getSavedSession() }, error: null }));
  native.client.auth.signOut.mockReset().mockImplementation(async () => {
    native.client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    native.emitAuth('SIGNED_OUT', null); return { error: null };
  });
  native.client.auth.signInWithPassword.mockReset().mockResolvedValue({ error: null });
});
afterEach(async () => {
  await act(async () => root?.unmount()); root = null; node?.remove(); node = null;
});

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe('Family account transitions', () => {
  it('discards an old account response even when it arrives after successful logout', async () => {
    const gate = createSessionGate(), response = deferred<string>(), saved: string[] = [];
    const current = gate.beginRead()!;
    const loading = response.promise.then(value => { if (current()) saved.push(value); });
    await gate.run('signOut', async () => {});
    response.resolve('old guardian records'); await loading;
    expect(saved).toEqual([]);
    expect(gate.beginRead()?.()).toBe(true);
  });

  it('prevents another login, a role switch, or new reads while push cleanup is pending', async () => {
    const gate = createSessionGate(), cleanup = deferred<void>(), login = vi.fn(), switchRole = vi.fn();
    const signingOut = gate.run('signOut', () => cleanup.promise);
    await expect(gate.run('signIn', login)).rejects.toMatchObject({ code: 'busy' });
    await expect(gate.run('role', switchRole)).rejects.toMatchObject({ code: 'busy' });
    expect(gate.beginRead()).toBeNull();
    expect(login).not.toHaveBeenCalled(); expect(switchRole).not.toHaveBeenCalled();
    cleanup.resolve(); await signingOut;
    await gate.run('signIn', login); expect(login).toHaveBeenCalledOnce();
  });

  it('keeps failed cleanup closed across refresh and background events, with a sign-out retry available', async () => {
    const gate = createSessionGate(), login = vi.fn(), role = vi.fn();
    await expect(gate.run('role', async () => { throw new Error('Native deletion failed.'); })).rejects.toThrow('Native deletion failed.');
    gate.invalidate(); gate.invalidate();
    expect(gate.beginRead()).toBeNull();
    await expect(gate.run('signIn', login)).rejects.toMatchObject({ code: 'cleanup' });
    await expect(gate.run('role', role)).rejects.toMatchObject({ code: 'cleanup' });
    expect(login).not.toHaveBeenCalled(); expect(role).not.toHaveBeenCalled();
    await gate.run('signOut', async () => {});
    expect(gate.blocked).toBe(false); expect(gate.beginRead()?.()).toBe(true);
  });

  it('does not strand an explicit transition lock when an auth event invalidates its reads', async () => {
    const gate = createSessionGate(), cleanup = deferred<void>();
    const previous = gate.beginRead()!;
    const signingOut = gate.run('signOut', () => cleanup.promise);
    gate.invalidate(); // SIGNED_OUT and AppState changes can occur inside SDK signOut.
    cleanup.resolve(); await signingOut;
    expect(previous()).toBe(false); expect(gate.running).toBe(false);
    const login = vi.fn(async () => {}); await gate.run('signIn', login);
    expect(login).toHaveBeenCalledOnce();
  });

  it('allows a password retry after failure without reviving the invalidated access response', async () => {
    const gate = createSessionGate(), previous = gate.beginRead()!;
    await expect(gate.run('signIn', async () => { throw new Error('Wrong password.'); })).rejects.toThrow('Wrong password.');
    const retry = vi.fn(async () => {}); await gate.run('signIn', retry);
    expect(retry).toHaveBeenCalledOnce(); expect(previous()).toBe(false);
  });

  it('invalidates overlapping reads and backgrounded work without deleting an authenticated session', async () => {
    const gate = createSessionGate(), first = gate.beginRead()!, latest = gate.beginRead()!;
    expect(first()).toBe(false); expect(latest()).toBe(true);
    gate.invalidate(); expect(latest()).toBe(false);
    expect(gate.blocked).toBe(false); expect(gate.beginRead()?.()).toBe(true);
  });

  it('blocks cold-start login until saved push cleanup is confirmed, then recovers from a failed attempt', async () => {
    const gate = createSessionGate(), cleanup = deferred<void>(), login = vi.fn();
    const cleaning = gate.run('authLoss', () => cleanup.promise);
    const failed = expect(cleaning).rejects.toThrow('Keychain unavailable.');
    await expect(gate.run('signIn', login)).rejects.toMatchObject({ code: 'busy' });
    cleanup.reject(new Error('Keychain unavailable.')); await failed;
    await expect(gate.run('signIn', login)).rejects.toMatchObject({ code: 'cleanup' });
    await gate.run('authLoss', async () => {});
    await gate.run('signIn', login); expect(login).toHaveBeenCalledOnce();
  });
});

describe('AuthProvider session and identity boundary', () => {
  it('immediately hides access and the bound client while logout waits for the old owner’s push cleanup', async () => {
    await mount(); expect(auth.status).toBe('ready');
    const oldClient = auth.client, cleanup = deferred<{ nativeCleared: boolean; serverRevoked: boolean }>();
    native.disconnect.mockReturnValueOnce(cleanup.promise);
    let logout!: Promise<void>;
    act(() => { logout = auth.signOut(); });
    expect(auth.status).toBe('checking'); expect(auth.access).toBeNull(); expect(auth.client).toBeNull();
    expect(native.disconnect).toHaveBeenCalledWith({ client: oldClient, userId: guardian.userId, role: 'parent' });
    await expect(auth.signIn('new@example.test', 'password')).rejects.toThrow('securing this phone');
    expect(native.client.auth.signInWithPassword).not.toHaveBeenCalled();
    await act(async () => { cleanup.resolve({ nativeCleared: true, serverRevoked: true }); await logout; });
    expect(auth.status).toBe('signedOut'); expect(auth.client).toBeNull();
  });

  it('keeps role cleanup failures closed across foreground/refresh and retains the old client for sign-out recovery', async () => {
    await mount(); const oldClient = auth.client;
    native.disconnect.mockResolvedValueOnce({ nativeCleared: false, serverRevoked: true });
    await act(async () => { await expect(auth.chooseRole('student')).rejects.toThrow('cleanup'); });
    expect(auth.status).toBe('error'); expect(auth.role).toBe('parent'); expect(auth.access).toBeNull(); expect(auth.client).toBeNull();
    await act(async () => { auth.refresh(); native.emitApp('background'); native.emitApp('active'); });
    expect(auth.status).toBe('error'); expect(auth.client).toBeNull();
    await act(async () => { await auth.signOut(); });
    expect(auth.status).toBe('signedOut');
    expect(native.disconnect.mock.calls[1][0]).toEqual({ client: oldClient, userId: guardian.userId, role: 'parent' });
  });

  it('never restores a delayed old-user access response after SIGNED_OUT and a different login', async () => {
    const response = deferred<FamilyAccess>(); native.access.mockReturnValueOnce(response.promise);
    await mount(); expect(auth.status).toBe('checking');
    await act(async () => { native.emitAuth('SIGNED_OUT', null); });
    expect(auth.status).toBe('signedOut'); expect(auth.client).toBeNull();
    const next: FamilyAccess = { ...guardian, userId: 'guardian-b', name: 'Guardian B' };
    const nextSession: Session = { access_token: 'synthetic-session-b', user: { id: next.userId } };
    native.access.mockResolvedValue(next);
    native.client.auth.signInWithPassword.mockImplementation(async () => {
      native.client.auth.getSession.mockResolvedValue({ data: { session: nextSession }, error: null });
      native.emitAuth('SIGNED_IN', nextSession); return { error: null };
    });
    await act(async () => { await auth.signIn('new@example.test', 'password'); });
    expect(auth.status).toBe('ready'); expect(auth.access?.userId).toBe(next.userId);
    const nextClient = auth.client;
    await act(async () => { response.resolve(guardian); });
    expect(auth.access?.userId).toBe(next.userId); expect(auth.client).toBe(nextClient);
    expect(native.bound).toHaveBeenLastCalledWith('synthetic-session-b');
  });

  it('blanks backgrounded data, revalidates on foreground, and recovers from network failure without deleting push identity', async () => {
    await mount(); const oldClient = auth.client;
    act(() => native.emitApp('background'));
    expect(auth.status).toBe('checking'); expect(auth.foreground).toBe(false); expect(auth.client).toBeNull();
    native.access.mockRejectedValueOnce(new Error('Network unavailable.'));
    await act(async () => { native.emitApp('active'); });
    expect(auth.status).toBe('error'); expect(auth.access).toBeNull();
    expect(native.cleanup).not.toHaveBeenCalled(); expect(native.disconnect).not.toHaveBeenCalled();
    const refreshed: Session = { ...sessionA, access_token: 'synthetic-refreshed-session-a' };
    native.client.auth.getSession.mockResolvedValue({ data: { session: refreshed }, error: null });
    await act(async () => { auth.refresh(); });
    expect(auth.status).toBe('ready'); expect(auth.foreground).toBe(true); expect(auth.access?.userId).toBe(guardian.userId);
    expect(auth.client).not.toBe(oldClient); expect(native.bound).toHaveBeenLastCalledWith(refreshed.access_token);
  });

  it('does not expose login on a cold signed-out start until saved native cleanup succeeds', async () => {
    native.client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const cleanup = deferred<{ nativeCleared: boolean }>(); native.cleanup.mockReturnValueOnce(cleanup.promise);
    await mount(); expect(auth.status).toBe('checking');
    await expect(auth.signIn('new@example.test', 'password')).rejects.toThrow('securing this phone');
    await act(async () => { cleanup.resolve({ nativeCleared: false }); });
    expect(auth.status).toBe('error'); expect(auth.client).toBeNull();
    expect(native.client.auth.signInWithPassword).not.toHaveBeenCalled();
    await act(async () => { await auth.signOut(); });
    expect(auth.status).toBe('signedOut'); expect(native.cleanup).toHaveBeenCalledTimes(2);
  });

  it('allows a failed password retry and recovers a failed sign-out without reviving ready data', async () => {
    native.client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await mount(); expect(auth.status).toBe('signedOut');
    native.client.auth.signInWithPassword.mockResolvedValueOnce({ error: new Error('Wrong password.') });
    await act(async () => { await expect(auth.signIn('school@example.test', 'wrong')).rejects.toThrow('Sign-in failed.'); });
    expect(auth.status).toBe('signedOut');
    native.client.auth.signInWithPassword.mockImplementation(async () => {
      native.client.auth.getSession.mockResolvedValue({ data: { session: sessionA }, error: null });
      native.emitAuth('SIGNED_IN', sessionA); return { error: null };
    });
    await act(async () => { await auth.signIn('school@example.test', 'correct'); });
    expect(auth.status).toBe('ready'); const oldClient = auth.client;
    native.client.auth.signOut.mockResolvedValueOnce({ error: new Error('Local storage unavailable.') });
    await act(async () => { await expect(auth.signOut()).rejects.toThrow('Sign-out could not be confirmed.'); });
    expect(auth.status).toBe('error'); expect(auth.client).toBeNull();
    await act(async () => { auth.refresh(); }); expect(auth.status).toBe('error');
    await act(async () => { await auth.signOut(); }); expect(auth.status).toBe('signedOut');
    expect(native.disconnect.mock.calls.at(-1)?.[0]).toEqual({ client: oldClient, userId: guardian.userId, role: 'parent' });
  });

  it('rejects stale auth actions from a previous account rather than disconnecting the current guardian', async () => {
    await mount(); const previousSignOut = auth.signOut, previousChooseRole = auth.chooseRole;
    await act(async () => { await auth.signOut(); });
    const next: FamilyAccess = { ...guardian, userId: 'guardian-b' };
    const nextSession: Session = { access_token: 'synthetic-session-b', user: { id: next.userId } };
    native.access.mockResolvedValue(next);
    native.client.auth.signInWithPassword.mockImplementation(async () => {
      native.client.auth.getSession.mockResolvedValue({ data: { session: nextSession }, error: null });
      native.emitAuth('SIGNED_IN', nextSession); return { error: null };
    });
    await act(async () => { await auth.signIn('new@example.test', 'password'); });
    const previousDisconnects = native.disconnect.mock.calls.length, previousSignOuts = native.client.auth.signOut.mock.calls.length;
    await expect(previousSignOut()).rejects.toThrow('workspace changed');
    await expect(previousChooseRole('student')).rejects.toThrow('workspace changed');
    expect(native.disconnect).toHaveBeenCalledTimes(previousDisconnects); expect(native.client.auth.signOut).toHaveBeenCalledTimes(previousSignOuts);
    expect(auth.status).toBe('ready'); expect(auth.access?.userId).toBe(next.userId);
  });

  it('does not overwrite a session that was saved after the login screen was verified signed out', async () => {
    native.client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await mount(); expect(auth.status).toBe('signedOut');
    native.client.auth.getSession.mockResolvedValue({ data: { session: sessionA }, error: null });
    await act(async () => { await expect(auth.signIn('new@example.test', 'password')).rejects.toThrow('existing sign-in'); });
    expect(native.client.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(auth.status).toBe('ready'); expect(auth.access?.userId).toBe(guardian.userId);
    expect(native.bound).toHaveBeenLastCalledWith(sessionA.access_token);
  });

  it('fails closed if the verified identity differs from its session snapshot or the school changes', async () => {
    native.access.mockResolvedValueOnce({ ...guardian, userId: 'different-user' });
    await mount(); expect(auth.status).toBe('error'); expect(auth.client).toBeNull();
    await act(async () => { auth.refresh(); }); expect(auth.status).toBe('ready'); const oldClient = auth.client;
    native.access.mockResolvedValueOnce({ ...guardian, schoolId: 'different-school' });
    await act(async () => { auth.refresh(); }); expect(auth.status).toBe('error'); expect(auth.client).toBeNull();
    await act(async () => { await auth.signOut(); });
    expect(native.disconnect).toHaveBeenLastCalledWith({ client: oldClient, userId: guardian.userId, role: 'parent' });
    expect(auth.status).toBe('signedOut');
  });
});
