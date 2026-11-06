import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { BookOpen, CalendarDays, ChevronRight, GraduationCap } from 'lucide-react-native';
import { router } from 'expo-router';
import { useAuth } from '../../auth/provider';
import { listHomework, homeworkPageSize } from '../../data/homework';
import { ChildPicker, useFamily, childName } from '../../ui/family';
import { Button, Card, ErrorCard, Screen, Skeleton, Text, Title } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';
import { useLoad } from '../../ui/use-load';

export default function Learning() {
  const auth = useAuth(), family = useFamily(), p = usePalette();
  const [page, setPage] = useState({ child: '', offset: 0 });
  const child = family.selected, offset = page.child === child?.id ? page.offset : 0;
  const read = useCallback((signal: AbortSignal) => child ? listHomework(auth.client!, auth.access!, auth.role, child, offset, signal) : Promise.resolve(null), [auth.client, auth.access, auth.role, child, offset]);
  const work = useLoad(`${child?.id}:${offset}`, read);
  return <Screen><Title title="Learning" subtitle="Schoolwork, published results and leave requests for your verified school profile." />
    <View style={{ gap: 10 }}><Button label="Published results" secondary icon={<GraduationCap size={20} color={p.primary} />} onPress={() => router.push('/(school)/results')} />
      <Button label="Leave requests" secondary icon={<CalendarDays size={20} color={p.primary} />} onPress={() => router.push('/(school)/leave')} /></View>
    {family.loading ? <Skeleton rows={2} /> : family.error ? <ErrorCard message={family.error} retry={family.refresh} /> : !child ? <Card><Text>No student profile is linked. Contact your school.</Text></Card> : <>
      <ChildPicker /><View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><BookOpen color={p.primary} size={20} /><Text accessibilityRole="header" style={{ fontSize: 19, fontWeight: '700' }}>Homework</Text></View>
      <Text style={{ color: p.muted }}>Current session · {childName(child)}{auth.role === 'parent' ? ' · Read-only guardian view' : ''}</Text>
      {work.loading ? <Skeleton /> : work.error ? <ErrorCard message={work.error} retry={work.reload} /> : work.data && <>
        {!work.data.rows.length && <Card><Text>No homework is published for this student’s active placement in the current session.</Text></Card>}
        {work.data.rows.map(row => <Card key={row.id}>
          <Text style={{ fontSize: 17, lineHeight: 25, fontWeight: '600' }}>{row.title}</Text>
          {row.description && <Text numberOfLines={3} style={{ color: p.muted }}>{row.description}</Text>}
          <Text style={{ color: p.muted, fontSize: 12 }}>{row.dueDate ? `Due ${row.dueDate}` : 'No due date'}{row.maxMarks !== null ? ` · ${row.maxMarks} maximum marks` : ''}</Text>
          <Button label={auth.role === 'student' ? 'Open homework' : 'View work and feedback'} secondary icon={<ChevronRight size={18} color={p.primary} />} onPress={() => router.push({ pathname: '/(school)/homework', params: { child: child.id, activity: row.id } })} />
        </Card>)}
        <Text style={{ color: p.muted, fontSize: 12 }}>{work.data.total ? `${offset + 1}–${offset + work.data.rows.length} of ${work.data.total}` : '0 homework tasks'}</Text>
        {offset > 0 && <Button label="Previous homework" secondary onPress={() => setPage({ child: child.id, offset: Math.max(0, offset - homeworkPageSize) })} />}
        {offset + homeworkPageSize < work.data.total && <Button label="More homework" secondary onPress={() => setPage({ child: child.id, offset: offset + homeworkPageSize })} />}
      </>}
      <Button label="Refresh homework" secondary onPress={work.reload} />
      <Text style={{ color: p.muted, fontSize: 12 }}>Past-session academic history remains available on the school website. Published results and leave history are available here.</Text>
    </>}
  </Screen>;
}
