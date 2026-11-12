import { Stack, Redirect, router, useGlobalSearchParams, usePathname } from 'expo-router';
import { useEffect, useReducer, useRef } from 'react';
import Constants from 'expo-constants';
import { useAuth } from '../../auth/provider';
import { FamilyProvider } from '../../ui/family';
import { usePalette } from '../../ui/theme';
import { Screen, Skeleton } from '../../ui/primitives';
import { AuthProblem } from '../../ui/auth-problem';
import { attachPushInboxHints, refreshNativePushRegistration, subscribePushRegistration } from '../../push';
import { MfaVerification } from '../../ui/mfa-verification';

export const unstable_settings = { anchor: '(tabs)' };
const tabPaths = new Set(['/', '/attendance', '/learning', '/notifications', '/account']);
type Place = { pathname: string; params: Record<string, string | string[]> };

function PushHints() {
  const { access, role, client, tokenRevision } = useAuth();
  const userId = access!.userId, configured = Constants.expoConfig?.extra?.firebaseConfigured === true;
  const [registration, refreshRegistration] = useReducer(value => value + 1, 0);
  useEffect(() => subscribePushRegistration({ userId, role }, refreshRegistration), [userId, role]);
  // Runs on app start, every foreground remount and each token refresh (tokenRevision); the push layer throttles it.
  useEffect(() => { void refreshNativePushRegistration({ client: client!, userId, role, configured, label: 'Android phone' }); }, [client, userId, role, configured, tokenRevision]);
  useEffect(() => {
    let active = true, unsubscribe = () => {};
    void attachPushInboxHints({ userId, role, configured,
      // Pop stack screens (exam, homework…) back to the existing tabs entry; navigate would push a second one.
      onInboxHint: event => { if (active && event === 'opened') router.dismissTo('/(school)/(tabs)/notifications'); },
    }).then(stop => { if (active) unsubscribe = stop; else stop(); }).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, [userId, role, configured, registration]);
  return null;
}

export default function SchoolLayout() {
  const auth = useAuth(), p = usePalette();
  const pathname = usePathname(), query = JSON.stringify(useGlobalSearchParams());
  const place = useRef<{ owner: string; tab: Place; screen: Place | null } | null>(null), returning = useRef(false);
  const readyOwner = auth.status === 'ready' && auth.foreground && auth.access
    ? `${auth.access.userId}:${auth.access.schoolId}:${auth.role}` : null;
  useEffect(() => {
    if (auth.status === 'signedOut') { place.current = null; returning.current = false; return; }
    if (!readyOwner) { returning.current = place.current !== null; return; }
    const saved = place.current?.owner === readyOwner ? place.current : null;
    if (returning.current) {
      returning.current = false;
      // The background recheck remounts the Stack on Home; the same owner gets their tab and stack screen (with params) back.
      if (saved && pathname === '/') {
        if (saved.tab.pathname !== '/') router.navigate(saved.tab);
        if (saved.screen) router.push(saved.screen);
        return;
      }
    }
    const params = Object.fromEntries(Object.entries(JSON.parse(query) as Place['params']).filter(([key]) => !key.startsWith('__')));
    place.current = tabPaths.has(pathname) ? { owner: readyOwner, tab: { pathname, params }, screen: null }
      : { owner: readyOwner, tab: saved?.tab ?? { pathname: '/', params: {} }, screen: { pathname, params } };
  }, [auth.status, pathname, query, readyOwner]);
  if (auth.status === 'signedOut') return <Redirect href="/login" />;
  if (auth.status === 'mfa' && auth.foreground) return <MfaVerification />;
  if (auth.status === 'error') return <AuthProblem />;
  if (auth.status !== 'ready' || !auth.foreground || !auth.access) return <Screen><Skeleton /></Screen>;
  // Full reloads pass through the Skeleton above, which already remounts this tree; an in-place recheck must not.
  return <FamilyProvider key={`${auth.access.userId}:${auth.role}`}><PushHints />
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }} />
  </FamilyProvider>;
}
