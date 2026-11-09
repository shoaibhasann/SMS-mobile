import { useCallback, useState, useEffect, useRef } from 'react';
import { Alert, Linking, View } from 'react-native';
import { Bell, CheckCheck } from 'lucide-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../auth/provider';
import { loadFamilyNotificationInbox, markAllFamilyNotificationsRead, markFamilyNotificationRead, type FamilyNotification, type FamilyNotificationCursor } from '../../data';
import { Button, Card, ErrorCard, Screen, Skeleton, Text, Title } from '../../ui/primitives';
import { useLoad } from '../../ui/use-load';
import { usePalette } from '../../ui/theme';
import { useFamily } from '../../ui/family';
import { ExamSchedule } from '../../ui/exam-schedule';
import { GateAlertPreferences } from '../../ui/gate-alert-preferences';

const labels = {
  absence: ['Attendance', 'View attendance'],
  late: ['Late attendance', 'View attendance'],
  gate_arrival: ['Arrival', 'View attendance'],
  gate_exit: ['Exit', 'View attendance'],
  result_published: ['Result', 'View published result'],
  leave_decision: ['Leave', 'View leave decision'],
  announcement: ['Announcement', 'Open in SMS Web'],
  homework_assigned: ['Homework', 'Open in SMS Web'],
  fee_due: ['Fee reminder', 'Open in SMS Web'],
  fee_payment: ['Fee payment', 'Open in SMS Web'],
  exam_schedule: ['Exam scheduled', 'View exam schedule'],
} as const;
const gateTime = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

export default function Notifications() {
  const { assessment } = useLocalSearchParams<{ assessment?: string | string[] }>();
  return assessment ? <ExamSchedule assessment={assessment} back={() => router.setParams({ assessment: '' })} /> : <NotificationsInbox />;
}

