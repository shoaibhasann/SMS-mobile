import { useCallback, useState, useEffect, useRef } from 'react';
import { Alert, Linking, View } from 'react-native';
import { Bell, CheckCheck } from 'lucide-react-native';
import { router } from 'expo-router';
import { useAuth } from '../../../auth/provider';
import { subscribePushInboxRefresh } from '../../../push';
import { homeworkError, loadFamilyNotificationInbox, markAllFamilyNotificationsRead, resolveHomeworkChild, markFamilyNotificationRead, type FamilyNotification, type FamilyNotificationCursor } from '../../../data';
import { Button, Card, ErrorCard, Screen, Skeleton, Text, Title } from '../../../ui/primitives';
import { useLoad } from '../../../ui/use-load';
import { usePalette } from '../../../ui/theme';
import { useFamily } from '../../../ui/family';
import { GateAlertPreferences } from '../../../ui/gate-alert-preferences';

const labels = {
  absence: ['Attendance', 'View attendance'],
  late: ['Late attendance', 'View attendance'],
  gate_arrival: ['Arrival', 'View attendance'],
  gate_exit: ['Exit', 'View attendance'],
  result_published: ['Result', 'View published result'],
  leave_decision: ['Leave', 'View leave decision'],
  announcement: ['Announcement', 'Open in SMS Web'],
  homework_assigned: ['Homework', 'View homework'],
  fee_due: ['Fee reminder', 'Open in SMS Web'],
  fee_payment: ['Fee payment', 'Open in SMS Web'],
  exam_schedule: ['Exam scheduled', 'View exam schedule'],
} as const;
// The same record routes as the web inbox (lib/notifications/family.ts notificationHref); the web page re-checks sign-in and access.
const webRecord = { announcement: ['notices', 'notice'], fee_due: ['invoices', 'fee'], fee_payment: ['invoices', 'payment'] } as const;
// The inbox currently on screen, so a confirmation from an unmounted inbox's dialog still applies.
let liveInbox: { userId: string; role: string; markAll(): void } | null = null;
// A fresh value per alert tap, so Attendance remounts its history (page 1, no filters) even for the same alert; only called from onPress.
const alertNonce = () => Date.now();
const gateTime = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

