import { Stack, Redirect, router, usePathname } from 'expo-router';
import { useEffect, useReducer, useRef } from 'react';
import Constants from 'expo-constants';
import { useAuth } from '../../auth/provider';
import { FamilyProvider } from '../../ui/family';
import { usePalette } from '../../ui/theme';
import { Screen, Skeleton } from '../../ui/primitives';
import { AuthProblem } from '../../ui/auth-problem';
import { attachPushInboxHints, subscribePushRegistration } from '../../push';
import { MfaVerification } from '../../ui/mfa-verification';

export const unstable_settings = { anchor: '(tabs)' };

function PushHints() {
  const { access, role } = useAuth();
  const userId = access!.userId;
  const [registration, refreshRegistration] = useReducer(value => value + 1, 0);
  useEffect(() => subscribePushRegistration({ userId, role }, refreshRegistration), [userId, role]);
  useEffect(() => {
    let active = true, unsubscribe = () => {};
    void attachPushInboxHints({ userId, role, configured: Constants.expoConfig?.extra?.firebaseConfigured === true,
      onInboxHint: event => { if (active && event === 'opened') router.navigate({ pathname: '/(school)/(tabs)/notifications', params: { assessment: '' } }); },
    }).then(stop => { if (active) unsubscribe = stop; else stop(); }).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, [userId, role, registration]);
  return null;
}

export default function SchoolLayout() {
  const auth = useAuth(), p = usePalette();
  const pathname = usePathname();
  const accountOwner = useRef<string | null>(null), returning = useRef(false);
  const readyOwner = auth.status === 'ready' && auth.foreground && auth.access
    ? `${auth.access.userId}:${auth.access.schoolId}:${auth.role}` : null;
  useEffect(() => {
    if (auth.status === 'signedOut') { accountOwner.current = null; returning.current = false; return; }
    if (!readyOwner) { returning.current = accountOwner.current !== null; return; }
    const restore = returning.current && accountOwner.current === readyOwner && pathname === '/';
    accountOwner.current = pathname === '/account' ? readyOwner : null;
    returning.current = false;
    if (restore) router.navigate('/(school)/(tabs)/account');
  }, [auth.status, pathname, readyOwner]);
  if (auth.status === 'signedOut') return <Redirect href="/login" />;
  if (auth.status === 'mfa' && auth.foreground) return <MfaVerification />;
  if (auth.status === 'error') return <AuthProblem />;
  if (auth.status !== 'ready' || !auth.foreground || !auth.access) return <Screen><Skeleton /></Screen>;
  return <FamilyProvider key={`${auth.access.userId}:${auth.role}:${auth.revision}`}><PushHints />
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }} />
  </FamilyProvider>;
}
