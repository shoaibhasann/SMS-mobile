import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useAuth } from '../../auth/provider';
import { loadAttendance, type AttendanceStatus } from '../../data';
import { ChildPicker, useFamily } from '../../ui/family';
import { useLoad } from '../../ui/use-load';
import { Button, Card, ErrorCard, Screen, Skeleton, Text, Title } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';

const labels: Record<AttendanceStatus, string> = { present: 'Present', absent: 'Absent', late: 'Late', half_day: 'Half day', leave: 'On leave', holiday: 'Holiday' };
export default function Attendance() {
  const { access, role, client } = useAuth(), family = useFamily(), p = usePalette();
  const [offset, setOffset] = useState(0), [forChild, setForChild] = useState('');
  const child = family.selected;
  const pageOffset = forChild === child?.id ? offset : 0;
  const read = useCallback(async (signal: AbortSignal) => {
    if (!access || !child) return { rows: [], count: 0 };
    return loadAttendance(client!, access, role, child, { offset: pageOffset, limit: 30 }, signal);
  }, [access, role, child, pageOffset, client]);
  const result = useLoad(`${access?.userId}:${role}:${child?.id}:${pageOffset}`, read);
  function page(value: number) { setForChild(child!.id); setOffset(value); }
  return <Screen><Title title="Attendance" subtitle="Saved school records. Unmarked days are not counted as absent." /><ChildPicker />
    {family.loading || result.loading ? <Skeleton /> : family.error ? <ErrorCard message={family.error} retry={family.refresh} /> : result.error ? <ErrorCard message={result.error} retry={result.reload} /> : !child ? <Card><Text>No student profile is currently linked.</Text></Card> : !result.data?.rows.length ? <Card><Text>No saved attendance records in this page.</Text></Card> : <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text accessibilityRole="header" style={{ fontWeight: '700' }}>Attendance history</Text><Text style={{ color: p.muted }}>{result.data.count} saved</Text></View>
      {result.data.rows.map(row => <View key={`${row.academic_year_id}:${row.attendance_date}`} style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, borderTopWidth: 1, borderTopColor: p.border, paddingTop: 14, paddingBottom: 3 }}>
        <Text>{new Date(`${row.attendance_date}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}</Text>
        <Text style={{ color: row.status === 'absent' ? p.danger : row.status === 'present' ? p.success : p.muted, fontWeight: '600' }}>{labels[row.status]}</Text>
      </View>)}
    </Card>}
    {child && !result.loading && <><View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}><Button label="Previous" secondary disabled={pageOffset === 0} onPress={() => page(Math.max(0, pageOffset - 30))} /></View><View style={{ flex: 1 }}><Button label="Next" secondary disabled={!result.data || pageOffset + 30 >= result.data.count} onPress={() => page(pageOffset + 30)} /></View></View><Button label="Refresh attendance" secondary onPress={result.reload} /></>}
  </Screen>;
}
