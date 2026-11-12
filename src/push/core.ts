import type { SupabaseClient } from '@supabase/supabase-js';

export type PushRole = 'parent' | 'student';
export type PushOwner = { userId: string; role: PushRole };
export type PushEnrollment = { state: 'pending' | 'registered' | 'cleanup-required'; deviceId: string | null; generation: number | null; needsReconnect?: true };
export type PushArguments = PushOwner & { client: SupabaseClient };
export type PushHint = 'received' | 'opened';
export type PushPermission = 'granted' | 'prompt' | 'settings';
export type PushDriver = {
  readPermission(): Promise<PushPermission>;
  requestPermission(): Promise<boolean>;
  currentInstallationId(): Promise<string>;
  register(): Promise<string>;
  disconnect(): Promise<void>;
  showForegroundHint(): void;
  listen(callback: (kind: PushHint, message: unknown) => void): Promise<() => void>;
};
export type PushDependencies = {
  platform(): string;
  storage: { read(): Promise<string | null>; write(value: string): Promise<void>; clear(): Promise<void> };
  identity(): Promise<{ installationId: string; secret: string }>;
  driver(): Promise<PushDriver>;
};
type Binding = PushOwner & Omit<PushEnrollment, 'needsReconnect'> & { version: 1; installationId: string; secret: string; fid: string | null };
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
async function limited<T>(promise: PromiseLike<T>, milliseconds = 10_000, message = 'The phone update timed out. Check your connection and try again.'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new NativePushError(message, 'timeout')), milliseconds); })]); }
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
  const inboxListeners = new Set<PushOwner & { reload(): void }>();
  const registrationListeners = new Set<PushOwner & { changed(): void }>();
  const refreshAfter = new Map<string, number>(), refreshing = new Set<string>();
  const stopHints = () => { detach(); detach = () => {}; };
  const read = async () => decode(await deps.storage.read());
  const write = (binding: Binding) => deps.storage.write(JSON.stringify(binding));
  const current = (expected: number) => { if (epoch !== expected) throw new NativePushError('The account changed. Reopen phone settings.', 'cancelled'); };
  async function rpc(client: SupabaseClient, name: string, args: Record<string, unknown>) {
    const controller = new AbortController();
    try {
      const response = await limited(client.rpc(name, args).abortSignal(controller.signal), 8_000);
      // 22023 texts (device limit, registration rate limit, invalid details) are written for families.
      if (response.error?.code === '22023' && response.error.message) throw new NativePushError(response.error.message, '22023');
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
  async function nativeCall<T>(work: Promise<T>, milliseconds?: number, message?: string): Promise<T> {
    const pending = Promise.resolve(work); nativePending = pending;
    void pending.finally(() => { if (nativePending === pending) nativePending = null; }).catch(() => {});
    return limited(pending, milliseconds, message);
  }
  function getPushAvailability(configured: boolean) {
    return !configured ? { available: false, reason: 'Native push is not configured for this build.' }
      : deps.platform() !== 'android' ? { available: false, reason: 'Phone push enrollment is Android-only in this build.' }
        : { available: true, reason: '' };
  }
  async function readNativePushPermission(configured: boolean) {
    if (!getPushAvailability(configured).available) return null;
    const driver = await limited(deps.driver());
    return limited(driver.readPermission());
  }
  async function readPushEnrollment(args: PushOwner & { configured: boolean }): Promise<PushEnrollment | null> {
    owner(args);
    // Android's permission dialog can remount the screen before enrollment finishes.
    await running?.catch(() => {});
    const expected = epoch, binding = await read(); current(expected);
    if (!binding || !sameOwner(binding, args)) return null;
    const local = { state: binding.state, deviceId: binding.deviceId, generation: binding.generation };
    if (binding.state !== 'registered' || !getPushAvailability(args.configured).available) return local;
    const driver = await limited(deps.driver()); current(expected);
    while (nativePending) { await limited(nativePending); current(expected); }
    const installation = await nativeCall(driver.currentInstallationId()); current(expected);
    if (!fid(installation)) throw new NativePushError('Phone registration could not be verified. Try again.', 'response');
    return installation === binding.fid ? local : { ...local, state: 'pending', needsReconnect: true };
  }
  async function enableNativePush(args: PushArguments & { configured: boolean; label: string }) {
    if (running) throw new NativePushError('A phone update is already in progress. Wait for it to finish.', 'busy');
    const available = getPushAvailability(args.configured);
    if (!available.available) throw new NativePushError(available.reason);
    owner(args);
    if (!args.label.trim() || Array.from(args.label.trim()).length > 80) throw new NativePushError('Choose a phone name between 1 and 80 characters.', 'validation');
    const expected = ++epoch; stopHints();
    let registrationSaved = false;
    const task = (async () => {
      if (cleanupBlocked) throw new NativePushError('Disconnect the previous phone registration before enabling alerts.', 'cleanup');
      if (nativePending) throw new NativePushError('Phone registration is still finishing. Try again shortly.', 'cleanup');
      await assertOwner(args); current(expected);
      let binding = await read(); current(expected);
      if (binding && (!sameOwner(binding, args) || binding.state === 'cleanup-required')) throw new NativePushError('Disconnect the previous phone registration before enabling alerts.', 'cleanup');
      const settings = record(await rpc(args.client, 'get_my_family_push_settings', { p_role: args.role })); current(expected);
      const prefs = record(settings.preferences);
      if (![prefs.enabled, prefs.absence, prefs.result_published, prefs.leave_decision].every(value => typeof value === 'boolean') || !Number.isSafeInteger(prefs.version) || Number(prefs.version) < 0 || !Array.isArray(settings.devices)) throw new NativePushError('Notification preferences could not be verified. Refresh settings.', 'response');
      const preferences = prefs as Preferences;
      if (binding?.deviceId && !settings.devices.some(value => { const row = record(value); return row.id === binding?.deviceId && row.revoked_at === null; })) {
        binding.state = 'cleanup-required'; await write(binding);
        throw new NativePushError('This phone registration was revoked. Disconnect it before explicitly enabling a new registration.', 'revoked');
      }
      const driver = await deps.driver(); current(expected);
      const permission = await limited(driver.readPermission()); current(expected);
      if (permission !== 'granted' && (permission === 'settings' || binding?.state === 'registered'
        || !await limited(driver.requestPermission(), 30_000))) {
        throw new NativePushError('Allow SMS notifications in Android settings.', 'permission');
      }
      current(expected);
      if (!binding) {
        const identity = await deps.identity(); current(expected);
        if (!uuid(identity.installationId) || !/^[0-9a-f]{64}$/.test(identity.secret)) throw new NativePushError('Phone security identity could not be created.', 'storage');
        binding = { version: 1, userId: args.userId, role: args.role, ...identity, fid: null, deviceId: null, generation: null, state: 'pending' };
        await write(binding); current(expected);
      }
      const nextFid = await nativeCall(driver.register(), 25_000,
        'Phone registration is taking longer than usual. Check your connection and try again.'); current(expected);
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
      registrationSaved = true;
      return { deviceId: binding.deviceId, generation: binding.generation, preferencesEnabled };
    })();
    running = task;
    try { return await task; }
    catch (error) { throw error instanceof NativePushError ? error : new NativePushError('The phone update could not be confirmed. Retry or disconnect before sharing this phone.', 'native'); }
    finally {
      if (running === task) {
        running = null;
        if (registrationSaved) refreshAfter.delete(`${args.userId}:${args.role}`); // An explicit enable lifts any earlier refresh throttle.
        if (registrationSaved && expected === epoch) for (const listener of registrationListeners) if (sameOwner(args, listener)) listener.changed();
      }
    }
  }
  // Delivery skips devices unseen for 90 days, so an enabled phone re-registers its saved installation on app start and token refresh.
  async function refreshNativePushRegistration(args: PushArguments & { configured: boolean; label: string }) {
    try {
      if (!getPushAvailability(args.configured).available || running || nativePending || cleanupBlocked) return;
      owner(args);
      const key = `${args.userId}:${args.role}`;
      if ((refreshAfter.get(key) ?? 0) > Date.now() || refreshing.has(key)) return;
      refreshing.add(key);
      // Token refreshes can tick every 30 s under clock skew: a settled ineligible or failed refresh retries after 10 minutes, a successful one after 6 hours.
      // Cancelled refreshes, pre-server failures and a missing permission (changeable in Android settings) retry on the next start or token refresh.
      const settle = (milliseconds: number) => { refreshAfter.set(key, Date.now() + milliseconds); };
      try {
        const expected = epoch, binding = await read(); current(expected);
        // Only an explicit enable changes the binding or FID, and it lifts this throttle.
        if (!binding || !sameOwner(binding, args) || binding.state !== 'registered') { settle(10 * 60_000); return; }
        const driver = await limited(deps.driver()); current(expected);
        if (await limited(driver.readPermission()) !== 'granted') return;
        current(expected);
        if (await nativeCall(driver.currentInstallationId()) !== binding.fid) { settle(10 * 60_000); return; }
        current(expected);
        await assertOwner(args); current(expected);
        let result: unknown;
        try {
          result = await rpc(args.client, 'register_my_family_push_device', { p_role: args.role, p_installation_id: binding.installationId,
            p_installation_secret: binding.secret, p_fid: binding.fid, p_platform: 'android', p_label: args.label.trim() });
        } catch (error) {
          settle(10 * 60_000);
          // A revoked row is never reactivated by the server; mark it so the Account screen asks for cleanup.
          if (error instanceof NativePushError && error.code === '42501' && expected === epoch) { binding.state = 'cleanup-required'; await write(binding); }
          return;
        }
        settle(10 * 60_000);
        current(expected);
        const saved = record(result);
        if (saved.device_id !== binding.deviceId || !Number.isSafeInteger(saved.generation) || Number(saved.generation) < 1) return;
        if (Number(saved.generation) !== binding.generation) { binding.generation = Number(saved.generation); await write(binding); }
        settle(6 * 3_600_000);
      } finally { refreshing.delete(key); }
    } catch { /* A background refresh never surfaces errors; the next start or token refresh retries. */ }
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
      // The signed-in user may clean up their own binding from either family workspace; the server rechecks p_role.
      const mine = binding && args && binding.userId === args.userId ? binding : null;
      // Without a saved FID no registration RPC has been sent for this binding.
      let serverRevoked = !!mine && !mine.fid && !mine.deviceId;
      if (mine && args && mine.deviceId) {
        try { await assertOwner(args); serverRevoked = await rpc(args.client, 'revoke_my_family_push_device', { p_role: mine.role, p_device_id: mine.deviceId }) === true; } catch { /* Native cleanup still runs after sign-in expires. */ }
      } else if (mine && args && mine.fid) {
        // The register reply was lost: a committed row would hold a device slot, so revoke it by this phone's own installation id.
        try {
          await assertOwner(args);
          await rpc(args.client, 'revoke_my_family_push_installation', { p_role: mine.role, p_installation_id: mine.installationId });
          serverRevoked = true;
        } catch { /* The dispatcher still retires the row once FCM reports UNREGISTERED. */ }
      }
      try {
        if (nativePending) await limited(nativePending);
        const driver = await deps.driver();
        await nativeCall(driver.disconnect());
        await deps.storage.clear(); cleanupBlocked = false;
        // An unacknowledged registration (FID sent, no device id) is undeliverable once the FID is deleted;
        // the dispatcher retires any orphan row when FCM reports UNREGISTERED.
        return { serverRevoked: serverRevoked || (!!mine && !mine.deviceId), nativeCleared: true };
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
  function subscribePushInboxRefresh(args: PushOwner, reload: () => void) {
    const listener = { ...args, reload };
    inboxListeners.add(listener);
    return () => { inboxListeners.delete(listener); };
  }
  function subscribePushRegistration(args: PushOwner, changed: () => void) {
    const listener = { ...args, changed };
    registrationListeners.add(listener);
    return () => { registrationListeners.delete(listener); };
  }
  async function attachPushInboxHints(args: PushOwner & { configured: boolean; onInboxHint(kind: PushHint): void }) {
    if (!getPushAvailability(args.configured).available) return () => {};
    await running?.catch(() => {});
    const expected = epoch;
    if (running || cleanupBlocked) return () => {};
    const binding = await read();
    if (!binding || !sameOwner(binding, args) || binding.state !== 'registered' || expected !== epoch) return () => {};
    const driver = await deps.driver();
    if (expected !== epoch) return () => {};
    let active = true;
    const unsubscribe = await driver.listen((kind, message) => {
      if (!active || epoch !== expected || !isInboxHint(message)) return;
      args.onInboxHint(kind);
      for (const listener of inboxListeners) if (sameOwner(args, listener)) listener.reload();
      if (kind === 'received') void driver.readPermission().then(permission => {
        if (active && epoch === expected && permission === 'granted') driver.showForegroundHint();
      }).catch(() => {});
    });
    const stop = () => { if (active) { active = false; unsubscribe(); } };
    if (expected !== epoch) { stop(); return () => {}; }
    stopHints(); detach = stop;
    return () => { stop(); if (detach === stop) detach = () => {}; };
  }
  return { getPushAvailability, readNativePushPermission, readPushEnrollment, enableNativePush, refreshNativePushRegistration, disconnectNativePush, cleanupSavedPushOnAuthLoss, attachPushInboxHints, subscribePushInboxRefresh, subscribePushRegistration };
}
