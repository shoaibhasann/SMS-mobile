import type { SupabaseClient } from '@supabase/supabase-js';

export type PushRole = 'parent' | 'student';
export type PushOwner = { userId: string; role: PushRole };
export type PushEnrollment = { state: 'pending' | 'registered' | 'cleanup-required'; deviceId: string | null; generation: number | null };
export type PushArguments = PushOwner & { client: SupabaseClient };
export type PushHint = 'received' | 'opened';
export type PushDriver = {
  requestPermission(): Promise<boolean>;
  register(): Promise<string>;
  disconnect(): Promise<void>;
  listen(callback: (kind: PushHint, message: unknown) => void): Promise<() => void>;
};
export type PushDependencies = {
  platform(): string;
  storage: { read(): Promise<string | null>; write(value: string): Promise<void>; clear(): Promise<void> };
  identity(): Promise<{ installationId: string; secret: string }>;
  driver(): Promise<PushDriver>;
};
type Binding = PushOwner & PushEnrollment & { version: 1; installationId: string; secret: string; fid: string | null };
type Preferences = { enabled: boolean; absence: boolean; result_published: boolean; leave_decision: boolean; version: number };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const fid = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{22}$/.test(value);
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const sameOwner = (a: PushOwner, b: PushOwner) => a.userId === b.userId && a.role === b.role;
export class NativePushError extends Error {
  constructor(message: string, public code = 'unavailable') { super(message); this.name = 'NativePushError'; }
}
function owner(value: PushOwner) {
  if (!uuid(value.userId) || !['parent', 'student'].includes(value.role)) throw new NativePushError('Sign in with a verified family account.', 'access');
}
async function limited<T>(promise: PromiseLike<T>, milliseconds = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new NativePushError('The phone update could not be confirmed. Retry before sharing this phone.', 'timeout')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
function decode(raw: string | null): Binding | null {
  if (raw === null) return null;
  try {
    const row = record(JSON.parse(raw));
    if (row.version !== 1 || !uuid(row.userId) || !['parent', 'student'].includes(String(row.role)) || !uuid(row.installationId)
      || typeof row.secret !== 'string' || !/^[0-9a-f]{64}$/.test(row.secret) || !(row.fid === null || fid(row.fid))
      || !['pending', 'registered', 'cleanup-required'].includes(String(row.state)) || !(row.deviceId === null || uuid(row.deviceId))
      || !(row.generation === null || Number.isSafeInteger(row.generation) && Number(row.generation) > 0)
      || row.state === 'registered' && (row.deviceId === null || row.generation === null || row.fid === null)) throw new Error();
    return row as Binding;
  } catch { throw new NativePushError('Saved phone registration could not be verified. Disconnect push before enabling it again.', 'storage'); }
}
export function isInboxHint(message: unknown) { return record(record(message).data).screen === 'notifications'; }

export function createPushLifecycle(deps: PushDependencies) {
  let running: Promise<unknown> | null = null, nativePending: Promise<unknown> | null = null;
  let epoch = 0, cleanupBlocked = false, detach = () => {};
  const stopHints = () => { detach(); detach = () => {}; };
  const read = async () => decode(await deps.storage.read());
  const write = (binding: Binding) => deps.storage.write(JSON.stringify(binding));
  const current = (expected: number) => { if (epoch !== expected) throw new NativePushError('The account changed. Reopen phone settings.', 'cancelled'); };
  async function rpc(client: SupabaseClient, name: string, args: Record<string, unknown>) {
    const controller = new AbortController();
    try {
      const response = await limited(client.rpc(name, args).abortSignal(controller.signal), 8_000);
      if (response.error) throw new NativePushError(response.error.code === '42501'
        ? 'Phone access could not be verified. Disconnect before enabling again.' : response.error.code === 'PT409'
          ? 'Notification preferences changed. Refresh settings before trying again.' : 'The phone update could not be confirmed. Retry or disconnect before sharing this phone.', response.error.code);
      return response.data as unknown;
    } finally { controller.abort(); }
  }
  async function assertOwner(args: PushArguments) {
    owner(args);
    const auth = await limited(args.client.auth.getUser(), 8_000);
    if (auth.error || auth.data.user?.id !== args.userId || auth.data.user.is_anonymous) throw new NativePushError('Your sign-in changed. Sign in again before managing phone alerts.', 'access');
  }
  async function nativeCall<T>(work: Promise<T>): Promise<T> {
    const pending = Promise.resolve(work); nativePending = pending;
    void pending.finally(() => { if (nativePending === pending) nativePending = null; }).catch(() => {});
    return limited(pending);
  }
  function getPushAvailability(configured: boolean) {
    return !configured ? { available: false, reason: 'Native push is not configured for this build.' }
      : deps.platform() !== 'android' ? { available: false, reason: 'Phone push enrollment is Android-only in this build.' }
        : { available: true, reason: '' };
  }
  async function readPushEnrollment(args: PushOwner): Promise<PushEnrollment | null> {
    owner(args); const binding = await read();
    return binding && sameOwner(binding, args) ? { state: binding.state, deviceId: binding.deviceId, generation: binding.generation } : null;
  }
  async function enableNativePush(args: PushArguments & { configured: boolean; label: string }) {
    if (running) throw new NativePushError('A phone update is already in progress. Wait for it to finish.', 'busy');
    const available = getPushAvailability(args.configured);
    if (!available.available) throw new NativePushError(available.reason);
    owner(args);
    if (!args.label.trim() || Array.from(args.label.trim()).length > 80) throw new NativePushError('Choose a phone name between 1 and 80 characters.', 'validation');
    const expected = ++epoch; stopHints();
    const task = (async () => {
      if (cleanupBlocked || nativePending) throw new NativePushError('Disconnect the previous phone registration before enabling alerts.', 'cleanup');
      await assertOwner(args); current(expected);
      let binding = await read(); current(expected);
      if (binding && (!sameOwner(binding, args) || binding.state === 'cleanup-required' || binding.state === 'pending' && !binding.fid)) throw new NativePushError('Disconnect the previous phone registration before enabling alerts.', 'cleanup');
      const settings = record(await rpc(args.client, 'get_my_family_push_settings', { p_role: args.role })); current(expected);
      const prefs = record(settings.preferences);
      if (![prefs.enabled, prefs.absence, prefs.result_published, prefs.leave_decision].every(value => typeof value === 'boolean') || !Number.isSafeInteger(prefs.version) || Number(prefs.version) < 0 || !Array.isArray(settings.devices)) throw new NativePushError('Notification preferences could not be verified. Refresh settings.', 'response');
      const preferences = prefs as Preferences;
      if (binding?.deviceId && !settings.devices.some(value => { const row = record(value); return row.id === binding?.deviceId && row.revoked_at === null; })) {
        binding.state = 'cleanup-required'; await write(binding);
        throw new NativePushError('This phone registration was revoked. Disconnect it before explicitly enabling a new registration.', 'revoked');
      }
      const driver = await deps.driver(); current(expected);
      if (!await limited(driver.requestPermission(), 30_000)) throw new NativePushError('Phone notification permission was not granted.', 'permission');
      current(expected);
      if (!binding) {
        const identity = await deps.identity(); current(expected);
        if (!uuid(identity.installationId) || !/^[0-9a-f]{64}$/.test(identity.secret)) throw new NativePushError('Phone security identity could not be created.', 'storage');
        binding = { version: 1, userId: args.userId, role: args.role, ...identity, fid: null, deviceId: null, generation: null, state: 'pending' };
        await write(binding); current(expected);
      }
      const nextFid = await nativeCall(driver.register()); current(expected);
      if (!fid(nextFid)) throw new NativePushError('Firebase installation registration could not be verified.', 'response');
      binding.fid = nextFid; binding.state = 'pending'; await write(binding); current(expected);
      let result: unknown;
      try {
        result = await rpc(args.client, 'register_my_family_push_device', { p_role: args.role, p_installation_id: binding.installationId,
          p_installation_secret: binding.secret, p_fid: nextFid, p_platform: 'android', p_label: args.label.trim() });
      } catch (error) {
        if (error instanceof NativePushError && error.code === '42501') { binding.state = 'cleanup-required'; await write(binding); }
        throw error;
      }
      current(expected);
      const saved = record(result);
      if (!uuid(saved.device_id) || !Number.isSafeInteger(saved.generation) || Number(saved.generation) < 1) throw new NativePushError('Phone registration could not be confirmed. Retry this account’s registration or disconnect.', 'response');
      binding.deviceId = saved.device_id; binding.generation = Number(saved.generation); binding.state = 'registered'; await write(binding); current(expected);
      let preferencesEnabled = preferences.enabled;
      if (!preferencesEnabled) {
        try {
          const changed = record(await rpc(args.client, 'set_my_family_push_preferences', { p_role: args.role, p_enabled: true,
            p_absence: preferences.absence, p_result_published: preferences.result_published, p_leave_decision: preferences.leave_decision, p_expected_version: preferences.version }));
          current(expected); const confirmed = record(changed.preferences);
          preferencesEnabled = confirmed.enabled === true && confirmed.absence === preferences.absence && confirmed.result_published === preferences.result_published && confirmed.leave_decision === preferences.leave_decision
            && Number.isSafeInteger(confirmed.version) && Number(confirmed.version) >= preferences.version;
        } catch { current(expected); }
      }
      return { deviceId: binding.deviceId, generation: binding.generation, preferencesEnabled };
    })();
    running = task;
    try { return await task; }
    catch (error) { throw error instanceof NativePushError ? error : new NativePushError('The phone update could not be confirmed. Retry or disconnect before sharing this phone.', 'native'); }
    finally { if (running === task) running = null; }
  }
  async function disconnect(args: PushArguments | null) {
    ++epoch; stopHints(); const previous = running;
    const task = (async () => {
      await previous?.catch(() => {});
      let binding: Binding | null = null, storageInvalid = false;
      try { binding = await read(); } catch { storageInvalid = true; }
      if (!binding && !storageInvalid && !nativePending && !cleanupBlocked) return { serverRevoked: true, nativeCleared: true };
      cleanupBlocked = true;
      if (binding) { binding.state = 'cleanup-required'; await write(binding).catch(() => {}); }
      let serverRevoked = false;
      if (binding && args && sameOwner(binding, args) && binding.deviceId) {
        try { await assertOwner(args); serverRevoked = await rpc(args.client, 'revoke_my_family_push_device', { p_role: binding.role, p_device_id: binding.deviceId }) === true; } catch { /* Native cleanup still runs after sign-in expires. */ }
      }
      try {
        if (nativePending) await limited(nativePending);
        const driver = await deps.driver();
        await nativeCall(driver.disconnect());
        await deps.storage.clear(); cleanupBlocked = false;
        return { serverRevoked, nativeCleared: true };
      } catch { return { serverRevoked, nativeCleared: false }; }
    })();
    running = task;
    try { return await task; } finally { if (running === task) running = null; }
  }
  const disconnectNativePush = (args: PushArguments) => disconnect(args);
  async function cleanupSavedPushOnAuthLoss() {
    const result = await disconnect(null);
    return { nativeCleared: result.nativeCleared };
  }
  async function attachPushInboxHints(args: PushOwner & { configured: boolean; onInboxHint(kind: PushHint): void }) {
    const expected = epoch;
    if (!getPushAvailability(args.configured).available || running || cleanupBlocked) return () => {};
    const binding = await read();
    if (!binding || !sameOwner(binding, args) || binding.state !== 'registered' || expected !== epoch) return () => {};
    const driver = await deps.driver();
    if (expected !== epoch) return () => {};
    const unsubscribe = await driver.listen((kind, message) => { if (epoch === expected && isInboxHint(message)) args.onInboxHint(kind); });
    if (expected !== epoch) { unsubscribe(); return () => {}; }
    stopHints(); detach = unsubscribe;
    return () => { unsubscribe(); if (detach === unsubscribe) detach = () => {}; };
  }
  return { getPushAvailability, readPushEnrollment, enableNativePush, disconnectNativePush, cleanupSavedPushOnAuthLoss, attachPushInboxHints };
}
