import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { useAuth } from '../../auth/provider';
import type { FamilyAccess, FamilyChild, FamilyRole } from '../../data/family';
import { getFamilyNotificationLeave, leaveOverlaps, listFamilyStudentLeave, StudentLeaveError, submitStudentLeave, validateLeaveTarget, validateStudentLeave, type StudentLeaveRequest } from '../../data/leave';
import { createPendingLeaveStore, type PendingLeaveIntent, type LeaveDraft } from '../../data/pending-leave';
import { ChildPicker, useFamily } from '../../ui/family';
import { useLoad } from '../../ui/use-load';
import { BackArrow, Button, Card, ErrorCard, Screen, Skeleton, Text, Title } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';
import type { SupabaseClient } from '@supabase/supabase-js';

const pendingStore = createPendingLeaveStore({
  get: key => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  remove: key => SecureStore.deleteItemAsync(key),
}, Crypto.randomUUID);
const empty: LeaveDraft = { startDate: '', endDate: '', reason: '' };
const dateLabel = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

export default function Leave() {
  const auth = useAuth(), family = useFamily();
  const params = useLocalSearchParams<{ child?: string; request?: string }>();
  let target = { child: null as string | null, request: null as string | null }, error = '';
  try { target = validateLeaveTarget(params.child, params.request); } catch (cause) { error = cause instanceof Error ? cause.message : 'This leave link is invalid.'; }
  const child = target.child ? family.children.find(value => value.id === target.child) : family.selected;
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><Screen>
    <BackArrow onPress={() => router.canGoBack() ? router.back() : router.replace('/(school)/(tabs)/learning')} />
    <Title title="Leave requests" subtitle={auth.role === 'parent' ? 'Request leave for a linked child and track the decision.' : 'Request leave for yourself and track the decision.'} />
    {error ? <ErrorCard message={error} /> : family.loading ? <Skeleton /> : family.error ? <ErrorCard message={family.error} retry={family.refresh} /> : !child ? <Card><Text>{target.child ? 'This student is no longer available in your current school access.' : 'No student profile is currently linked.'}</Text></Card> : auth.access && auth.client ?
      <LeaveForChild key={`${auth.access.userId}:${auth.access.schoolId}:${auth.role}:${child.id}`} access={auth.access} client={auth.client} role={auth.role} child={child} requestId={target.request} /> : <Skeleton />}
  </Screen></KeyboardAvoidingView>;
}

