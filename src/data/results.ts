import type { SupabaseClient } from '@supabase/supabase-js';
import { listChildren, type FamilyAccess, type FamilyChild, type FamilyRole } from './family';

export const publicationPageSize = 50;
export type PublicationMetadata = {
  assessment_id: string; school_id: string; school_name: string; academic_year_id: string; academic_year_name: string;
  class_id: string; class_name: string; section_id: string | null; section_name: string | null;
  subject_id: string; subject_name: string; teacher_id: string; teacher_name: string; name: string;
  assessment_date: string; maximum_marks: number; assessment_updated_at: string; status: string;
};
export type FamilyAssessmentResult = {
  id: string; assessment_id: string; revision: number; published_at: string; publisher_name: string;
  metadata: PublicationMetadata; student_id: string; student_name: string; admission_no: string; roll_no: string | null;
  marks_obtained: number; maximum_marks: number; percentage: number; remarks: string | null;
};
export type FamilyResultPage = { rows: FamilyAssessmentResult[]; total_count: number; offset: number; student_id: string; school_id: string };
export class ResultPublicationError extends Error {
  constructor(message: string, readonly code = '') { super(message); this.name = 'ResultPublicationError'; }
}
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const nullableText = (value: unknown): value is string | null => value === null || typeof value === 'string';
const timestamp = (value: unknown): value is string => typeof value === 'string' && date(value.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const invalid = () => new ResultPublicationError('The published result records could not be verified. Refresh to try again.');
const privateFields = ['pupils', 'snapshot', 'rank', 'mark_id', 'enrollment_id', 'review_note', 'source_token', 'raw_marks'];
function aborted(signal?: AbortSignal) {
  if (signal?.aborted) { const error = new Error('Request cancelled.'); error.name = 'AbortError'; throw error; }
}
function date(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
function metadata(value: unknown, schoolId: string, assessmentId: string): PublicationMetadata {
  const row = record(value);
  if (row.assessment_id !== assessmentId || row.school_id !== schoolId || ![row.academic_year_id, row.class_id, row.subject_id, row.teacher_id].every(uuid)
    || ![row.school_name, row.academic_year_name, row.class_name, row.subject_name, row.teacher_name, row.name].every(text)
    || !(row.section_id === null && row.section_name === null || uuid(row.section_id) && text(row.section_name))
    || row.status !== 'completed' || !date(row.assessment_date) || !timestamp(row.assessment_updated_at)
    || !finite(row.maximum_marks) || row.maximum_marks <= 0 || privateFields.some(key => key in row)) throw invalid();
  return {
    assessment_id: assessmentId, school_id: schoolId, school_name: row.school_name as string,
    academic_year_id: row.academic_year_id as string, academic_year_name: row.academic_year_name as string,
    class_id: row.class_id as string, class_name: row.class_name as string, section_id: row.section_id as string | null,
    section_name: row.section_name as string | null, subject_id: row.subject_id as string, subject_name: row.subject_name as string,
    teacher_id: row.teacher_id as string, teacher_name: row.teacher_name as string, name: row.name as string,
    assessment_date: row.assessment_date as string, maximum_marks: row.maximum_marks,
    assessment_updated_at: row.assessment_updated_at as string, status: 'completed',
  };
}
function result(value: unknown, pupil: FamilyChild): FamilyAssessmentResult {
  const row = record(value);
  if (!uuid(row.id) || !uuid(row.assessment_id) || row.student_id !== pupil.id || !text(row.publisher_name) || !text(row.student_name) || !text(row.admission_no)
    || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1 || !timestamp(row.published_at)
    || !nullableText(row.roll_no) || !nullableText(row.remarks) || !finite(row.marks_obtained) || !finite(row.maximum_marks)
    || row.maximum_marks <= 0 || row.marks_obtained < 0 || row.marks_obtained > row.maximum_marks || !finite(row.percentage)
    || row.percentage < 0 || row.percentage > 100 || Math.abs(row.percentage - row.marks_obtained / row.maximum_marks * 100) > 0.011
    || 'status' in row && row.status !== 'published' || privateFields.some(key => key in row)) throw invalid();
  const source = metadata(row.metadata, pupil.school_id, row.assessment_id);
  if (row.maximum_marks !== source.maximum_marks) throw invalid();
  return {
    id: row.id, assessment_id: row.assessment_id, revision: row.revision as number, published_at: row.published_at,
    publisher_name: row.publisher_name, metadata: source, student_id: pupil.id, student_name: row.student_name,
    admission_no: row.admission_no, roll_no: row.roll_no, marks_obtained: row.marks_obtained,
    maximum_marks: row.maximum_marks, percentage: row.percentage, remarks: row.remarks,
  };
}
async function scope(client: SupabaseClient, access: FamilyAccess, role: FamilyRole, pupil: FamilyChild, signal?: AbortSignal) {
  aborted(signal);
  if (!uuid(access.userId) || !uuid(access.schoolId) || !uuid(pupil.id) || pupil.school_id !== access.schoolId
    || !['parent', 'student'].includes(role) || !access.roles.includes(role)) throw new ResultPublicationError('Your access to this student could not be verified.', '42501');
  const permitted = await listChildren(client, access, role, signal);
  aborted(signal);
  if (!permitted.some(row => row.id === pupil.id && row.school_id === access.schoolId)) throw new ResultPublicationError('This student is no longer available to your account. Refresh school access.', '42501');
}
function rpcError(error: {code?: string} | null) {
  if (!error) return;
  if (error.code === '42501') throw new ResultPublicationError('Your result access changed. Refresh school access before continuing.', error.code);
  if (['PGRST202', '42883', '42703'].includes(error.code ?? '')) throw new ResultPublicationError('Published results need the latest school update. Contact your administrator.', error.code);
  throw new ResultPublicationError('Published results could not be loaded. Refresh to try again.', error.code);
}
function count(value: unknown) {
  const total = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(total) || total < 0) throw invalid();
  return total;
}
export async function getFamilyAssessmentResults(client: SupabaseClient, access: FamilyAccess, role: FamilyRole, pupil: FamilyChild,
  offset = 0, signal?: AbortSignal): Promise<FamilyResultPage> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 2147483647) throw new ResultPublicationError('Choose a valid results page.', '22023');
  await scope(client, access, role, pupil, signal);
  const query = client.rpc('get_family_assessment_results', { p_student_id: pupil.id, p_offset: offset });
  const response = await (signal ? query.abortSignal(signal) : query);
  aborted(signal); rpcError(response.error);
  const page = record(response.data), total = count(page.total_count);
  if (page.student_id !== pupil.id || page.school_id !== access.schoolId || page.offset !== offset || !Array.isArray(page.rows)
    || page.rows.length > publicationPageSize || page.rows.length > 0 && total < offset + page.rows.length) throw invalid();
  const rows = page.rows.map(value => result(value, pupil));
  if (new Set(rows.map(row => row.id)).size !== rows.length || new Set(rows.map(row => row.assessment_id)).size !== rows.length) throw invalid();
  return { rows, total_count: total, offset, student_id: pupil.id, school_id: access.schoolId };
}
export async function getFamilyNotificationResult(client: SupabaseClient, access: FamilyAccess, role: FamilyRole, pupil: FamilyChild,
  assessmentId: string, signal?: AbortSignal): Promise<FamilyAssessmentResult | null> {
  if (!uuid(assessmentId)) throw new ResultPublicationError('This result link is invalid.', '22023');
  await scope(client, access, role, pupil, signal);
  const query = client.rpc('get_family_notification_result', { p_role: role, p_student_id: pupil.id, p_assessment_id: assessmentId });
  const response = await (signal ? query.abortSignal(signal) : query);
  aborted(signal); rpcError(response.error);
  if (response.data === null) return null;
  const row = result(response.data, pupil);
  if (row.assessment_id !== assessmentId) throw invalid();
  return row;
}
