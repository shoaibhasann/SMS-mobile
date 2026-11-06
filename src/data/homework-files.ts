import type { SupabaseClient } from '@supabase/supabase-js';
import type { FamilyAccess, FamilyChild, FamilyRole } from './family';
import { checkedHomeworkPath, getHomework, homeworkCancelled, homeworkFileScope, homeworkUuid, type HomeworkActivity } from './homework';

export const homeworkFileMaxBytes = 10 * 1024 * 1024;
export const homeworkBucket = 'homework-submissions';
const mimeTypes: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
export type HomeworkAttachment = { path: string; name: string; size: number; mimeType: string };
export function validateHomeworkBytes(name: string, mimeType: string | undefined, bytes: ArrayBuffer) {
  const ext = name.split('.').at(-1)?.toLowerCase() ?? '', expected = mimeTypes[ext], signature = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength));
  if (!expected || mimeType && mimeType !== expected || bytes.byteLength < 1 || bytes.byteLength > homeworkFileMaxBytes) throw new Error('Choose an original PDF, JPG or PNG of 10 MB or less.');
  const valid = ext === 'pdf' ? String.fromCharCode(...signature.slice(0, 5)) === '%PDF-'
    : ext === 'png' ? [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => signature[i] === n) : signature[0] === 255 && signature[1] === 216 && signature[2] === 255;
  if (!valid) throw new Error('The file content does not match its PDF, JPG or PNG format.');
  return { ext, mimeType: expected, name: name.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_').replace(/^\.+/, '').trim().slice(-160) || `homework.${ext}` };
}
export async function uploadHomeworkFile(client: SupabaseClient, access: FamilyAccess, role: FamilyRole, child: FamilyChild, work: HomeworkActivity,
  file: { name: string; mimeType?: string; bytes: ArrayBuffer; id: string }, signal?: AbortSignal): Promise<HomeworkAttachment> {
  if (role !== 'student') throw new Error('Only the student can upload homework.');
  const current = await getHomework(client, access, role, child, work.id, signal), valid = validateHomeworkBytes(file.name, file.mimeType, file.bytes);
  if (!homeworkUuid(file.id)) throw new Error('The attachment could not be prepared safely.');
  const path = [...homeworkFileScope(current, child.id), `${file.id}.${valid.ext}`].join('/');
  homeworkCancelled(signal);
  const result = await client.storage.from(homeworkBucket).upload(path, file.bytes, { contentType: valid.mimeType, cacheControl: '0', upsert: false });
  if (result.error || result.data?.path !== path) {
    // shortcut: failed cleanup can leave private orphan files; add a retention sweep before wider distribution.
    await client.storage.from(homeworkBucket).remove([path]).catch(() => {});
    throw new Error('Upload was not confirmed. Select the original file and retry.');
  }
  if (signal?.aborted) {
    await client.storage.from(homeworkBucket).remove([path]).catch(() => {});
    homeworkCancelled(signal);
  }
  return { path, name: valid.name, size: file.bytes.byteLength, mimeType: valid.mimeType };
}
export async function discardHomeworkFile(client: SupabaseClient, work: HomeworkActivity, child: FamilyChild, path: string) {
  checkedHomeworkPath(path, work, child.id);
  const result = await client.storage.from(homeworkBucket).remove([path]);
  if (result.error || !result.data?.some(row => row.name === path || row.name === path.split('/').at(-1))) throw new Error('Removal was not confirmed. Refresh homework; submitted files stay protected.');
}
