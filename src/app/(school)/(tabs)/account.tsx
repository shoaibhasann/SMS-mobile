import { useCallback, useState, useEffect, useRef } from 'react';
import { Alert, Linking, Switch, View } from 'react-native';
import Constants from 'expo-constants';
import { useAuth } from '../../../auth/provider';
import { disconnectNativePush, enableNativePush, getPushAvailability, NativePushError, readNativePushPermission, readPushEnrollment } from '../../../push';
import { Button, Card, ErrorCard, Screen, Skeleton, Text, Title } from '../../../ui/primitives';
import { useDarkMode, usePalette } from '../../../ui/theme';
import { useLoad } from '../../../ui/use-load';

export default function Account() {
  const auth = useAuth(), p = usePalette();
  const { darkMode, setDarkMode } = useDarkMode();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const configured = Constants.expoConfig?.extra?.firebaseConfigured === true;
  const availability = getPushAvailability(configured);
  const read = useCallback(async (signal: AbortSignal) => {
    const [local, permission] = await Promise.all([
      readPushEnrollment({ userId: auth.access!.userId, role: auth.role, configured }), readNativePushPermission(configured),
    ]);
    if (local?.state !== 'registered' && !local?.needsReconnect) return { local, permission, enabled: false };
    const { data, error } = await auth.client!.rpc('get_my_family_push_settings', { p_role: auth.role }).abortSignal(signal);
    if (error || !Array.isArray(data?.devices) || typeof data.preferences?.enabled !== 'boolean') {
      throw new Error('Phone notification settings could not be verified. Try again.');
    }
    const active = data.devices.some((device: { id: string; revoked_at: string | null }) => device.id === local.deviceId && device.revoked_at === null);
    return {
      local: active ? local : { ...local, state: 'cleanup-required' as const },
      permission: permission === 'prompt' ? 'settings' as const : permission,
      enabled: active && !local.needsReconnect && data.preferences.enabled,
    };
  }, [auth.access, auth.role, auth.client, configured]);
  const enrollment = useLoad(`${auth.access?.userId}:${auth.role}:${auth.revision}`, read);
  const settings = enrollment.data;
  const on = settings?.enabled && settings.permission === 'granted';
  const blocked = settings?.permission === 'settings';
  const needsCleanup = settings?.local?.state === 'cleanup-required';
  const needsReconnect = settings?.local?.needsReconnect;
  async function enable() {
    if (!alive.current) return;
    setBusy(true); setError('');
    try {
      await enableNativePush({ client: auth.client!, userId: auth.access!.userId, role: auth.role, label: 'Android phone', configured });
    } catch (cause) {
      if (alive.current && !(cause instanceof NativePushError && cause.code === 'permission')) {
        setError(cause instanceof Error ? cause.message : 'Phone registration could not be confirmed.');
      }
    } finally { if (alive.current) { enrollment.reload(); setBusy(false); } }
  }
  async function disable() {
    if (!alive.current) return;
    setBusy(true); setError('');
    try {
      const result = await disconnectNativePush({ client: auth.client!, userId: auth.access!.userId, role: auth.role });
      if (!result.nativeCleared || !result.serverRevoked) throw new Error('Device cleanup is incomplete. Retry before switching accounts or sharing this phone.');
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'Device cleanup could not be confirmed.'); }
    finally { if (alive.current) { enrollment.reload(); setBusy(false); } }
  }
  function confirmDisconnect() {
    Alert.alert('Turn off notifications on this phone?', 'This disconnects this phone from school alerts.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Turn off', style: 'destructive', onPress: () => { if (alive.current) void disable(); } },
    ]);
  }
  return <Screen><Title title="Your account" />
    <Card><Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '700' }}>{auth.role === 'parent' ? 'Guardian' : 'Student'} account</Text>
      {auth.access!.roles.length > 1 && <View style={{ gap: 10 }}>{auth.access!.roles.map(role => <Button key={role} label={`${role === 'parent' ? 'Guardian' : 'Student'} workspace`} secondary={auth.role !== role} disabled={busy || auth.role === role} onPress={() => void auth.chooseRole(role).catch(() => {})} />)}</View>}
    </Card>
    <Card><Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '700' }}>Mobile notifications</Text>
      {enrollment.loading ? <Skeleton rows={1} /> : enrollment.error ? <ErrorCard message={enrollment.error} retry={enrollment.reload} /> : <>
        <Text accessibilityLiveRegion="polite" style={{ fontWeight: '600' }}>{on ? 'On for this phone' : 'Off for this phone'}</Text>
        <Text style={{ color: p.muted }}>{needsCleanup ? 'Disconnect the previous registration before turning on notifications again.'
          : blocked ? 'Allow notifications for SMS in Android settings.'
            : !availability.available ? availability.reason
              : needsReconnect ? 'This phone’s notification registration changed. Reconnect to receive alerts.'
              : on ? 'Alerts follow your school notification preferences.' : 'Turn on alerts for your account and register this phone.'}</Text>
        {!needsCleanup && blocked && <Button label="Open Android settings" disabled={busy} onPress={() => void Linking.openSettings().catch(() => {
          if (alive.current) setError('Open Settings, choose Apps → SMS, then allow notifications.');
        })} />}
        {!needsCleanup && !blocked && !on && availability.available && <Button label={busy ? 'Turning on…' : needsReconnect ? 'Reconnect notifications' : 'Turn on notifications'} disabled={busy} onPress={() => void enable()} />}
      </>}
      {!enrollment.loading && (settings?.local || enrollment.error) && <Button label={on ? 'Turn off on this phone' : 'Disconnect this phone'} secondary disabled={busy} onPress={confirmDisconnect} />}
      {error && <ErrorCard message={error} />}
    </Card>
    <Card><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 }}>
      <Text style={{ fontWeight: '600' }}>Dark mode</Text>
      <Switch accessibilityLabel="Dark mode" value={darkMode} onValueChange={setDarkMode} trackColor={{ false: p.border, true: p.primary }} />
    </View></Card>
    <Button label={busy ? 'Please wait…' : 'Sign out'} secondary disabled={busy} onPress={() => Alert.alert('Sign out?', 'This phone’s push registration is disconnected and the local school session is closed.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => { if (!alive.current) return; setBusy(true); void auth.signOut().catch(() => { if (alive.current) setBusy(false); }); } }])} />
  </Screen>;
}
