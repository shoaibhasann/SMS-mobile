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
export type AttendanceYear = { id: string; name: string; start_date: string; end_date: string };
type AttendancePage = { offset?: number; limit?: number; yearId?: string; month?: string; status?: AttendanceStatus };
type ClassTeacher = { id: string; name: string; isClassTeacher: boolean; subjects: string[] };
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

function attendanceDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

export function attendanceMonths(year: AttendanceYear, today: string): string[] {
  const months: string[] = [];
  const end = (today < year.end_date ? today : year.end_date).slice(0, 7);
  for (const day = new Date(`${year.start_date.slice(0, 7)}-01T00:00:00Z`);
    day.getUTCFullYear() <= 9999 && day.toISOString().slice(0, 7) <= end; day.setUTCMonth(day.getUTCMonth() + 1)) {
    months.push(day.toISOString().slice(0, 10));
  }
  return months.reverse();
}

export async function loadAttendanceYears(client: SupabaseClient, access: FamilyAccess, role: FamilyRole, pupil: FamilyChild, signal?: AbortSignal) {
  assertRole(access, role);
  const selected = child(pupil, access);
  cancelled(signal);
  const query = client.rpc('get_family_attendance_report_context', { p_role: role, p_student_id: selected.id });
  const response = await (signal ? query.abortSignal(signal) : query);
  cancelled(signal);
  const context = record(response.data);
  if (response.error || context.user_id !== access.userId || context.school_id !== access.schoolId || context.student_id !== selected.id
    || context.role !== role || context.timezone !== 'Asia/Kolkata' || !attendanceDate(context.server_today) || !Array.isArray(context.years)) throw invalid();
  const years: AttendanceYear[] = context.years.map(value => {
    const { id, name, start_date, end_date } = record(value);
    if (!validUuid(id) || !text(name) || !attendanceDate(start_date) || !attendanceDate(end_date) || start_date > end_date
      || Date.parse(end_date) - Date.parse(start_date) > 365 * 86_400_000) throw invalid();
    return { id, name, start_date, end_date };
  });
  if (new Set(years.map(year => year.id)).size !== years.length) throw invalid();
  return { years, today: context.server_today };
}

export async function loadAttendance(client: SupabaseClient, access: FamilyAccess, role: FamilyRole, pupil: FamilyChild,
  { offset = 0, limit = 30, yearId, month, status }: AttendancePage = {}, signal?: AbortSignal): Promise<{ rows: AttendanceRow[]; count: number }> {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(offset + limit) || !Number.isSafeInteger(limit) || limit < 1 || limit > 60) throw new Error('Choose a valid attendance page.');
  if ((yearId !== undefined && !validUuid(yearId)) || (month !== undefined && (!attendanceDate(month) || !month.endsWith('-01')))
    || (status !== undefined && !attendanceStatuses.includes(status))) throw new Error('Choose a valid attendance filter.');
  const selected = child(pupil, access);
  const pupils = await listChildren(client, access, role, signal);
  if (!pupils.some(item => item.id === selected.id)) throw denied();
  const monthEnd = month ? new Date(Date.parse(month)) : null;
  monthEnd?.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
  const lastDay = monthEnd?.toISOString().slice(0, 10);
  let query = client.from('attendance').select('attendance_date,academic_year_id,status,student_id,school_id', { count: 'exact' })
    .eq('school_id', access.schoolId).eq('student_id', selected.id);
  if (yearId) query = query.eq('academic_year_id', yearId);
  if (month && lastDay) query = query.gte('attendance_date', month).lte('attendance_date', lastDay);
  if (status) query = query.eq('status', status);
  query = query.order('attendance_date', { ascending: false }).order('academic_year_id').range(offset, offset + limit - 1);
  const response = await (signal ? query.abortSignal(signal) : query);
  cancelled(signal);
  if (response.error || !Array.isArray(response.data) || response.data.length > limit) throw invalid();
  const count = pageCount(response.count);
  if (response.data.length !== Math.min(limit, Math.max(0, count - offset))) throw invalid();
  const rows = response.data.map(value => {
    const row = record(value), date = row.attendance_date;
    if (row.student_id !== selected.id || row.school_id !== access.schoolId || !attendanceDate(date)
      || !validUuid(row.academic_year_id) || !attendanceStatuses.includes(row.status as AttendanceStatus)
      || (yearId && row.academic_year_id !== yearId) || (month && date.slice(0, 7) !== month.slice(0, 7)) || (status && row.status !== status)) throw invalid();
    return { attendance_date: date, academic_year_id: row.academic_year_id, status: row.status as AttendanceStatus };
  });
  if (new Set(rows.map(row => `${row.academic_year_id}:${row.attendance_date}`)).size !== rows.length) throw invalid();
  return { rows, count };
}

export async function loadClassTeachers(client: SupabaseClient, access: FamilyAccess, role: FamilyRole, pupil: FamilyChild, signal?: AbortSignal) {
  assertRole(access, role);
  const selected = child(pupil, access);
  cancelled(signal);
  const query = client.rpc('get_family_class_teachers', { p_role: role, p_student_id: selected.id });
  const response = await (signal ? query.abortSignal(signal) : query);
  cancelled(signal);
  if (response.error && ['PGRST202', '42883'].includes(response.error.code)) throw new Error('Teacher assignments are not available on the school server yet.');
  if (response.error?.code === '42501') throw denied();
  const value = record(response.data);
  if (response.error || value.user_id !== access.userId || value.school_id !== access.schoolId || value.student_id !== selected.id
    || value.role !== role || !Array.isArray(value.teachers)) throw invalid();
  const { academic_year_name: year, class_name: className, section_name: section } = value;
  if (className === null ? year !== null || section !== null || value.teachers.length > 0
    : !text(className) || !text(year) || section !== null && !text(section)) throw invalid();
  const teachers: ClassTeacher[] = value.teachers.map(teacher => {
    const { id, name, is_class_teacher: isClassTeacher, subjects } = record(teacher);
    if (!validUuid(id) || !text(name) || typeof isClassTeacher !== 'boolean' || !Array.isArray(subjects)
      || !subjects.length || !subjects.every(text) || new Set(subjects).size !== subjects.length) throw invalid();
    return { id, name, isClassTeacher, subjects };
  });
  if (new Set(teachers.map(teacher => teacher.id)).size !== teachers.length
    || teachers.filter(teacher => teacher.isClassTeacher).length > (section ? 1 : 0)) throw invalid();
  return { year: year as string | null, className: className as string | null, section: section as string | null, teachers };
}
