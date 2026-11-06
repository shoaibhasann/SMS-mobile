import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, TextInput } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { ArrowLeft, Paperclip } from 'lucide-react-native';
import { useAuth } from '../../auth/provider';
import type { FamilyChild } from '../../data/family';
import { definitiveHomeworkError, getHomework, homeworkError, homeworkUuid, loadSubmission, submitHomework } from '../../data/homework';
import { discardHomeworkFile, homeworkFileMaxBytes, uploadHomeworkFile } from '../../data/homework-files';
import { createPendingHomeworkStore, type HomeworkIntent } from '../../data/pending-homework';
import { useFamily, childName } from '../../ui/family';
import { Button, Card, ErrorCard, Screen, Skeleton, Text, Title } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';
import { useLoad } from '../../ui/use-load';

const pendingStore = createPendingHomeworkStore({ get: SecureStore.getItemAsync, set: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }), remove: SecureStore.deleteItemAsync });
export default function Homework() {
  const params = useLocalSearchParams<{ child?: string | string[]; activity?: string | string[] }>(), family = useFamily();
  const valid = homeworkUuid(params.child) && homeworkUuid(params.activity), child = valid ? family.children.find(row => row.id === params.child) : null;
  if (family.loading) return <Screen><Skeleton /></Screen>;
  if (!valid || !child || family.error) return <Screen><ErrorCard message="This homework link is unavailable for your current school access." /><Button label="Back to learning" secondary onPress={() => router.replace('/(school)/learning')} /></Screen>;
  return <HomeworkDetail key={`${child.id}:${params.activity}`} child={child} activityId={params.activity as string} />;
}
function HomeworkDetail({ child, activityId }: { child: FamilyChild; activityId: string }) {
  const auth = useAuth(), p = usePalette(), alive = useRef(true), operation = useRef<AbortController | null>(null), working = useRef(false);
  const [draft, setDraft] = useState<{ text: string; file: { path: string; name: string } | null } | null>(null);
  const [pendingOverride, setPending] = useState<HomeworkIntent | null | undefined>(undefined);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(''), [storageBlocked, setStorageBlocked] = useState(false);
  const scope = { userId: auth.access!.userId, schoolId: auth.access!.schoolId, studentId: child.id, activityId };
  const read = useCallback(async (signal: AbortSignal) => {
    const work = await getHomework(auth.client!, auth.access!, auth.role, child, activityId, signal);
    const saved = await loadSubmission(auth.client!, auth.access!, auth.role, child, work, signal);
    const intent = auth.role === 'student' ? await pendingStore.read({ userId: auth.access!.userId, schoolId: auth.access!.schoolId, studentId: child.id, activityId }) : null;
    return { work, saved, intent };
  }, [auth.client, auth.access, auth.role, child, activityId]);
  const loaded = useLoad(`${auth.access!.userId}:${auth.role}:${child.id}:${activityId}`, read);
  useEffect(() => { alive.current = true; return () => { alive.current = false; operation.current?.abort(); }; }, []);
  const work = loaded.data?.work, saved = loaded.data?.saved;
  const pending = pendingOverride === undefined ? loaded.data?.intent ?? null : pendingOverride;
  const text = pending?.text ?? draft?.text ?? saved?.text_response ?? '';
  const file = pending ? pending.filePath ? { path: pending.filePath, name: pending.fileName! } : null : draft ? draft.file : saved?.file_path ? { path: saved.file_path, name: saved.file_name! } : null;
  const setText = (value: string) => setDraft({ text: value, file });
  const setFile = (value: { path: string; name: string } | null) => setDraft({ text, file: value });
  const editable = auth.role === 'student' && (saved?.status !== 'graded' || !!pending), locked = busy || !!pending || storageBlocked;
  function back() {
    if (busy) return;
    if (!pending && !storageBlocked && editable && (text !== (saved?.text_response ?? '') || file?.path !== (saved?.file_path ?? undefined))) {
      Alert.alert('Leave this draft?', 'Unsubmitted text will be discarded. Uploaded files stay private; remove an unused attachment before leaving if you do not need it.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard draft', style: 'destructive', onPress: () => { if (alive.current) { setDraft(null); router.replace('/(school)/learning'); } } }]);
    } else router.replace('/(school)/learning');
  }
  async function pickFile() {
    if (!work || !editable || locked || file || working.current) return;
    working.current = true; setBusy(true); setError(''); const controller = new AbortController(); operation.current = controller;
    let cached: File | null = null;
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/jpeg', 'image/png'], copyToCacheDirectory: true, multiple: false });
      if (picked.canceled || !alive.current || controller.signal.aborted) return;
      const selected = picked.assets[0];
      if (!selected?.uri.startsWith(`${Paths.cache.uri.replace(/\/$/, '')}/`)) throw new Error('The selected file could not be copied into the app’s private cache.');
      cached = new File(selected.uri);
      if (!cached.exists || cached.size < 1 || cached.size > homeworkFileMaxBytes) throw new Error('Choose a PDF, JPG or PNG of 10 MB or less.');
      const bytes = await cached.arrayBuffer();
      if (controller.signal.aborted) return;
      const attachment = await uploadHomeworkFile(auth.client!, auth.access!, auth.role, child, work, { name: selected.name, mimeType: selected.mimeType, bytes, id: Crypto.randomUUID() }, controller.signal);
      if (alive.current) setFile(attachment);
    } catch (cause) { if (alive.current) setError(homeworkError(cause)); }
    finally {
      try { if (cached?.exists) await cached.delete(); } catch { /* The private cache is also cleared by the OS. */ }
      if (alive.current) setBusy(false); working.current = false; operation.current = null;
    }
  }
  async function removeFile() {
    if (!file || !work || locked || saved?.file_path === file.path || working.current) return;
    working.current = true; setBusy(true); setError('');
    try { await discardHomeworkFile(auth.client!, work, child, file.path); if (alive.current) setFile(null); }
    catch (cause) { if (alive.current) setError(homeworkError(cause)); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  async function submit() {
    if (!work || !editable || busy || !loaded.data || storageBlocked || working.current) return;
    working.current = true; setBusy(true); setError(''); setMessage(''); let intent: HomeworkIntent | null = pending, recovering = !!pending;
    try {
      const requestId = Crypto.randomUUID();
      intent = pending ?? await pendingStore.prepare(scope, { text, filePath: file?.path ?? null, fileName: file?.name ?? null, expectedRevision: saved?.revision ?? null, requestId });
      recovering ||= intent.requestId !== requestId;
      if (!alive.current) return;
      setPending(intent);
      await submitHomework(auth.client!, auth.access!, auth.role, child, work, intent);
      await pendingStore.complete(scope, intent.requestId);
      if (alive.current) { setDraft(null); setPending(undefined); loaded.reload(); setMessage('Homework saved. Your teacher can now review it.'); }
    } catch (cause) {
      if (!intent) {
        try { intent = await pendingStore.read(scope); if (alive.current) setPending(intent); }
        catch { if (alive.current) { setStorageBlocked(true); setError('Local request status could not be read. Reopen this homework before sending new work.'); } return; }
        recovering = true;
      }
      if (intent && !recovering && definitiveHomeworkError(cause)) {
        try { await pendingStore.complete(scope, intent.requestId); if (alive.current) setPending(null); }
        catch { if (alive.current) setError('The local request status is unconfirmed. Retry the same request before editing.'); return; }
      }
      if (alive.current) setError(homeworkError(cause));
    } finally { working.current = false; if (alive.current) setBusy(false); }
  }
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><Screen>
    <Button label="Back to learning" secondary disabled={busy} icon={<ArrowLeft color={p.primary} size={18} />} onPress={back} />
    <Title title="Homework" subtitle={childName(child)} />
    {loaded.loading ? <Skeleton /> : loaded.error ? <ErrorCard message={loaded.error} retry={loaded.reload} /> : work && <>
      <Card style={{ backgroundColor: p.soft }}><Text style={{ color: p.primary, fontWeight: '600', fontSize: 12 }}>PUBLISHED SCHOOLWORK</Text><Text accessibilityRole="header" style={{ fontSize: 22, lineHeight: 30, fontWeight: '700' }}>{work.title}</Text>{work.description && <Text>{work.description}</Text>}<Text style={{ color: p.muted }}>{work.dueDate ? `Due ${work.dueDate}` : 'No due date'}{work.maxMarks !== null ? ` · Out of ${work.maxMarks}` : ''}</Text></Card>
      {message && <Text accessibilityRole="alert" style={{ color: p.success }}>{message}</Text>}
      {error && <ErrorCard message={error} />}
      {pending && <Card><Text style={{ color: p.warning }}>A saved request is awaiting confirmation. Retry its exact text and attachment; edits stay locked to prevent duplicate submissions, including after an app restart.</Text></Card>}
      {saved && <Card><Text style={{ color: saved.status === 'graded' ? p.success : p.primary, fontWeight: '700' }}>{saved.status === 'graded' ? 'Reviewed by your teacher' : 'Submitted for review'}</Text><Text style={{ color: p.muted }}>Saved {new Date(saved.submitted_at).toLocaleString()}</Text>
        {saved.status === 'graded' && <><Text style={{ fontSize: 22, fontWeight: '700' }}>{saved.marks !== null ? `${saved.marks}${work.maxMarks !== null ? ` / ${work.maxMarks}` : ''}` : 'Feedback only'}</Text><Text>{saved.feedback || 'No written feedback.'}</Text></>}
      </Card>}
      {editable ? <Card><Text nativeID="homework-response" style={{ fontWeight: '600' }}>Your response</Text><TextInput accessibilityLabel="Your homework response" accessibilityLabelledBy="homework-response" value={text} onChangeText={setText} multiline maxLength={10000} editable={!locked} textAlignVertical="top"
        placeholder="Write your answer here…" placeholderTextColor={p.muted} style={{ fontFamily: 'Sora', fontSize: 15, lineHeight: 24, minHeight: 140, padding: 14, color: p.text, backgroundColor: p.bg, borderWidth: 1, borderColor: p.border, borderRadius: 14 }} />
        <Text style={{ fontSize: 12, color: p.muted }}>{text.length} / 10,000 characters</Text>
        {file ? <><Text>{file.name}</Text><Text style={{ color: p.muted, fontSize: 12 }}>Private attachment{saved?.file_path === file.path ? ' · Submitted attachments cannot be replaced' : ''}</Text>{saved?.file_path !== file.path && <Button label="Remove attachment" secondary disabled={locked} onPress={() => void removeFile()} />}</> : work.sectionId && <Button label="Attach PDF or photo" secondary disabled={locked} icon={<Paperclip size={19} color={p.primary} />} onPress={() => void pickFile()} />}
        <Button label={busy ? 'Please wait…' : pending ? 'Retry the same submission' : saved ? 'Save updated response' : 'Submit homework'} disabled={busy || storageBlocked || !loaded.data || (!text.trim() && !file)} onPress={() => void submit()} />
      </Card> : <Card><Text style={{ fontWeight: '600' }}>Student response</Text><Text>{saved?.text_response || 'No text response submitted.'}</Text>{saved?.file_name && <Text style={{ color: p.muted }}>Private attachment: {saved.file_name}</Text>}<Text style={{ color: p.muted, fontSize: 12 }}>{auth.role === 'parent' ? 'Guardian view is read-only. Only the student can submit work.' : 'Reviewed homework is locked. Contact your teacher if you need a correction.'}</Text></Card>}
      <Button label="Reload submission and feedback" secondary disabled={busy || !!pending} onPress={loaded.reload} />
      <Text style={{ color: p.muted, fontSize: 12 }}>Private attachments: PDF, JPG or PNG, up to 10 MB. Original downloads remain on the authenticated school website in this mobile slice. Unsent drafts stay in this app session; switching accounts discards them.</Text>
    </>}
  </Screen></KeyboardAvoidingView>;
}