function NotificationsInbox() {
  const { access, role, client } = useAuth(), p = usePalette();
  const family = useFamily();
  const [unread, setUnread] = useState(false), [cursor, setCursor] = useState<FamilyNotificationCursor | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const read = useCallback((signal: AbortSignal) => loadFamilyNotificationInbox(client!, { userId: access!.userId, role, unreadOnly: unread, cursor }, signal), [access, role, unread, cursor, client]);
  const inbox = useLoad(`${access?.userId}:${role}:${unread}:${cursor?.id}`, read);
  async function mark(row: FamilyNotification) {
    if (!alive.current) return;
    setBusy(true); setError('');
    try {
      const saved = await markFamilyNotificationRead(client!, role, row.kind, row.id);
      if (!saved) throw new Error('This update is no longer available. Refresh your inbox.');
      if (alive.current) inbox.reload();
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'Read status could not be confirmed. Refresh before retrying.'); }
    finally { if (alive.current) setBusy(false); }
  }
  function markAll() {
    Alert.alert('Mark all updates as read?', 'This updates only the currently signed-in account and role, including unread updates outside this page.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Mark all as read', onPress: () => {
        if (!alive.current) return;
        setBusy(true); setError('');
        void markAllFamilyNotificationsRead(client!, role).then(() => { if (alive.current) { setCursor(null); inbox.reload(); } })
          .catch(() => { if (alive.current) setError('Read status could not be confirmed. Refresh before retrying.'); }).finally(() => { if (alive.current) setBusy(false); });
      } },
    ]);
  }
  async function open(row: FamilyNotification) {
    if (!alive.current) return;
    const { kind, student_id: child, source_id: source } = row;
    if (kind === 'exam_schedule') {
      router.setParams({ assessment: source });
      return;
    }
    if (child && !family.children.some(pupil => pupil.id === child)) {
      setError('Child access changed. Refresh school access before opening this update.');
      return;
    }
    if (child) {
      family.select(child);
      if (kind === 'result_published' && row.assessment_id) {
        router.push({ pathname: '/(school)/results', params: { child, assessment: row.assessment_id } });
        return;
      }
      if (kind === 'leave_decision') {
        router.push({ pathname: '/(school)/leave', params: { child, request: source } });
        return;
      }
      if (kind === 'absence' || kind === 'late' || kind === 'gate_arrival' || kind === 'gate_exit') {
        router.push('/(school)/attendance');
        return;
      }
    }
    const params = new URLSearchParams();
    if (role === 'parent') params.set('view', 'guardian');
    if (child) params.set('child', child);
    const target = {
      announcement: ['notices', 'notice'],
      homework_assigned: ['homework', 'activity'],
      fee_due: ['invoices', 'fee'],
      fee_payment: ['invoices', 'payment'],
    } as const;
    if (kind === 'announcement' || kind === 'homework_assigned' || kind === 'fee_due' || kind === 'fee_payment') {
      const [path, key] = target[kind];
      params.set(key, source);
      try { await Linking.openURL(`https://sms-web-shoaibhasann.vercel.app/modules/${path}?${params}`); }
      catch { if (alive.current) setError('SMS Web could not be opened. Try again.'); }
    }
  }
  return <Screen><Title title="School updates" subtitle="Attendance, exam schedules and other school alerts. Read status belongs to your account." />
    {role === 'parent' && access && client && <GateAlertPreferences key={access.userId} client={client} userId={access.userId} onChanged={() => { setCursor(null); inbox.reload(); }} />}
    <View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}><Button label="All" secondary={unread} onPress={() => { setUnread(false); setCursor(null); }} /></View><View style={{ flex: 1 }}><Button label="Unread" secondary={!unread} onPress={() => { setUnread(true); setCursor(null); }} /></View></View>
    {error && <ErrorCard message={error} />}
    {inbox.loading ? <Skeleton /> : inbox.error ? <ErrorCard message={inbox.error} retry={inbox.reload} /> : inbox.data && <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Bell size={20} color={p.primary} /><Text style={{ flex: 1, fontWeight: '600' }}>{inbox.data.unread_count} unread</Text></View>
      <Button label="Mark all as read" secondary disabled={busy || inbox.data.unread_count === 0} onPress={markAll} icon={<CheckCheck size={19} color={p.text} />} />
      {!inbox.data.notifications.length && <Card><Text>{unread ? 'You’re all caught up.' : 'No school updates are available.'}</Text></Card>}
      {inbox.data.notifications.map(row => <Card key={`${row.kind}:${row.id}`}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}><Text style={{ color: p.primary, fontSize: 12, fontWeight: '700' }}>{row.kind === 'exam_schedule' && row.status === 'rescheduled' ? 'Exam schedule updated' : labels[row.kind][0]}</Text><Text style={{ color: p.muted, fontSize: 12 }}>{row.read_at ? 'Read' : 'Unread'}</Text></View>
        <Text accessibilityRole="header" style={{ fontSize: 17, lineHeight: 26, fontWeight: '600' }}>{row.title}</Text>{row.student_name && <Text>{row.student_name}</Text>}<Text style={{ color: p.muted, fontSize: 12 }}>{row.occurred_at ? `${gateTime.format(new Date(row.occurred_at))} IST${row.delayed ? ' · Delayed scan' : ''}` : row.event_date}</Text>
        <Button label={labels[row.kind][1]} secondary onPress={() => void open(row)} />
        {!row.read_at && <Button label="Mark as read" secondary disabled={busy} onPress={() => void mark(row)} />}
      </Card>)}
      {inbox.data.next_cursor && <Button label="Older updates" secondary onPress={() => setCursor(inbox.data!.next_cursor)} />}
      {cursor && <Button label="Latest updates" secondary onPress={() => setCursor(null)} />}
    </>}
    <Button label="Refresh updates" secondary disabled={busy} onPress={inbox.reload} />
    <Text style={{ color: p.muted, fontSize: 12 }}>Details are checked against your current linked-child access. Result links show the latest published revision. Opening an update does not automatically mark it read.</Text>
  </Screen>;
}
