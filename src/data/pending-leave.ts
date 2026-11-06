import { leaveUuid, StudentLeaveError, validateStudentLeave, type StudentLeaveSubmission } from './leave';
import type { FamilyRole } from './family';

export type LeaveIntentScope = { userId: string; role: FamilyRole; schoolId: string; studentId: string };
export type LeaveDraft = Pick<StudentLeaveSubmission, 'startDate' | 'endDate' | 'reason'>;
export type PendingLeaveIntent = LeaveIntentScope & StudentLeaveSubmission & { version: 1 };
type Store = { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void> };
const storageError = () => new StudentLeaveError('The saved request could not be verified. Retry loading it; do not send a new request until the school confirms its status.', 'pending-storage');
function scopeKey(scope: LeaveIntentScope) {
  if (![scope.userId, scope.schoolId, scope.studentId].every(leaveUuid) || !['parent', 'student'].includes(scope.role)) throw storageError();
  return `sms.leave.pending.${scope.userId}.${scope.role}.${scope.schoolId}.${scope.studentId}`;
}
function parse(raw: string, scope: LeaveIntentScope): PendingLeaveIntent {
  try {
    const value = JSON.parse(raw) as PendingLeaveIntent;
    if (!value || value.version !== 1 || value.userId !== scope.userId || value.role !== scope.role || value.schoolId !== scope.schoolId || value.studentId !== scope.studentId
      || !leaveUuid(value.idempotencyKey) || typeof value.startDate !== 'string' || typeof value.endDate !== 'string' || typeof value.reason !== 'string'
      || validateStudentLeave(value.startDate, value.endDate, value.reason) || value.reason !== value.reason.trim()) throw storageError();
    return { version: 1, ...scope, startDate: value.startDate, endDate: value.endDate, reason: value.reason, idempotencyKey: value.idempotencyKey };
  } catch { throw storageError(); }
}
export function createPendingLeaveStore(store: Store, randomId: () => string) {
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(work: () => Promise<T>) => { const next = queue.then(work); queue = next.catch(() => {}); return next; };
  async function read(scope: LeaveIntentScope): Promise<PendingLeaveIntent | null> {
    const key = scopeKey(scope), pointer = await store.get(key);
    if (pointer === null) return null;
    let saved: { version: number; generation: string; count: number };
    try { saved = JSON.parse(pointer); } catch { throw storageError(); }
    if (saved?.version !== 1 || !leaveUuid(saved.generation) || !Number.isInteger(saved.count) || saved.count < 1 || saved.count > 16) throw storageError();
    const parts = await Promise.all(Array.from({ length: saved.count }, (_, i) => store.get(`${key}.${saved.generation}.${i}`)));
    if (parts.some(part => part === null)) throw storageError();
    const intent = parse(parts.join(''), scope);
    if (intent.idempotencyKey !== saved.generation) throw storageError();
    return intent;
  }
  return {
    read(scope: LeaveIntentScope) { return serialized(() => read(scope)); },
    prepare(scope: LeaveIntentScope, draft: LeaveDraft) { return serialized(async () => {
      const key = scopeKey(scope), saved = await read(scope);
      const reason = draft.reason.trim(), validation = validateStudentLeave(draft.startDate, draft.endDate, reason);
      if (validation) throw new StudentLeaveError(validation, 'validation');
      if (saved) {
        if (saved.startDate !== draft.startDate || saved.endDate !== draft.endDate || saved.reason !== reason) throw new StudentLeaveError('An unconfirmed request is locked. Retry that exact request before editing dates or reason.', 'pending-locked');
        return { intent: saved, recovered: true };
      }
      const idempotencyKey = randomId();
      if (!leaveUuid(idempotencyKey)) throw storageError();
      const intent: PendingLeaveIntent = { version: 1, ...scope, startDate: draft.startDate, endDate: draft.endDate, reason, idempotencyKey };
      const points = Array.from(JSON.stringify(intent)), parts: string[] = [];
      // Keep each encrypted native value below the historical 2 KB Keychain limit, including Unicode reasons.
      for (let i = 0; i < points.length; i += 400) parts.push(points.slice(i, i + 400).join(''));
      if (parts.length > 16) throw storageError();
      const writes = await Promise.allSettled(parts.map((part, i) => store.set(`${key}.${idempotencyKey}.${i}`, part)));
      if (writes.some(result => result.status === 'rejected')) {
        await Promise.allSettled(parts.map((_, i) => store.remove(`${key}.${idempotencyKey}.${i}`)));
        throw storageError();
      }
      // Publish last. If a native write commits before rejecting, preserve its chunks for the next read.
      await store.set(key, JSON.stringify({ version: 1, generation: idempotencyKey, count: parts.length }));
      return { intent, recovered: false };
    }); },
    complete(scope: LeaveIntentScope, idempotencyKey: string) { return serialized(async () => {
      const key = scopeKey(scope), intent = await read(scope);
      if (!intent) return;
      if (intent.idempotencyKey !== idempotencyKey) throw storageError();
      const pointer = JSON.parse((await store.get(key))!);
      try { await store.remove(key); }
      catch (error) { if (await store.get(key) !== null) throw error; }
      await Promise.allSettled(Array.from({ length: pointer.count }, (_, i) => store.remove(`${key}.${idempotencyKey}.${i}`)));
    }); },
  };
}
