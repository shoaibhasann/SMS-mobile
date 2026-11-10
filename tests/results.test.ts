import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listChildren, type FamilyAccess, type FamilyChild } from '../src/data/family';
import { getFamilyAssessmentResults, getFamilyNotificationResult, type FamilyAssessmentResult, type PublicationMetadata } from '../src/data/results';
import { summarizePublishedResults } from '../src/data/academic-analysis';

vi.mock('../src/data/family', () => ({ listChildren: vi.fn() }));
const id = (n: number) => `51000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const stamp = '2026-11-06T15:00:00.123456+00:00';
const access: FamilyAccess = { userId: id(1), name: 'QA parent', schoolId: id(2), roles: ['parent', 'student'] };
const child: FamilyChild = { id: id(3), school_id: id(2), admission_no: 'QA-001', first_name: 'QA child', middle_name: null, last_name: null, roll_no: '1', status: 'active' };
const metadata = (patch: Partial<PublicationMetadata> = {}): PublicationMetadata => ({
  assessment_id: id(4), school_id: id(2), school_name: 'QA School', academic_year_id: id(5), academic_year_name: '2026–27',
  class_id: id(6), class_name: 'Class 6', section_id: id(7), section_name: 'A', subject_id: id(8), subject_name: 'Science',
  teacher_id: id(9), teacher_name: 'QA Teacher', name: 'November practice', assessment_date: '2026-11-05',
  maximum_marks: 20, assessment_updated_at: stamp, status: 'completed', ...patch,
});
const row = (patch: Partial<FamilyAssessmentResult> = {}): FamilyAssessmentResult => ({
  id: id(10), assessment_id: id(4), revision: 1, published_at: stamp, publisher_name: 'QA Principal', metadata: metadata(),
  student_id: id(3), student_name: 'QA child', admission_no: 'QA-001', roll_no: '1', marks_obtained: 18, maximum_marks: 20,
  percentage: 90, remarks: 'Clear reasoning', ...patch,
});
const page = (rows: unknown[] = [row()], patch: Record<string, unknown> = {}) => ({ rows, total_count: rows.length, offset: 0, student_id: child.id, school_id: access.schoolId, ...patch });
function client(data: unknown, error: { code: string; message?: string } | null = null) {
  const abortSignal = vi.fn().mockResolvedValue({ data, error });
  const rpc = vi.fn().mockReturnValue(Object.assign(Promise.resolve({ data, error }), { abortSignal }));
  return { client: { rpc } as unknown as SupabaseClient, rpc, abortSignal };
}
beforeEach(() => { vi.mocked(listChildren).mockReset().mockResolvedValue([child]); });

describe('native subject comparisons', () => {
  it('uses assessment dates and keeps comparisons within one subject and academic year', () => {
    const latest = row({ percentage: 85 });
    const prior = row({ percentage: 70, metadata: metadata({ assessment_date: '2026-10-10' }), published_at: '2026-11-07T09:00:00Z' });
    const sameDay = row({ percentage: 100, published_at: '2026-11-06T14:00:00Z' });
    const otherSubject = row({ percentage: 0, metadata: metadata({ subject_id: id(11), subject_name: 'English' }) });
    const priorYear = row({ percentage: 50, metadata: metadata({ academic_year_id: id(12), academic_year_name: '2025–26', assessment_date: '2026-02-10' }) });
    const input = [prior, priorYear, latest, otherSubject, sameDay];
    expect(summarizePublishedResults(input)).toEqual({ year: '2026–27', subjects: [{ latest, previous: prior }, { latest: otherSubject, previous: null }] });
    expect(input[0]).toBe(prior);
    expect(summarizePublishedResults([])).toBeNull();
  });
});

describe('native latest published result boundary', () => {
  it('checks fresh family/child scope before fetching the complete 50-row history page', async () => {
    const saved = client(page([row()], { total_count: '51', offset: 50 })), signal = new AbortController().signal;
    const result = await getFamilyAssessmentResults(saved.client, access, 'parent', child, 50, signal);
    expect(result).toEqual({ rows: [row()], total_count: 51, offset: 50, student_id: child.id, school_id: access.schoolId });
    expect(listChildren).toHaveBeenCalledWith(saved.client, access, 'parent', signal);
    expect(saved.rpc).toHaveBeenCalledWith('get_family_assessment_results', { p_student_id: child.id, p_offset: 50 });
    expect(saved.abortSignal).toHaveBeenCalledWith(signal);
  });
  it('preserves a legitimate zero score and the original class/session snapshot for a retained pupil', async () => {
    const value = row({ marks_obtained: 0, percentage: 0, metadata: metadata({ class_name: 'Original class', academic_year_name: 'Original session' }) });
    const result = await getFamilyAssessmentResults(client(page([value])).client, access, 'student', { ...child, status: 'withdrawn' });
    expect(result.rows[0]).toEqual(value);
  });
  it('returns only explicitly whitelisted pupil and metadata fields', async () => {
    const value = { ...row(), harmless_extension: 'ignored', metadata: { ...metadata(), another_extension: 'ignored' } };
    const result = (await getFamilyAssessmentResults(client(page([value])).client, access, 'parent', child)).rows[0];
    expect(result).toEqual(row()); expect(result).not.toHaveProperty('harmless_extension'); expect(result.metadata).not.toHaveProperty('another_extension');
  });
  it.each(['pupils', 'snapshot', 'rank', 'mark_id', 'enrollment_id', 'review_note', 'source_token', 'raw_marks'])(
    'fails closed rather than retaining a leaked private %s field', async key => {
      await expect(getFamilyAssessmentResults(client(page([{ ...row(), [key]: 'private' }])).client, access, 'parent', child)).rejects.toThrow('could not be verified');
      await expect(getFamilyAssessmentResults(client(page([{ ...row(), metadata: { ...metadata(), [key]: 'private' } }])).client, access, 'parent', child)).rejects.toThrow('could not be verified');
    },
  );
  it.each([
    { student_id: id(99) }, { id: 'not-a-uuid' }, { assessment_id: id(99) }, { revision: 0 }, { revision: 1.5 }, { published_at: 'yesterday' }, { published_at: '2026-02-30T00:00:00Z' },
    { percentage: 89 }, { marks_obtained: -1 }, { marks_obtained: 21 }, { maximum_marks: 0 }, { remarks: {} }, { status: 'pending' },
  ])('rejects malformed/unpublished/mismapped family results %j', async patch => {
    await expect(getFamilyAssessmentResults(client(page([{ ...row(), ...patch }])).client, access, 'parent', child)).rejects.toThrow('could not be verified');
  });
  it.each([
    { school_id: id(99) }, { assessment_date: '2026-02-30' }, { assessment_date: '0000-01-01' }, { maximum_marks: 19 },
    { academic_year_id: 'bad' }, { teacher_id: 'bad' }, { section_id: null }, { status: 'draft' }, { assessment_updated_at: 'invalid' }, { assessment_updated_at: '2026-02-30T00:00:00Z' },
  ])('rejects incoherent frozen result metadata %j', async patch => {
    const value = { ...row(), metadata: { ...metadata(), ...patch } };
    await expect(getFamilyAssessmentResults(client(page([value])).client, access, 'parent', child)).rejects.toThrow('could not be verified');
  });
  it('accepts an explicitly whole-class assessment and validates count/offset/context/duplicates', async () => {
    const whole = row({ metadata: metadata({ section_id: null, section_name: null }) });
    expect((await getFamilyAssessmentResults(client(page([whole])).client, access, 'parent', child)).rows[0]).toEqual(whole);
    for (const value of [page([row(), row()]), page([row(), row({ id: id(11), revision: 2 })]), page([row()], { total_count: 0 }),
      page([row()], { offset: 50 }), page([row()], { school_id: id(99) }), page([row()], { student_id: id(99) }), page([row()], { total_count: '9007199254740992' })]) {
      await expect(getFamilyAssessmentResults(client(value).client, access, 'parent', child)).rejects.toThrow('could not be verified');
    }
  });
  it('rejects an overfull result page and invalid offsets before source access', async () => {
    const saved = client(page());
    for (const offset of [-1, 0.5, 2147483648]) await expect(getFamilyAssessmentResults(saved.client, access, 'parent', child, offset)).rejects.toThrow('valid results page');
    expect(saved.rpc).not.toHaveBeenCalled(); expect(listChildren).not.toHaveBeenCalled();
    const rows = Array.from({ length: 51 }, (_, n) => row({ id: id(100 + n), assessment_id: id(200 + n), metadata: metadata({ assessment_id: id(200 + n) }) }));
    await expect(getFamilyAssessmentResults(client(page(rows)).client, access, 'parent', child)).rejects.toThrow('could not be verified');
  });
  it('does not call result APIs for another school, a missing role or a currently revoked child', async () => {
    const saved = client(page());
    await expect(getFamilyAssessmentResults(saved.client, access, 'parent', { ...child, school_id: id(99) })).rejects.toThrow('access');
    await expect(getFamilyAssessmentResults(saved.client, { ...access, roles: ['student'] }, 'parent', child)).rejects.toThrow('access');
    vi.mocked(listChildren).mockResolvedValue([]);
    await expect(getFamilyAssessmentResults(saved.client, access, 'parent', child)).rejects.toThrow('no longer available');
    expect(saved.rpc).not.toHaveBeenCalled();
  });
  it('propagates a failed live role/session check without fetching protected result data', async () => {
    const saved = client(page()); vi.mocked(listChildren).mockRejectedValue(new Error('Session revoked'));
    await expect(getFamilyAssessmentResults(saved.client, access, 'parent', child)).rejects.toThrow('Session revoked'); expect(saved.rpc).not.toHaveBeenCalled();
  });
  it('loads the exact latest assessment independently of normal history pagination and handles unavailable results', async () => {
    const latest = row({ revision: 4 }), saved = client(latest);
    expect(await getFamilyNotificationResult(saved.client, access, 'student', child, id(4))).toEqual(latest);
    expect(saved.rpc).toHaveBeenCalledWith('get_family_notification_result', { p_role: 'student', p_student_id: id(3), p_assessment_id: id(4) });
    expect(await getFamilyNotificationResult(client(null).client, access, 'parent', child, id(4))).toBeNull();
    await expect(getFamilyNotificationResult(client(row()).client, access, 'parent', child, id(99))).rejects.toThrow('could not be verified');
    const invalid = client(row()); await expect(getFamilyNotificationResult(invalid.client, access, 'parent', child, 'invalid')).rejects.toThrow('link is invalid'); expect(invalid.rpc).not.toHaveBeenCalled();
  });
  it('honors cancellation before, during scope verification and after the source response', async () => {
    const saved = client(page()), controller = new AbortController(); controller.abort();
    await expect(getFamilyAssessmentResults(saved.client, access, 'parent', child, 0, controller.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(saved.rpc).not.toHaveBeenCalled();
    const during = new AbortController(); vi.mocked(listChildren).mockImplementation(async () => { during.abort(); return [child]; });
    await expect(getFamilyNotificationResult(saved.client, access, 'parent', child, id(4), during.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(saved.rpc).not.toHaveBeenCalled();
    vi.mocked(listChildren).mockResolvedValue([child]);
    const late = new AbortController(), pending = client(page()); pending.abortSignal.mockImplementation(async () => { late.abort(); return { data: page(), error: null }; });
    await expect(getFamilyAssessmentResults(pending.client, access, 'parent', child, 0, late.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it.each([['42501', 'access changed'], ['PGRST202', 'latest school update'], ['500', 'could not be loaded']])('normalizes %s without surfacing private backend error text', async (code, message) => {
    await expect(getFamilyAssessmentResults(client(null, { code, message: 'Private actor SQL body' }).client, access, 'parent', child)).rejects.toThrow(message);
  });
});
