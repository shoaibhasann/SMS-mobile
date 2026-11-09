import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { loadGateAlertPreferences, saveGateAlertPreferences, type GateAlertPreference } from '../src/data/gate-alerts';
import { loadFamilyNotificationInbox, markFamilyNotificationRead } from '../src/data/notifications';

const id = (n: number) => `79000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row: GateAlertPreference = { student_id: id(2), student_name: 'Gate QA child', preference_id: id(3), arrival_enabled: false, exit_enabled: false, version: 0 };
function fixture(data: unknown, error: { code: string } | null = null) {
  const abortSignal = vi.fn().mockResolvedValue({ data, error });
  const rpc = vi.fn().mockReturnValue(Object.assign(Promise.resolve({ data, error }), { abortSignal }));
  return { client: { rpc } as unknown as SupabaseClient, rpc, abortSignal };
}
describe('native Guardian gate preferences', () => {
  it('verifies the captured owner, whitelists the link epoch and shows saved OFF defaults', async () => {
    const f = fixture({ user_id: id(1), children: [{ ...row, private_contact: 'omitted' }] }), signal = new AbortController().signal;
    expect(await loadGateAlertPreferences(f.client, id(1), signal)).toEqual([row]);
    expect(f.rpc).toHaveBeenCalledWith('get_my_gate_alert_preferences'); expect(f.abortSignal).toHaveBeenCalledWith(signal);
  });
  it.each([{ user_id: id(9), children: [row] }, { user_id: id(1), children: [row, row] },
    { user_id: id(1), children: [{ ...row, preference_id: 'bad' }] }, { user_id: id(1), children: [{ ...row, arrival_enabled: 'true' }] },
    { user_id: id(1), children: [{ ...row, version: -1 }] }, { user_id: id(1), children: [row, { ...row, student_id: id(9) }] }])(
    'denies mismapped or incomplete preference responses %j', async data => {
      await expect(loadGateAlertPreferences(fixture(data).client, id(1))).rejects.toThrow('could not be verified');
    });
  it('uses the immutable link epoch and exact version rather than a mutable pupil-ID setter', async () => {
    const next = { ...row, arrival_enabled: true }, saved = { ...next, version: 1 }, f = fixture({ ...saved, user_id: id(1) });
    expect(await saveGateAlertPreferences(f.client, id(1), next)).toEqual(saved);
    expect(f.rpc).toHaveBeenCalledWith('set_my_gate_alert_preferences', { p_preference_id: row.preference_id, p_expected_version: 0, p_arrival_enabled: true, p_exit_enabled: false });
  });
  it.each([{ user_id: id(9) }, { preference_id: id(9) }, { student_id: id(9) }, { arrival_enabled: false }, { version: 10 }])(
    'rejects delayed or incoherent write acknowledgements %j', async patch => {
      const f = fixture({ ...row, arrival_enabled: true, version: 1, user_id: id(1), ...patch });
      await expect(saveGateAlertPreferences(f.client, id(1), { ...row, arrival_enabled: true })).rejects.toThrow('could not be verified');
    });
  it.each([['PT409', 'another session'], ['42501', 'access changed'], ['XX000', 'could not be confirmed']])(
    'requires reconciliation for %s rather than retrying an old opt-in', async (code, message) => {
      await expect(saveGateAlertPreferences(fixture(null, { code }).client, id(1), row)).rejects.toThrow(message);
    });
  it('does not start or expose a cancelled preference request', async () => {
    const f = fixture({ user_id: id(1), children: [row] }), controller = new AbortController(); controller.abort();
    await expect(loadGateAlertPreferences(f.client, id(1), controller.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(f.rpc).not.toHaveBeenCalled();
  });
});

const arrival = { id: id(4), kind: 'gate_arrival', student_id: id(2), student_name: 'Gate QA child', source_id: id(5),
  created_at: '2026-11-07T04:00:00Z', occurred_at: '2026-11-07T03:00:00Z', delayed: true, read_at: null,
  event_date: '2026-11-07', status: 'IN', title: 'Arrived at school', assessment_id: null };
describe('native gate alerts in the exam-capable inbox', () => {
  it('decodes actual event time/delay and the gate cursor through v8', async () => {
    const cursor = { id: arrival.id, kind: arrival.kind, created_at: arrival.created_at };
    const f = fixture({ user_id: id(1), role: 'parent', notifications: [arrival], unread_count: 1, next_cursor: cursor });
    const inbox = await loadFamilyNotificationInbox(f.client, { userId: id(1), role: 'parent', limit: 1 });
    expect(inbox.notifications).toEqual([arrival]); expect(inbox.next_cursor).toEqual(cursor);
    expect(f.rpc.mock.calls[0][0]).toBe('get_family_notification_inbox_v8');
  });
  it.each([{ occurred_at: null }, { delayed: 'yes' }, { status: 'OUT' }, { occurred_at: 'bad' }, { occurred_at: '2026-11-07T08:00:00' }])('rejects false arrival metadata %j', async patch => {
    await expect(loadFamilyNotificationInbox(fixture({ user_id: id(1), role: 'parent', notifications: [{ ...arrival, ...patch }], unread_count: 1, next_cursor: null }).client,
      { userId: id(1), role: 'parent' })).rejects.toThrow('could not be verified');
  });
  it('rejects a Guardian gate alert returned to a Student view', async () => {
    await expect(loadFamilyNotificationInbox(fixture({ user_id: id(1), role: 'student', notifications: [arrival], unread_count: 1, next_cursor: null }).client,
      { userId: id(1), role: 'student' })).rejects.toThrow('could not be verified');
  });
  it('keeps per-recipient read writes in the v8 contract', async () => {
    const f = fixture(arrival.created_at); expect(await markFamilyNotificationRead(f.client, 'parent', 'gate_arrival', arrival.id)).toBe(arrival.created_at);
    expect(f.rpc).toHaveBeenCalledWith('mark_family_notification_read_v8', { p_role: 'parent', p_kind: 'gate_arrival', p_id: arrival.id });
  });
  it('never starts a Student gate-mark mutation', async () => {
    const f = fixture(null);
    await expect(markFamilyNotificationRead(f.client, 'student', 'gate_arrival', arrival.id)).rejects.toThrow('could not be verified');
    expect(f.rpc).not.toHaveBeenCalled();
  });
});
