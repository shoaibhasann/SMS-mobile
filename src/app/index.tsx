import { Redirect } from 'expo-router';
import { useAuth } from '../auth/provider';
import { MfaVerification } from '../ui/mfa-verification';
import { Screen, Skeleton } from '../ui/primitives';
import { AuthProblem } from '../ui/auth-problem';

export default function Entry() {
  const auth = useAuth();
  if (auth.status === 'signedOut') return <Redirect href="/login" />;
  if (auth.status === 'mfa' && auth.foreground) return <MfaVerification />;
  if (auth.status === 'ready' && auth.foreground) return <Redirect href="/(school)" />;
  if (auth.status === 'error') return <AuthProblem />;
  return <Screen><Skeleton /></Screen>;
}
