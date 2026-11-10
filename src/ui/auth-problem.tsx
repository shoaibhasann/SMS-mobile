import { useState } from 'react';
import { useAuth } from '../auth/provider';
import { Button, ErrorCard, Screen, Title } from './primitives';

export function AuthProblem() {
  const { error, recovery, refresh, signOut } = useAuth();
  const [working, setWorking] = useState(false);
  return <Screen>
    <Title title={recovery === 'finishSignOut' ? 'Finish signing out' : 'School access unavailable'} />
    <ErrorCard message={error || 'Could not verify school access.'} retry={recovery === 'finishSignOut' ? undefined : refresh} />
    {recovery && <Button label={working ? 'Signing out…' : recovery === 'endSession' ? 'Sign out of saved account' : 'Finish signing out'}
      secondary disabled={working} onPress={() => {
        setWorking(true);
        void signOut().catch(() => {}).finally(() => setWorking(false));
      }} />}
  </Screen>;
}