function LeaveForChild({ access, client, role, child, requestId }: { access: FamilyAccess; client: SupabaseClient; role: FamilyRole; child: FamilyChild; requestId: string | null }) {
  const family = useFamily(), p = usePalette();
  const scope = useMemo(() => ({ userId: access.userId, schoolId: access.schoolId, role, studentId: child.id }), [access.userId, access.schoolId, role, child.id]);
  const [draft, setDraft] = useState<LeaveDraft>(empty), [pending, setPending] = useState<PendingLeaveIntent | null>(null);
  const [pendingLoading, setPendingLoading] = useState(true), [pendingError, setPendingError] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [offset, setOffset] = useState(0), [expanded, setExpanded] = useState('');
  const mounted = useRef(true), activeRequest = useRef<AbortController | null>(null), submitting = useRef(false);
  const current = () => mounted.current;
  const restore = useCallback(async () => {
    const value = await pendingStore.read(scope);
    if (!mounted.current) return;
    setPending(value); setPendingError('');
    if (value) setDraft({ startDate: value.startDate, endDate: value.endDate, reason: value.reason });
  }, [scope]);
  useEffect(() => {
    mounted.current = true;
    void pendingStore.read(scope).then(value => {
      if (!mounted.current) return;
      setPending(value); setPendingError('');
      if (value) setDraft({ startDate: value.startDate, endDate: value.endDate, reason: value.reason });
    }).catch(() => { if (mounted.current) setPendingError('Your pending request could not be loaded securely. Retry before sending another request.'); })
      .finally(() => { if (mounted.current) setPendingLoading(false); });
    return () => { mounted.current = false; activeRequest.current?.abort(); };
  }, [scope]);
  const load = useCallback((signal: AbortSignal) => listFamilyStudentLeave(client, access, role, child, offset, signal), [client, access, role, child, offset]);
  const history = useLoad(`${access.userId}:${role}:${child.id}:${offset}`, load);
  const loadDecision = useCallback((signal: AbortSignal) => requestId ? getFamilyNotificationLeave(client, access, role, child, requestId, signal) : Promise.resolve(null), [client, access, role, child, requestId]);
  const decision = useLoad(`${access.userId}:${role}:${child.id}:decision:${requestId}`, loadDecision);
  const locked = busy || !!pending || pendingLoading || !!pendingError;
  function select(value: FamilyChild) {
    if (value.id === child.id || submitting.current || pending) return;
    const change = () => { if (!current() || submitting.current || pending) return; family.select(value.id); router.setParams({ child: value.id, request: undefined }); };
    if (Object.values(draft).some(value => value.trim())) Alert.alert('Discard this unsent draft?', 'Dates and reason have not been submitted. Switching students clears this draft.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Switch student', style: 'destructive', onPress: change }]);
    else change();
  }
  async function submit() {
    if (submitting.current || pendingLoading || pendingError) return;
    const validation = validateStudentLeave(draft.startDate, draft.endDate, draft.reason);
    if (validation) { setError(validation); return; }
    if (!pending && leaveOverlaps(history.data ?? [], draft.startDate, draft.endDate)) { setError('These dates overlap a saved pending or approved request. Review history before sending.'); return; }
    submitting.current = true; setBusy(true); setError(''); setNotice('');
    const controller = new AbortController(); activeRequest.current = controller;
    let prepared: Awaited<ReturnType<typeof pendingStore.prepare>> | null = null;
    try {
      prepared = await pendingStore.prepare(scope, draft);
      if (current()) setPending(prepared.intent);
      const saved = await submitStudentLeave(client, access, role, child, prepared.intent, controller.signal);
      await pendingStore.complete(scope, prepared.intent.idempotencyKey);
      if (!current()) return;
      setPending(null); setDraft(empty); setOffset(0); setNotice('Request sent. You can track it under Request history.'); setExpanded(saved); history.reload();
    } catch (cause) {
      // Only the first explicitly rejected attempt can unlock editing. An earlier unknown commit stays locked.
      if (prepared && !prepared.recovered && cause instanceof StudentLeaveError && ['22023', 'PT409', '42501', '23505', '40001'].includes(cause.code) && !controller.signal.aborted) {
        await pendingStore.complete(scope, prepared.intent.idempotencyKey).catch(() => {});
      }
      if (!current()) return;
      setError(cause instanceof StudentLeaveError ? cause.message : 'Submission could not be confirmed. Retry this same request; your dates and reason are kept.');
      await restore().catch(() => { if (current()) setPendingError('The pending request could not be confirmed securely. Retry loading it before sending another request.'); });
    } finally {
      submitting.current = false;
      if (current()) { setBusy(false); activeRequest.current = null; }
    }
  }
  const field = { minHeight: 54, borderWidth: 1, borderColor: p.border, color: p.text, backgroundColor: p.bg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Sora', fontSize: 15, lineHeight: 22 };
  return <>
    <ChildPicker child={child} onSelect={select} disabled={locked} />
    {role === 'parent' && family.children.length > 1 && (busy || pending) && <Text style={{ color: p.muted }}>Student selection is locked until this request is confirmed. An unconfirmed request is kept securely for this account and student.</Text>}
    {requestId && (decision.loading ? <Skeleton rows={1} /> : decision.error ? <ErrorCard message={decision.error} retry={decision.reload} /> : decision.data ? <LeaveRecord row={decision.data} expanded /> : <Card><Text>This leave decision is currently unavailable. Refresh school access or contact your school.</Text></Card>)}
    <Card><Text accessibilityRole="header" style={{ fontSize: 18, lineHeight: 26, fontWeight: '700' }}>{pending ? 'Confirm your submitted request' : 'Request leave'}</Text>
      <Text style={{ color: p.muted }}>Your principal or school administrator approves or declines the request. Attendance is recorded separately.</Text>
      {pendingLoading ? <Skeleton rows={1} /> : pendingError ? <ErrorCard message={pendingError} retry={() => { setPendingLoading(true); void restore().catch(() => {}).finally(() => setPendingLoading(false)); }} /> : <>
        {pending && <Text style={{ color: p.warning }}>The previous outcome is unconfirmed. Dates and reason are locked. Retry this same request to check whether your school received it.</Text>}
        {child.status !== 'active' && !pending && <Text style={{ color: p.muted }}>Retained history is available. Only an active student with a current enrollment can submit a new request.</Text>}
        <Text style={{ color: p.muted }}>All fields are required. Choose dates in the current academic year.</Text>
        <View style={{ gap: 6 }}>
          <Text nativeID="leave-start" style={{ fontWeight: '600' }}>Start date</Text>
          <TextInput accessibilityLabel="Start date, YYYY-MM-DD" accessibilityLabelledBy="leave-start" placeholder="YYYY-MM-DD" placeholderTextColor={p.muted} value={draft.startDate} onChangeText={startDate => setDraft(value => ({ ...value, startDate }))} editable={!locked && child.status === 'active'} maxLength={10} autoCorrect={false} autoCapitalize="none" keyboardType="numbers-and-punctuation" style={field} />
        </View>
        <View style={{ gap: 6 }}>
          <Text nativeID="leave-end" style={{ fontWeight: '600' }}>End date</Text>
          <TextInput accessibilityLabel="End date, YYYY-MM-DD" accessibilityLabelledBy="leave-end" placeholder="YYYY-MM-DD" placeholderTextColor={p.muted} value={draft.endDate} onChangeText={endDate => setDraft(value => ({ ...value, endDate }))} editable={!locked && child.status === 'active'} maxLength={10} autoCorrect={false} autoCapitalize="none" keyboardType="numbers-and-punctuation" style={field} />
        </View>
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}><Text nativeID="leave-reason" style={{ fontWeight: '600' }}>Reason</Text><Text style={{ color: p.muted, fontSize: 12 }}>{Array.from(draft.reason.trim()).length}/1,000</Text></View>
          <TextInput accessibilityLabel="Reason for leave" accessibilityLabelledBy="leave-reason" placeholder="Tell your school why leave is needed" placeholderTextColor={p.muted} value={draft.reason} onChangeText={reason => setDraft(value => ({ ...value, reason }))} editable={!locked && child.status === 'active'} multiline maxLength={1000} textAlignVertical="top" style={[field, { minHeight: 112 }]} />
        </View>
        <Button label={busy ? 'Confirming request…' : pending ? 'Retry this same request' : 'Submit leave request'} disabled={busy || (!pending && child.status !== 'active')} onPress={() => void submit()} />
      </>}
      {notice && <Text accessibilityLiveRegion="polite" style={{ color: p.success }}>{notice}</Text>}{error && <ErrorCard message={error} />}
    </Card>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}><Text accessibilityRole="header" style={{ fontWeight: '700', fontSize: 18 }}>Request history</Text><Button label="Refresh history" secondary disabled={busy} onPress={history.reload} /></View>
    {history.loading ? <Skeleton /> : history.error ? <ErrorCard message={history.error} retry={history.reload} /> : !history.data?.length ? <Card><Text>{offset === 0 ? 'No leave requests yet.' : 'No leave requests on this page.'}</Text></Card> : history.data.map(row => <View key={row.id} style={{ gap: 8 }}><LeaveRecord row={row} expanded={row.id === expanded} /><Pressable accessibilityRole="button" accessibilityLabel={row.id === expanded ? 'Hide leave details' : 'Show leave details'} onPress={() => setExpanded(value => value === row.id ? '' : row.id)} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 10 }}><Text style={{ color: p.primary, fontWeight: '600' }}>{row.id === expanded ? 'Hide details' : 'View details'}</Text></Pressable></View>)}
    <View style={{ gap: 10 }}><Text style={{ color: p.muted }}>Page {Math.floor(offset / 50) + 1}{history.data?.[0] ? ` · ${history.data[0].total_count} saved requests` : ''}</Text><View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}><Button label="Previous" secondary disabled={busy || history.loading || offset === 0} onPress={() => setOffset(value => Math.max(0, value - 50))} /></View><View style={{ flex: 1 }}><Button label="Next" secondary disabled={busy || history.loading || !history.data?.length || offset + 50 >= history.data[0].total_count} onPress={() => setOffset(value => value + 50)} /></View></View></View>
  </>;
}

