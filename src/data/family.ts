import type { SupabaseClient } from '@supabase/supabase-js';

export type FamilyRole = 'parent' | 'student';
export type FamilyAccess = { userId: string; name: string; schoolId: string; roles: FamilyRole[] };
export type FamilyChild = {
  id: string; school_id: string; admission_no: string; first_name: string;
  middle_name: string | null; last_name: string | null; roll_no: string | null; status: string;
};
export const attendanceStatuses = ['present', 'absent', 'late', 'half_day', 'leave', 'holiday'] as const;
export type AttendanceStatus = (typeof attendanceStatuses)[number];
export type AttendanceRow = { attendance_date: string; academic_year_id: string; status: AttendanceStatus };
export const attendanceLabels: Record<AttendanceStatus, string> = {
  present: 'Present', absent: 'Absent', late: 'Late', half_day: 'Half day', leave: 'On leave', holiday: 'Holiday',
};

const studentColumns = 'id,school_id,admission_no,first_name,middle_name,last_name,roll_no,status';
const validUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const nullableText = (value: unknown): value is string | null => value === null || typeof value === 'string';
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const denied = () => new Error('Your family access could not be verified. Sign in again or contact your school.');
const invalid = () => new Error('The saved school records could not be verified. Refresh to try again.');
function cancelled(signal?: AbortSignal) {
  if (signal?.aborted) { const error = new Error('Request cancelled.'); error.name = 'AbortError'; throw error; }
}
function verified(user: { is_anonymous?: boolean; email_confirmed_at?: string; phone_confirmed_at?: string } | null) {
  return user && user.is_anonymous !== true && [user.email_confirmed_at, user.phone_confirmed_at].some(value => typeof value === 'string' && Number.isFinite(Date.parse(value)));
}
function pageCount(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalid();
  return value;
}
function assertRole(access: FamilyAccess, role: FamilyRole) {
  if (!validUuid(access.userId) || !validUuid(access.schoolId) || !['parent', 'student'].includes(role) || !access.roles.includes(role)) throw denied();
}
async function scopedIdentity(client: SupabaseClient, signal?: AbortSignal) {
  cancelled(signal);
  const { data: { user }, error } = await client.auth.getUser();
  cancelled(signal);
  if (error || !user || !validUuid(user.id) || !verified(user)) throw denied();
  const query = client.from('profiles').select('id,school_id,full_name,is_active').eq('id', user.id);
  const profile = await (signal ? query.abortSignal(signal) : query).maybeSingle();
  cancelled(signal);
  const row = record(profile.data);
  if (profile.error || row.id !== user.id || row.is_active !== true || !validUuid(row.school_id) || !nullableText(row.full_name)) throw denied();
  return { userId: user.id, schoolId: row.school_id, name: typeof row.full_name === 'string' && row.full_name.trim() ? row.full_name.trim() : 'School account' };
}
async function checkedRole(client: SupabaseClient, role: FamilyRole, signal?: AbortSignal) {
  cancelled(signal);
  const query = client.rpc('get_family_notification_unread_count', { p_role: role });
  const response = await (signal ? query.abortSignal(signal) : query);
  cancelled(signal);
  if (response.error) throw denied();
  const count = typeof response.data === 'string' && /^\d+$/.test(response.data) ? Number(response.data) : response.data;
  pageCount(count);
}
async function currentScope(client: SupabaseClient, access: FamilyAccess, role: FamilyRole, signal?: AbortSignal) {
  assertRole(access, role);
  const identity = await scopedIdentity(client, signal);
  if (identity.userId !== access.userId || identity.schoolId !== access.schoolId) throw denied();
  await checkedRole(client, role, signal);
}

export async function readFamilyAccess(client: SupabaseClient, signal?: AbortSignal): Promise<FamilyAccess> {
  const identity = await scopedIdentity(client, signal);
  const query = client.from('user_roles').select('user_id,school_id,role').eq('user_id', identity.userId)
    .eq('school_id', identity.schoolId).in('role', ['parent', 'student']);
  const response = await (signal ? query.abortSignal(signal) : query);
  cancelled(signal);
  if (response.error || !Array.isArray(response.data)) throw denied();
  const roles = new Set<FamilyRole>();
  for (const value of response.data) {
    const row = record(value);
    if (row.user_id !== identity.userId || row.school_id !== identity.schoolId || !['parent', 'student'].includes(row.role as string)) throw denied();
    roles.add(row.role as FamilyRole);
  }
  const permitted = (['parent', 'student'] as const).filter(role => roles.has(role));
  if (!permitted.length) throw denied();
  await Promise.all(permitted.map(role => checkedRole(client, role, signal)));
  cancelled(signal);
  return { ...identity, roles: permitted };
}

