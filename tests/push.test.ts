import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPushLifecycle, isInboxHint, type PushDependencies, type PushHint } from '../src/push/core';

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
  const settings = { preferences: { ...prefs }, devices: [] as { id: string; revoked_at: string | null }[] };
  const driver = {
    requestPermission: vi.fn(async () => true), register: vi.fn(async () => fid), disconnect: vi.fn(async () => {}),
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
  it('rejects an existing binding owned by a different user or role without native access', async () => {
    const f = fixture(); await f.enableNativePush(f.args); vi.clearAllMocks();
    f.getUser.mockResolvedValue({ data: { user: { id: otherUser, is_anonymous: false } }, error: null });
    expect(await f.readPushEnrollment({ userId: otherUser, role: 'parent' })).toBeNull();
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
    await cancelled; expect(await cleaning).toEqual({ serverRevoked: false, nativeCleared: true });
    expect(f.rpc.mock.calls.filter(call => call[0] === 'register_my_family_push_device')).toHaveLength(0);
    expect(f.stored()).toBeNull();
  });
  it('never lets a timed-out native operation overlap cleanup or a new account', async () => {
    vi.useFakeTimers(); const f = fixture(), registration = deferred<string>(); f.driver.register.mockReturnValueOnce(registration.promise);
    const enabling = f.enableNativePush(f.args); const timedOut = expect(enabling).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(10_001); await timedOut;
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

const sdk = vi.hoisted(() => ({
  platform: { OS: 'android', Version: 35 }, permission: vi.fn(async () => 'granted'),
  getApps: vi.fn(() => [{}]), getApp: vi.fn(() => ({})), getMessaging: vi.fn(() => ({})),
  register: vi.fn(async () => {}), unregister: vi.fn(async () => {}), setAutoInitEnabled: vi.fn(async () => {}),
  onRegistered: vi.fn((_instance: unknown, callback: (fid: string) => void) => { callback('n'.repeat(22)); return () => {}; }),
  getInstallations: vi.fn(() => ({})), getId: vi.fn(async () => 'n'.repeat(22)), deleteInstallations: vi.fn(async () => {}),
  onMessage: vi.fn(() => () => {}), onNotificationOpenedApp: vi.fn(() => () => {}), getInitialNotification: vi.fn(async () => null),
}));
vi.mock('react-native', () => ({ Platform: sdk.platform, PermissionsAndroid: { request: sdk.permission, PERMISSIONS: { POST_NOTIFICATIONS: 'post' }, RESULTS: { GRANTED: 'granted' } } }));
vi.mock('@react-native-firebase/app', () => ({ getApps: sdk.getApps, getApp: sdk.getApp }));
vi.mock('@react-native-firebase/messaging', () => ({ getMessaging: sdk.getMessaging, register: sdk.register, unregister: sdk.unregister,
  setAutoInitEnabled: sdk.setAutoInitEnabled, onRegistered: sdk.onRegistered, onMessage: sdk.onMessage,
  onNotificationOpenedApp: sdk.onNotificationOpenedApp, getInitialNotification: sdk.getInitialNotification }));
vi.mock('@react-native-firebase/installations', () => ({ getInstallations: sdk.getInstallations, getId: sdk.getId, deleteInstallations: sdk.deleteInstallations }));

describe('Android FID adapter', () => {
  it('keeps Firebase imports inactive until the native driver is explicitly requested', async () => {
    await import('../src/push/native');
    expect(sdk.getApps).not.toHaveBeenCalled(); expect(sdk.register).not.toHaveBeenCalled();
  });
  it('subscribes before register and handles an immediate cached FID', async () => {
    const { createNativeDriver } = await import('../src/push/native');
    const driver = await createNativeDriver();
    expect(await driver.requestPermission()).toBe(true);
    expect(await driver.register()).toBe('n'.repeat(22));
    expect(sdk.onRegistered.mock.invocationCallOrder.at(-1)).toBeLessThan(sdk.register.mock.invocationCallOrder.at(-1)!);
    expect(sdk.permission).toHaveBeenCalledWith('post');
  });
  it('ignores a stale cached FID when the installation changed after cleanup', async () => {
    const { createNativeDriver } = await import('../src/push/native');
    const driver = await createNativeDriver();
    let registered: ((value: string) => void) | null = null;
    sdk.onRegistered.mockImplementationOnce((_instance, callback) => { registered = callback; callback('s'.repeat(22)); return () => {}; });
    sdk.getId.mockImplementationOnce(async () => { registered?.('n'.repeat(22)); return 'n'.repeat(22); });
    expect(await driver.register()).toBe('n'.repeat(22));
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
