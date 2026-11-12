import type { SupabaseClient } from '@supabase/supabase-js';
import { listChildren, type FamilyAccess, type FamilyChild, type FamilyRole } from './family';

export const homeworkPageSize = 20;
export type HomeworkActivity = {
  id: string; classLogId: string; schoolId: string; academicYearId: string; classId: string; sectionId: string | null; subjectId: string;
  title: string; description: string | null; dueDate: string | null; maxMarks: number | null; logDate: string;
};
export type HomeworkSubmission = {
  id: string; activity_id: string; student_id: string; text_response: string | null; file_path: string | null; file_name: string | null;
  submitted_at: string; status: 'submitted' | 'graded'; marks: number | null; feedback: string | null; revision: number;
};
export type HomeworkInput = { text: string; filePath: string | null; fileName: string | null; expectedRevision: number | null; requestId: string };
export class HomeworkError extends Error {
  constructor(message: string, public readonly code = 'unverified') { super(message); }
}
export const homeworkUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const optionalText = (value: unknown): value is string | null => value === null || typeof value === 'string';
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith('0000') && Number.isFinite(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const timestamp = (value: unknown): value is string => typeof value === 'string' && date(value.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const invalid = () => new HomeworkError('This homework could not be verified. Refresh school access before continuing.');
export function homeworkCancelled(signal?: AbortSignal) { if (signal?.aborted) { const error = new Error('Homework action cancelled.'); error.name = 'AbortError'; throw error; } }
export function homeworkError(cause: unknown) {
  const code = (cause as { code?: string } | null)?.code;
  if (code === '42501') return 'Your access changed. Refresh school access before continuing.';
  if ((cause as Error | null)?.name === 'AbortError') return 'The school did not respond in time. Retry; your work is kept.';
  if (code === 'PT409' || code === '40001') return 'This work changed in another session. Your draft is kept; reload the saved submission before editing.';
  if (code === '23505') return 'This request was already used for different work. Reload its saved status.';
  if (code === '22023' || code === '23514') return 'Check your response and attachment, then try again.';
  return cause instanceof Error ? cause.message : 'The school could not confirm this action. Retry the same request.';
}
export function definitiveHomeworkError(cause: unknown) { return ['42501', 'PT409', '40001', '23505', '22023', '23514', 'validation'].includes((cause as { code?: string })?.code ?? ''); }
export function homeworkFileScope(activity: HomeworkActivity, studentId: string) {
  const segments = [activity.schoolId, activity.academicYearId, activity.classId, activity.sectionId, activity.subjectId, activity.id, studentId];
  if (!segments.every(homeworkUuid)) throw new HomeworkError('Private attachments require a verified class section. You can still submit a text response.', 'validation');
  return segments as string[];
}
export function checkedHomeworkPath(path: string, activity: HomeworkActivity, studentId: string) {
  const parts = path.split('/'), scope = homeworkFileScope(activity, studentId);
  const ending = parts[7]?.split('.') ?? [];
  if (parts.length !== 8 || !scope.every((part, i) => parts[i] === part) || ending.length !== 2 || !homeworkUuid(ending[0]) || !['pdf', 'png', 'jpg', 'jpeg'].includes(ending[1])) throw invalid();
}
type Placement = { academic_year_id: string; class_id: string; section_id: string };
async function placement(client: SupabaseClient, access: FamilyAccess, role: FamilyRole, child: FamilyChild, signal?: AbortSignal): Promise<Placement | null> {
  if (child.school_id !== access.schoolId || !homeworkUuid(child.id)) throw invalid();
  const children = await listChildren(client, access, role, signal);
  if (!children.some(row => row.id === child.id)) throw new HomeworkError('This child is no longer linked to your account.', '42501');
  const yearQuery = client.from('academic_years').select('id,school_id,is_current').eq('school_id', access.schoolId).eq('is_current', true);
  const year = await (signal ? yearQuery.abortSignal(signal) : yearQuery).maybeSingle();
  homeworkCancelled(signal);
  if (year.error) throw year.error;
  if (year.data === null) return null;
  const current = record(year.data);
  if (!homeworkUuid(current.id) || current.school_id !== access.schoolId || current.is_current !== true) throw invalid();
  const enrollmentQuery = client.from('enrollments').select('student_id,academic_year_id,class_id,section_id,status')
    .eq('student_id', child.id).eq('academic_year_id', current.id).eq('status', 'active');
  const enrollment = await (signal ? enrollmentQuery.abortSignal(signal) : enrollmentQuery).maybeSingle();
  homeworkCancelled(signal);
  if (enrollment.error) throw enrollment.error;
  if (enrollment.data === null) return null;
  const row = record(enrollment.data);
  if (row.student_id !== child.id || row.academic_year_id !== current.id || row.status !== 'active' || !homeworkUuid(row.class_id) || !homeworkUuid(row.section_id)) throw invalid();
  return { academic_year_id: current.id, class_id: row.class_id, section_id: row.section_id };
}
const activityColumns = 'id,class_log_id,activity_type,title,description,due_date,max_marks,class_logs!inner(id,school_id,academic_year_id,class_id,section_id,subject_id,log_date,status,published_at)';
function activity(value: unknown, schoolId: string, scope: Placement): HomeworkActivity {
  const row = record(value), log = record(row.class_logs);
  if (!homeworkUuid(row.id) || !homeworkUuid(row.class_log_id) || log.id !== row.class_log_id || row.activity_type !== 'homework'
    || typeof row.title !== 'string' || !row.title.trim() || !optionalText(row.description) || row.due_date !== null && !date(row.due_date)
    || row.max_marks !== null && !nonnegative(row.max_marks) || log.school_id !== schoolId || log.academic_year_id !== scope.academic_year_id
    || log.class_id !== scope.class_id || log.section_id !== null && log.section_id !== scope.section_id || !homeworkUuid(log.subject_id)
    || !date(log.log_date) || log.status !== 'published' || !timestamp(log.published_at)) throw invalid();
  return { id: row.id, classLogId: row.class_log_id, schoolId, academicYearId: scope.academic_year_id, classId: scope.class_id, sectionId: log.section_id as string | null,
    subjectId: log.subject_id, title: row.title, description: row.description, dueDate: row.due_date as string | null, maxMarks: row.max_marks as number | null, logDate: log.log_date };
}
function scopedActivities(client: SupabaseClient, access: FamilyAccess, scope: Placement) {
  return client.from('class_activities').select(activityColumns, { count: 'exact' }).eq('activity_type', 'homework')
    .eq('class_logs.school_id', access.schoolId).eq('class_logs.academic_year_id', scope.academic_year_id).eq('class_logs.class_id', scope.class_id)
    .or(`section_id.is.null,section_id.eq.${scope.section_id}`, { referencedTable: 'class_logs' }).eq('class_logs.status', 'published');
}
export async function listHomework(client: SupabaseClient, access: FamilyAccess, role: FamilyRole, child: FamilyChild, offset = 0, signal?: AbortSignal) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset % homeworkPageSize !== 0) throw invalid();
  const scope = await placement(client, access, role, child, signal);
  if (!scope) return { rows: [] as HomeworkActivity[], total: 0, offset, placed: false };
  const query = scopedActivities(client, access, scope).order('due_date', { ascending: false, nullsFirst: true }).order('created_at', { ascending: false }).order('id').range(offset, offset + homeworkPageSize - 1);
  const result = await (signal ? query.abortSignal(signal) : query);
  homeworkCancelled(signal);
  if (result.error) throw result.error;
  if (!Array.isArray(result.data) || result.data.length > homeworkPageSize || typeof result.count !== 'number' || !Number.isSafeInteger(result.count) || result.count < 0
    || result.data.length > 0 && result.count < offset + result.data.length) throw invalid();
  const rows = result.data.map(row => activity(row, access.schoolId, scope));
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw invalid();
  return { rows, total: result.count, offset, placed: true };
}

