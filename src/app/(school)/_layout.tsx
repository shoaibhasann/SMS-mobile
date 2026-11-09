import { Tabs, Redirect, router } from 'expo-router';
import { useEffect } from 'react';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { House, CalendarCheck, Bell, UserRound, BookOpen } from 'lucide-react-native';
import { useAuth } from '../../auth/provider';
import { FamilyProvider } from '../../ui/family';
import { usePalette } from '../../ui/theme';
import { Button, ErrorCard, Screen, Skeleton } from '../../ui/primitives';
import { attachPushInboxHints } from '../../push';
import { MfaVerification } from '../../ui/mfa-verification';

function PushHints() {
  const { access, role } = useAuth();
  useEffect(() => {
    let active = true, unsubscribe = () => {};
    void attachPushInboxHints({ userId: access!.userId, role, configured: Constants.expoConfig?.extra?.firebaseConfigured === true,
      onInboxHint: event => { if (active && event === 'opened') router.navigate({ pathname: '/(school)/notifications', params: { assessment: '' } }); },
    }).then(stop => { if (active) unsubscribe = stop; else stop(); }).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, [access, role]);
  return null;
}

export default function SchoolLayout() {
  const auth = useAuth(), p = usePalette(), insets = useSafeAreaInsets();
  if (auth.status === 'signedOut') return <Redirect href="/login" />;
  if (auth.status === 'mfa' && auth.foreground) return <MfaVerification />;
  if (auth.status !== 'ready' || !auth.foreground || !auth.access) return <Screen>{auth.error ? <><ErrorCard message={auth.error} retry={auth.refresh} /><Button label="Sign out" onPress={() => void auth.signOut().catch(() => {})} secondary /></> : <Skeleton />}</Screen>;
  return <FamilyProvider key={`${auth.access.userId}:${auth.role}:${auth.revision}`}><PushHints /><Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: p.primary, tabBarInactiveTintColor: p.muted,
    tabBarStyle: { backgroundColor: p.surface, borderTopColor: p.border, height: 64 + Math.max(12, insets.bottom), paddingBottom: Math.max(12, insets.bottom), paddingTop: 8 }, tabBarLabelStyle: { fontFamily: 'Sora', fontSize: 11 } }}>
    <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color, size }) => <House color={color} size={size} /> }} />
    <Tabs.Screen name="attendance" options={{ title: 'Attendance', tabBarIcon: ({ color, size }) => <CalendarCheck color={color} size={size} /> }} />
    <Tabs.Screen name="learning" options={{ title: 'Learning', tabBarIcon: ({ color, size }) => <BookOpen color={color} size={size} /> }} />
    <Tabs.Screen name="notifications" options={{ title: 'Updates', tabBarIcon: ({ color, size }) => <Bell color={color} size={size} /> }} />
    <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: ({ color, size }) => <UserRound color={color} size={size} /> }} />
    <Tabs.Screen name="homework" options={{ href: null }} />
    <Tabs.Screen name="results" options={{ href: null }} />
    <Tabs.Screen name="leave" options={{ href: null }} />
  </Tabs></FamilyProvider>;
}
