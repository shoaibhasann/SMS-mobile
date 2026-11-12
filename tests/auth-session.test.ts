// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js';
import { createSessionGate } from '../src/auth/session-gate';
import type { FamilyAccess } from '../src/data';
import { AuthProvider, useAuth } from '../src/auth/provider';
import type { MfaStatus } from '../src/auth/mfa';

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
    signInWithPassword: vi.fn<(credentials: { email?: string; phone?: string; password: string }) => Promise<{ error: unknown }>>(),
    signOut: vi.fn<(options: { scope: string }) => Promise<{ error: unknown }>>(),
    refreshSession: vi.fn<() => Promise<{ data: { session: Session | null; user: { id: string } | null }; error: unknown }>>(),
  } };
  return { app, client, store: new Map<string, string>(),
    access: vi.fn<(client: unknown, signal?: AbortSignal) => Promise<FamilyAccess>>(),
    mfa: vi.fn<(client: unknown, userId: string, signal?: AbortSignal) => Promise<MfaStatus>>(),
    verify: vi.fn<() => Promise<void>>(),
    bound: vi.fn<(token: string) => SupabaseClient>(),
    rebind: vi.fn((client: SupabaseClient, token: string) => { if (token) (client as unknown as { sessionToken: string }).sessionToken = token; }),
    cleanup: vi.fn<() => Promise<{ nativeCleared: boolean }>>(),
    disconnect: vi.fn<(owner: unknown) => Promise<{ nativeCleared: boolean; serverRevoked: boolean }>>(),
    getSavedSession() { return session; },
    setSession(value: Session | null) { session = value; },
    emitAuth(event: string, value: Session | null) { session = value; authListener(event, value); },
    emitApp(state: string) { app.currentState = state; appListener(state); },
  };
});
vi.mock('react-native', () => ({ AppState: native.app }));
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0,
  getItemAsync: vi.fn(async (key: string) => native.store.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => { native.store.set(key, value); }),
  deleteItemAsync: vi.fn(async (key: string) => { native.store.delete(key); }) }));
vi.mock('../src/auth/client', () => ({ configError: null, schoolClient: () => native.client, familyClient: native.bound, rebindFamilyClient: native.rebind, allowSessionRenewal: vi.fn() }));
vi.mock('../src/data', () => ({ readFamilyAccess: native.access }));
vi.mock('../src/auth/mfa', () => ({ readMfaStatus: native.mfa, verifyMfa: native.verify }));
vi.mock('../src/push', () => ({ cleanupSavedPushOnAuthLoss: native.cleanup, disconnectNativePush: native.disconnect }));

