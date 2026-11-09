import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, TextInput, View } from 'react-native';
import { ShieldCheck } from 'lucide-react-native';
import { useAuth } from '../auth/provider';
import { schoolClient } from '../auth/client';
import { listMfaFactors, type MfaFactor } from '../auth/mfa';
import { Button, Card, ErrorCard, Screen, Skeleton, Text, Title } from './primitives';
import { usePalette } from './theme';

export function MfaVerification() {
  const auth = useAuth(), p = usePalette(), status = auth.mfa;
  const [factors, setFactors] = useState<MfaFactor[]>([]), [factor, setFactor] = useState('');
  const [code, setCode] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0), submitting = useRef(false);
  useEffect(() => {
    if (status?.action !== 'challenge') return;
    const controller = new AbortController();
    void listMfaFactors(schoolClient(), status.user_id, controller.signal).then(rows => {
      if (!controller.signal.aborted) { setFactors(rows); setFactor(rows[0]?.id ?? ''); }
    }).catch(() => { if (!controller.signal.aborted) setError('Authenticators could not be loaded. Retry or sign in again.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [status?.user_id, status?.action, retry]);
  async function submit() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try { await auth.verifyAuthenticator(factor, code); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Verification could not be confirmed.'); }
    finally { submitting.current = false; setBusy(false); setCode(''); }
  }
  async function setup() {
    try { await Linking.openURL('https://sms-web-shoaibhasann.vercel.app/mfa?next=%2Faccount%2Fsettings'); }
    catch { setError('Account security could not open. Contact your school for help.'); }
  }
  if (!status) return <Screen><Skeleton /></Screen>;
  const challenge = status.action === 'challenge';
  return <Screen>
    <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: p.soft, alignItems: 'center', justifyContent: 'center' }}><ShieldCheck color={p.primary} size={26} /></View>
    <Title title={challenge ? 'Verify it’s you' : status.action === 'enroll' ? 'Secure your account' : 'Sign in again'}
      subtitle={challenge ? 'Enter the six-digit code from your authenticator app.' : status.action === 'enroll' ? 'Your school requires an authenticator before you can open your workspace.' : 'Your security session changed. Sign out and verify your account again.'} />
    {error && <ErrorCard message={error} retry={challenge && !busy ? () => { setLoading(true); setError(''); setFactors([]); setFactor(''); setCode(''); setRetry(value => value + 1); } : undefined} />}
    {challenge && (loading ? <Skeleton rows={2} /> : <Card>
      {factors.length > 1 && <View style={{ gap: 8 }}><Text style={{ color: p.muted }}>Choose your authenticator</Text>{factors.map(row => <Pressable key={row.id} accessibilityRole="radio" accessibilityState={{ checked: factor === row.id, disabled: busy }} disabled={busy} onPress={() => { setFactor(row.id); setCode(''); }} style={{ minHeight: 48, padding: 12, borderWidth: 1, borderRadius: 12, borderColor: row.id === factor ? p.primary : p.border, backgroundColor: row.id === factor ? p.soft : p.surface }}><Text>{row.friendly_name || 'Authenticator'}</Text></Pressable>)}</View>}
      {!factors.length ? <Text>No verified authenticator was found. Sign in again to check account security.</Text> : <>
        <Text nativeID="authenticator-code-label" style={{ fontWeight: '600' }}>Authenticator code</Text>
        <TextInput accessibilityLabel="Authenticator code" accessibilityLabelledBy="authenticator-code-label" value={code} onChangeText={value => setCode(value.replace(/\D/g, '').slice(0, 6))} maxLength={6} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" autoCorrect={false} editable={!busy} placeholder="000000" placeholderTextColor={p.muted} onSubmitEditing={() => void submit()} style={{ minHeight: 58, borderWidth: 1, borderColor: p.border, backgroundColor: p.bg, color: p.text, borderRadius: 14, padding: 14, fontFamily: 'Sora', fontSize: 23, letterSpacing: 8 }} />
        <Button label={busy ? 'Verifying…' : 'Verify and continue'} onPress={() => void submit()} disabled={busy || code.length !== 6 || !factor} />
      </>}
    </Card>)}
    {status.action === 'enroll' && <Card><Text>Open account security on the SMS website and sign in there to add an authenticator. Then sign out and sign in again on this phone.</Text><Button label="Open account security" onPress={() => void setup()} /><Text style={{ color: p.muted }}>Keep a backup authenticator before enabling school-wide MFA. For a lost authenticator, contact your school administrator.</Text></Card>}
    <Button label="Sign out" secondary disabled={busy} onPress={() => void auth.signOut().catch(() => setError('Sign-out could not be confirmed. Retry before sharing this phone.'))} />
    <Text style={{ color: p.muted, textAlign: 'center' }}>Your school records stay locked until verification succeeds.</Text>
  </Screen>;
}
