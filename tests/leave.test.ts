import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { getFamilyNotificationLeave, isLeaveDate, leaveOverlaps, listFamilyStudentLeave, submitStudentLeave, validateLeaveTarget, validateStudentLeave, type StudentLeaveRequest } from '../src/data/leave';
import { createPendingLeaveStore } from '../src/data/pending-leave';
import type { FamilyAccess, FamilyChild } from '../src/data/family';

const id = (n: number) => `51000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const stamp = '2026-11-06T15:00:00.123456+00:00';
const access: FamilyAccess = { userId: id(1), schoolId: id(2), name: 'QA parent', roles: ['parent'] };
const child: FamilyChild = { id: id(3), school_id: id(2), admission_no: 'QA-001', first_name: 'QA child', middle_name: null, last_name: null, roll_no: '1', status: 'active' };
const row = (patch: Record<string, unknown> = {}) => ({ id: id(10), school_id: id(2), student_id: id(3), student_name: 'QA child', admission_no: 'QA-001',
  academic_year_id: id(11), academic_year_name: '2026–27', class_name: 'Class 6', section_name: 'A', start_date: '2026-11-10', end_date: '2026-11-11',
  reason: 'Family event', status: 'pending', requester_id: id(1), requester_name: 'QA parent', created_at: stamp,
  reviewed_by: null, reviewer_name: null, review_note: null, reviewed_at: null, total_count: 1, ...patch });
const reviewed = () => row({ status: 'approved', reviewed_by: id(12), reviewer_name: 'QA principal', review_note: 'Approved for the dates requested.', reviewed_at: '2026-11-06T16:00:00Z' });
type Reply = { data: unknown; error: { code?: string; message?: string } | null; count?: number };
function fixture() {
  const auth = vi.fn(async () => ({ data: { user: { id: id(1), is_anonymous: false, email_confirmed_at: stamp } }, error: null }));
  const replies: Record<string, Reply> = { list_family_student_leave: { data: [row()], error: null }, submit_student_leave: { data: id(10), error: null }, get_family_notification_leave: { data: reviewed(), error: null } };
  const signals: AbortSignal[] = [];
  const rpc = vi.fn((name: string, _args: unknown) => {
    const value = name === 'get_family_notification_unread_count' ? { data: 0, error: null } : replies[name];
    return Object.assign(Promise.resolve(value), { abortSignal: (signal: AbortSignal) => { signals.push(signal); return Promise.resolve(value); } });
  });
  const patches: Record<string, Reply> = {};
  const from = vi.fn((name: string) => {
    let single = false;
    const builder = { select: () => builder, eq: () => builder, in: () => builder, order: () => builder, limit: () => builder,
      abortSignal: () => builder, maybeSingle: () => { single = true; return builder; },
      then: (resolve: (value: Reply) => unknown, reject: (error: unknown) => unknown) => {
        const reply = patches[name] ?? (name === 'profiles' ? { data: { id: id(1), school_id: id(2), full_name: 'QA parent', is_active: true }, error: null }
          : name === 'parents' ? { data: { id: id(4), school_id: id(2), profile_id: id(1) }, error: null }
            : name === 'student_parents' ? { data: [{ student_id: id(3) }], count: 1, error: null }
              : { data: single ? { ...child, profile_id: id(1) } : [child], error: null });
        return Promise.resolve(reply).then(resolve, reject);
      } };
    return builder;
  });
  return { client: { auth: { getUser: auth }, from, rpc } as unknown as SupabaseClient, auth, from, rpc, replies, patches, signals };
}
const draft = { startDate: '2026-11-10', endDate: '2026-11-11', reason: 'Family event' };
const request = { ...draft, idempotencyKey: id(20) };
const scope = { userId: id(1), role: 'parent' as const, schoolId: id(2), studentId: id(3) };
function storageFixture() {
  const values = new Map<string, string>();
  const store = { get: vi.fn(async (key: string) => values.get(key) ?? null), set: vi.fn(async (key: string, value: string) => { values.set(key, value); }), remove: vi.fn(async (key: string) => { values.delete(key); }) };
  let generated = 20;
  const random = vi.fn(() => id(generated++));
  return { values, store, random, pending: createPendingLeaveStore(store, random) };
}

describe('family leave data', () => {
  it('loads exact own-child history and whitelists the DTO', async () => {
    const f = fixture(); f.replies.list_family_student_leave.data = [row({ private_note: 'not returned', idempotency_key: id(20) })];
    const rows = await listFamilyStudentLeave(f.client, access, 'parent', child);
    expect(rows).toEqual([row()]); expect(rows[0]).not.toHaveProperty('private_note'); expect(rows[0]).not.toHaveProperty('idempotency_key');
    expect(f.rpc).toHaveBeenCalledWith('list_family_student_leave', { p_student_id: child.id, p_offset: 0 });
  });
  it('supports Student self access and exact decision targets beyond page 50 without reading notifications', async () => {
    const f = fixture(), student = { ...access, roles: ['student' as const] };
    expect(await getFamilyNotificationLeave(f.client, student, 'student', child, id(10))).toEqual(reviewed());
    expect(f.rpc).toHaveBeenCalledWith('get_family_notification_leave', { p_role: 'student', p_student_id: child.id, p_request_id: id(10) });
    expect(f.rpc.mock.calls.some(([name]) => name.startsWith('mark_'))).toBe(false);
    f.replies.get_family_notification_leave.data = null;
    expect(await getFamilyNotificationLeave(f.client, student, 'student', child, id(10))).toBeNull();
  });
  it('validates actual dates, ordered ranges, Unicode character limits, and exact route references', () => {
    for (const value of ['2026-02-29', '2026-02-30', '0000-01-01', '2026-2-01', '2026-13-01']) expect(isLeaveDate(value)).toBe(false);
    expect(isLeaveDate('2028-02-29')).toBe(true);
    expect(validateStudentLeave('2026-11-11', '2026-11-10', 'valid')).toBeTruthy();
    expect(validateStudentLeave(draft.startDate, draft.endDate, '  ab  ')).toBeTruthy();
    expect(validateStudentLeave(draft.startDate, draft.endDate, 'invalid\u0000reason')).toBeTruthy();
    expect(validateStudentLeave(draft.startDate, draft.endDate, '😀'.repeat(1000))).toBeNull();
    expect(validateStudentLeave(draft.startDate, draft.endDate, '😀'.repeat(1001))).toBeTruthy();
    expect(validateLeaveTarget(id(3), id(10))).toEqual({ child: id(3), request: id(10) });
    for (const params of [[undefined, id(10)], [[id(3)], id(10)], ['bad', undefined], [id(3), ['bad']]]) expect(() => validateLeaveTarget(...params as [unknown, unknown])).toThrow('invalid');
  });
  it('allows repeated dates only after rejection; pending/approved overlaps include touching endpoints', () => {
    expect(leaveOverlaps([row() as StudentLeaveRequest], '2026-11-11', '2026-11-12')).toBe(true);
    expect(leaveOverlaps([reviewed() as StudentLeaveRequest], '2026-11-09', '2026-11-10')).toBe(true);
    expect(leaveOverlaps([row({ status: 'rejected' }) as StudentLeaveRequest], draft.startDate, draft.endDate)).toBe(false);
    expect(leaveOverlaps([row() as StudentLeaveRequest], '2026-11-12', '2026-11-13')).toBe(false);
  });
  it.each([
    { id: 'bad' }, { academic_year_id: 'bad' }, { requester_id: 'bad' }, { school_id: id(99) }, { student_id: id(99) },
    { status: 'cancelled' }, { start_date: '2026-02-30' }, { end_date: '2026-11-09' }, { created_at: '2026-02-30T00:00:00Z' },
    { reviewed_by: id(12) }, { total_count: -1 }, { reason: 'ab' },
  ])('rejects an incoherent DTO %j', async patch => {
    const f = fixture(); f.replies.list_family_student_leave.data = [row(patch)];
    await expect(listFamilyStudentLeave(f.client, access, 'parent', child)).rejects.toThrow('could not be verified');
  });
  it('rejects duplicate/mismatched totals and decision substitution despite a successful RPC', async () => {
    const f = fixture();
    for (const values of [[row(), row()], [row(), row({ id: id(13), total_count: 2 })]]) {
      f.replies.list_family_student_leave.data = values; await expect(listFamilyStudentLeave(f.client, access, 'parent', child)).rejects.toThrow();
    }
    f.replies.get_family_notification_leave.data = row();
    await expect(getFamilyNotificationLeave(f.client, access, 'parent', child, id(10))).rejects.toThrow();
    f.replies.get_family_notification_leave.data = { ...reviewed(), id: id(99) };
    await expect(getFamilyNotificationLeave(f.client, access, 'parent', child, id(10))).rejects.toThrow();
  });
  it('denies wrong-role, foreign-account, wrong-school, and revoked-child context before the leave RPC', async () => {
    const cases: [FamilyAccess, 'parent', FamilyChild][] = [[{ ...access, roles: [] }, 'parent', child], [access, 'parent', { ...child, school_id: id(99) }], [access, 'parent', { ...child, id: id(99) }]];
    for (const args of cases) {
      const f = fixture(); await expect(listFamilyStudentLeave(f.client, ...args)).rejects.toThrow();
      expect(f.rpc.mock.calls.some(([name]) => name === 'list_family_student_leave')).toBe(false);
    }
    const f = fixture(); f.auth.mockResolvedValue({ data: { user: { id: id(99), is_anonymous: false, email_confirmed_at: stamp } }, error: null });
    await expect(submitStudentLeave(f.client, access, 'parent', child, request)).rejects.toThrow('family access');
    expect(f.rpc.mock.calls.some(([name]) => name === 'submit_student_leave')).toBe(false);
    const revoked = fixture(); revoked.patches.student_parents = { data: [], count: 0, error: null };
    await expect(listFamilyStudentLeave(revoked.client, access, 'parent', child)).rejects.toThrow();
  });
  it('keeps exact idempotency payload, trims reason, and makes no attendance mutations', async () => {
    const f = fixture(); expect(await submitStudentLeave(f.client, access, 'parent', child, { ...request, reason: '  Family event  ' })).toBe(id(10));
    expect(f.rpc).toHaveBeenCalledWith('submit_student_leave', { p_student_id: id(3), p_start_date: draft.startDate, p_end_date: draft.endDate, p_reason: draft.reason, p_idempotency_key: id(20) });
    expect(f.from.mock.calls.some(([table]) => table === 'attendance')).toBe(false);
    await expect(submitStudentLeave(f.client, access, 'parent', child, { ...request, idempotencyKey: 'bad' })).rejects.toMatchObject({ code: 'validation' });
  });
  it('preserves aborts before and during reads and refuses to acknowledge a stale aborted write', async () => {
    const f = fixture(), controller = new AbortController(); controller.abort();
    await expect(listFamilyStudentLeave(f.client, access, 'parent', child, 0, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.rpc).not.toHaveBeenCalled();
    const during = fixture(), cancellation = new AbortController();
    during.rpc.mockImplementation((name: string) => {
      const result = { data: name === 'submit_student_leave' ? id(10) : 0, error: null };
      return Object.assign(Promise.resolve(result), { abortSignal: async () => { if (name === 'submit_student_leave') cancellation.abort(); return result; } });
    });
    await expect(submitStudentLeave(during.client, access, 'parent', child, request, cancellation.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('does not expose provider errors and treats a malformed acknowledgment as unknown', async () => {
    const f = fixture(); f.replies.submit_student_leave = { data: null, error: { code: 'PT409', message: 'private SQL detail' } };
    await expect(submitStudentLeave(f.client, access, 'parent', child, request)).rejects.toThrow('conflicts');
    await expect(submitStudentLeave(f.client, access, 'parent', child, request)).rejects.not.toThrow('private SQL');
    f.replies.submit_student_leave = { data: 'not-a-uuid', error: null };
    await expect(submitStudentLeave(f.client, access, 'parent', child, request)).rejects.toThrow('could not be confirmed');
    await expect(listFamilyStudentLeave(f.client, access, 'parent', child, -1)).rejects.toThrow('valid history page');
  });
});

describe('encrypted unknown-outcome leave intent storage', () => {
  it('survives a new controller/app process with the same exact key and payload', async () => {
    const f = storageFixture(), initial = await f.pending.prepare(scope, draft);
    const restarted = createPendingLeaveStore(f.store, f.random), retry = await restarted.prepare(scope, { ...draft, reason: ' Family event ' });
    expect(retry).toEqual({ intent: initial.intent, recovered: true }); expect(f.random).toHaveBeenCalledOnce();
    expect(await restarted.read(scope)).toEqual(initial.intent);
  });
  it('locks edits until an exact-key completion and never clears a different intent', async () => {
    const f = storageFixture(), saved = await f.pending.prepare(scope, draft);
    await expect(f.pending.prepare(scope, { ...draft, reason: 'Different request' })).rejects.toMatchObject({ code: 'pending-locked' });
    await expect(f.pending.complete(scope, id(99))).rejects.toMatchObject({ code: 'pending-storage' });
    expect(await f.pending.read(scope)).toEqual(saved.intent);
    await f.pending.complete(scope, saved.intent.idempotencyKey);
    expect(await f.pending.read(scope)).toBeNull(); expect(f.values.size).toBe(0);
    expect((await f.pending.prepare(scope, draft)).intent.idempotencyKey).not.toBe(saved.intent.idempotencyKey);
  });
  it('isolates user, school, role, and child, without exposing another scope’s intent', async () => {
    const f = storageFixture(); await f.pending.prepare(scope, draft);
    for (const patch of [{ userId: id(99) }, { schoolId: id(99) }, { role: 'student' as const }, { studentId: id(99) }]) expect(await f.pending.read({ ...scope, ...patch })).toBeNull();
    const pointerKey = [...f.values.keys()].find(key => key.endsWith(scope.studentId))!;
    const pointer = f.values.get(pointerKey)!; f.values.set(pointerKey.replace(scope.studentId, id(99)), pointer);
    await expect(f.pending.read({ ...scope, studentId: id(99) })).rejects.toMatchObject({ code: 'pending-storage' });
  });
  it('keeps Unicode reasons in small chunks and fails closed for missing/corrupt native bytes', async () => {
    const f = storageFixture(), content = { ...draft, reason: '😀'.repeat(1000) }; await f.pending.prepare(scope, content);
    expect(f.store.set.mock.calls.every(([, value]) => new TextEncoder().encode(value).length <= 1800)).toBe(true);
    expect((await f.pending.read(scope))?.reason).toBe(content.reason);
    const chunk = [...f.values.keys()].find(key => key.endsWith('.0'))!; f.values.delete(chunk);
    await expect(f.pending.read(scope)).rejects.toMatchObject({ code: 'pending-storage' });
    await expect(f.pending.prepare(scope, draft)).rejects.toMatchObject({ code: 'pending-storage' });
  });
  it('confirms secure deletion by reading its postcondition when the native acknowledgment is lost', async () => {
    const f = storageFixture(), prepared = await f.pending.prepare(scope, draft);
    f.store.remove.mockImplementation(async key => { f.values.delete(key); if (key.endsWith(scope.studentId)) throw new Error('Lost delete acknowledgment'); });
    await f.pending.complete(scope, prepared.intent.idempotencyKey);
    expect(await f.pending.read(scope)).toBeNull(); expect(f.values.size).toBe(0);
  });
  it('serializes concurrent prepare calls and keeps native pointer writes that committed before rejecting', async () => {
    const f = storageFixture(); const saved = await Promise.all([f.pending.prepare(scope, draft), f.pending.prepare(scope, draft)]);
    expect(saved[0].intent.idempotencyKey).toBe(saved[1].intent.idempotencyKey); expect(f.random).toHaveBeenCalledOnce();
    const unknown = storageFixture(); unknown.store.set.mockImplementation(async (key, value) => { unknown.values.set(key, value); if (key.endsWith(scope.studentId)) throw new Error('Unknown native acknowledgment'); });
    await expect(unknown.pending.prepare(scope, draft)).rejects.toThrow('Unknown native acknowledgment');
    unknown.store.set.mockImplementation(async (key, value) => { unknown.values.set(key, value); });
    expect((await unknown.pending.prepare(scope, draft)).recovered).toBe(true); expect(unknown.random).toHaveBeenCalledOnce();
  });
});
