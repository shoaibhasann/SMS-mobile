import type { SupabaseClient } from '@supabase/supabase-js';

export type GateAlertPreference = {
  student_id: string; student_name: string; preference_id: string;
  arrival_enabled: boolean; exit_enabled: boolean; version: number;
};
export class GateAlertError extends Error {
  constructor(message: string, readonly code: 'access' | 'conflict' | 'unconfirmed' = 'unconfirmed') { super(message); }
}
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const invalid = () => new Error('Gate alert settings could not be verified. Refresh saved settings before changing them.');
function cancelled(signal?: AbortSignal) {
  if (signal?.aborted) { const error = new Error('Gate alert action cancelled.'); error.name = 'AbortError'; throw error; }
}
function preference(value: unknown): GateAlertPreference {
  const row = record(value);
  if (!uuid(row.student_id) || !uuid(row.preference_id) || typeof row.student_name !== 'string' || !row.student_name.trim()
    || typeof row.arrival_enabled !== 'boolean' || typeof row.exit_enabled !== 'boolean'
    || !Number.isSafeInteger(row.version) || Number(row.version) < 0) throw invalid();
  return { student_id: row.student_id, student_name: row.student_name, preference_id: row.preference_id,
    arrival_enabled: row.arrival_enabled, exit_enabled: row.exit_enabled, version: row.version as number };
}
function checkError(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === '42501') throw new GateAlertError('Your child access changed. Refresh school access before changing gate alerts.', 'access');
  if (error.code === 'PT409') throw new GateAlertError('Gate alert settings changed in another session. Refresh saved settings before retrying.', 'conflict');
  throw new GateAlertError('The change could not be confirmed. Refresh saved settings before retrying.');
}

// The Auth provider supplies one immutable-JWT familyClient, never a shared mutable Auth client.
export async function loadGateAlertPreferences(client: SupabaseClient, userId: string, signal?: AbortSignal): Promise<GateAlertPreference[]> {
  if (!uuid(userId)) throw invalid(); cancelled(signal);
  const query = client.rpc('get_my_gate_alert_preferences');
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  cancelled(signal); checkError(error);
  const row = record(data);
  if (row.user_id !== userId || !Array.isArray(row.children) || row.children.length > 1500) throw invalid();
  const children = row.children.map(preference);
  if (new Set(children.map(child => child.student_id)).size !== children.length
    || new Set(children.map(child => child.preference_id)).size !== children.length) throw invalid();
  return children;
}

export async function saveGateAlertPreferences(client: SupabaseClient, userId: string, value: GateAlertPreference, signal?: AbortSignal): Promise<GateAlertPreference> {
  if (!uuid(userId)) throw invalid();
  const next = preference(value); cancelled(signal);
  const query = client.rpc('set_my_gate_alert_preferences', { p_preference_id: next.preference_id, p_expected_version: next.version,
    p_arrival_enabled: next.arrival_enabled, p_exit_enabled: next.exit_enabled });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  cancelled(signal); checkError(error);
  const row = record(data), saved = preference(row);
  if (row.user_id !== userId || saved.student_id !== next.student_id || saved.preference_id !== next.preference_id
    || saved.arrival_enabled !== next.arrival_enabled || saved.exit_enabled !== next.exit_enabled
    || ![next.version, next.version + 1].includes(saved.version)) throw invalid();
  return saved;
}
