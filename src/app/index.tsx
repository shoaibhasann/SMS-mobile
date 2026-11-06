import { Redirect } from 'expo-router';
import { useAuth } from '../auth/provider';
import { Screen, Title, Skeleton, ErrorCard, Button } from '../ui/primitives';

export default function Entry() {
  const auth = useAuth();
  if (auth.status === 'signedOut') return <Redirect href="/login" />;
  if (auth.status === 'ready' && auth.foreground) return <Redirect href="/(school)" />;
  return <Screen><Title title="Your school, in sync." subtitle="Secure family workspace" />{auth.error ? <><ErrorCard message={auth.error} retry={auth.refresh} /><Button label="Sign out" secondary onPress={() => void auth.signOut().catch(() => {})} /></> : <Skeleton />}</Screen>;
}
