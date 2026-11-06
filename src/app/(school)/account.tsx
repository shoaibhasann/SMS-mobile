import { useCallback, useState, useEffect, useRef } from 'react';
import { Alert, Platform, View } from 'react-native';
import Constants from 'expo-constants';
import { useAuth } from '../../auth/provider';
import { disconnectNativePush, enableNativePush, getPushAvailability, readPushEnrollment } from '../../push';
import { Button, Card, ErrorCard, Screen, Skeleton, Text, Title } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';
import { useLoad } from '../../ui/use-load';

export default function Account() {
  const auth = useAuth(), p = usePalette();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const configured = Constants.expoConfig?.extra?.firebaseConfigured === true;
  const availability = getPushAvailability(configured);
  const read = useCallback(async (signal: AbortSignal) => {
    const local = await readPushEnrollment({ userId: auth.access!.userId, role: auth.role });
    if (!local || local.state !== 'registered') return local;
    const { data, error } = await auth.client!.rpc('get_my_family_push_settings', { p_role: auth.role }).abortSignal(signal);
    if (error || !Array.isArray(data?.devices)) throw new Error('Phone access could not be verified. Refresh school access.');
    return data.devices.some((device: { id: string; revoked_at: string | null }) => device.id === local.deviceId && device.revoked_at === null)
      ? local : { ...local, state: 'cleanup-required' as const };
  }, [auth.access, auth.role, auth.client]);
  const enrollment = useLoad(`${auth.access?.userId}:${auth.role}`, read);
  async function enable() {
    if (!alive.current) return;
    setBusy(true); setNotice(''); setError('');
    try {
      const result = await enableNativePush({ client: auth.client!, userId: auth.access!.userId, role: auth.role, label: `${Platform.OS === 'android' ? 'Android' : 'iOS'} phone`, configured });
      if (!alive.current) return;
      setNotice(result.preferencesEnabled ? 'This phone is registered and account push preferences are enabled. Phone display still depends on school delivery setup.' : 'This phone is registered, but account preferences were not confirmed. Refresh before retrying.'); enrollment.reload();
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'Phone registration could not be confirmed.'); }
    finally { if (alive.current) setBusy(false); }
  }
  async function disable() {
    if (!alive.current) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await disconnectNativePush({ client: auth.client!, userId: auth.access!.userId, role: auth.role });
      if (!result.nativeCleared || !result.serverRevoked) throw new Error('Device cleanup is incomplete. Retry before switching accounts or sharing this phone.');
      if (!alive.current) return;
      setNotice('This phone is disconnected from push alerts. School records and other devices are unchanged.'); enrollment.reload();
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'Device cleanup could not be confirmed.'); }
    finally { if (alive.current) setBusy(false); }
  }
  return <Screen><Title title="Your account" subtitle="Verified school access and this phone’s notification settings." />
    <Card><Text accessibilityRole="header" style={{ fontSize: 21, lineHeight: 30, fontWeight: '700' }}>{auth.access?.name}</Text><Text style={{ color: p.muted }}>{auth.role === 'parent' ? 'Guardian' : 'Student'} workspace</Text>
      {auth.access!.roles.length > 1 && <View style={{ gap: 10 }}>{auth.access!.roles.map(role => <Button key={role} label={`${role === 'parent' ? 'Guardian' : 'Student'} workspace`} secondary={auth.role !== role} disabled={busy || auth.role === role} onPress={() => void auth.chooseRole(role).catch(() => {})} />)}</View>}
    </Card>
    <Card><Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '700' }}>Mobile notifications</Text><Text style={{ color: p.muted }}>Enable account push alerts and register this phone. Your school must also activate sending. No alert is delivered just by saving a preference.</Text>
      {enrollment.loading ? <Skeleton rows={1} /> : enrollment.error ? <ErrorCard message={enrollment.error} retry={enrollment.reload} /> : <Text>{enrollment.data?.state === 'registered' ? 'This account has a local phone registration. Server access is rechecked before sending.' : enrollment.data ? 'The previous phone registration needs retry or cleanup. It is not confirmed as active.' : 'This phone is not registered for this account.'}</Text>}
      {!availability.available && <Text style={{ color: p.muted }}>{availability.reason}</Text>}
      <Button label="Enable on this phone" disabled={busy || !availability.available} onPress={() => void enable()} />
      <Button label="Disconnect this phone" secondary disabled={busy || enrollment.loading} onPress={() => Alert.alert('Disconnect this phone?', 'Stop this installation’s alerts. Other phones and linked children stay unchanged.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Disconnect', style: 'destructive', onPress: () => { if (alive.current) void disable(); } }])} />
      {notice && <Text accessibilityLiveRegion="polite">{notice}</Text>}{error && <ErrorCard message={error} />}
    </Card>
    <Card><Text style={{ fontWeight: '600' }}>Appearance follows your device</Text><Text style={{ color: p.muted }}>The same SMS palette and Sora typeface are used in Light and Dark.</Text></Card>
    <Button label={busy ? 'Please wait…' : 'Sign out'} secondary disabled={busy} onPress={() => Alert.alert('Sign out?', 'This phone’s push registration is disconnected and the local school session is closed.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => { if (!alive.current) return; setBusy(true); void auth.signOut().catch(() => { if (alive.current) setBusy(false); }); } }])} />
  </Screen>;
}
