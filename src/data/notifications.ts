import type { SupabaseClient } from "@supabase/supabase-js";

export type FamilyNotificationRole = "parent" | "student";
export type FamilyNotificationKind = "absence" | "result_published" | "leave_decision" | "gate_arrival" | "gate_exit";
export type FamilyNotificationCursor = { created_at: string; kind: FamilyNotificationKind; id: string };
export type FamilyNotification = {
  id: string; kind: FamilyNotificationKind; student_id: string; student_name: string;
  created_at: string; read_at: string | null; event_date: string; source_id: string;
  status: "absent" | "published" | "approved" | "rejected" | "IN" | "OUT"; title: string; assessment_id: string | null;
  occurred_at: string | null; delayed: boolean;
};
export type FamilyNotificationInbox = {
  notifications: FamilyNotification[]; unread_count: number; next_cursor: FamilyNotificationCursor | null;
};

const kinds: readonly string[] = ["absence", "result_published", "leave_decision", "gate_arrival", "gate_exit"];
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && value.includes("T");
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const invalid = () => new Error("The notification records could not be verified. Refresh to try again.");

function role(value: FamilyNotificationRole) {
  if (value !== "parent" && value !== "student") throw new Error("Choose a valid family notification view.");
  return value;
}
function count(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < 0) throw invalid();
  return number;
}
function cursor(value: unknown): FamilyNotificationCursor {
  const row = record(value);
  if (!uuid(row.id) || !timestamp(row.created_at) || !kinds.includes(row.kind as string)) throw invalid();
  return { id: row.id, created_at: row.created_at, kind: row.kind as FamilyNotificationKind };
}
function notification(value: unknown): FamilyNotification {
  const row = record(value);
  const gate = row.kind === 'gate_arrival' || row.kind === 'gate_exit';
  const date = typeof row.event_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.event_date)
    && !row.event_date.startsWith("0000") && Number.isFinite(Date.parse(`${row.event_date}T00:00:00Z`))
    && new Date(`${row.event_date}T00:00:00Z`).toISOString().slice(0, 10) === row.event_date;
  if (!uuid(row.id) || !uuid(row.student_id) || !uuid(row.source_id) || !timestamp(row.created_at)
    || !(row.read_at === null || timestamp(row.read_at)) || !date
    || typeof row.student_name !== "string" || !row.student_name.trim()
    || typeof row.title !== "string" || !row.title.trim()
    || !(row.kind === "absence" && row.status === "absent" && row.assessment_id === null
      || row.kind === "result_published" && row.status === "published" && uuid(row.assessment_id)
      || row.kind === "leave_decision" && ["approved", "rejected"].includes(row.status as string) && row.assessment_id === null
      || row.kind === "gate_arrival" && row.status === 'IN' && row.assessment_id === null
      || row.kind === "gate_exit" && row.status === 'OUT' && row.assessment_id === null)
    || typeof row.delayed !== 'boolean' || (gate ? !timestamp(row.occurred_at) || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(row.occurred_at) : row.occurred_at !== null || row.delayed)) throw invalid();
  return {
    id: row.id, kind: row.kind as FamilyNotificationKind, student_id: row.student_id, student_name: row.student_name,
    created_at: row.created_at, read_at: row.read_at as string | null, event_date: row.event_date as string,
    source_id: row.source_id, status: row.status as FamilyNotification["status"], title: row.title, assessment_id: row.assessment_id as string | null,
    occurred_at: row.occurred_at as string | null, delayed: row.delayed,
  };
}
function rpcError(error: { code?: string } | null) {
  if (!error) return;
  if (["PGRST202", "42883"].includes(error.code ?? "")) throw new Error("Notifications need the latest school update. Contact your administrator.");
  if (error.code === "42501") throw new Error("Your notification access changed. Reopen this page after signing in.");
  throw new Error("Notifications could not be confirmed. Refresh to check the saved status before retrying.");
}

export async function loadFamilyNotificationInbox(client: SupabaseClient, options: {
  role: FamilyNotificationRole; unreadOnly?: boolean; cursor?: FamilyNotificationCursor | null; limit?: number;
}, signal?: AbortSignal): Promise<FamilyNotificationInbox> {
  const limit = options.limit ?? 30;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || (options.unreadOnly !== undefined && typeof options.unreadOnly !== "boolean")) throw invalid();
  const before = options.cursor ? cursor(options.cursor) : null;
  const request = client.rpc("get_family_notification_inbox_v2", {
    p_role: role(options.role), p_unread_only: options.unreadOnly ?? false, p_limit: limit,
    p_before_created_at: before?.created_at ?? null, p_before_kind: before?.kind ?? null, p_before_id: before?.id ?? null,
  });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  rpcError(error);
  const result = record(data);
  if (!Array.isArray(result.notifications) || result.notifications.length > limit) throw invalid();
  const rows = result.notifications.map(notification);
  if (options.role === 'student' && rows.some(row => row.kind === 'gate_arrival' || row.kind === 'gate_exit')) throw invalid();
  if (new Set(rows.map((row) => `${row.kind}:${row.id}`)).size !== rows.length
    || options.unreadOnly && rows.some((row) => row.read_at !== null)) throw invalid();
  const next = result.next_cursor === null ? null : cursor(result.next_cursor);
  const last = rows.at(-1);
  if (next && (!last || next.id !== last.id || next.kind !== last.kind || next.created_at !== last.created_at)) throw invalid();
  if (next && before && next.id === before.id && next.kind === before.kind && next.created_at === before.created_at) throw invalid();
  return { notifications: rows, unread_count: count(result.unread_count), next_cursor: next };
}

export async function loadFamilyNotificationUnreadCount(client: SupabaseClient, view: FamilyNotificationRole, signal?: AbortSignal) {
  const request = client.rpc("get_family_notification_unread_count_v2", { p_role: role(view) });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  rpcError(error); return count(data);
}

export async function markFamilyNotificationRead(client: SupabaseClient, view: FamilyNotificationRole,
  kind: FamilyNotificationKind, id: string, signal?: AbortSignal): Promise<string | null> {
  if (!kinds.includes(kind) || !uuid(id) || view === 'student' && (kind === 'gate_arrival' || kind === 'gate_exit')) throw invalid();
  const request = client.rpc("mark_family_notification_read_v2", { p_role: role(view), p_kind: kind, p_id: id });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  rpcError(error);
  if (data !== null && !timestamp(data)) throw invalid();
  return data;
}

export async function markAllFamilyNotificationsRead(client: SupabaseClient, view: FamilyNotificationRole, signal?: AbortSignal) {
  const request = client.rpc("mark_all_family_notifications_read_v2", { p_role: role(view) });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  rpcError(error); return count(data);
}