export default function Notifications() {
  const { access, role, client } = useAuth(), p = usePalette();
  const family = useFamily();
  const [unread, setUnread] = useState(false), [cursor, setCursor] = useState<FamilyNotificationCursor | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const read = useCallback((signal: AbortSignal) => loadFamilyNotificationInbox(client!, { userId: access!.userId, role, unreadOnly: unread, cursor }, signal), [access, role, unread, cursor, client]);
  const inbox = useLoad(`${access?.userId}:${role}:${unread}:${cursor?.id}`, read);
  const { reload } = inbox, userId = access?.userId;
  useEffect(() => userId ? subscribePushInboxRefresh({ userId, role }, reload) : undefined, [userId, role, reload]);
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
  function confirmedMarkAll() {
    setBusy(true); setError('');
    void markAllFamilyNotificationsRead(client!, role).then(() => { if (alive.current) { setCursor(null); inbox.reload(); } })
      .catch(() => { if (alive.current) setError('Read status could not be confirmed. Refresh before retrying.'); }).finally(() => { if (alive.current) setBusy(false); });
  }
  const confirmed = useRef(confirmedMarkAll);
  useEffect(() => { confirmed.current = confirmedMarkAll; });
  useEffect(() => {
    if (!userId) return;
    const owner = { userId, role, markAll: () => confirmed.current() };
    liveInbox = owner;
    return () => { if (liveInbox === owner) liveInbox = null; };
  }, [userId, role]);
  function markAll() {
    const owner = { userId, role };
    Alert.alert('Mark all updates as read?', 'This updates only the currently signed-in account and role, including unread updates outside this page.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Mark all as read', onPress: () => {
        if (alive.current) { confirmedMarkAll(); return; }
        // Android keeps this dialog open while backgrounding unmounts the inbox: hand the confirmation to the remounted
        // inbox of the same account and role, and never drop it silently.
        const live = liveInbox;
        if (live && live.userId === owner.userId && live.role === owner.role) live.markAll();
        else Alert.alert('Updates not marked', 'Reopen Updates and try again.');
      } },
    ]);
  }
  function open(row: FamilyNotification) {
    if (!alive.current) return;
    const { kind, student_id: child, source_id: source } = row;
    if (kind === 'exam_schedule') {
      router.push({ pathname: '/(school)/exam', params: { assessment: source } });
      return;
    }
    if (kind === 'homework_assigned') {
      if (family.loading || family.error) { setError('Child access changed. Refresh school access before opening this update.'); return; }
      setBusy(true); setError('');
      void resolveHomeworkChild(client!, access!, role, family.children, source).then(pupil => {
        if (!alive.current) return;
        family.select(pupil.id);
        router.push({ pathname: '/(school)/homework', params: { child: pupil.id, activity: source } });
      }).catch(cause => { if (alive.current) setError(homeworkError(cause)); }).finally(() => { if (alive.current) setBusy(false); });
      return;
    }
    if (child && !family.children.some(pupil => pupil.id === child)) {
      setError('Child access changed. Refresh school access before opening this update.');
      return;
    }
    if (kind === 'announcement' || kind === 'fee_due' || kind === 'fee_payment') {
      const [page, key] = webRecord[kind], params = new URLSearchParams();
      if (child) params.set('child', child);
      if (role === 'parent') params.set('view', 'guardian');
      params.set(key, source);
      void Linking.openURL(`https://sms-web-shoaibhasann.vercel.app/modules/${page}?${params}`).catch(() => { if (alive.current) setError('Open SMS Web in your browser to view this update.'); });
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
        router.navigate({ pathname: '/(school)/(tabs)/attendance', params: { alert: `${row.id}:${alertNonce()}` } });
        return;
      }
    }
  }
  return <Screen bottomInset={false}><Title title="School updates" subtitle="Attendance, exam schedules and other school alerts. Read status belongs to your account." />
    {role === 'parent' && access && client && <GateAlertPreferences key={access.userId} client={client} userId={access.userId} onChanged={() => { setCursor(null); inbox.reload(); }} />}
    <View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}><Button label="All" secondary={unread} selected={!unread} onPress={() => { setUnread(false); setCursor(null); }} /></View><View style={{ flex: 1 }}><Button label="Unread" secondary={!unread} selected={unread} onPress={() => { setUnread(true); setCursor(null); }} /></View></View>
    {error && <ErrorCard message={error} />}
    {inbox.loading ? <Skeleton /> : inbox.error ? <ErrorCard message={inbox.error} retry={inbox.reload} /> : inbox.data && <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Bell size={20} color={p.primary} /><Text style={{ flex: 1, fontWeight: '600' }}>{inbox.data.unread_count} unread</Text></View>
      <Button label="Mark all as read" secondary disabled={busy || inbox.data.unread_count === 0} onPress={markAll} icon={<CheckCheck size={19} color={p.text} />} />
      {!inbox.data.notifications.length && <Card><Text>{unread ? 'You’re all caught up.' : 'No school updates are available.'}</Text></Card>}
      {inbox.data.notifications.map(row => {
        const [label, action] = labels[row.kind];
        return <Card key={`${row.kind}:${row.id}`} style={!row.read_at ? { borderColor: p.primary } : undefined}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}><Text style={{ color: p.primary, fontSize: 12, fontWeight: '700' }}>{row.kind === 'exam_schedule' && row.status === 'rescheduled' ? 'Exam schedule updated' : label}</Text><Text style={{ color: row.read_at ? p.muted : p.primary, fontSize: 12, fontWeight: row.read_at ? undefined : '700' }}>{row.read_at ? 'Read' : 'Unread'}</Text></View>
        <Text accessibilityRole="header" style={{ fontSize: 17, lineHeight: 26, fontWeight: '600' }}>{row.title}</Text>{family.children.length > 1 && row.student_name && <Text>{row.student_name}</Text>}<Text style={{ color: p.muted, fontSize: 12 }}>{row.occurred_at ? `${gateTime.format(new Date(row.occurred_at))} IST${row.delayed ? ' · Delayed scan' : ''}` : row.event_date}</Text>
        {action && <Button label={action} secondary disabled={busy} onPress={() => open(row)} />}
        {!row.read_at && <Button label="Mark as read" secondary disabled={busy} onPress={() => void mark(row)} />}
      </Card>;
      })}
      {inbox.data.next_cursor && <Button label="Older updates" secondary onPress={() => setCursor(inbox.data!.next_cursor)} />}
      {cursor && <Button label="Latest updates" secondary onPress={() => setCursor(null)} />}
    </>}
    <Button label="Refresh updates" secondary disabled={busy} onPress={inbox.reload} />
    <Text style={{ color: p.muted, fontSize: 12 }}>Details are checked against your current linked-child access. Result links show the latest published revision. Opening an update does not automatically mark it read.</Text>
  </Screen>;
}
