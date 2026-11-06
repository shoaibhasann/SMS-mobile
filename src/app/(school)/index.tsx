import { router } from 'expo-router';
import { CalendarCheck, Bell } from 'lucide-react-native';
import { useAuth } from '../../auth/provider';
import { ChildPicker, useFamily, childName } from '../../ui/family';
import { Button, Card, ErrorCard, Screen, Skeleton, Text, Title } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';

export default function Home() {
  const { access, role, refresh } = useAuth(), family = useFamily(), p = usePalette();
  return <Screen><Title title={`Hello, ${access?.name.split(' ')[0] || 'there'}.`} subtitle={role === 'parent' ? 'Your child’s school day, one place.' : 'Your learning and school updates, one place.'} />
    {family.loading ? <Skeleton rows={2} /> : family.error ? <ErrorCard message={family.error} retry={refresh} /> : !family.children.length ? <Card><Text>No student profile is currently linked. Contact your school to verify access.</Text></Card> : <>
      <ChildPicker /><Card style={{ backgroundColor: p.soft }}><Text style={{ color: p.primary, fontSize: 12, fontWeight: '700' }}>YOUR SCHOOL DAY</Text><Text style={{ fontSize: 22, lineHeight: 31, fontWeight: '700' }}>{family.selected && childName(family.selected)}</Text><Text style={{ color: p.muted }}>See saved attendance and school updates. Records are checked against your current school access.</Text></Card>
      <Button label="Attendance history" onPress={() => router.push('/(school)/attendance')} icon={<CalendarCheck size={20} color={p.onPrimary} />} />
      <Button label="School updates" secondary onPress={() => router.push('/(school)/notifications')} icon={<Bell size={20} color={p.text} />} />
    </>}
    <Text style={{ color: p.muted, fontSize: 12 }}>Mobile pilot · Read-only attendance and family updates. Homework, report cards and leave screens follow in the next app slice.</Text>
  </Screen>;
}
