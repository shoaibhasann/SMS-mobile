import type { SupabaseClient } from '@supabase/supabase-js';
import { listChildren, type FamilyAccess, type FamilyChild, type FamilyRole } from './family';

export const studentLeavePageSize = 50;
export const studentLeaveStatuses = ['pending', 'approved', 'rejected'] as const;
export type StudentLeaveStatus = typeof studentLeaveStatuses[number];
export type StudentLeaveRequest = {
  id: string; school_id: string; student_id: string; student_name: string; admission_no: string;
  academic_year_id: string; academic_year_name: string; class_name: string; section_name: string | null;
  start_date: string; end_date: string; reason: string; status: StudentLeaveStatus;
  requester_id: string; requester_name: string | null; created_at: string; reviewed_by: string | null;
  reviewer_name: string | null; review_note: string | null; reviewed_at: string | null; total_count: number;
};
export type StudentLeaveSubmission = { startDate: string; endDate: string; reason: string; idempotencyKey: string };
export class StudentLeaveError extends Error {
  constructor(message: string, readonly code = '') { super(message); this.name = 'StudentLeaveError'; }
}
export const leaveUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const nullableText = (value: unknown): value is string | null => value === null || typeof value === 'string';
const stamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && isLeaveDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
const invalid = () => new StudentLeaveError('Leave records could not be verified. Refresh to try again.');
function cancelled(signal?: AbortSignal) { if (signal?.aborted) { const error = new Error('Request cancelled.'); error.name = 'AbortError'; throw error; } }
export function isLeaveDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
export function validateStudentLeave(startDate: string, endDate: string, reason: string): string | null {
  if (!isLeaveDate(startDate) || !isLeaveDate(endDate) || startDate > endDate) return 'Use valid YYYY-MM-DD dates, with the end on or after the start.';
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason)) return 'Use ordinary text for the leave reason.';
  const length = Array.from(reason.trim()).length;
  return length < 3 || length > 1000 ? 'Enter a reason between 3 and 1,000 characters.' : null;
}
export function validateLeaveTarget(child: unknown, request: unknown): { child: string | null; request: string | null } {
  if (child !== undefined && !leaveUuid(child) || request !== undefined && !leaveUuid(request) || request !== undefined && child === undefined) throw new StudentLeaveError('This leave link is invalid.', 'validation');
  return { child: typeof child === 'string' ? child : null, request: typeof request === 'string' ? request : null };
}
export function leaveOverlaps(rows: StudentLeaveRequest[], start: string, end: string) {
  return isLeaveDate(start) && isLeaveDate(end) && start <= end && rows.some(row => row.status !== 'rejected' && row.start_date <= end && row.end_date >= start);
}
function count(value: unknown): number {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0) throw invalid();
  return number;
}
function rows(data: unknown, scope: { studentId: string; schoolId: string }, offset: number): StudentLeaveRequest[] {
  if (!Array.isArray(data) || data.length > studentLeavePageSize) throw invalid();
  const ids = new Set<string>(); let total: number | null = null;
  return data.map(value => {
    const row = record(value), totalCount = count(row.total_count), reviewed = row.status !== 'pending';
    if (![row.id, row.school_id, row.student_id, row.academic_year_id, row.requester_id].every(leaveUuid)
      || ![row.student_name, row.admission_no, row.academic_year_name, row.class_name, row.reason].every(text)
      || ![row.section_name, row.requester_name, row.reviewer_name, row.review_note].every(nullableText)
      || !studentLeaveStatuses.includes(row.status as StudentLeaveStatus)
      || !isLeaveDate(row.start_date) || !isLeaveDate(row.end_date) || row.start_date > row.end_date
      || Array.from(String(row.reason).trim()).length < 3 || Array.from(String(row.reason).trim()).length > 1000
      || !stamp(row.created_at) || (reviewed ? !leaveUuid(row.reviewed_by) || !text(row.review_note) || Array.from(row.review_note.trim()).length < 3 || Array.from(row.review_note.trim()).length > 1000 || !stamp(row.reviewed_at) || Date.parse(row.reviewed_at) < Date.parse(String(row.created_at))
        : row.reviewed_by !== null || row.review_note !== null || row.reviewed_at !== null)
      || row.student_id !== scope.studentId || row.school_id !== scope.schoolId || ids.has(String(row.id))
      || totalCount < offset + data.length || total !== null && totalCount !== total) throw invalid();
    total = totalCount; ids.add(row.id as string);
    return { id: row.id as string, school_id: row.school_id as string, student_id: row.student_id as string, student_name: row.student_name as string,
      admission_no: row.admission_no as string, academic_year_id: row.academic_year_id as string, academic_year_name: row.academic_year_name as string,
      class_name: row.class_name as string, section_name: row.section_name as string | null, start_date: row.start_date, end_date: row.end_date,
      reason: row.reason as string, status: row.status as StudentLeaveStatus, requester_id: row.requester_id as string, requester_name: row.requester_name as string | null,
      created_at: row.created_at as string, reviewed_by: row.reviewed_by as string | null, reviewer_name: row.reviewer_name as string | null,
      review_note: row.review_note as string | null, reviewed_at: row.reviewed_at as string | null, total_count: totalCount };
  });
}
async function selectedChild(client: SupabaseClient, access: FamilyAccess, role: FamilyRole, pupil: FamilyChild, signal?: AbortSignal) {
  cancelled(signal);
  if (!leaveUuid(pupil.id) || pupil.school_id !== access.schoolId) throw new StudentLeaveError('Your access to this student could not be verified.', '42501');
  const children = await listChildren(client, access, role, signal);
  if (!children.some(child => child.id === pupil.id && child.school_id === access.schoolId)) throw new StudentLeaveError('Your access to this student could not be verified.', '42501');
  cancelled(signal);
}
function failure(error: { code?: string } | null, submit: boolean) {
  if (!error) return;
  const code = error.code ?? '';
  const message = ['PGRST202', '42883'].includes(code) ? 'Leave requests need a school update. Contact your administrator.'
    : code === '42501' ? 'Your access to this student or school could not be verified. Refresh school access.'
      : code === 'PT409' ? 'This request conflicts with a saved request. Refresh history; pending or approved dates cannot overlap.'
        : code === '22023' ? 'The school could not accept these dates or reason. Dates must be within the current academic year.'
          : submit ? 'Submission could not be confirmed. Retry this same request; your dates and reason are kept.'
            : 'Leave history could not be loaded. Refresh to try again.';
  throw new StudentLeaveError(message, code);
}
async function rpc(client: SupabaseClient, name: string, args: Record<string, unknown>, submit: boolean, signal?: AbortSignal) {
  cancelled(signal);
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 15_000);
  try {
    const result = await client.rpc(name, args).abortSignal(controller.signal);
    cancelled(signal); failure(result.error, submit); return result.data as unknown;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export async function listFamilyStudentLeave(client: SupabaseClient, access: FamilyAccess, role: FamilyRole, pupil: FamilyChild, offset = 0, signal?: AbortSignal) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new StudentLeaveError('Choose a valid history page.', 'validation');
  await selectedChild(client, access, role, pupil, signal);
  return rows(await rpc(client, 'list_family_student_leave', { p_student_id: pupil.id, p_offset: offset }, false, signal), { studentId: pupil.id, schoolId: access.schoolId }, offset);
}
export async function getFamilyNotificationLeave(client: SupabaseClient, access: FamilyAccess, role: FamilyRole, pupil: FamilyChild, requestId: string, signal?: AbortSignal): Promise<StudentLeaveRequest | null> {
  if (!leaveUuid(requestId)) throw new StudentLeaveError('This leave link is invalid.', 'validation');
  await selectedChild(client, access, role, pupil, signal);
  const data = await rpc(client, 'get_family_notification_leave', { p_role: role, p_student_id: pupil.id, p_request_id: requestId }, false, signal);
  if (data === null) return null;
  const row = rows([data], { studentId: pupil.id, schoolId: access.schoolId }, 0)[0];
  if (row.id !== requestId || row.status === 'pending') throw invalid();
  return row;
}
export async function submitStudentLeave(client: SupabaseClient, access: FamilyAccess, role: FamilyRole, pupil: FamilyChild, request: StudentLeaveSubmission, signal?: AbortSignal): Promise<string> {
  const validation = validateStudentLeave(request.startDate, request.endDate, request.reason);
  if (validation || !leaveUuid(request.idempotencyKey)) throw new StudentLeaveError(validation || 'The request reference is invalid.', 'validation');
  await selectedChild(client, access, role, pupil, signal);
  const id = await rpc(client, 'submit_student_leave', { p_student_id: pupil.id, p_start_date: request.startDate, p_end_date: request.endDate,
      p_reason: request.reason.trim(), p_idempotency_key: request.idempotencyKey }, true, signal);
  if (!leaveUuid(id)) throw new StudentLeaveError('Submission could not be confirmed. Retry this same request; your dates and reason are kept.');
  return id;
}
