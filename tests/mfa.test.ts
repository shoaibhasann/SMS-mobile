import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listMfaFactors, parseMfaStatus, readMfaStatus, verifyMfa } from '../src/auth/mfa';

const clients = vi.hoisted(() => ({ mfa: vi.fn(), family: vi.fn() }));
vi.mock('../src/auth/client', () => ({ mfaClient: clients.mfa, familyClient: clients.family }));
const status = { user_id: 'a', required: true, allowed: false, action: 'challenge', current_aal: 'aal1', verified_totp_count: 1 };
function fixture() {
  const session = { user: { id: 'a' }, access_token: 'private-a', refresh_token: 'private-refresh-a' };
  const isolated = { auth: { setSession: vi.fn(async () => ({ data: { user: { id: 'a' } }, error: null })), mfa: {
    listFactors: vi.fn(async () => ({ data: { totp: [{ id: 'factor-a', created_at: '2026-11-07T00:00:00Z' }] }, error: null })),
    challengeAndVerify: vi.fn(async () => ({ data: { access_token: 'isolated-a' }, error: null as unknown })),
  } } };
  const primary = { auth: {
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    getUser: vi.fn(async () => ({ data: { user: { id: 'a' } }, error: null })),
    refreshSession: vi.fn(async () => ({ data: { user: { id: 'a' }, session: { ...session, access_token: 'current-aal2' } }, error: null })),
    setSession: vi.fn(),
  } };
  const rpc = vi.fn(() => ({ abortSignal: vi.fn(async () => ({ data: { ...status, allowed: true, action: 'none', current_aal: 'aal2' }, error: null })) }));
  clients.mfa.mockReturnValue(isolated); clients.family.mockReturnValue({ rpc });
  return { primary: primary as unknown as SupabaseClient, auth: primary.auth, isolated, rpc };
}
beforeEach(() => vi.clearAllMocks());
describe('Native MFA trust boundaries', () => {
  it('rejects a foreign identity and contradictory assurance decisions', () => {
    expect(() => parseMfaStatus(status, 'b')).toThrow('security session');
    expect(() => parseMfaStatus({ ...status, allowed: true }, 'a')).toThrow();
    expect(() => parseMfaStatus({ ...status, allowed: true, action: 'none' }, 'a')).toThrow();
    expect(parseMfaStatus(status, 'a')).toEqual(status);
  });
  it('pins isolated MFA operations to the verified captured owner and refreshes without copying tokens', async () => {
    const f = fixture(); await verifyMfa(f.primary, 'a', 'factor-a', '123456', new AbortController().signal);
    expect(f.auth.getUser).toHaveBeenCalledWith('private-a');
    expect(f.isolated.auth.setSession).toHaveBeenCalledWith({ access_token: 'private-a', refresh_token: 'private-refresh-a' });
    expect(f.auth.refreshSession).toHaveBeenCalledWith(); expect(f.auth.setSession).not.toHaveBeenCalled();
    expect(clients.family).toHaveBeenCalledWith('current-aal2'); expect(f.rpc).toHaveBeenCalledWith('get_my_staff_mfa_status');
  });
  it('does not refresh or overwrite B when an isolated A verification resolves late', async () => {
    const f = fixture();
    f.auth.getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'a' }, access_token: 'private-a', refresh_token: 'private-refresh-a' } }, error: null })
      .mockResolvedValue({ data: { session: { user: { id: 'b' }, access_token: 'private-b', refresh_token: 'private-refresh-b' } }, error: null });
    await expect(verifyMfa(f.primary, 'a', 'factor-a', '123456')).rejects.toThrow('security session');
    expect(f.auth.refreshSession).not.toHaveBeenCalled(); expect(f.auth.setSession).not.toHaveBeenCalled();
  });
  it('never verifies a code against a foreign or unverified captured identity', async () => {
    const f = fixture(); f.auth.getUser.mockResolvedValue({ data: { user: { id: 'b' } }, error: null });
    await expect(verifyMfa(f.primary, 'a', 'factor-a', '123456')).rejects.toThrow();
    expect(f.isolated.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });
  it('rejects malformed codes before provider mutation and makes wrong codes retryable', async () => {
    const f = fixture(); await expect(verifyMfa(f.primary, 'a', 'factor-a', '123')).rejects.toThrow('six-digit');
    expect(clients.mfa).not.toHaveBeenCalled();
    f.isolated.auth.mfa.challengeAndVerify.mockResolvedValueOnce({ data: { access_token: '' }, error: { code: 'mfa_verification_failed' } });
    await expect(verifyMfa(f.primary, 'a', 'factor-a', '123456')).rejects.toThrow('not accepted');
    expect(f.auth.refreshSession).not.toHaveBeenCalled();
  });
  it('cancels before provider calls and does not trust successful Auth without a fresh database decision', async () => {
    const f = fixture(), controller = new AbortController(); controller.abort();
    await expect(listMfaFactors(f.primary, 'a', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(clients.mfa).not.toHaveBeenCalled();
    const query = { abortSignal: vi.fn(async () => ({ data: status, error: null })) };
    f.rpc.mockReturnValue(query as unknown as ReturnType<typeof f.rpc>);
    await expect(verifyMfa(f.primary, 'a', 'factor-a', '123456', new AbortController().signal)).rejects.toThrow('security session');
  });
  it('allows the own-status bootstrap read without attempting a protected table read', async () => {
    const query = { abortSignal: vi.fn(async () => ({ data: status, error: null })) }, client = { rpc: vi.fn(() => query), from: vi.fn() };
    expect(await readMfaStatus(client as unknown as SupabaseClient, 'a', new AbortController().signal)).toEqual(status);
    expect(client.rpc).toHaveBeenCalledWith('get_my_staff_mfa_status'); expect(client.from).not.toHaveBeenCalled();
  });
});
describe('server-rejected session token', () => {
  const read = (reply: unknown) => readMfaStatus({ rpc: vi.fn(() => ({ abortSignal: vi.fn(async () => reply) })) } as unknown as SupabaseClient, 'a', new AbortController().signal);
  it('marks a 401 or PostgREST JWT rejection so the caller can renew the session, and keeps other failures plain', async () => {
    for (const reply of [{ data: null, status: 401, error: { message: 'JWT expired' } }, { data: null, status: 400, error: { code: 'PGRST301' } }, { data: null, error: { code: 'PGRST303' } }]) {
      await expect(read(reply)).rejects.toMatchObject({ name: 'SessionRejected', message: expect.stringContaining('security session') });
    }
    const other = await read({ data: null, status: 500, error: { code: '500' } }).catch((error: Error) => error);
    expect((other as Error).name).toBe('Error');
  });
});
