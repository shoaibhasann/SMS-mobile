import { router } from 'expo-router';
import { Button, Card, Screen, Text, Title } from '../ui/primitives';
import { usePalette } from '../ui/theme';

// Unknown sms-school:// links land here instead of Expo's dev "Unmatched Route" screen; Home re-enters the normal auth routing.
export default function NotFound() {
  const p = usePalette();
  return <Screen>
    <Title title="Link not available" />
    <Card>
      <Text style={{ color: p.muted }}>{"This link isn't available in the app. It may be old or mistyped."}</Text>
      <Button label="Go to Home" onPress={() => router.replace('/')} />
    </Card>
  </Screen>;
}
