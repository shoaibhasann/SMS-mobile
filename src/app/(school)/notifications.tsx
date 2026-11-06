import { useCallback, useState, useEffect, useRef } from 'react';
import { Alert, View } from 'react-native';
import { Bell, CheckCheck } from 'lucide-react-native';
import { router } from 'expo-router';
import { useAuth } from '../../auth/provider';
import { loadFamilyNotificationInbox, markAllFamilyNotificationsRead, markFamilyNotificationRead, type FamilyNotification, type FamilyNotificationCursor } from '../../data';
import { Button, Card, ErrorCard, Screen, Skeleton, Text, Title } from '../../ui/primitives';
import { useLoad } from '../../ui/use-load';
import { usePalette } from '../../ui/theme';
import { useFamily } from '../../ui/family';

export default function Notifications() {
  const { access, role, client } = useAuth(), p = usePalette();
  const family = useFamily();
  const [unread, setUnread] = useState(false), [cursor, setCursor] = useState<FamilyNotificationCursor | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const read = useCallback((signal: AbortSignal) => loadFamilyNotificationInbox(client!, { role, unreadOnly: unread, cursor }, signal), [role, unread, cursor, client]);
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
    if (!family.children.some(child => child.id === row.student_id)) { setError('Child access changed. Refresh school access before opening this update.'); return; }
    family.select(row.student_id);
    if (row.kind === 'absence') router.push('/(school)/attendance');
    else if (row.kind === 'result_published') router.push({ pathname: '/(school)/results', params: { child: row.student_id, assessment: row.assessment_id! } });
    else router.push({ pathname: '/(school)/leave', params: { child: row.student_id, request: row.source_id } });
  }
  return <Screen><Title title="School updates" subtitle="Attendance, published results and leave decisions. Read status belongs to your account." />
    <View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}><Button label="All" secondary={unread} onPress={() => { setUnread(false); setCursor(null); }} /></View><View style={{ flex: 1 }}><Button label="Unread" secondary={!unread} onPress={() => { setUnread(true); setCursor(null); }} /></View></View>
    {error && <ErrorCard message={error} />}
    {inbox.loading ? <Skeleton /> : inbox.error ? <ErrorCard message={inbox.error} retry={inbox.reload} /> : inbox.data && <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Bell size={20} color={p.primary} /><Text style={{ flex: 1, fontWeight: '600' }}>{inbox.data.unread_count} unread</Text></View>
      <Button label="Mark all as read" secondary disabled={busy || inbox.data.unread_count === 0} onPress={markAll} icon={<CheckCheck size={19} color={p.text} />} />
      {!inbox.data.notifications.length && <Card><Text>{unread ? 'You’re all caught up.' : 'No school updates are available.'}</Text></Card>}
      {inbox.data.notifications.map(row => <Card key={`${row.kind}:${row.id}`}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}><Text style={{ color: p.primary, fontSize: 12, fontWeight: '700' }}>{row.kind === 'absence' ? 'ATTENDANCE' : row.kind === 'result_published' ? 'RESULT' : 'LEAVE'}</Text><Text style={{ color: p.muted, fontSize: 12 }}>{row.read_at ? 'Read' : 'Unread'}</Text></View>
        <Text accessibilityRole="header" style={{ fontSize: 17, lineHeight: 26, fontWeight: '600' }}>{row.title}</Text><Text>{row.student_name}</Text><Text style={{ color: p.muted, fontSize: 12 }}>{row.event_date}</Text>
        <Button label={row.kind === 'absence' ? 'View attendance' : row.kind === 'result_published' ? 'View published result' : 'View leave decision'} secondary onPress={() => void open(row)} />
        {!row.read_at && <Button label="Mark as read" secondary disabled={busy} onPress={() => void mark(row)} />}
      </Card>)}
      {inbox.data.next_cursor && <Button label="Older updates" secondary onPress={() => setCursor(inbox.data!.next_cursor)} />}
      {cursor && <Button label="Latest updates" secondary onPress={() => setCursor(null)} />}
    </>}
    <Button label="Refresh updates" secondary disabled={busy} onPress={inbox.reload} />
    <Text style={{ color: p.muted, fontSize: 12 }}>Details are checked against your current linked-child access. Result links show the latest published revision. Opening an update does not automatically mark it read.</Text>
  </Screen>;
}
