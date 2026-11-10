import { router } from 'expo-router';
import { CalendarCheck, Bell, BookOpen } from 'lucide-react-native';
import { useAuth } from '../../auth/provider';
import { ChildPicker, useFamily } from '../../ui/family';
import { Button, Card, ErrorCard, Screen, Skeleton, Text, Title } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';

export default function Home() {
  const { access, role, refresh } = useAuth(), family = useFamily(), p = usePalette();
  return <Screen><Title title={`Hello, ${access?.name.split(' ')[0] || 'there'}.`} subtitle={role === 'parent' ? 'Follow your child’s attendance, learning and school updates.' : 'Check your attendance, schoolwork and updates.'} />
    {family.loading ? <Skeleton rows={2} /> : family.error ? <ErrorCard message={family.error} retry={refresh} /> : !family.children.length ? <Card><Text>No student profile is currently linked. Contact your school to verify access.</Text></Card> : <>
      <ChildPicker />
      <Button label="Attendance history" onPress={() => router.push('/(school)/attendance')} icon={<CalendarCheck size={20} color={p.onPrimary} />} />
      <Button label="Homework, results and leave" secondary onPress={() => router.push('/(school)/learning')} icon={<BookOpen size={20} color={p.primary} />} />
      <Button label="School updates" secondary onPress={() => router.push('/(school)/notifications')} icon={<Bell size={20} color={p.text} />} />
    </>}
    <Text style={{ color: p.muted, fontSize: 12 }}>Mobile pilot · Published results are individual assessment records. Attendance is read-only; approved leave does not change it automatically.</Text>
  </Screen>;
}
