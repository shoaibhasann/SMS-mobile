import { homeworkUuid, type HomeworkInput } from './homework';
export type HomeworkIntentScope = { userId: string; schoolId: string; studentId: string; activityId: string };
export type HomeworkIntent = HomeworkIntentScope & HomeworkInput & { version: 1 };
type Store = { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void> };
const invalid = () => new Error('The unconfirmed homework request could not be verified. Contact your school before sending new work.');
function key(scope: HomeworkIntentScope) {
  if (![scope.userId, scope.schoolId, scope.studentId, scope.activityId].every(homeworkUuid)) throw invalid();
  return `sms.homework.pending.${scope.userId}.${scope.schoolId}.${scope.studentId}.${scope.activityId}`;
}
function parse(raw: string, scope: HomeworkIntentScope): HomeworkIntent {
  try {
    const row = JSON.parse(raw) as HomeworkIntent;
    if (row.version !== 1 || !Object.entries(scope).every(([k, value]) => row[k as keyof HomeworkIntentScope] === value) || !homeworkUuid(row.requestId)
      || typeof row.text !== 'string' || row.text.length > 10000 || row.text !== row.text.trim() || row.filePath !== null && typeof row.filePath !== 'string'
      || row.fileName !== null && typeof row.fileName !== 'string' || (row.filePath === null) !== (row.fileName === null) || !row.text && !row.filePath
      || row.expectedRevision !== null && (!Number.isSafeInteger(row.expectedRevision) || row.expectedRevision < 0)) throw invalid();
    return { version: 1, ...scope, requestId: row.requestId, text: row.text, filePath: row.filePath, fileName: row.fileName, expectedRevision: row.expectedRevision };
  } catch { throw invalid(); }
}
export function createPendingHomeworkStore(store: Store) {
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(work: () => Promise<T>) => { const next = queue.then(work); queue = next.catch(() => {}); return next; };
  async function read(scope: HomeworkIntentScope): Promise<HomeworkIntent | null> {
    const pointer = await store.get(key(scope));
    if (pointer === null) return null;
    let manifest: { id: string; count: number };
    try { manifest = JSON.parse(pointer); } catch { throw invalid(); }
    if (!homeworkUuid(manifest?.id) || !Number.isInteger(manifest.count) || manifest.count < 1 || manifest.count > 64) throw invalid();
    const parts = await Promise.all(Array.from({ length: manifest.count }, (_, i) => store.get(`${key(scope)}.${manifest.id}.${i}`)));
    if (parts.some(part => part === null)) throw invalid();
    const intent = parse(parts.join(''), scope);
    if (intent.requestId !== manifest.id) throw invalid();
    return intent;
  }
  return {
    read(scope: HomeworkIntentScope) { return serialized(() => read(scope)); },
    prepare(scope: HomeworkIntentScope, input: HomeworkInput) { return serialized(async () => {
      const next = parse(JSON.stringify({ version: 1, ...scope, ...input, text: input.text.trim() }), scope), old = await read(scope);
      if (old) {
        if (old.text !== next.text || old.filePath !== next.filePath || old.fileName !== next.fileName || old.expectedRevision !== next.expectedRevision) throw new Error('Retry the locked homework request before editing it.');
        return old;
      }
      const points = Array.from(JSON.stringify(next)), parts: string[] = [];
      for (let i = 0; i < points.length; i += 400) parts.push(points.slice(i, i + 400).join(''));
      if (parts.length > 64) throw invalid();
      const written = await Promise.allSettled(parts.map((part, i) => store.set(`${key(scope)}.${next.requestId}.${i}`, part)));
      if (written.some(result => result.status === 'rejected')) {
        await Promise.allSettled(parts.map((_, i) => store.remove(`${key(scope)}.${next.requestId}.${i}`)));
        throw invalid();
      }
      // Publish the pointer last; preserve chunks if the native write's outcome is unknown.
      await store.set(key(scope), JSON.stringify({ id: next.requestId, count: parts.length }));
      return next;
    }); },
    complete(scope: HomeworkIntentScope, requestId: string) { return serialized(async () => {
      const old = await read(scope);
      if (!old) return;
      if (old.requestId !== requestId) throw invalid();
      const manifest = JSON.parse((await store.get(key(scope)))!);
      try { await store.remove(key(scope)); }
      catch (cause) { if (await store.get(key(scope)) !== null) throw cause; }
      await Promise.allSettled(Array.from({ length: manifest.count }, (_, i) => store.remove(`${key(scope)}.${requestId}.${i}`)));
    }); },
  };
}
