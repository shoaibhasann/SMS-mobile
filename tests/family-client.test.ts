import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthRetryableFetchError } from '@supabase/supabase-js';

vi.mock('react-native-url-polyfill/auto', () => ({}));
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn(), WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0 }));
vi.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000000' }));

type ClientModule = typeof import('../src/auth/client');
let mod: ClientModule;
const seen: string[] = [];
// Tokens listed here are rejected the way PostgREST rejects an expired JWT.
const rejected = new Set<string>();
// Tokens listed here get a 403 with this body (Auth bad_jwt, or a plain RLS denial).
const forbidden = new Map<string, object>();
beforeAll(async () => {
  vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', 'https://qa-project.supabase.co');
  vi.stubEnv('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_synthetic');
  vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
    const authorization = new Headers(init?.headers).get('Authorization') ?? '';
    seen.push(authorization);
    if (init?.signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    const denial = forbidden.get(authorization.replace('Bearer ', ''));
    if (denial) return new Response(JSON.stringify(denial), { status: 403, headers: { 'Content-Type': 'application/json' } });
    if (rejected.has(authorization.replace('Bearer ', ''))) {
      return new Response(JSON.stringify({ code: 'PGRST301', message: 'JWT expired' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ id: 'guardian-a', aud: 'authenticated', role: 'authenticated' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  mod = await import('../src/auth/client');
});
afterEach(() => { seen.length = 0; rejected.clear(); forbidden.clear(); vi.restoreAllMocks(); });

describe('familyClient token binding', () => {
  it('sends the token rebound after a refresh on RPC, Auth and Storage requests of the same instance only', async () => {
    const first = mod.familyClient('token-a'), second = mod.familyClient('token-other');
    await first.rpc('get_my_family_access');
    expect(seen).toEqual(['Bearer token-a']); seen.length = 0;

    mod.rebindFamilyClient(first, 'token-b');
    await first.rpc('get_my_family_access');
    await first.auth.getUser();
    await first.storage.from('homework').upload('a/b.pdf', new Blob(['x']));
    expect(seen).toEqual(['Bearer token-b', 'Bearer token-b', 'Bearer token-b']); seen.length = 0;

    await second.rpc('get_my_family_access');
    expect(seen).toEqual(['Bearer token-other']);
  });
  it('ignores an empty token and clients it did not create', async () => {
    const client = mod.familyClient('token-a');
    expect(() => mod.rebindFamilyClient(client, '')).not.toThrow();
    expect(() => mod.rebindFamilyClient({} as never, 'token-b')).not.toThrow();
    await client.rpc('get_my_family_access');
    expect(seen).toEqual(['Bearer token-a']);
  });
});

describe('familyClient rejected-token recovery', () => {
  type Refresh = Awaited<ReturnType<ReturnType<ClientModule['schoolClient']>['auth']['refreshSession']>>;
  const renewedFor = (userId: string, token = 'token-new') => ({ data: { session: { access_token: token, user: { id: userId } }, user: { id: userId } }, error: null }) as unknown as Refresh;
  function renewal(result: () => Promise<Refresh>) { return vi.spyOn(mod.schoolClient().auth, 'refreshSession').mockImplementation(result); }

  it('renews once for concurrent rejected requests and retries each once with the new token', async () => {
    rejected.add('token-old');
    let finish!: (value: Refresh) => void;
    const refresh = renewal(() => new Promise(resolve => { finish = resolve; }));
    const client = mod.familyClient('token-old'); mod.allowSessionRenewal(client, 'guardian-a');
    // PostgREST builders only send when awaited, so start them explicitly.
    const reads = [client.rpc('a').then(result => result), client.rpc('b').then(result => result), client.auth.getUser()];
    await vi.waitFor(() => expect(seen).toHaveLength(3));
    finish(renewedFor('guardian-a'));
    const results = await Promise.all(reads);
    expect(results.every(result => !result.error)).toBe(true);
    expect(refresh).toHaveBeenCalledOnce();
    expect(seen).toEqual(['Bearer token-old', 'Bearer token-old', 'Bearer token-old', 'Bearer token-new', 'Bearer token-new', 'Bearer token-new']);
    seen.length = 0; await client.rpc('c'); expect(seen).toEqual(['Bearer token-new']);
  });
  it('does not loop when the renewed token is still rejected', async () => {
    rejected.add('token-old'); rejected.add('token-new');
    const refresh = renewal(async () => renewedFor('guardian-a'));
    const client = mod.familyClient('token-old'); mod.allowSessionRenewal(client, 'guardian-a');
    const result = await client.rpc('a');
    expect(result.status).toBe(401); expect(refresh).toHaveBeenCalledOnce();
    expect(seen).toEqual(['Bearer token-old', 'Bearer token-new']);
  });
  it('reports a network failure, not a rejection, when the renewal cannot reach the server', async () => {
    rejected.add('token-old');
    renewal(async () => ({ data: { session: null, user: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) }) as unknown as Refresh);
    const client = mod.familyClient('token-old'); mod.allowSessionRenewal(client, 'guardian-a');
    const result = await client.rpc('a');
    expect(result.status).toBe(0); expect(result.error?.message).toMatch(/network/i);
    expect(seen).toEqual(['Bearer token-old']);
  });
  it('never adopts a renewed session that belongs to another user', async () => {
    rejected.add('token-old');
    renewal(async () => renewedFor('guardian-b', 'token-other-user'));
    const client = mod.familyClient('token-old'); mod.allowSessionRenewal(client, 'guardian-a');
    expect((await client.rpc('a')).status).toBe(401);
    expect(seen).toEqual(['Bearer token-old']);
  });
  it('sends no retry after the request was aborted during the renewal', async () => {
    rejected.add('token-old');
    const controller = new AbortController();
    renewal(async () => { controller.abort(); return renewedFor('guardian-a'); });
    const client = mod.familyClient('token-old'); mod.allowSessionRenewal(client, 'guardian-a');
    const result = await client.rpc('a').abortSignal(controller.signal);
    expect(result.error).toBeTruthy(); expect(seen.filter(value => value === 'Bearer token-new')).toHaveLength(0);
  });
  it('renews on an Auth 403 bad_jwt but never on a plain 403 permission denial', async () => {
    forbidden.set('token-old', { code: 403, error_code: 'bad_jwt', msg: 'invalid JWT' });
    const refresh = renewal(async () => renewedFor('guardian-a'));
    const client = mod.familyClient('token-old'); mod.allowSessionRenewal(client, 'guardian-a');
    expect((await client.auth.getUser()).error).toBeNull();
    expect(refresh).toHaveBeenCalledOnce(); expect(seen).toEqual(['Bearer token-old', 'Bearer token-new']);
    seen.length = 0; refresh.mockClear(); forbidden.set('token-rls', { code: '42501', message: 'permission denied' });
    const denied = mod.familyClient('token-rls'); mod.allowSessionRenewal(denied, 'guardian-a');
    expect((await denied.rpc('a')).status).toBe(403);
    expect(refresh).not.toHaveBeenCalled(); expect(seen).toEqual(['Bearer token-rls']);
  });
  it('leaves a client without renewal (the provider access probe) to its own single refresh', async () => {
    rejected.add('token-old');
    const refresh = renewal(async () => renewedFor('guardian-a'));
    const result = await mod.familyClient('token-old').rpc('a');
    expect(result.status).toBe(401); expect(refresh).not.toHaveBeenCalled(); expect(seen).toEqual(['Bearer token-old']);
  });
});
