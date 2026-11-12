import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View, type TextInputInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect } from 'expo-router';
import { ArrowRight, CircleAlert, Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react-native';
import { useAuth } from '../auth/provider';
import { configError } from '../auth/client';
import { Screen, Skeleton, Text } from '../ui/primitives';
import { AuthProblem } from '../ui/auth-problem';
import { usePalette } from '../ui/theme';
import { MfaVerification } from '../ui/mfa-verification';
import logo from '../../assets/sms-logo.png';

export default function Login() {
  const auth = useAuth(), p = usePalette(), { height, fontScale } = useWindowDimensions();
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [show, setShow] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [focused, setFocused] = useState<'email' | 'password' | null>(null), [keyboard, setKeyboard] = useState(false);
  const passwordInput = useRef<TextInputInstance>(null), submitting = useRef(false);
  const compact = height < 780, largeText = fontScale > 1.2;
  useEffect(() => {
    const opened = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const closed = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false));
    return () => { opened.remove(); closed.remove(); };
  }, []);
  if (auth.status === 'ready' && auth.foreground) return <Redirect href="/(school)" />;
  if (auth.status === 'mfa' && auth.foreground) return <MfaVerification />;
  if (auth.status === 'error') return <AuthProblem />;
  if (auth.status !== 'signedOut') return <Screen><Skeleton /></Screen>;
  async function submit() {
    if (submitting.current || configError) return;
    submitting.current = true; setBusy(true); setError('');
    try { await auth.signIn(email, password); setPassword(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign-in could not be confirmed.'); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function recover() {
    try { await Linking.openURL('https://sms-web-shoaibhasann.vercel.app/forgot-password'); }
    catch { setError('Password recovery could not open. Contact your school for help.'); }
  }
  const field = (name: 'email' | 'password') => [styles.field, { backgroundColor: p.bg, borderColor: focused === name ? p.primary : p.border }];
  const input = [styles.input, { color: p.text }];
  const message = error || auth.error || configError;
  return <SafeAreaView style={{ flex: 1, backgroundColor: p.surface }}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} contentContainerStyle={[styles.scroll, { justifyContent: keyboard || compact || largeText ? 'flex-start' : 'center', paddingTop: keyboard || compact ? 24 : 40, paddingBottom: keyboard ? 24 : 40 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <View style={[styles.masthead, { marginBottom: keyboard ? 24 : compact ? 32 : 40 }]}>
            {!keyboard && <Image source={logo} style={styles.logo} />}
            <Text style={styles.wordmark}>SMS</Text>
            <Text style={{ color: p.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' }}>School Management System</Text>
          </View>
          <View style={styles.intro}><Text accessibilityRole="header" style={styles.heading}>Welcome back</Text><Text style={{ color: p.muted, fontSize: 14, lineHeight: 22, textAlign: 'center' }}>Sign in to your school account.</Text></View>
          {message && <View style={[styles.error, { backgroundColor: p.bg }]}><CircleAlert size={18} color={p.danger} /><Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ color: p.danger, flex: 1 }}>{message}</Text></View>}
          <View style={{ gap: 16 }}>
            <View style={{ gap: 8 }}>
              <Text nativeID="email-label" style={styles.label}>Email or mobile number</Text>
              <View style={field('email')}><Mail size={19} strokeWidth={1.7} color={focused === 'email' ? p.primary : p.muted} />
                <TextInput accessibilityLabel="Email or mobile number" accessibilityLabelledBy="email-label" autoComplete="username" importantForAutofill="yes" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} editable={!busy} value={email} onChangeText={setEmail} style={input} placeholder="you@school.com or 98765 43210" placeholderTextColor={p.muted} underlineColorAndroid="transparent" returnKeyType="next" onSubmitEditing={() => passwordInput.current?.focus()} onFocus={() => setFocused('email')} onBlur={() => setFocused(null)} />
              </View>
            </View>
            <View style={{ gap: 8 }}>
              <View style={styles.passwordHeading}><Text nativeID="password-label" style={styles.label}>Password</Text><Pressable accessibilityRole="link" accessibilityLabel="Forgot or set password? Opens the SMS website" disabled={busy} hitSlop={4} onPress={() => void recover()} style={styles.recovery}><Text style={{ color: p.primary, fontWeight: '500', fontSize: 12, lineHeight: 20 }}>Forgot or set password?</Text></Pressable></View>
              <View style={field('password')}><LockKeyhole size={19} strokeWidth={1.7} color={focused === 'password' ? p.primary : p.muted} />
                <TextInput ref={passwordInput} accessibilityLabel="Password" accessibilityLabelledBy="password-label" autoComplete="current-password" importantForAutofill="yes" secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} editable={!busy} value={password} onChangeText={setPassword} style={input} placeholder="Enter your password" placeholderTextColor={p.muted} underlineColorAndroid="transparent" onSubmitEditing={() => void submit()} returnKeyType="go" onFocus={() => setFocused('password')} onBlur={() => setFocused(null)} />
                <Pressable accessibilityRole="button" accessibilityLabel={show ? 'Hide password' : 'Show password'} accessibilityState={{ disabled: busy, checked: show }} disabled={busy} onPress={() => setShow(value => !value)} style={({ pressed }) => [styles.reveal, { opacity: pressed ? 0.6 : 1 }]}>{show ? <EyeOff color={p.muted} size={20} strokeWidth={1.7} /> : <Eye color={p.muted} size={20} strokeWidth={1.7} />}</Pressable>
              </View>
            </View>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={busy ? 'Signing in' : 'Sign in'} accessibilityState={{ disabled: busy || !!configError, busy }} disabled={busy || !!configError} onPress={() => void submit()} style={({ pressed }) => [styles.submit, { backgroundColor: p.primary, opacity: busy || configError ? 0.55 : pressed ? 0.82 : 1 }]}>
            <Text style={{ color: p.onPrimary, fontSize: 15, lineHeight: 23, fontWeight: '600', flexShrink: 1, textAlign: 'center' }}>{busy ? 'Signing in…' : 'Sign in'}</Text>{busy ? <ActivityIndicator size="small" color={p.onPrimary} /> : <ArrowRight color={p.onPrimary} size={19} />}
          </Pressable>
          <View style={styles.footer}><LockKeyhole size={13} strokeWidth={1.7} color={p.muted} /><Text style={{ color: p.muted, fontSize: 12, lineHeight: 19, flexShrink: 1 }}>School-approved accounts only.</Text></View>
          {!keyboard && <View style={{ gap: 6, marginTop: 8 }}>
            <Text style={[styles.hint, { color: p.muted }]}>Invited with a mobile number? Set an app password in Account settings on the SMS website, then sign in here with that mobile number.</Text>
            <Text style={[styles.hint, { color: p.muted }]}>Signed up with Google? Use Forgot or set password with the same Gmail to create an app password.</Text>
            <Text style={[styles.hint, { color: p.muted }]}>Need access? Contact your school.</Text>
          </View>}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, paddingHorizontal: 24 },
  content: { width: '100%', maxWidth: 400, alignSelf: 'center' },
  masthead: { alignItems: 'center', gap: 4 },
  logo: { width: 72, height: 72, marginBottom: 8 },
  wordmark: { fontSize: 30, lineHeight: 37, fontWeight: '800', letterSpacing: -1.5, textAlign: 'center' },
  intro: { alignItems: 'center', gap: 8, marginBottom: 28 },
  heading: { fontSize: 27, lineHeight: 36, fontWeight: '700', letterSpacing: -0.8, textAlign: 'center' },
  label: { fontSize: 13, lineHeight: 21, fontWeight: '600' },
  field: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 14, minHeight: 56, paddingLeft: 16, paddingRight: 4 },
  input: { flex: 1, minWidth: 0, minHeight: 54, paddingHorizontal: 12, paddingVertical: 13, fontFamily: 'Sora', fontSize: 15, lineHeight: 22 },
  passwordHeading: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 4 },
  recovery: { minHeight: 44, maxWidth: '100%', flexShrink: 1, justifyContent: 'center', alignItems: 'flex-end' },
  reveal: { minWidth: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  submit: { minHeight: 56, paddingHorizontal: 22, paddingVertical: 15, borderRadius: 15, marginTop: 22, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12 },
  error: { borderRadius: 14, padding: 14, gap: 10, flexDirection: 'row', alignItems: 'flex-start', marginBottom: 18 },
  footer: { flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  hint: { textAlign: 'center', fontSize: 12, lineHeight: 20 },
});