function child(value: unknown, access: FamilyAccess): FamilyChild {
  const row = record(value);
  if (!validUuid(row.id) || row.school_id !== access.schoolId || !text(row.admission_no) || !text(row.first_name) || !text(row.status)
    || !nullableText(row.middle_name) || !nullableText(row.last_name) || !nullableText(row.roll_no)) throw invalid();
  return { id: row.id, school_id: row.school_id as string, admission_no: row.admission_no, first_name: row.first_name,
    middle_name: row.middle_name, last_name: row.last_name, roll_no: row.roll_no, status: row.status };
}
export function childName(value: FamilyChild) {
  return [value.first_name, value.middle_name, value.last_name].filter(Boolean).join(' ');
}

export async function listChildren(client: SupabaseClient, access: FamilyAccess, role: FamilyRole, signal?: AbortSignal): Promise<FamilyChild[]> {
  await currentScope(client, access, role, signal);
  if (role === 'student') {
    const query = client.from('students').select(`${studentColumns},profile_id`).eq('profile_id', access.userId).eq('school_id', access.schoolId);
    const response = await (signal ? query.abortSignal(signal) : query).maybeSingle();
    cancelled(signal);
    if (response.error) throw invalid();
    if (response.data === null) return [];
    if (record(response.data).profile_id !== access.userId) throw invalid();
    return [child(response.data, access)];
  }
  const parentQuery = client.from('parents').select('id,school_id,profile_id').eq('profile_id', access.userId).eq('school_id', access.schoolId);
  const parent = await (signal ? parentQuery.abortSignal(signal) : parentQuery).maybeSingle();
  cancelled(signal);
  if (parent.error || !parent.data) throw denied();
  const owner = record(parent.data);
  if (!validUuid(owner.id) || owner.profile_id !== access.userId || owner.school_id !== access.schoolId) throw denied();
  const linksQuery = client.from('student_parents').select('student_id', { count: 'exact' }).eq('parent_id', owner.id).limit(1501);
  const links = await (signal ? linksQuery.abortSignal(signal) : linksQuery);
  cancelled(signal);
  if (links.error || !Array.isArray(links.data) || links.data.length > 1500 || pageCount(links.count) !== links.data.length) throw invalid();
  const ids = links.data.map(value => { const row = record(value); if (!validUuid(row.student_id)) throw invalid(); return row.student_id; });
  if (new Set(ids).size !== ids.length) throw invalid();
  if (!ids.length) return [];
  const studentsQuery = client.from('students').select(studentColumns).eq('school_id', access.schoolId).in('id', ids).order('first_name').order('id').limit(1501);
  const students = await (signal ? studentsQuery.abortSignal(signal) : studentsQuery);
  cancelled(signal);
  if (students.error || !Array.isArray(students.data) || students.data.length !== ids.length) throw invalid();
  const pupils = students.data.map(value => child(value, access));
  if (new Set(pupils.map(pupil => pupil.id)).size !== pupils.length || pupils.some(pupil => !ids.includes(pupil.id))) throw invalid();
  return pupils;
}

export async function loadAttendance(client: SupabaseClient, access: FamilyAccess, role: FamilyRole, pupil: FamilyChild,
  { offset = 0, limit = 30 }: { offset?: number; limit?: number } = {}, signal?: AbortSignal): Promise<{ rows: AttendanceRow[]; count: number }> {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 60) throw new Error('Choose a valid attendance page.');
  const selected = child(pupil, access);
  const pupils = await listChildren(client, access, role, signal);
  if (!pupils.some(item => item.id === selected.id)) throw denied();
  const query = client.from('attendance').select('attendance_date,academic_year_id,status,student_id,school_id', { count: 'exact' })
    .eq('school_id', access.schoolId).eq('student_id', selected.id).order('attendance_date', { ascending: false }).range(offset, offset + limit - 1);
  const response = await (signal ? query.abortSignal(signal) : query);
  cancelled(signal);
  if (response.error || !Array.isArray(response.data) || response.data.length > limit) throw invalid();
  const count = pageCount(response.count);
  if (response.data.length && count < offset + response.data.length) throw invalid();
  const rows = response.data.map(value => {
    const row = record(value), date = row.attendance_date;
    if (row.student_id !== selected.id || row.school_id !== access.schoolId || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000')
      || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
      || !validUuid(row.academic_year_id) || !attendanceStatuses.includes(row.status as AttendanceStatus)) throw invalid();
    return { attendance_date: date, academic_year_id: row.academic_year_id, status: row.status as AttendanceStatus };
  });
  if (new Set(rows.map(row => `${row.academic_year_id}:${row.attendance_date}`)).size !== rows.length) throw invalid();
  return { rows, count };
}