function LeaveRecord({ row, expanded }: { row: StudentLeaveRequest; expanded: boolean }) {
  const p = usePalette();
  return <Card><View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 }}><Text style={{ fontWeight: '700' }}>{dateLabel(row.start_date)} – {dateLabel(row.end_date)}</Text><Text style={{ color: row.status === 'approved' ? p.success : row.status === 'rejected' ? p.danger : p.warning, fontWeight: '600' }}>{row.status === 'approved' ? 'Approved' : row.status === 'rejected' ? 'Rejected' : 'Pending review'}</Text></View>
    <Text numberOfLines={expanded ? undefined : 3}>{row.reason}</Text><Text style={{ color: p.muted, fontSize: 12 }}>{row.academic_year_name} · {row.class_name}{row.section_name ? ` ${row.section_name}` : ''}</Text>
    {expanded && <><Text style={{ color: p.muted, fontSize: 12 }}>Requested by {row.requester_name || 'School account'} · {new Date(row.created_at).toLocaleDateString('en-IN')}</Text>{row.review_note && <View style={{ gap: 6, borderTopWidth: 1, borderTopColor: p.border, paddingTop: 12 }}><Text style={{ fontWeight: '600' }}>School decision</Text><Text>{row.review_note}</Text><Text style={{ color: p.muted, fontSize: 12 }}>{row.reviewer_name || 'School reviewer'} · {new Date(row.reviewed_at!).toLocaleDateString('en-IN')}</Text></View>}</>}
  </Card>;
}