export async function listHomeworkStatuses(client: SupabaseClient, role: FamilyRole, child: FamilyChild, rows: HomeworkActivity[], signal?: AbortSignal) {
  const ids = new Set(rows.map(row => row.id));
  const statuses = new Map<string, HomeworkSubmission['status']>();
  if (!ids.size) return statuses;
  if (ids.size > homeworkPageSize || !homeworkUuid(child.id) || rows.some(row => row.schoolId !== child.school_id || !homeworkUuid(row.id))) throw invalid();
  const query = role === 'student' ? client.rpc('list_my_homework_submissions', { p_activity_ids: [...ids] })
    : client.from('activity_submissions').select('activity_id,student_id,status').eq('student_id', child.id).in('activity_id', [...ids]);
  const result = await (signal ? query.abortSignal(signal) : query);
  homeworkCancelled(signal);
  if (result.error) throw result.error;
  if (!Array.isArray(result.data) || result.data.length > ids.size) throw invalid();
  for (const value of result.data) {
    const row = record(value);
    if (row.student_id !== child.id || typeof row.activity_id !== 'string' || !ids.has(row.activity_id)
      || statuses.has(row.activity_id) || (row.status !== 'submitted' && row.status !== 'graded')) throw invalid();
    statuses.set(row.activity_id, row.status);
  }
  return statuses;
}

