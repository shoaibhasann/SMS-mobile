import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPushLifecycle, isInboxHint, type PushDependencies, type PushHint, type PushPermission } from '../src/push/core';

const userId = '11111111-1111-4111-8111-111111111111';
const otherUser = '22222222-2222-4222-8222-222222222222';
const installationId = '33333333-3333-4333-8333-333333333333';
const deviceId = '44444444-4444-4444-8444-444444444444';
const secret = 'a'.repeat(64), fid = 'c'.repeat(22);
const prefs = { enabled: false, absence: false, result_published: true, leave_decision: true, version: 2 };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
function fixture() {
  let stored: string | null = null;
  let listener: ((kind: PushHint, message: unknown) => void) | null = null;
  let permission: PushPermission = 'prompt';
  const settings = { preferences: { ...prefs }, devices: [] as { id: string; revoked_at: string | null }[] };
  const driver = {
    readPermission: vi.fn(async () => permission),
    requestPermission: vi.fn(async () => { permission = 'granted'; return true; }), register: vi.fn(async () => fid), disconnect: vi.fn(async () => {}),
    currentInstallationId: vi.fn(async () => fid),
    showForegroundHint: vi.fn(),
    listen: vi.fn(async (callback: (kind: PushHint, message: unknown) => void) => { listener = callback; return unsubscribe; }),
  };
  const unsubscribe = vi.fn();
  const responder = vi.fn(async (name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { code: string } | null }> => {
    if (name === 'get_my_family_push_settings') return { data: settings, error: null };
    if (name === 'register_my_family_push_device') {
      if (!settings.devices.some(row => row.id === deviceId)) settings.devices.push({ id: deviceId, revoked_at: null });
      return { data: { device_id: deviceId, generation: 1 }, error: null };
    }
    if (name === 'set_my_family_push_preferences') {
      settings.preferences = { enabled: args.p_enabled as boolean, absence: args.p_absence as boolean,
        result_published: args.p_result_published as boolean, leave_decision: args.p_leave_decision as boolean, version: 3 };
      return { data: settings, error: null };
    }
    return { data: true, error: null };
  });
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => ({ abortSignal: () => responder(name, args) }));
  const getUser = vi.fn(async () => ({ data: { user: { id: userId, is_anonymous: false } }, error: null as unknown }));
  const client = { auth: { getUser }, rpc } as unknown as SupabaseClient;
  const deps: PushDependencies = {
    platform: () => 'android', storage: { read: vi.fn(async () => stored), write: vi.fn(async value => { stored = value; }), clear: vi.fn(async () => { stored = null; }) },
    identity: vi.fn(async () => ({ installationId, secret })), driver: vi.fn(async () => driver),
  };
  const lifecycle = createPushLifecycle(deps);
  const args = { client, userId, role: 'parent' as const, configured: true, label: 'School phone' };
  return { ...lifecycle, args, deps, driver, client, getUser, rpc, responder, settings, unsubscribe,
    stored: () => stored, setStored: (value: string | null) => { stored = value; }, emit: (kind: PushHint, message: unknown) => listener?.(kind, message) };
}
afterEach(() => vi.useRealTimers());

