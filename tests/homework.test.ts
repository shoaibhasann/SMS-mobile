import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { checkedHomeworkPath, getHomework, homeworkFileScope, listHomework, listHomeworkStatuses, loadSubmission, submitHomework, type HomeworkActivity } from '../src/data/homework';
import { discardHomeworkFile, homeworkBucket, homeworkFileMaxBytes, uploadHomeworkFile, validateHomeworkBytes } from '../src/data/homework-files';
import { createPendingHomeworkStore, type HomeworkIntentScope } from '../src/data/pending-homework';
import type { FamilyAccess, FamilyChild, FamilyRole } from '../src/data/family';

const id = (n: number) => `61000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const stamp = '2026-11-06T15:00:00.123456+00:00';
const child: FamilyChild = { id: id(3), school_id: id(2), admission_no: 'QA-001', first_name: 'QA child', middle_name: null, last_name: null, roll_no: '1', status: 'active' };
const log = (patch: Record<string, unknown> = {}) => ({ id: id(10), school_id: id(2), academic_year_id: id(5), class_id: id(6), section_id: id(7), subject_id: id(8), log_date: '2026-11-06', status: 'published', published_at: stamp, ...patch });
const activity = (patch: Record<string, unknown> = {}) => ({ id: id(9), class_log_id: id(10), activity_type: 'homework', title: 'Equivalent fractions', description: 'Show your working.', due_date: '2026-11-20', max_marks: 100, class_logs: log(), ...patch });
const work: HomeworkActivity = { id: id(9), classLogId: id(10), schoolId: id(2), academicYearId: id(5), classId: id(6), sectionId: id(7), subjectId: id(8), title: 'Equivalent fractions', description: 'Show your working.', dueDate: '2026-11-20', maxMarks: 100, logDate: '2026-11-06' };
const input = { text: 'My complete answer', filePath: null, fileName: null, expectedRevision: null, requestId: id(20) };
const filePath = [...[2, 5, 6, 7, 8, 9, 3].map(id), `${id(21)}.pdf`].join('/');
const submission = (patch: Record<string, unknown> = {}) => ({ id: id(11), activity_id: id(9), student_id: id(3), text_response: 'Saved answer', file_path: null, file_name: null, submitted_at: stamp, status: 'submitted', marks: null, feedback: null, revision: 1, ...patch });
type Reply = { data: unknown; error: { code: string; message?: string } | null; count?: number };
type Query = { table: string; filters: [string, unknown][]; single: boolean; range?: [number, number]; selection: string; signal?: AbortSignal; or?: [string, unknown] };
function fixture(role: FamilyRole = 'student') {
  const access: FamilyAccess = { userId: id(1), schoolId: id(2), name: 'QA family', roles: [role] };
  const patches: Record<string, Reply> = {}, rpcPatches: Record<string, Reply> = {}, queries: Query[] = [];
  const auth = vi.fn(async () => ({ data: { user: { id: id(1), is_anonymous: false, email_confirmed_at: stamp } }, error: null }));
  const rpc = vi.fn((name: string, _args: unknown) => {
    const reply = rpcPatches[name] ?? { data: name === 'get_family_notification_unread_count' ? 0 : name === 'list_my_homework_submissions' ? [submission()] : { id: id(11), revision: 1, status: 'submitted' }, error: null };
    return Object.assign(Promise.resolve(reply), { abortSignal: (signal: AbortSignal) => { signals.push(signal); return Promise.resolve(reply); } });
  });
  const signals: AbortSignal[] = [];
  const from = vi.fn((table: string) => {
    const q: Query = { table, filters: [], single: false, selection: '' }; queries.push(q);
    const builder = { select: (selection: string) => { q.selection = selection; return builder; }, eq: (column: string, value: unknown) => { q.filters.push([column, value]); return builder; },
      in: (column: string, value: unknown) => { q.filters.push([column, value]); return builder; }, or: (filter: string, options: unknown) => { q.or = [filter, options]; return builder; },
      order: () => builder, limit: () => builder, range: (first: number, last: number) => { q.range = [first, last]; return builder; },
      maybeSingle: () => { q.single = true; return builder; }, abortSignal: (signal: AbortSignal) => { q.signal = signal; return builder; },
      then: (resolve: (value: Reply) => unknown, reject: (error: unknown) => unknown) => {
        const reply = patches[table] ?? (table === 'profiles' ? { data: { id: id(1), school_id: id(2), full_name: 'QA family', is_active: true }, error: null }
          : table === 'parents' ? { data: { id: id(4), school_id: id(2), profile_id: id(1) }, error: null }
            : table === 'student_parents' ? { data: [{ student_id: id(3) }], count: 1, error: null }
              : table === 'students' ? { data: q.single ? { ...child, profile_id: id(1) } : [child], error: null }
                : table === 'academic_years' ? { data: { id: id(5), school_id: id(2), is_current: true }, error: null }
                  : table === 'enrollments' ? { data: { student_id: id(3), academic_year_id: id(5), class_id: id(6), section_id: id(7), status: 'active' }, error: null }
                    : table === 'class_activities' ? { data: q.single ? activity() : [activity()], count: 1, error: null }
                      : { data: [submission()], error: null });
        return Promise.resolve(reply).then(resolve, reject);
      } };
    return builder;
  });
  const upload = vi.fn(async (path: string, _bytes: ArrayBuffer, _options: unknown): Promise<Reply> => ({ data: { path }, error: null }));
  const remove = vi.fn(async (paths: string[]): Promise<Reply> => ({ data: paths.map(name => ({ name })), error: null }));
  const storageFrom = vi.fn(() => ({ upload, remove }));
  return { client: { auth: { getUser: auth }, from, rpc, storage: { from: storageFrom } } as unknown as SupabaseClient, access, patches, rpcPatches, queries, auth, rpc, from, signals, upload, remove, storageFrom };
}
const buffer = (header: number[], length = header.length) => { const bytes = new Uint8Array(length); bytes.set(header); return bytes.buffer; };
const pdf = () => buffer([37, 80, 68, 70, 45, 49, 46, 55]);

describe('published family homework data', () => {
  it('gets only the selected child’s homework statuses and rejects mixed child responses', async () => {
    const guardian = fixture('parent'), student = fixture();
    expect(await listHomeworkStatuses(student.client, 'student', child, [work])).toEqual(new Map([[work.id, 'submitted']]));
    expect(student.rpc).toHaveBeenCalledWith('list_my_homework_submissions', { p_activity_ids: [work.id] });
    expect(await listHomeworkStatuses(guardian.client, 'parent', child, [work])).toEqual(new Map([[work.id, 'submitted']]));
    expect(guardian.queries[0]).toMatchObject({ table: 'activity_submissions', selection: 'activity_id,student_id,status',
      filters: [['student_id', child.id], ['activity_id', [work.id]]] });
    guardian.patches.activity_submissions = { data: [submission({ student_id: id(99) })], error: null };
    await expect(listHomeworkStatuses(guardian.client, 'parent', child, [work])).rejects.toThrow('could not be verified');
  });

  it('uses the actual current enrollment tuple and exact section-or-class publication filters', async () => {
    const f = fixture(), signal = new AbortController().signal;
    expect(await listHomework(f.client, f.access, 'student', child, 0, signal)).toEqual({ rows: [work], total: 1, offset: 0 });
    expect(f.queries.find(q => q.table === 'enrollments')?.filters).toEqual([['student_id', id(3)], ['academic_year_id', id(5)], ['status', 'active']]);
    const query = f.queries.find(q => q.table === 'class_activities')!;
    expect(query.filters).toEqual([['activity_type', 'homework'], ['class_logs.school_id', id(2)], ['class_logs.academic_year_id', id(5)], ['class_logs.class_id', id(6)], ['class_logs.status', 'published']]);
    expect(query.or).toEqual([`section_id.is.null,section_id.eq.${id(7)}`, { referencedTable: 'class_logs' }]);
    expect(query.range).toEqual([0, 19]); expect(query.signal).toBe(signal);
  });
  it('whitelists activity fields and permits class-wide text homework without inventing a section', async () => {
    const f = fixture(); f.patches.class_activities = { data: activity({ class_logs: log({ section_id: null }), private_note: 'omit', attachment_secret: 'omit' }), error: null };
    expect(await getHomework(f.client, f.access, 'student', child, id(9))).toEqual({ ...work, sectionId: null });
    expect(() => homeworkFileScope({ ...work, sectionId: null }, child.id)).toThrow('verified class section');
  });
  it('returns an empty page for absent current enrollment without querying other class homework', async () => {
    for (const table of ['academic_years', 'enrollments']) {
      const f = fixture(); f.patches[table] = { data: null, error: null };
      expect(await listHomework(f.client, f.access, 'student', child)).toEqual({ rows: [], total: 0, offset: 0 });
      expect(f.queries.some(q => q.table === 'class_activities')).toBe(false);
    }
  });
  it.each([
    { id: 'bad' }, { class_log_id: id(99) }, { activity_type: 'classwork' }, { title: '   ' }, { due_date: '2026-02-30' }, { max_marks: '100' }, { max_marks: NaN }, { max_marks: -1 },
    { class_logs: log({ school_id: id(99) }) }, { class_logs: log({ academic_year_id: id(99) }) }, { class_logs: log({ class_id: id(99) }) }, { class_logs: log({ section_id: id(99) }) },
    { class_logs: log({ subject_id: 'bad' }) }, { class_logs: log({ log_date: '2026-02-30' }) }, { class_logs: log({ status: 'draft' }) }, { class_logs: log({ published_at: 'not-a-time' }) },
  ])('rejects malformed or cross-tuple published activity %j', async patch => {
    const f = fixture(); f.patches.class_activities = { data: activity(patch), error: null };
    await expect(getHomework(f.client, f.access, 'student', child, id(9))).rejects.toThrow('could not be verified');
  });
  it('rejects a rollover publication timestamp instead of normalizing it to a different day', async () => {
    const f = fixture(); f.patches.class_activities = { data: activity({ class_logs: log({ published_at: '2026-02-30T00:00:00Z' }) }), error: null };
    await expect(getHomework(f.client, f.access, 'student', child, id(9))).rejects.toThrow();
  });
  it('rejects duplicate/unaccounted pages and direct-link substitution', async () => {
    const f = fixture(); f.patches.class_activities = { data: [activity(), activity()], count: 2, error: null };
    await expect(listHomework(f.client, f.access, 'student', child)).rejects.toThrow();
    f.patches.class_activities = { data: [activity()], count: 0, error: null };
    await expect(listHomework(f.client, f.access, 'student', child)).rejects.toThrow();
    f.patches.class_activities = { data: activity({ id: id(99) }), error: null };
    await expect(getHomework(f.client, f.access, 'student', child, id(9))).rejects.toThrow();
    await expect(listHomework(f.client, f.access, 'student', child, 1)).rejects.toThrow();
  });
  it('fails closed on foreign current year/enrollment and revoked role before any homework RPC', async () => {
    for (const [table, data] of [['academic_years', { id: id(5), school_id: id(99), is_current: true }], ['enrollments', { student_id: id(99), academic_year_id: id(5), class_id: id(6), section_id: id(7), status: 'active' }]] as const) {
      const f = fixture(); f.patches[table] = { data, error: null };
      await expect(getHomework(f.client, f.access, 'student', child, id(9))).rejects.toThrow(); expect(f.queries.some(q => q.table === 'class_activities')).toBe(false);
    }
    const revoked = fixture(); revoked.rpcPatches.get_family_notification_unread_count = { data: null, error: { code: '42501' } };
    await expect(submitHomework(revoked.client, revoked.access, 'student', child, work, input)).rejects.toThrow('family access');
    expect(revoked.rpc.mock.calls.some(([name]) => name === 'submit_homework')).toBe(false);
  });
  it('keeps Guardian submission reads explicitly filtered by child and activity; Student uses the guarded RPC', async () => {
    const guardian = fixture('parent');
    expect(await loadSubmission(guardian.client, guardian.access, 'parent', child, work)).toEqual(submission());
    expect(guardian.queries.find(q => q.table === 'activity_submissions')?.filters).toEqual([['activity_id', id(9)], ['student_id', id(3)]]);
    expect(guardian.rpc.mock.calls.some(([name]) => name === 'list_my_homework_submissions')).toBe(false);
    const student = fixture(); expect(await loadSubmission(student.client, student.access, 'student', child, work)).toEqual(submission());
    expect(student.rpc).toHaveBeenCalledWith('list_my_homework_submissions', { p_activity_ids: [id(9)] });
    await expect(submitHomework(guardian.client, guardian.access, 'parent', child, work, input)).rejects.toThrow('Only the student');
    expect(guardian.rpc.mock.calls.some(([name]) => name === 'submit_homework')).toBe(false);
  });
  it.each([
    { id: 'bad' }, { activity_id: id(99) }, { student_id: id(99) }, { status: 'published' }, { marks: 20 }, { feedback: 'Unreviewed feedback' }, { revision: -1 },
    { status: 'graded', marks: -1 }, { status: 'graded', marks: 101 }, { status: 'graded', marks: '90' }, { file_path: filePath, file_name: null },
  ])('rejects an incoherent submission %j', async patch => {
    const f = fixture(); f.rpcPatches.list_my_homework_submissions = { data: [submission(patch)], error: null };
    await expect(loadSubmission(f.client, f.access, 'student', child, work)).rejects.toThrow('could not be verified');
  });
  it('rejects rollover submission dates and an empty response with no attachment', async () => {
    for (const patch of [{ submitted_at: '2026-02-30T00:00:00Z' }, { text_response: null }]) {
      const f = fixture(); f.rpcPatches.list_my_homework_submissions = { data: [submission(patch)], error: null };
      await expect(loadSubmission(f.client, f.access, 'student', child, work)).rejects.toThrow();
    }
  });
  it('whitelists feedback records and sends the exact idempotency/revision payload', async () => {
    const f = fixture(); f.rpcPatches.list_my_homework_submissions = { data: [submission({ status: 'graded', marks: 85, feedback: 'Clear working.', private_note: 'omit' })], error: null };
    expect(await loadSubmission(f.client, f.access, 'student', child, work)).toEqual(submission({ status: 'graded', marks: 85, feedback: 'Clear working.' }));
    expect(await submitHomework(f.client, f.access, 'student', child, work, { ...input, text: '  My complete answer  ', expectedRevision: 1 })).toEqual({ id: id(11), revision: 1, status: 'submitted' });
    expect(f.rpc).toHaveBeenCalledWith('submit_homework', { p_activity_id: id(9), p_text_response: input.text, p_file_path: null, p_file_name: null, p_expected_revision: 1, p_request_id: id(20) });
    for (const patch of [{ requestId: 'bad' }, { text: '' }, { text: 'a'.repeat(10001) }, { expectedRevision: -1 }, { filePath: filePath }]) await expect(submitHomework(f.client, f.access, 'student', child, work, { ...input, ...patch })).rejects.toThrow();
  });
  it('propagates cancellation before writes and never borrows another account scope', async () => {
    const f = fixture(), controller = new AbortController(); controller.abort();
    await expect(submitHomework(f.client, f.access, 'student', child, work, input, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.rpc).not.toHaveBeenCalled();
    await expect(getHomework(f.client, { ...f.access, schoolId: id(99) }, 'student', child, id(9))).rejects.toThrow();
    await expect(submitHomework(f.client, { ...f.access, roles: ['parent'] }, 'student', child, work, input)).rejects.toThrow();
    expect(f.rpc.mock.calls.some(([name]) => name === 'submit_homework')).toBe(false);
  });
});

describe('private homework file boundaries', () => {
  it('requires canonical full-scope paths and rejects traversal, foreign children, and unsupported suffixes', () => {
    expect(() => checkedHomeworkPath(filePath, work, child.id)).not.toThrow();
    for (const path of [filePath.replace(id(3), id(99)), filePath.replace('.pdf', '.exe'), `${filePath}/..`, filePath.replace('.pdf', '.backup.pdf'), filePath.replace(id(7), 'null')]) expect(() => checkedHomeworkPath(path, work, child.id)).toThrow();
  });
  it('checks real file signatures, MIME agreement, the 10 MB boundary, and safe display names', () => {
    expect(validateHomeworkBytes('../answer?.PDF', 'application/pdf', pdf())).toMatchObject({ ext: 'pdf', mimeType: 'application/pdf' });
    expect(validateHomeworkBytes('../answer?.PDF', 'application/pdf', pdf()).name).not.toMatch(/[\\/?:]/);
    expect(validateHomeworkBytes('photo.png', undefined, buffer([137, 80, 78, 71, 13, 10, 26, 10])).mimeType).toBe('image/png');
    expect(validateHomeworkBytes('photo.jpg', 'image/jpeg', buffer([255, 216, 255])).mimeType).toBe('image/jpeg');
    expect(validateHomeworkBytes('full.pdf', undefined, buffer([37, 80, 68, 70, 45], homeworkFileMaxBytes)).ext).toBe('pdf');
    for (const [name, mime, bytes] of [['fake.pdf', undefined, buffer([0, 1, 2])], ['wrong.pdf', 'image/png', pdf()], ['bad.svg', undefined, pdf()], ['empty.pdf', undefined, new ArrayBuffer(0)], ['big.pdf', undefined, buffer([37, 80, 68, 70, 45], homeworkFileMaxBytes + 1)]] as const) expect(() => validateHomeworkBytes(name, mime, bytes)).toThrow();
  });
  it('uploads only after current Student scope is verified, with non-public/non-overwriting storage options', async () => {
    const f = fixture(), bytes = pdf();
    expect(await uploadHomeworkFile(f.client, f.access, 'student', child, work, { name: 'answer.pdf', mimeType: 'application/pdf', bytes, id: id(21) })).toEqual({ path: filePath, name: 'answer.pdf', size: bytes.byteLength, mimeType: 'application/pdf' });
    expect(f.storageFrom).toHaveBeenCalledWith(homeworkBucket); expect(f.upload).toHaveBeenCalledWith(filePath, bytes, { contentType: 'application/pdf', cacheControl: '0', upsert: false });
    const guardian = fixture('parent'); await expect(uploadHomeworkFile(guardian.client, guardian.access, 'parent', child, work, { name: 'a.pdf', bytes, id: id(21) })).rejects.toThrow('Only the student'); expect(guardian.storageFrom).not.toHaveBeenCalled();
    const revoked = fixture(); revoked.rpcPatches.get_family_notification_unread_count = { data: null, error: { code: '42501' } };
    await expect(uploadHomeworkFile(revoked.client, revoked.access, 'student', child, work, { name: 'a.pdf', bytes, id: id(21) })).rejects.toThrow(); expect(revoked.upload).not.toHaveBeenCalled();
  });
  it('removes its known uploaded object when cancellation arrives after upload acknowledgment', async () => {
    const f = fixture(), controller = new AbortController();
    f.upload.mockImplementation(async path => { controller.abort(); return { data: { path }, error: null }; });
    await expect(uploadHomeworkFile(f.client, f.access, 'student', child, work, { name: 'answer.pdf', bytes: pdf(), id: id(21) }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.remove).toHaveBeenCalledWith([filePath]);
  });
  it('rejects mismatched upload/removal acknowledgments and validates a removal path before touching storage', async () => {
    const f = fixture(); f.upload.mockResolvedValue({ data: { path: 'wrong/path' }, error: null });
    await expect(uploadHomeworkFile(f.client, f.access, 'student', child, work, { name: 'answer.pdf', bytes: pdf(), id: id(21) })).rejects.toThrow('not confirmed');
    f.remove.mockResolvedValue({ data: [], error: null }); await expect(discardHomeworkFile(f.client, work, child, filePath)).rejects.toThrow('not confirmed');
    vi.clearAllMocks(); await expect(discardHomeworkFile(f.client, work, child, filePath.replace(id(3), id(99)))).rejects.toThrow(); expect(f.storageFrom).not.toHaveBeenCalled();
  });
});

const scope: HomeworkIntentScope = { userId: id(1), schoolId: id(2), studentId: id(3), activityId: id(9) };
function pendingFixture() {
  const values = new Map<string, string>();
  const store = { get: vi.fn(async (key: string) => values.get(key) ?? null), set: vi.fn(async (key: string, value: string) => { values.set(key, value); }), remove: vi.fn(async (key: string) => { values.delete(key); }) };
  return { values, store, pending: createPendingHomeworkStore(store) };
}
describe('unknown homework intent persistence', () => {
  it('restores the same payload/key on restart, ignores a newly offered key, and locks edits', async () => {
    const f = pendingFixture(), saved = await f.pending.prepare(scope, input), restarted = createPendingHomeworkStore(f.store);
    expect(await restarted.prepare(scope, { ...input, requestId: id(99), text: ' My complete answer ' })).toEqual(saved);
    await expect(restarted.prepare(scope, { ...input, text: 'Changed answer' })).rejects.toThrow('locked');
    await expect(restarted.complete(scope, id(99))).rejects.toThrow(); expect(await restarted.read(scope)).toEqual(saved);
    await restarted.complete(scope, id(20)); expect(await restarted.read(scope)).toBeNull(); expect(f.values.size).toBe(0);
  });
  it('isolates user/school/child/activity and fails closed instead of dropping corrupt pending records', async () => {
    const f = pendingFixture(); await f.pending.prepare(scope, input);
    for (const patch of [{ userId: id(99) }, { schoolId: id(99) }, { studentId: id(99) }, { activityId: id(99) }]) expect(await f.pending.read({ ...scope, ...patch })).toBeNull();
    const chunk = [...f.values.keys()].find(key => key.endsWith('.0'))!; f.values.delete(chunk);
    await expect(f.pending.read(scope)).rejects.toThrow('could not be verified');
    await expect(f.pending.prepare(scope, input)).rejects.toThrow();
  });
  it('keeps each Unicode native chunk small and whitelists the persisted intent', async () => {
    const f = pendingFixture(), text = '😀'.repeat(4000);
    const saved = await f.pending.prepare(scope, { ...input, text, private_note: 'omit' } as typeof input);
    expect(saved).not.toHaveProperty('private_note'); expect((await f.pending.read(scope))?.text).toBe(text);
    expect(f.store.set.mock.calls.every(([, value]) => new TextEncoder().encode(value).length <= 1800)).toBe(true);
  });
  it('recovers a pointer write that committed before rejection without creating another request identity', async () => {
    const f = pendingFixture(); f.store.set.mockImplementation(async (key, value) => { f.values.set(key, value); if (key.endsWith(scope.activityId)) throw new Error('Unknown native acknowledgment'); });
    await expect(f.pending.prepare(scope, input)).rejects.toThrow();
    expect((await createPendingHomeworkStore(f.store).prepare(scope, { ...input, requestId: id(99) })).requestId).toBe(input.requestId);
  });
  it('serializes parallel prepares and confirms deletion after a lost native deletion acknowledgment', async () => {
    const f = pendingFixture(); const [one, two] = await Promise.all([f.pending.prepare(scope, input), f.pending.prepare(scope, { ...input, requestId: id(99) })]);
    expect(one.requestId).toBe(two.requestId);
    f.store.remove.mockImplementation(async key => { f.values.delete(key); if (key.endsWith(scope.activityId)) throw new Error('Lost delete acknowledgment'); });
    await f.pending.complete(scope, input.requestId);
    expect(await f.pending.read(scope)).toBeNull();
  });
});