export async function getHomework(client: SupabaseClient, access: FamilyAccess, role: FamilyRole, child: FamilyChild, id: string, signal?: AbortSignal): Promise<HomeworkActivity> {
  if (!homeworkUuid(id)) throw invalid();
  const scope = await placement(client, access, role, child, signal);
  if (!scope) throw invalid();
  const query = scopedActivities(client, access, scope).eq('id', id);
  const result = await (signal ? query.abortSignal(signal) : query).maybeSingle();
  homeworkCancelled(signal);
  if (result.error) throw result.error;
  const row = activity(result.data, access.schoolId, scope);
  if (row.id !== id) throw invalid();
  return row;
}
// Homework inbox rows carry no student_id, so find the linked child whose current placement contains this activity.
export async function resolveHomeworkChild(client: SupabaseClient, access: FamilyAccess, role: FamilyRole, children: readonly FamilyChild[], id: string, signal?: AbortSignal): Promise<FamilyChild> {
  if (!homeworkUuid(id)) throw invalid();
  for (const child of children) {
    const scope = await placement(client, access, role, child, signal);
    if (!scope) continue;
    const query = scopedActivities(client, access, scope).eq('id', id);
    const result = await (signal ? query.abortSignal(signal) : query).maybeSingle();
    homeworkCancelled(signal);
    if (result.error) throw result.error;
    if (result.data !== null) return child;
  }
  throw new HomeworkError('This homework is not available for your linked children. Refresh updates or contact your school.', 'unavailable');
}
function submission(value: unknown, work: HomeworkActivity, child: FamilyChild): HomeworkSubmission {
  const row = record(value);
  if (!homeworkUuid(row.id) || row.activity_id !== work.id || row.student_id !== child.id || !optionalText(row.text_response) || !optionalText(row.file_path) || !optionalText(row.file_name)
    || !timestamp(row.submitted_at) || !['submitted', 'graded'].includes(row.status as string)
    || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0 || row.marks !== null && (!nonnegative(row.marks) || work.maxMarks !== null && row.marks > work.maxMarks)
    || !optionalText(row.feedback) || row.status === 'submitted' && (row.marks !== null || row.feedback !== null) || (row.file_path === null) !== (row.file_name === null)
    || !(typeof row.text_response === 'string' && row.text_response.trim()) && !row.file_path) throw invalid();
  if (typeof row.file_path === 'string') checkedHomeworkPath(row.file_path, work, child.id);
  return { id: row.id, activity_id: work.id, student_id: child.id, text_response: row.text_response, file_path: row.file_path, file_name: row.file_name,
    submitted_at: row.submitted_at, status: row.status as HomeworkSubmission['status'], marks: row.marks as number | null, feedback: row.feedback, revision: row.revision as number };
}
export async function loadSubmission(client: SupabaseClient, access: FamilyAccess, role: FamilyRole, child: FamilyChild, work: HomeworkActivity, signal?: AbortSignal) {
  const current = await getHomework(client, access, role, child, work.id, signal);
  const query = role === 'student' ? client.rpc('list_my_homework_submissions', { p_activity_ids: [work.id] })
    : client.from('activity_submissions').select('id,activity_id,student_id,text_response,file_path,file_name,submitted_at,status,marks,feedback,revision').eq('activity_id', work.id).eq('student_id', child.id).limit(2);
  const result = await (signal ? query.abortSignal(signal) : query);
  homeworkCancelled(signal);
  if (result.error) throw result.error;
  if (!Array.isArray(result.data) || result.data.length > 1) throw invalid();
  return result.data.length ? submission(result.data[0], current, child) : null;
}
export async function submitHomework(client: SupabaseClient, access: FamilyAccess, role: FamilyRole, child: FamilyChild, work: HomeworkActivity, input: HomeworkInput, signal?: AbortSignal) {
  if (role !== 'student') throw new HomeworkError('Only the student can submit homework.', '42501');
  const current = await getHomework(client, access, role, child, work.id, signal);
  if (!homeworkUuid(input.requestId) || typeof input.text !== 'string' || input.text.trim().length > 10000 || !optionalText(input.filePath) || !optionalText(input.fileName)
    || (!input.text.trim() && !input.filePath) || (input.filePath === null) !== (input.fileName === null)
    || input.expectedRevision !== null && (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)) throw new HomeworkError('Add a response or PDF, JPG or PNG attachment (text up to 10,000 characters).', 'validation');
  if (input.filePath) checkedHomeworkPath(input.filePath, current, child.id);
  homeworkCancelled(signal);
  const query = client.rpc('submit_homework', { p_activity_id: work.id, p_text_response: input.text.trim() || null, p_file_path: input.filePath,
    p_file_name: input.fileName, p_expected_revision: input.expectedRevision, p_request_id: input.requestId });
  const result = await (signal ? query.abortSignal(signal) : query);
  homeworkCancelled(signal);
  if (result.error) throw result.error;
  const row = record(result.data);
  if (!homeworkUuid(row.id) || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0 || !['submitted', 'graded'].includes(row.status as string)) throw new HomeworkError('Submission was not confirmed. Retry this exact request before editing.', 'unknown');
  return { id: row.id, revision: row.revision as number, status: row.status as HomeworkSubmission['status'] };
}