describe('Native push lifecycle', () => {
  it('does not initialize a provider or enroll without configuration or on unsupported iOS', async () => {
    const f = fixture();
    expect(f.getPushAvailability(false).available).toBe(false);
    await expect(f.enableNativePush({ ...f.args, configured: false })).rejects.toMatchObject({ code: 'unavailable' });
    f.deps.platform = () => 'ios';
    await expect(f.enableNativePush(f.args)).rejects.toMatchObject({ code: 'unavailable' });
    await f.attachPushInboxHints({ ...f.args, onInboxHint: vi.fn() });
    expect(f.deps.driver).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it('validates current user and verified role before requesting native permission', async () => {
    const f = fixture();
    f.getUser.mockResolvedValue({ data: { user: { id: otherUser, is_anonymous: false } }, error: null });
    await expect(f.enableNativePush(f.args)).rejects.toMatchObject({ code: 'access' });
    expect(f.deps.driver).not.toHaveBeenCalled();
    f.getUser.mockResolvedValue({ data: { user: { id: userId, is_anonymous: false } }, error: null });
    f.responder.mockResolvedValue({ data: null, error: { code: '42501' } });
    await expect(f.enableNativePush(f.args)).rejects.toMatchObject({ code: '42501' });
    expect(f.driver.requestPermission).not.toHaveBeenCalled();
  });
  it('does not create an identity or register after permission denial', async () => {
    const f = fixture(); f.driver.requestPermission.mockResolvedValue(false);
    await expect(f.enableNativePush(f.args)).rejects.toMatchObject({ code: 'permission' });
    expect(f.deps.identity).not.toHaveBeenCalled(); expect(f.driver.register).not.toHaveBeenCalled(); expect(f.stored()).toBeNull();
  });
  it('does not prompt with a grant, a saved denial, or a legacy registration after settings disable alerts', async () => {
    const f = fixture();
    f.driver.readPermission.mockResolvedValue('settings');
    await expect(f.enableNativePush(f.args)).rejects.toMatchObject({ code: 'permission' });
    f.driver.readPermission.mockResolvedValue('granted');
    await f.enableNativePush(f.args);
    f.driver.readPermission.mockResolvedValue('prompt');
    await expect(f.enableNativePush(f.args)).rejects.toMatchObject({ code: 'permission' });
    expect(f.driver.requestPermission).not.toHaveBeenCalled();
    expect(f.driver.register).toHaveBeenCalledOnce();
  });
  it('persists a secure identity before FID registration and enables only the master preference', async () => {
    const f = fixture();
    f.driver.register.mockImplementation(async () => {
      expect(JSON.parse(f.stored()!)).toMatchObject({ installationId, secret, fid: null, state: 'pending', userId, role: 'parent' });
      return fid;
    });
    expect(await f.enableNativePush(f.args)).toEqual({ deviceId, generation: 1, preferencesEnabled: true });
    expect(f.rpc).toHaveBeenCalledWith('register_my_family_push_device', { p_role: 'parent', p_installation_id: installationId,
      p_installation_secret: secret, p_fid: fid, p_platform: 'android', p_label: 'School phone' });
    expect(f.rpc).toHaveBeenCalledWith('set_my_family_push_preferences', { p_role: 'parent', p_enabled: true, p_absence: false,
      p_result_published: true, p_leave_decision: true, p_expected_version: 2 });
    expect(await f.readPushEnrollment(f.args)).toEqual({ state: 'registered', deviceId, generation: 1 });
    expect(JSON.stringify(await f.readPushEnrollment(f.args))).not.toContain(secret);
    expect(JSON.stringify(await f.readPushEnrollment(f.args))).not.toContain(fid);
  });
  it('requires an explicit reconnect when the installed Firebase identity changes', async () => {
    const f = fixture(); await f.enableNativePush(f.args);
    const rotated = 'r'.repeat(22);
    f.driver.currentInstallationId.mockResolvedValue(rotated);
    expect(await f.readPushEnrollment(f.args)).toEqual({ state: 'pending', deviceId, generation: 1, needsReconnect: true });
    expect(f.driver.register).toHaveBeenCalledOnce();
    f.driver.register.mockResolvedValue(rotated);
    await f.enableNativePush(f.args);
    expect(await f.readPushEnrollment(f.args)).toMatchObject({ state: 'registered' });
    expect(f.rpc).toHaveBeenCalledWith('register_my_family_push_device', expect.objectContaining({ p_installation_id: installationId, p_fid: rotated }));
  });
  it('reports a missing Firebase identity as unverified and skips verification in an unconfigured build', async () => {
    const f = fixture(); await f.enableNativePush(f.args);
    f.driver.currentInstallationId.mockResolvedValueOnce(null as unknown as string);
    await expect(f.readPushEnrollment(f.args)).rejects.toMatchObject({ code: 'response' });
    expect(await f.readPushEnrollment({ ...f.args, configured: false })).toMatchObject({ state: 'registered' });
    expect(f.driver.currentInstallationId).toHaveBeenCalledOnce();
    expect(f.driver.register).toHaveBeenCalledOnce();
  });
  it('notifies the matching active workspace to attach listeners after a granted enrollment or reconnect', async () => {
    const f = fixture(), changed = vi.fn(), other = vi.fn();
    const unsubscribe = f.subscribePushRegistration(f.args, changed);
    f.subscribePushRegistration({ userId: otherUser, role: 'parent' }, other);
    f.driver.readPermission.mockResolvedValue('granted');
    await f.enableNativePush(f.args);
    expect(changed).toHaveBeenCalledOnce(); expect(other).not.toHaveBeenCalled();
    expect(f.driver.requestPermission).not.toHaveBeenCalled();
    unsubscribe();
    await f.enableNativePush(f.args);
    expect(changed).toHaveBeenCalledOnce();
  });
  it('waits for a native installation check before deleting it and discards the old status', async () => {
    const f = fixture(); await f.enableNativePush(f.args);
    const pending = deferred<string>(); f.driver.currentInstallationId.mockReturnValueOnce(pending.promise);
    const result = expect(f.readPushEnrollment(f.args)).rejects.toMatchObject({ code: 'cancelled' });
    await vi.waitFor(() => expect(f.driver.currentInstallationId).toHaveBeenCalledOnce());
    const cleanup = f.disconnectNativePush(f.args);
    expect(f.driver.disconnect).not.toHaveBeenCalled();
    pending.resolve(fid);
    await result; await cleanup;
    expect(f.driver.disconnect).toHaveBeenCalledOnce();
  });
  it('keeps a registered binding when preference confirmation conflicts or is unknown', async () => {
    const f = fixture(), original = f.responder.getMockImplementation()!;
    f.responder.mockImplementation(async (name, args) => name === 'set_my_family_push_preferences'
      ? { data: null, error: { code: 'PT409' } } : original(name, args));
    expect(await f.enableNativePush(f.args)).toEqual({ deviceId, generation: 1, preferencesEnabled: false });
    expect(await f.readPushEnrollment(f.args)).toMatchObject({ state: 'registered' });
    expect(f.driver.disconnect).not.toHaveBeenCalled();
  });
  it('retries an unknown backend acknowledgment using the same installation proof', async () => {
    const f = fixture(), original = f.responder.getMockImplementation()!;
    let fail = true;
    f.responder.mockImplementation(async (name, args) => {
      if (name === 'register_my_family_push_device' && fail) { fail = false; return { data: {}, error: null }; }
      return original(name, args);
    });
    await expect(f.enableNativePush(f.args)).rejects.toMatchObject({ code: 'response' });
    expect(await f.readPushEnrollment(f.args)).toMatchObject({ state: 'pending' });
    await f.enableNativePush(f.args);
    expect(f.deps.identity).toHaveBeenCalledTimes(1);
    const registrations = f.rpc.mock.calls.filter(call => call[0] === 'register_my_family_push_device');
    expect(registrations[0][1]).toEqual(registrations[1][1]);
  });
  it('reads the completed enrollment after the account screen remounts during registration', async () => {
    const f = fixture(), registration = deferred<string>();
    f.driver.register.mockReturnValueOnce(registration.promise);
    const enabling = f.enableNativePush(f.args);
    await vi.waitFor(() => expect(f.driver.register).toHaveBeenCalledOnce());
    const remountRead = f.readPushEnrollment(f.args);
    registration.resolve(fid);
    await enabling;
    await expect(remountRead).resolves.toMatchObject({ state: 'registered', deviceId });
  });
  it('retries a settled native failure with the same owner and original proof', async () => {
    const f = fixture();
    f.driver.register.mockRejectedValueOnce(new Error('temporary native failure'));
    await expect(f.enableNativePush(f.args)).rejects.toMatchObject({ code: 'native' });
    expect(await f.readPushEnrollment(f.args)).toMatchObject({ state: 'pending', deviceId: null });
    await expect(f.enableNativePush(f.args)).resolves.toMatchObject({ deviceId });
    expect(f.deps.identity).toHaveBeenCalledOnce();
    expect(f.driver.requestPermission).toHaveBeenCalledOnce();
  });
  it('rejects an existing binding owned by a different user or role without native access', async () => {
    const f = fixture(); await f.enableNativePush(f.args); vi.clearAllMocks();
    f.getUser.mockResolvedValue({ data: { user: { id: otherUser, is_anonymous: false } }, error: null });
    expect(await f.readPushEnrollment({ userId: otherUser, role: 'parent', configured: true })).toBeNull();
    await expect(f.enableNativePush({ ...f.args, userId: otherUser })).rejects.toMatchObject({ code: 'cleanup' });
    f.getUser.mockResolvedValue({ data: { user: { id: userId, is_anonymous: false } }, error: null });
    await expect(f.enableNativePush({ ...f.args, role: 'student' })).rejects.toMatchObject({ code: 'cleanup' });
    expect(f.deps.driver).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it('never automatically reactivates a remotely revoked identity', async () => {
    const f = fixture(); await f.enableNativePush(f.args); f.settings.devices[0].revoked_at = '2026-11-06T00:00:00Z';
    vi.clearAllMocks();
    await expect(f.enableNativePush(f.args)).rejects.toMatchObject({ code: 'revoked' });
    expect(await f.readPushEnrollment(f.args)).toMatchObject({ state: 'cleanup-required' });
    expect(f.driver.register).not.toHaveBeenCalled();
    await expect(f.enableNativePush(f.args)).rejects.toMatchObject({ code: 'cleanup' });
    expect(await f.disconnectNativePush(f.args)).toEqual({ serverRevoked: true, nativeCleared: true });
    expect(f.driver.disconnect).toHaveBeenCalledOnce(); expect(f.stored()).toBeNull();
    await f.enableNativePush(f.args); expect(f.deps.identity).toHaveBeenCalledOnce();
  });
  it('retains a cleanup tombstone after backend access is denied during registration', async () => {
    const f = fixture(), original = f.responder.getMockImplementation()!;
    f.responder.mockImplementation(async (name, args) => name === 'register_my_family_push_device'
      ? { data: null, error: { code: '42501' } } : original(name, args));
    await expect(f.enableNativePush(f.args)).rejects.toMatchObject({ code: '42501' });
    expect(await f.readPushEnrollment(f.args)).toMatchObject({ state: 'cleanup-required' });
    await expect(f.enableNativePush(f.args)).rejects.toMatchObject({ code: 'cleanup' });
  });
  it('still clears native installation after auth expiry, without falsely confirming remote revoke', async () => {
    const f = fixture(); await f.enableNativePush(f.args);
    f.getUser.mockResolvedValue({ data: { user: { id: otherUser, is_anonymous: false } }, error: null });
    expect(await f.disconnectNativePush(f.args)).toEqual({ serverRevoked: false, nativeCleared: true });
    expect(f.driver.disconnect).toHaveBeenCalledOnce(); expect(f.stored()).toBeNull();
    expect(f.rpc.mock.calls.filter(call => call[0] === 'revoke_my_family_push_device')).toHaveLength(0);
  });
  it('does not claim remote revoke for a missing or foreign row', async () => {
    const f = fixture(); await f.enableNativePush(f.args);
    const original = f.responder.getMockImplementation()!;
    f.responder.mockImplementation(async (name, args) => name === 'revoke_my_family_push_device' ? { data: false, error: null } : original(name, args));
    expect(await f.disconnectNativePush(f.args)).toEqual({ serverRevoked: false, nativeCleared: true });
  });
  it('blocks new registration after native cleanup failure and permits an explicit successful retry', async () => {
    const f = fixture(); await f.enableNativePush(f.args); f.driver.disconnect.mockRejectedValueOnce(new Error('native failure'));
    expect(await f.disconnectNativePush(f.args)).toEqual({ serverRevoked: true, nativeCleared: false });
    expect(await f.readPushEnrollment(f.args)).toMatchObject({ state: 'cleanup-required' });
    await expect(f.enableNativePush(f.args)).rejects.toMatchObject({ code: 'cleanup' });
    expect(await f.disconnectNativePush(f.args)).toEqual({ serverRevoked: true, nativeCleared: true });
    f.getUser.mockResolvedValue({ data: { user: { id: otherUser, is_anonymous: false } }, error: null });
    await f.enableNativePush({ ...f.args, userId: otherUser });
    expect(f.deps.identity).toHaveBeenCalledTimes(2);
  });
  it('serializes logout cleanup behind an in-flight native registration and cancels old owner commits', async () => {
    const f = fixture(), registration = deferred<string>();
    f.driver.register.mockReturnValueOnce(registration.promise);
    const enabling = f.enableNativePush(f.args); const cancelled = expect(enabling).rejects.toMatchObject({ code: 'cancelled' });
    await vi.waitFor(() => expect(f.driver.register).toHaveBeenCalledOnce());
    const cleaning = f.disconnectNativePush(f.args);
    await expect(f.enableNativePush(f.args)).rejects.toMatchObject({ code: 'busy' });
    expect(f.driver.disconnect).not.toHaveBeenCalled(); registration.resolve(fid);
    await cancelled; expect(await cleaning).toEqual({ serverRevoked: true, nativeCleared: true });
    expect(f.rpc.mock.calls.filter(call => call[0] === 'register_my_family_push_device')).toHaveLength(0);
    expect(f.stored()).toBeNull();
  });
  it('never lets a timed-out native operation overlap cleanup or a new account', async () => {
    vi.useFakeTimers(); const f = fixture(), registration = deferred<string>(); f.driver.register.mockReturnValueOnce(registration.promise);
    const enabling = f.enableNativePush(f.args); const timedOut = expect(enabling).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(10_001);
    await expect(f.enableNativePush(f.args)).rejects.toMatchObject({ code: 'busy' });
    await vi.advanceTimersByTimeAsync(15_000); await timedOut;
    await expect(f.enableNativePush(f.args)).rejects.toMatchObject({ code: 'cleanup' });
    const cleaning = f.disconnectNativePush(f.args); await vi.advanceTimersByTimeAsync(10_001);
    expect(await cleaning).toMatchObject({ nativeCleared: false }); expect(f.driver.disconnect).not.toHaveBeenCalled();
    registration.resolve(fid); await vi.advanceTimersByTimeAsync(0);
    expect(await f.disconnectNativePush(f.args)).toMatchObject({ nativeCleared: true });
    expect(f.driver.disconnect).toHaveBeenCalledOnce();
  });
  it('cleans malformed saved data before allowing enrollment', async () => {
    const f = fixture(); f.setStored('{invalid');
    await expect(f.readPushEnrollment(f.args)).rejects.toMatchObject({ code: 'storage' });
    await expect(f.enableNativePush(f.args)).rejects.toMatchObject({ code: 'storage' });
    expect(await f.disconnectNativePush(f.args)).toEqual({ serverRevoked: false, nativeCleared: true });
    expect(f.stored()).toBeNull();
  });
  it('avoids native initialization when there has never been a saved enrollment', async () => {
    const f = fixture(); expect(await f.disconnectNativePush(f.args)).toEqual({ serverRevoked: true, nativeCleared: true });
    expect(f.deps.driver).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it('only hints an existing same-owner inbox and stops hint callbacks during logout', async () => {
    const f = fixture(), hints = vi.fn();
    await f.attachPushInboxHints({ ...f.args, onInboxHint: hints }); expect(f.driver.listen).not.toHaveBeenCalled();
    await f.enableNativePush(f.args);
    await f.attachPushInboxHints({ ...f.args, userId: otherUser, onInboxHint: hints }); expect(f.driver.listen).not.toHaveBeenCalled();
    const stop = await f.attachPushInboxHints({ ...f.args, onInboxHint: hints });
    f.emit('opened', { data: { url: 'https://attacker.example', student_id: 'private' } });
    f.emit('received', { data: { screen: 'notifications' } }); f.emit('opened', { data: { screen: 'notifications', url: 'https://ignored.example' } });
    expect(hints.mock.calls).toEqual([['received'], ['opened']]);
    const cleaning = f.disconnectNativePush(f.args); f.emit('opened', { data: { screen: 'notifications' } });
    expect(hints).toHaveBeenCalledTimes(2); expect(f.unsubscribe).toHaveBeenCalledOnce(); await cleaning; stop();
  });
  it('refreshes the matching inbox and only shows the foreground message with OS permission', async () => {
    const f = fixture(), hint = { data: { screen: 'notifications' } };
    const reload = vi.fn(), other = vi.fn();
    const unsubscribe = f.subscribePushInboxRefresh(f.args, reload);
    f.subscribePushInboxRefresh({ userId, role: 'student' }, other);
    f.subscribePushInboxRefresh({ userId: otherUser, role: 'parent' }, other);
    await f.enableNativePush(f.args);
    const stop = await f.attachPushInboxHints({ ...f.args, onInboxHint: vi.fn() });
    f.emit('received', { data: { screen: '/admin' } });
    f.driver.readPermission.mockResolvedValueOnce('settings');
    f.emit('received', hint); await Promise.resolve();
    expect(reload).toHaveBeenCalledOnce(); expect(other).not.toHaveBeenCalled();
    expect(f.driver.showForegroundHint).not.toHaveBeenCalled();
    f.emit('received', hint); await Promise.resolve();
    expect(reload).toHaveBeenCalledTimes(2); expect(f.driver.showForegroundHint).toHaveBeenCalledOnce();
    unsubscribe();
    f.emit('opened', hint);
    expect(reload).toHaveBeenCalledTimes(2); expect(f.driver.showForegroundHint).toHaveBeenCalledOnce();
    const pendingPermission = deferred<PushPermission>();
    f.driver.readPermission.mockReturnValueOnce(pendingPermission.promise);
    f.emit('received', hint); stop(); pendingPermission.resolve('granted'); await Promise.resolve();
    expect(f.driver.showForegroundHint).toHaveBeenCalledOnce();
  });
  it('cleans a saved installation on confirmed cold-start auth loss without a session or any RPC', async () => {
    const f = fixture(); await f.enableNativePush(f.args); vi.clearAllMocks();
    expect(await f.cleanupSavedPushOnAuthLoss()).toEqual({ nativeCleared: true });
    expect(f.driver.disconnect).toHaveBeenCalledOnce(); expect(f.stored()).toBeNull();
    expect(f.getUser).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it('auth-loss cleanup does not initialize Firebase if this phone was never enrolled', async () => {
    const f = fixture(); expect(await f.cleanupSavedPushOnAuthLoss()).toEqual({ nativeCleared: true });
    expect(f.deps.driver).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it('serializes confirmed auth-loss cleanup behind an enrollment and blocks re-enrollment after cleanup failure', async () => {
    const f = fixture(), registration = deferred<string>(); f.driver.register.mockReturnValueOnce(registration.promise);
    const enabling = f.enableNativePush(f.args), cancelled = expect(enabling).rejects.toMatchObject({ code: 'cancelled' });
    await vi.waitFor(() => expect(f.driver.register).toHaveBeenCalledOnce());
    f.driver.disconnect.mockRejectedValueOnce(new Error('native failure'));
    const cleaning = f.cleanupSavedPushOnAuthLoss();
    await expect(f.enableNativePush(f.args)).rejects.toMatchObject({ code: 'busy' });
    registration.resolve(fid); await cancelled;
    expect(await cleaning).toEqual({ nativeCleared: false });
    await expect(f.enableNativePush(f.args)).rejects.toMatchObject({ code: 'cleanup' });
    expect(await f.cleanupSavedPushOnAuthLoss()).toEqual({ nativeCleared: true });
    expect(f.rpc.mock.calls.filter(call => call[0] === 'revoke_my_family_push_device')).toHaveLength(0);
  });
  it('recognizes only the fixed notification inbox signal without accepting arbitrary destinations', () => {
    expect(isInboxHint({ data: { screen: 'notifications' } })).toBe(true);
    for (const message of [null, {}, { data: [] }, { data: { screen: '/admin' } }, { url: 'notifications' }]) expect(isInboxHint(message)).toBe(false);
  });
});

describe('Push cleanup for unacknowledged and same-user registrations', () => {
  const revokes = (f: ReturnType<typeof fixture>) => f.rpc.mock.calls.filter(call => call[0] === 'revoke_my_family_push_device');
  it('passes the device-limit reason through and treats the unacknowledged binding as clean after FID deletion', async () => {
    const f = fixture(), original = f.responder.getMockImplementation()!;
    f.responder.mockImplementation(async (name, args) => name === 'register_my_family_push_device'
      ? { data: null, error: { code: '22023', message: 'Remove an old device before adding another.' } as { code: string } } : original(name, args));
    await expect(f.enableNativePush(f.args)).rejects.toMatchObject({ code: '22023', message: 'Remove an old device before adding another.' });
    expect(JSON.parse(f.stored()!)).toMatchObject({ fid, deviceId: null });
    expect(await f.disconnectNativePush(f.args)).toEqual({ serverRevoked: true, nativeCleared: true });
    expect(revokes(f)).toHaveLength(0); expect(f.driver.disconnect).toHaveBeenCalledOnce(); expect(f.stored()).toBeNull();
  });
  it('treats a register RPC that failed after the FID was saved as clean once native cleanup succeeds', async () => {
    const f = fixture(), original = f.responder.getMockImplementation()!;
    f.responder.mockImplementation(async (name, args) => name === 'register_my_family_push_device' ? Promise.reject(new Error('network')) : original(name, args));
    await expect(f.enableNativePush(f.args)).rejects.toBeTruthy();
    expect(await f.disconnectNativePush(f.args)).toEqual({ serverRevoked: true, nativeCleared: true });
  });
  it('revokes a registration whose acknowledgement was lost by this phone’s own installation id', async () => {
    const f = fixture(), original = f.responder.getMockImplementation()!;
    f.responder.mockImplementation(async (name, args) => name === 'register_my_family_push_device' ? Promise.reject(new Error('network')) : original(name, args));
    await expect(f.enableNativePush({ ...f.args, role: 'student' })).rejects.toBeTruthy();
    expect(await f.disconnectNativePush(f.args)).toEqual({ serverRevoked: true, nativeCleared: true });
    expect(f.rpc.mock.calls.filter(call => call[0] === 'revoke_my_family_push_installation'))
      .toEqual([['revoke_my_family_push_installation', { p_role: 'student', p_installation_id: installationId }]]);
    expect(revokes(f)).toHaveLength(0); expect(f.driver.disconnect).toHaveBeenCalledOnce();
    const g = fixture(); g.driver.register.mockRejectedValueOnce(new Error('native failure'));
    await expect(g.enableNativePush(g.args)).rejects.toMatchObject({ code: 'native' });
    await g.disconnectNativePush(g.args);
    expect(g.rpc.mock.calls.some(call => call[0] === 'revoke_my_family_push_installation')).toBe(false);
  });
  it('keeps the strict result when native cleanup of an unacknowledged binding fails', async () => {
    const f = fixture(), original = f.responder.getMockImplementation()!;
    f.responder.mockImplementation(async (name, args) => name === 'register_my_family_push_device' ? { data: {}, error: null }
      : name === 'revoke_my_family_push_installation' ? { data: null, error: { code: 'PGRST000' } } : original(name, args));
    await expect(f.enableNativePush(f.args)).rejects.toMatchObject({ code: 'response' });
    f.driver.disconnect.mockRejectedValueOnce(new Error('native failure'));
    expect(await f.disconnectNativePush(f.args)).toEqual({ serverRevoked: false, nativeCleared: false });
    // Once the installation revoke is confirmed, the server side is clean even while native cleanup still fails.
    f.responder.mockImplementation(original);
    f.driver.disconnect.mockRejectedValueOnce(new Error('native failure'));
    expect(await f.disconnectNativePush(f.args)).toEqual({ serverRevoked: true, nativeCleared: false });
  });
  it('revokes the same user’s other-role binding from the other workspace, never another user’s', async () => {
    const f = fixture(); await f.enableNativePush({ ...f.args, role: 'student' });
    expect(await f.disconnectNativePush({ ...f.args, role: 'parent' })).toEqual({ serverRevoked: true, nativeCleared: true });
    expect(revokes(f)).toEqual([['revoke_my_family_push_device', { p_role: 'student', p_device_id: deviceId }]]);
    const g = fixture(); await g.enableNativePush({ ...g.args, role: 'student' });
    g.getUser.mockResolvedValue({ data: { user: { id: otherUser, is_anonymous: false } }, error: null });
    expect(await g.disconnectNativePush({ ...g.args, userId: otherUser })).toEqual({ serverRevoked: false, nativeCleared: true });
    expect(revokes(g)).toHaveLength(0);
  });
});

const sdk = vi.hoisted(() => ({
  platform: { OS: 'android', Version: 35 }, permission: vi.fn(async () => 'granted'), hasPermission: vi.fn(async () => 0),
  readPrompt: vi.fn(async (): Promise<string | null> => null), writePrompt: vi.fn(async () => {}),
  getApps: vi.fn(() => [{}]), getApp: vi.fn(() => ({})), getMessaging: vi.fn(() => ({})),
  register: vi.fn(async () => {}), unregister: vi.fn(async () => {}), setAutoInitEnabled: vi.fn(async () => {}),
  getInstallations: vi.fn(() => ({})), getId: vi.fn(async () => 'n'.repeat(22)), deleteInstallations: vi.fn(async () => {}),
  onMessage: vi.fn(() => () => {}), onNotificationOpenedApp: vi.fn(() => () => {}), getInitialNotification: vi.fn(async () => null),
  toast: vi.fn(),
}));
vi.mock('react-native', () => ({ Platform: sdk.platform, PermissionsAndroid: { request: sdk.permission, PERMISSIONS: { POST_NOTIFICATIONS: 'post' }, RESULTS: { GRANTED: 'granted' } }, ToastAndroid: { show: sdk.toast, SHORT: 0 } }));
vi.mock('expo-secure-store', () => ({ getItemAsync: sdk.readPrompt, setItemAsync: sdk.writePrompt }));
vi.mock('@react-native-firebase/app', () => ({ getApps: sdk.getApps, getApp: sdk.getApp }));
vi.mock('@react-native-firebase/messaging', () => ({ getMessaging: sdk.getMessaging, register: sdk.register, unregister: sdk.unregister,
  hasPermission: sdk.hasPermission, AuthorizationStatus: { AUTHORIZED: 1 },
  setAutoInitEnabled: sdk.setAutoInitEnabled, onMessage: sdk.onMessage,
  onNotificationOpenedApp: sdk.onNotificationOpenedApp, getInitialNotification: sdk.getInitialNotification }));
vi.mock('@react-native-firebase/installations', () => ({ getInstallations: sdk.getInstallations, getId: sdk.getId, deleteInstallations: sdk.deleteInstallations }));

describe('Android FID adapter', () => {
  it('keeps Firebase imports inactive until the native driver is explicitly requested', async () => {
    await import('../src/push/native');
    expect(sdk.getApps).not.toHaveBeenCalled(); expect(sdk.register).not.toHaveBeenCalled();
  });
  it('returns the same installation only after Firebase confirms its registration', async () => {
    const { createNativeDriver } = await import('../src/push/native');
    const driver = await createNativeDriver();
    expect(await driver.requestPermission()).toBe(true);
    expect(await driver.register()).toBe('n'.repeat(22));
    const [before, after] = sdk.getId.mock.invocationCallOrder.slice(-2);
    expect(before).toBeLessThan(sdk.register.mock.invocationCallOrder.at(-1)!);
    expect(after).toBeGreaterThan(sdk.register.mock.invocationCallOrder.at(-1)!);
    expect(sdk.permission).toHaveBeenCalledWith('post');
  });
  it('checks actual Android permission again after Settings without a second OS prompt', async () => {
    const { createNativeDriver } = await import('../src/push/native');
    const driver = await createNativeDriver();
    sdk.permission.mockClear().mockResolvedValueOnce('denied');
    sdk.writePrompt.mockClear().mockImplementationOnce(async () => { sdk.readPrompt.mockResolvedValueOnce('1'); });
    expect(await driver.requestPermission()).toBe(false);
    expect(sdk.writePrompt).toHaveBeenCalledOnce();
    expect(await driver.requestPermission()).toBe(false);
    sdk.hasPermission.mockResolvedValueOnce(1);
    expect(await driver.readPermission()).toBe('granted');
    expect(sdk.permission).toHaveBeenCalledOnce();
  });
  it('rejects an installation that rotated while registering', async () => {
    const { createNativeDriver } = await import('../src/push/native');
    const driver = await createNativeDriver();
    sdk.getId.mockResolvedValueOnce('s'.repeat(22));
    await expect(driver.register()).rejects.toMatchObject({ code: 'native' });
  });
  it('reads the Firebase installation without enrolling and gives a retryable message for provider errors', async () => {
    const { createNativeDriver } = await import('../src/push/native');
    const driver = await createNativeDriver();
    sdk.register.mockClear();
    expect(await driver.currentInstallationId()).toBe('n'.repeat(22));
    sdk.getId.mockRejectedValueOnce(new Error('Firebase transport error'));
    await expect(driver.currentInstallationId()).rejects.toThrow('Phone registration could not be verified. Try again.');
    expect(sdk.register).not.toHaveBeenCalled();
    driver.showForegroundHint();
    expect(sdk.toast).toHaveBeenCalledWith('New school update. Open Updates to view it.', 0);
  });
  it('attempts installation deletion even when unregister fails synchronously and does not claim cleanup success', async () => {
    const { createNativeDriver } = await import('../src/push/native');
    const driver = await createNativeDriver();
    sdk.unregister.mockImplementationOnce(() => { throw new Error('native unregister failure'); });
    await expect(driver.disconnect()).rejects.toMatchObject({ code: 'native' });
    expect(sdk.setAutoInitEnabled).toHaveBeenCalledWith(expect.anything(), false);
    expect(sdk.deleteInstallations).toHaveBeenCalledOnce();
  });
});

describe('Native push registration refresh', () => {
  const registerCalls = (f: ReturnType<typeof fixture>) => f.rpc.mock.calls.filter(([name]) => name === 'register_my_family_push_device');
  async function registered() {
    const f = fixture(); f.driver.readPermission.mockResolvedValue('granted');
    await f.enableNativePush(f.args); f.rpc.mockClear(); f.driver.register.mockClear();
    return f;
  }
  it('re-registers the saved installation so only last_seen_at moves, without prompting or rotating the FID', async () => {
    const f = await registered();
    await f.refreshNativePushRegistration(f.args);
    expect(registerCalls(f)).toEqual([['register_my_family_push_device', { p_role: 'parent', p_installation_id: installationId,
      p_installation_secret: secret, p_fid: fid, p_platform: 'android', p_label: 'School phone' }]]);
    expect(f.driver.register).not.toHaveBeenCalled(); expect(f.driver.requestPermission).not.toHaveBeenCalled();
    expect(JSON.parse(f.stored()!)).toMatchObject({ state: 'registered', deviceId, generation: 1, fid });
  });
  it('throttles repeat refreshes for the same owner', async () => {
    const f = await registered();
    await f.refreshNativePushRegistration(f.args); await f.refreshNativePushRegistration(f.args);
    expect(registerCalls(f)).toHaveLength(1);
  });
  it('does nothing without a registered binding for this owner, without permission, or after an FID rotation', async () => {
    const empty = fixture();
    await empty.refreshNativePushRegistration(empty.args);
    expect(empty.deps.driver).not.toHaveBeenCalled(); expect(empty.rpc).not.toHaveBeenCalled();
    const f = await registered();
    await f.refreshNativePushRegistration({ ...f.args, userId: otherUser });
    vi.useFakeTimers({ toFake: ['Date'] });
    f.driver.readPermission.mockResolvedValue('settings');
    await f.refreshNativePushRegistration(f.args);
    vi.advanceTimersByTime(10 * 60_000);
    f.driver.readPermission.mockResolvedValue('granted'); f.driver.currentInstallationId.mockResolvedValue('r'.repeat(22));
    await f.refreshNativePushRegistration(f.args);
    expect(f.driver.currentInstallationId).toHaveBeenCalled();
    expect(registerCalls(f)).toHaveLength(0);
  });
  it.each([
    ['no saved binding', async (f: ReturnType<typeof fixture>) => { f.setStored(null); }],
    ['a pending binding', async (f: ReturnType<typeof fixture>) => { f.setStored(JSON.stringify({ ...JSON.parse(f.stored()!), state: 'pending' })); }],
    ['a rotated installation id', async (f: ReturnType<typeof fixture>) => { f.driver.currentInstallationId.mockResolvedValue('r'.repeat(22)); }],
    ['a failed registration', async (f: ReturnType<typeof fixture>) => { f.responder.mockResolvedValue({ data: null, error: { code: '08006' } }); }],
  ])('retries %s at most once every 10 minutes instead of on every token tick', async (_, arrange) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const f = await registered(); await arrange(f);
    const reads = () => vi.mocked(f.deps.storage.read).mock.calls.length;
    await f.refreshNativePushRegistration(f.args);
    const afterFirst = reads(), driverCalls = vi.mocked(f.deps.driver).mock.calls.length;
    for (let tick = 0; tick < 19; tick += 1) { vi.advanceTimersByTime(30_000); await f.refreshNativePushRegistration(f.args); }
    expect(reads()).toBe(afterFirst); expect(vi.mocked(f.deps.driver).mock.calls.length).toBe(driverCalls);
    vi.advanceTimersByTime(30_000);
    await f.refreshNativePushRegistration(f.args);
    expect(reads()).toBe(afterFirst + 1);
  });
  it.each([
    ['notification permission that is re-granted in Android settings', (f: ReturnType<typeof fixture>) => {
      f.driver.readPermission.mockResolvedValueOnce('settings'); }],
    ['a sign-in check that is not ready yet', (f: ReturnType<typeof fixture>) => {
      f.getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('not ready') } as never); }],
    ['a failed explicit enable that cancels the refresh mid-way', (f: ReturnType<typeof fixture>) => {
      f.getUser.mockImplementationOnce(async () => {
        f.responder.mockResolvedValueOnce({ data: null, error: { code: '08006' } });
        await expect(f.enableNativePush(f.args)).rejects.toThrow();
        return { data: { user: { id: userId, is_anonymous: false } }, error: null };
      }); }],
  ])('retries straight away after %s, because the refresh never reached the server', async (_, arrange) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const f = await registered(); arrange(f);
    await f.refreshNativePushRegistration(f.args);
    expect(registerCalls(f)).toHaveLength(0);
    vi.advanceTimersByTime(30_000);
    await f.refreshNativePushRegistration(f.args);
    expect(registerCalls(f)).toHaveLength(1);
  });
  it('sends one registration when start-up and a token refresh overlap', async () => {
    const f = await registered();
    await Promise.all([f.refreshNativePushRegistration(f.args), f.refreshNativePushRegistration(f.args)]);
    expect(registerCalls(f)).toHaveLength(1);
  });
  it('refreshes immediately after an explicit enable even when an earlier attempt was throttled', async () => {
    const f = fixture(); f.driver.readPermission.mockResolvedValue('granted');
    await f.refreshNativePushRegistration(f.args);
    await f.enableNativePush(f.args); f.rpc.mockClear();
    await f.refreshNativePushRegistration(f.args);
    expect(registerCalls(f)).toHaveLength(1);
  });
  it('marks a remotely revoked phone for cleanup and never reactivates it', async () => {
    const f = await registered();
    f.responder.mockResolvedValueOnce({ data: null, error: { code: '42501' } });
    await expect(f.refreshNativePushRegistration(f.args)).resolves.toBeUndefined();
    expect(JSON.parse(f.stored()!)).toMatchObject({ state: 'cleanup-required' });
    await f.refreshNativePushRegistration(f.args);
    expect(registerCalls(f)).toHaveLength(1);
  });
  it('swallows other failures and retries on the next start', async () => {
    const f = await registered();
    f.responder.mockResolvedValueOnce({ data: null, error: { code: '08006' } });
    vi.useFakeTimers({ toFake: ['Date'] });
    await expect(f.refreshNativePushRegistration(f.args)).resolves.toBeUndefined();
    expect(JSON.parse(f.stored()!)).toMatchObject({ state: 'registered' });
    await f.refreshNativePushRegistration(f.args);
    expect(registerCalls(f)).toHaveLength(1);
    vi.advanceTimersByTime(10 * 60_000);
    await f.refreshNativePushRegistration(f.args);
    expect(registerCalls(f)).toHaveLength(2);
  });
  it('does not write a refresh result after the account changes mid-request', async () => {
    const f = await registered(), reply = deferred<{ data: unknown; error: null }>();
    f.responder.mockReturnValueOnce(reply.promise);
    const refreshing = f.refreshNativePushRegistration(f.args);
    await vi.waitFor(() => expect(registerCalls(f)).toHaveLength(1));
    const cleanup = f.disconnectNativePush(f.args);
    reply.resolve({ data: { device_id: deviceId, generation: 2 }, error: null });
    await refreshing; await cleanup;
    expect(f.stored()).toBeNull();
  });
});
