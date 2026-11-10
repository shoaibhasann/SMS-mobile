import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { BookOpen, CalendarDays, ChartNoAxesColumnIncreasing, ChevronRight, GraduationCap } from 'lucide-react-native';
import { router } from 'expo-router';
import { useAuth } from '../../../auth/provider';
import { listHomework, listHomeworkStatuses, homeworkPageSize } from '../../../data/homework';
import { ChildPicker, useFamily } from '../../../ui/family';
import { Button, Card, ErrorCard, Screen, Skeleton, Text, Title } from '../../../ui/primitives';
import { usePalette } from '../../../ui/theme';
import { useLoad } from '../../../ui/use-load';

const shortcuts = [
  { label: 'Progress', hint: 'Academic analysis', icon: ChartNoAxesColumnIncreasing, path: '/(school)/academic-analysis' },
  { label: 'Results', hint: 'Published results', icon: GraduationCap, path: '/(school)/results' },
  { label: 'Leave', hint: 'Leave requests', icon: CalendarDays, path: '/(school)/leave' },
] as const;
const dueDate = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'UTC' });

export default function Learning() {
  const { access, client, role } = useAuth(), family = useFamily(), p = usePalette();
  const [page, setPage] = useState({ child: '', offset: 0 });
  const child = family.selected, offset = page.child === child?.id ? page.offset : 0;
  const read = useCallback(async (signal: AbortSignal) => {
    if (!child || !client || !access) return null;
    const work = await listHomework(client, access, role, child, offset, signal);
    const statuses = await listHomeworkStatuses(client, role, child, work.rows, signal).catch(cause => {
      if (signal.aborted) throw cause;
      return null;
    });
    return { ...work, statuses };
  }, [access, child, client, offset, role]);
  const work = useLoad(`${access?.userId}:${role}:${child?.id}:${offset}`, read);

  return <Screen>
    <Title title="Learning" subtitle="Homework, progress and school requests" />
    {child && <ChildPicker />}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {shortcuts.map(({ label, hint, icon: Icon, path }) => <Pressable key={path} accessibilityRole="button" accessibilityLabel={hint} onPress={() => router.push(path)}
        style={({ pressed }) => ({ minWidth: 86, flexGrow: 1, flexBasis: 86, minHeight: 56, gap: 4, alignItems: 'center', justifyContent: 'center', padding: 8,
          borderRadius: 12, borderWidth: 1, borderColor: p.border, backgroundColor: pressed ? p.soft : p.surface })}>
        <Icon accessible={false} size={20} color={p.primary} /><Text style={{ fontWeight: '600', textAlign: 'center' }}>{label}</Text>
      </Pressable>)}
    </View>
    {family.loading ? <Skeleton rows={2} /> : family.error ? <ErrorCard message={family.error} retry={family.refresh} />
      : !child ? <Card><Text>No student profile is linked. Contact your school.</Text></Card> : <>
        <View style={{ gap: 4 }}>
          <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: '700' }}>Homework</Text>
          <Text style={{ color: p.muted }}>{role === 'parent' ? 'Current session · View assignments and teacher feedback' : 'Current session · Open an assignment to respond'}</Text>
        </View>
        {work.loading ? <Skeleton rows={2} /> : work.error ? <ErrorCard message={work.error} retry={work.reload} /> : work.data && <>
          {work.data.rows.length === 0 ? <Card><Text style={{ fontWeight: '700' }}>No homework yet</Text><Text style={{ color: p.muted }}>Published assignments for this class will appear here.</Text></Card>
            : <Card style={{ gap: 0, padding: 0, overflow: 'hidden' }}>
              {work.data.rows.map((row, index) => {
                const state = work.data?.statuses?.get(row.id);
                const status = state === 'graded' ? 'Reviewed' : state === 'submitted' ? 'Submitted' : work.data?.statuses ? 'Not submitted' : null;
                const date = row.dueDate ? `Due ${dueDate.format(new Date(`${row.dueDate}T00:00:00Z`))}` : 'No due date';
                return <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={[row.title, date, status].filter(Boolean).join(', ')}
                  onPress={() => router.push({ pathname: '/(school)/homework', params: { child: child.id, activity: row.id } })}
                  style={({ pressed }) => ({ minHeight: 72, paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: index ? 1 : 0, borderColor: p.border,
                    backgroundColor: pressed ? p.soft : p.surface, flexDirection: 'row', alignItems: 'center', gap: 12 })}>
                  <BookOpen accessible={false} color={p.primary} size={20} />
                  <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                    <Text style={{ fontWeight: '700' }}>{row.title}</Text>
                    <Text style={{ color: p.muted, fontSize: 12 }}>{date}{row.maxMarks !== null ? ` · ${row.maxMarks} marks` : ''}</Text>
                    {status && <Text style={{ color: state === 'graded' ? p.success : state === 'submitted' ? p.primary : p.muted, fontSize: 12, fontWeight: '600' }}>{status}</Text>}
                  </View>
                  <ChevronRight accessible={false} size={18} color={p.muted} />
                </Pressable>;
              })}
            </Card>}
          {!work.data.statuses && <Text style={{ color: p.muted }}>Submission status is unavailable. Open an assignment to check its details.</Text>}
          {work.data.total > homeworkPageSize && <>
            <Text style={{ color: p.muted, fontSize: 12 }}>{offset + 1}–{offset + work.data.rows.length} of {work.data.total} assignments</Text>
            {offset > 0 && <Button label="Previous assignments" secondary onPress={() => setPage({ child: child.id, offset: Math.max(0, offset - homeworkPageSize) })} />}
            {offset + homeworkPageSize < work.data.total && <Button label="More assignments" secondary onPress={() => setPage({ child: child.id, offset: offset + homeworkPageSize })} />}
          </>}
          <Button label="Refresh homework" secondary onPress={work.reload} />
        </>}
      </>}
  </Screen>;
}