const guardian: FamilyAccess = { userId: 'guardian-a', schoolId: 'school-a', name: 'Guardian A', roles: ['parent', 'student'] };
const sessionA: Session = { access_token: 'synthetic-session-a', user: { id: guardian.userId } };
let root: Root | null = null, node: HTMLDivElement | null = null, auth: ReturnType<typeof useAuth>;
let statuses: string[] = [], workspaces: string[] = [];
function Probe() { const value = useAuth(); useEffect(() => { auth = value; statuses.push(value.status); workspaces.push(`${value.status}:${value.role}`); }, [value]); return null; }
async function mount() {
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
  await act(async () => { root!.render(createElement(AuthProvider, null, createElement(Probe))); });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks(); native.setSession(sessionA); native.app.currentState = 'active'; statuses = []; workspaces = []; native.store.clear();
  native.client.auth.refreshSession.mockReset();
  native.access.mockReset().mockResolvedValue(guardian);
  native.mfa.mockReset().mockImplementation(async (_client, userId) => ({ user_id: userId, required: false, allowed: true, action: 'none', current_aal: 'aal1', verified_totp_count: 0 }));
  native.verify.mockReset().mockResolvedValue(undefined);
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
  it('allows an authenticator-code retry after failure without reviving old reads', async () => {
    const gate = createSessionGate(), old = gate.beginRead()!;
    await expect(gate.run('mfa', async () => { throw new Error('Wrong code.'); })).rejects.toThrow('Wrong code.');
    const retry = vi.fn(); await gate.run('mfa', retry);
    expect(retry).toHaveBeenCalledOnce(); expect(old()).toBe(false); expect(gate.blocked).toBe(false);
  });
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
  it('offers a retry without sign-out when no session has been found', async () => {
    native.setSession(null);
    native.client.auth.getSession.mockRejectedValueOnce(new Error('Storage temporarily unavailable.'));
    await mount();
    expect(auth).toMatchObject({ status: 'error', recovery: null, access: null });
    await act(async () => { auth.refresh(); });
    expect(auth).toMatchObject({ status: 'signedOut', recovery: null, access: null });
  });

  it('requires MFA before any family records load and rechecks after successful verification', async () => {
    native.mfa.mockResolvedValueOnce({ user_id: guardian.userId, required: true, allowed: false, action: 'challenge', current_aal: 'aal1', verified_totp_count: 1 });
    await mount(); expect(auth.status).toBe('mfa'); expect(auth.access).toBeNull(); expect(auth.client).toBeNull();
    expect(native.access).not.toHaveBeenCalled();
    await act(async () => { await auth.verifyAuthenticator('factor', '123456'); });
    expect(auth.status).toBe('ready'); expect(native.mfa).toHaveBeenCalledTimes(2);
    expect(native.verify).toHaveBeenCalledWith(native.client, guardian.userId, 'factor', '123456', expect.any(AbortSignal));
  });
  it('keeps a wrong MFA code retryable with family data hidden', async () => {
    native.mfa.mockResolvedValue({ user_id: guardian.userId, required: true, allowed: false, action: 'challenge', current_aal: 'aal1', verified_totp_count: 1 });
    await mount(); native.verify.mockRejectedValueOnce(new Error('Wrong code.'));
    await act(async () => { await expect(auth.verifyAuthenticator('factor', '123456')).rejects.toThrow('Wrong code.'); });
    expect(auth.status).toBe('mfa'); expect(native.access).not.toHaveBeenCalled();
    await act(async () => { await auth.signOut(); }); expect(auth.status).toBe('signedOut');
  });
  it('finishes native push cleanup when Auth signs out during a pending MFA verification', async () => {
    native.mfa.mockResolvedValue({ user_id: guardian.userId, required: true, allowed: false, action: 'challenge', current_aal: 'aal1', verified_totp_count: 1 });
    await mount(); const pending = deferred<void>(); native.verify.mockReturnValueOnce(pending.promise);
    let verifying!: Promise<void>;
    act(() => { verifying = auth.verifyAuthenticator('factor', '123456'); });
    await act(async () => { native.emitAuth('SIGNED_OUT', null); });
    expect(native.cleanup).not.toHaveBeenCalled(); expect(native.access).not.toHaveBeenCalled();
    await act(async () => { pending.reject(new Error('Session ended.')); await expect(verifying).rejects.toThrow('Session ended.'); });
    expect(native.cleanup).toHaveBeenCalledOnce(); expect(auth.status).toBe('signedOut'); expect(auth.client).toBeNull();
  });
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
    expect(auth.status).toBe('error'); expect(auth.access).toBeNull(); expect(auth.recovery).toBe('endSession');
    expect(native.cleanup).not.toHaveBeenCalled(); expect(native.disconnect).not.toHaveBeenCalled();
    const refreshed: Session = { ...sessionA, access_token: 'synthetic-refreshed-session-a' };
    native.client.auth.getSession.mockResolvedValue({ data: { session: refreshed }, error: null });
    await act(async () => { auth.refresh(); });
    expect(auth.status).toBe('ready'); expect(auth.foreground).toBe(true); expect(auth.access?.userId).toBe(guardian.userId);
    expect(auth.client).not.toBe(oldClient); expect(native.bound).toHaveBeenLastCalledWith(refreshed.access_token);
  });

  it('rebinds the refreshed token into the same client on a routine TOKEN_REFRESHED for the same owner', async () => {
    await mount(); expect(auth.status).toBe('ready'); statuses = [];
    const client = auth.client, revision = auth.revision;
    const refreshed: Session = { ...sessionA, access_token: 'refreshed' };
    await act(async () => { native.emitAuth('TOKEN_REFRESHED', refreshed); });
    expect(statuses).not.toContain('checking');
    expect(auth.status).toBe('ready'); expect(auth.access?.userId).toBe(guardian.userId);
    expect(auth.client).toBe(client); expect(auth.revision).toBe(revision); expect(auth.tokenRevision).toBe(1);
    expect(native.rebind).toHaveBeenLastCalledWith(client, 'refreshed');
    expect((auth.client as unknown as { sessionToken: string }).sessionToken).toBe('refreshed');
    expect(native.bound).toHaveBeenCalledOnce();
    expect(native.client.auth.getSession).toHaveBeenCalledOnce();
    expect(native.mfa).toHaveBeenCalledOnce(); expect(native.access).toHaveBeenCalledOnce();
  });
  it('reaches ready without a refresh storm when a fast device clock makes every getSession refresh', async () => {
    let refreshes = 0;
    native.client.auth.getSession.mockImplementation(async () => {
      // auth-js emits TOKEN_REFRESHED before getSession resolves; stop after 20 to keep a regression finite.
      if (refreshes < 20) native.emitAuth('TOKEN_REFRESHED', { ...sessionA, access_token: `skewed-${++refreshes}` });
      return { data: { session: native.getSavedSession() }, error: null };
    });
    await mount();
    expect(auth.status).toBe('ready'); expect(refreshes).toBe(1);
    expect(native.client.auth.getSession).toHaveBeenCalledOnce();
    expect(native.bound).toHaveBeenCalledExactlyOnceWith('skewed-1');
    // The 30 s auto-refresh ticker keeps refreshing under skew; each one only rebinds.
    await act(async () => { native.emitAuth('TOKEN_REFRESHED', { ...sessionA, access_token: 'ticker' }); });
    expect(auth.status).toBe('ready'); expect(native.client.auth.getSession).toHaveBeenCalledOnce();
    expect((auth.client as unknown as { sessionToken: string }).sessionToken).toBe('ticker');
  });
  it('rebinds a token refreshed while the access read was still in flight before exposing the client', async () => {
    const access = deferred<FamilyAccess>();
    native.access.mockReturnValueOnce(access.promise);
    await mount(); expect(auth.status).toBe('checking');
    await act(async () => { native.emitAuth('TOKEN_REFRESHED', { ...sessionA, access_token: 'mid-read' }); });
    await act(async () => { access.resolve(guardian); });
    expect(auth.status).toBe('ready'); expect(native.access).toHaveBeenCalledOnce();
    expect((auth.client as unknown as { sessionToken: string }).sessionToken).toBe('mid-read');
  });
  it('still clears and rechecks on SIGNED_IN for the same user', async () => {
    await mount(); expect(auth.status).toBe('ready'); statuses = [];
    await act(async () => { native.emitAuth('SIGNED_IN', { ...sessionA, access_token: 'signed-in' }); });
    expect(statuses[0]).toBe('checking'); expect(auth.status).toBe('ready');
    expect(native.bound).toHaveBeenLastCalledWith('signed-in'); expect(native.access).toHaveBeenCalledTimes(2);
  });
  it('still fails closed when a refreshed token belongs to a different user', async () => {
    await mount(); expect(auth.status).toBe('ready'); statuses = [];
    const other: Session = { access_token: 'other-user', user: { id: 'guardian-b' } };
    native.access.mockResolvedValueOnce({ ...guardian, userId: 'guardian-b' });
    await act(async () => { native.emitAuth('TOKEN_REFRESHED', other); });
    expect(statuses[0]).toBe('checking');
    expect(auth.status).toBe('error'); expect(auth.client).toBeNull(); expect(auth.access).toBeNull();
  });

  it('keeps signed-out autofill fields mounted while Android opens and closes the credential picker', async () => {
    native.setSession(null);
    await mount(); expect(auth.status).toBe('signedOut');
    const response = deferred<{ data: { session: null }; error: null }>();
    native.client.auth.getSession.mockReturnValueOnce(response.promise);
    act(() => native.emitApp('background'));
    expect(auth.foreground).toBe(false); expect(auth.status).toBe('signedOut');
    await act(async () => { native.emitApp('active'); });
    expect(auth.foreground).toBe(true); expect(auth.status).toBe('signedOut');
    expect(native.client.auth.getSession).toHaveBeenCalledTimes(2);
    await act(async () => { response.resolve({ data: { session: null }, error: null }); });
    expect(auth.status).toBe('signedOut'); expect(auth.client).toBeNull();
    expect(native.cleanup).toHaveBeenCalledOnce(); expect(native.access).not.toHaveBeenCalled();
    expect(native.client.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('still verifies an existing session discovered when a signed-out screen resumes', async () => {
    native.setSession(null);
    await mount(); expect(auth.status).toBe('signedOut');
    act(() => native.emitApp('background'));
    native.setSession(sessionA);
    const access = deferred<FamilyAccess>();
    native.access.mockReturnValueOnce(access.promise);
    await act(async () => { native.emitApp('active'); });
    expect(auth.status).toBe('checking'); expect(auth.client).toBeNull();
    await act(async () => { access.resolve(guardian); });
    expect(auth.status).toBe('ready'); expect(auth.access?.userId).toBe(guardian.userId);
    expect(native.mfa).toHaveBeenCalledOnce();
  });

  it('does not expose login on a cold signed-out start until saved native cleanup succeeds', async () => {
    native.client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const cleanup = deferred<{ nativeCleared: boolean }>(); native.cleanup.mockReturnValueOnce(cleanup.promise);
    await mount(); expect(auth.status).toBe('checking');
    await expect(auth.signIn('new@example.test', 'password')).rejects.toThrow('securing this phone');
    await act(async () => { cleanup.resolve({ nativeCleared: false }); });
    expect(auth.status).toBe('error'); expect(auth.client).toBeNull(); expect(auth.recovery).toBe('finishSignOut');
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

  it('signs a phone-only guardian in with a verified mobile number and app password', async () => {
    native.client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await mount(); expect(auth.status).toBe('signedOut');
    await act(async () => { await expect(auth.signIn('12345', 'app password')).rejects.toThrow('valid school email or 10-digit mobile'); });
    expect(native.client.auth.signInWithPassword).not.toHaveBeenCalled(); expect(auth.status).toBe('signedOut');
    native.client.auth.signInWithPassword.mockImplementation(async () => {
      native.client.auth.getSession.mockResolvedValue({ data: { session: sessionA }, error: null });
      native.emitAuth('SIGNED_IN', sessionA); return { error: null };
    });
    await act(async () => { await auth.signIn(' 98765 43210 ', 'app password'); });
    expect(native.client.auth.signInWithPassword).toHaveBeenCalledExactlyOnceWith({ phone: '+919876543210', password: 'app password' });
    expect(auth.status).toBe('ready');
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

describe('App-opened external activities (Android document picker)', () => {
  it('keeps the workspace mounted while the picker backgrounds the app, then rechecks access in place', async () => {
    await mount(); expect(auth.status).toBe('ready'); statuses = [];
    const picker = deferred<string>();
    let picked!: Promise<string>;
    act(() => { picked = auth.whileExternal(() => picker.promise); });
    act(() => native.emitApp('background'));
    expect(auth.status).toBe('ready'); expect(auth.foreground).toBe(true); expect(auth.client).not.toBeNull();
    expect(native.client.auth.stopAutoRefresh).not.toHaveBeenCalled();
    // Android resolves the picker (onActivityResult) before the activity resumes.
    await act(async () => { picker.resolve('report.pdf'); });
    await expect(picked).resolves.toBe('report.pdf');
    await act(async () => { native.emitApp('active'); });
    expect(statuses).not.toContain('checking');
    expect(auth.status).toBe('ready'); expect(auth.foreground).toBe(true);
    expect(native.access).toHaveBeenCalledTimes(2);
  });
  it('still fails closed when the in-place recheck after the picker cannot verify access', async () => {
    await mount(); expect(auth.status).toBe('ready');
    const picker = deferred<void>();
    act(() => { void auth.whileExternal(() => picker.promise); });
    act(() => native.emitApp('background'));
    native.access.mockRejectedValueOnce(new Error('Access revoked.'));
    await act(async () => { native.emitApp('active'); picker.resolve(); });
    expect(auth.status).toBe('error'); expect(auth.client).toBeNull(); expect(auth.access).toBeNull();
  });
  it('blanks the next ordinary background once the picker round-trip has finished', async () => {
    await mount();
    await act(async () => { await auth.whileExternal(async () => { native.emitApp('background'); }); });
    await act(async () => { native.emitApp('active'); });
    expect(auth.status).toBe('ready');
    act(() => native.emitApp('background'));
    expect(auth.status).toBe('checking'); expect(auth.foreground).toBe(false); expect(auth.client).toBeNull();
  });
});

describe('AuthProvider workspace restore, denial copy and rejected-token recovery', () => {
  const roleKey = 'sms.family.role.v1';
  async function remount() { await act(async () => root?.unmount()); node?.remove(); await mount(); }
  it('reopens the last chosen workspace for the same user after a cold start', async () => {
    await mount(); expect(auth).toMatchObject({ status: 'ready', role: 'parent' });
    await act(async () => { await auth.chooseRole('student'); });
    expect(auth).toMatchObject({ status: 'ready', role: 'student' });
    await remount();
    expect(auth).toMatchObject({ status: 'ready', role: 'student' });
  });
  it('ignores a saved workspace for another user or a role the account no longer holds', async () => {
    native.store.set(roleKey, JSON.stringify({ userId: 'someone-else', role: 'student' }));
    await mount(); expect(auth).toMatchObject({ status: 'ready', role: 'parent' });
    native.store.set(roleKey, JSON.stringify({ userId: guardian.userId, role: 'student' }));
    native.access.mockResolvedValue({ ...guardian, roles: ['parent'] });
    await remount(); expect(auth).toMatchObject({ status: 'ready', role: 'parent' });
  });
  it('tells a denied account it has no family access instead of blaming the connection', async () => {
    native.access.mockRejectedValueOnce(Object.assign(new Error('This account has no family access in the SMS app.'), { name: 'FamilyAccessDenied' }));
    await mount();
    expect(auth).toMatchObject({ status: 'error', error: 'This account has no family access in the SMS app.', recovery: 'endSession' });
    native.access.mockRejectedValueOnce(new Error('Network unavailable.'));
    await act(async () => { auth.refresh(); });
    expect(auth).toMatchObject({ status: 'error', error: 'Could not verify school access. Check your connection and try again.' });
  });
  it('renews a server-rejected token once and retries the access read with the new token', async () => {
    const renewed: Session = { access_token: 'renewed', user: { id: guardian.userId } };
    native.mfa.mockRejectedValueOnce(Object.assign(new Error('Your security session changed.'), { name: 'SessionRejected' }));
    native.client.auth.refreshSession.mockImplementation(async () => {
      native.emitAuth('TOKEN_REFRESHED', renewed);
      return { data: { session: renewed, user: renewed.user }, error: null };
    });
    await mount();
    expect(auth.status).toBe('ready'); expect(native.client.auth.refreshSession).toHaveBeenCalledOnce();
    expect(native.bound).toHaveBeenLastCalledWith('renewed');
    expect((auth.client as unknown as { sessionToken: string }).sessionToken).toBe('renewed');
  });
  it('shows a session-renewal message, not a connection error, when the rejected token cannot be renewed for this user', async () => {
    native.mfa.mockRejectedValue(Object.assign(new Error('Your security session changed.'), { name: 'SessionRejected' }));
    native.client.auth.refreshSession.mockResolvedValue({ data: { session: { access_token: 'other', user: { id: 'other-user' } }, user: { id: 'other-user' } }, error: null });
    await mount();
    expect(auth).toMatchObject({ status: 'error', recovery: 'endSession', access: null });
    expect(auth.error).toContain('sign-in could not be renewed');
    expect(native.client.auth.refreshSession).toHaveBeenCalledOnce(); expect(native.access).not.toHaveBeenCalled();
  });
  it('blames the date and time when the renewed token is still rejected by the server', async () => {
    const renewed: Session = { access_token: 'renewed', user: { id: guardian.userId } };
    native.mfa.mockRejectedValue(Object.assign(new Error('Your security session changed.'), { name: 'SessionRejected' }));
    native.client.auth.refreshSession.mockResolvedValue({ data: { session: renewed, user: renewed.user }, error: null });
    await mount();
    expect(auth).toMatchObject({ status: 'error', recovery: 'endSession' });
    expect(auth.error).toContain('date and time');
    expect(native.client.auth.refreshSession).toHaveBeenCalledOnce(); expect(native.mfa).toHaveBeenCalledTimes(2);
  });
  it('shows the connection message when renewing a rejected token fails for a network reason', async () => {
    native.mfa.mockRejectedValue(Object.assign(new Error('Your security session changed.'), { name: 'SessionRejected' }));
    native.client.auth.refreshSession.mockResolvedValue({ data: { session: null, user: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) });
    await mount();
    expect(auth).toMatchObject({ status: 'error', recovery: 'endSession', error: 'Could not verify school access. Check your connection and try again.' });
    expect(native.client.auth.refreshSession).toHaveBeenCalledOnce(); expect(native.mfa).toHaveBeenCalledOnce();
  });
  it('cold-starts a saved Student workspace with exactly one access read and no Guardian flash', async () => {
    native.store.set(roleKey, JSON.stringify({ userId: guardian.userId, role: 'student' }));
    await mount();
    expect(auth).toMatchObject({ status: 'ready', role: 'student' });
    expect(workspaces).not.toContain('ready:parent');
    expect(native.client.auth.getSession).toHaveBeenCalledOnce(); expect(native.mfa).toHaveBeenCalledOnce();
    expect(native.access).toHaveBeenCalledOnce(); expect(native.bound).toHaveBeenCalledOnce();
  });
  it('reads once when a Student-only account starts in the default Guardian role', async () => {
    native.access.mockResolvedValue({ ...guardian, roles: ['student'] });
    await mount();
    expect(auth).toMatchObject({ status: 'ready', role: 'student' });
    expect(native.access).toHaveBeenCalledOnce();
  });
  it('forgets the saved workspace on sign-out and on an Auth sign-out event', async () => {
    await mount(); await act(async () => { await auth.chooseRole('student'); });
    expect(native.store.has(roleKey)).toBe(true);
    await act(async () => { await auth.signOut(); });
    expect(auth.status).toBe('signedOut'); expect(native.store.has(roleKey)).toBe(false);
    native.client.auth.signInWithPassword.mockImplementation(async () => {
      native.client.auth.getSession.mockResolvedValue({ data: { session: sessionA }, error: null });
      native.emitAuth('SIGNED_IN', sessionA); return { error: null };
    });
    await act(async () => { await auth.signIn('school@example.test', 'password'); });
    expect(auth.status).toBe('ready'); expect(auth.role).toBe('parent');
    await act(async () => { await auth.chooseRole('student'); });
    expect(auth.role).toBe('student'); expect(native.store.has(roleKey)).toBe(true);
    native.client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await act(async () => { native.emitAuth('SIGNED_OUT', null); });
    expect(auth.status).toBe('signedOut'); expect(native.store.has(roleKey)).toBe(false);
    await act(async () => { await auth.signIn('school@example.test', 'password'); });
    expect(auth.status).toBe('ready'); expect(auth.role).toBe('parent');
  });
});
