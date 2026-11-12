import 'react-native-url-polyfill/auto';
import { createClient, isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { createSecureSessionStorage } from './secure-storage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
export const configError = !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || !key
  ? 'School connection is missing. Configure the mobile Supabase URL and publishable key.' : null;
let singleton: SupabaseClient | null = null;
export function schoolClient() {
  if (configError) throw new Error(configError);
  if (!singleton) singleton = createClient(url, key, { auth: {
    storage: createSecureSessionStorage({
      getItemAsync: key => SecureStore.getItemAsync(key),
      setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
      deleteItemAsync: key => SecureStore.deleteItemAsync(key),
    }, Crypto.randomUUID),
    autoRefreshToken: true, persistSession: true, detectSessionInUrl: false,
  } });
  return singleton;
}

type Binding = { token: string; userId: string | null };
const bindings = new WeakMap<SupabaseClient, Binding>();
// One refresh shared by every family request rejected at the same time; 'offline' means the refresh never reached Auth.
let renewing: Promise<{ userId: string; token: string } | 'offline' | null> | null = null;
function renewSession() {
  return renewing ??= schoolClient().auth.refreshSession().then(
    ({ data, error }) => error ? (isAuthRetryableFetchError(error) ? 'offline' as const : null)
      : data.session ? { userId: data.session.user.id, token: data.session.access_token } : null,
    () => 'offline' as const,
  ).finally(() => { renewing = null; });
}
// PostgREST answers an expired/invalid JWT with 401; Auth (getUser) with 403 bad_jwt.
async function rejectedToken(response: Response) {
  if (response.status === 401) return true;
  if (response.status !== 403) return false;
  const body = await response.clone().json().catch(() => null) as { error_code?: unknown } | null;
  return body?.error_code === 'bad_jwt';
}
export function familyClient(accessToken: string) {
  if (configError || !accessToken) throw new Error('A verified school session is required.');
  // Bind reads/writes to one session; stale UI callbacks must never borrow the next account's token.
  // Only a same-user token refresh may rotate this instance's token (rebindFamilyClient); a new account always gets a new client.
  const bound: Binding = { token: accessToken, userId: null };
  const send = (input: RequestInfo | URL, init: RequestInit | undefined, token: string) => {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
      // A device clock behind the server keeps sending a token the server already rejects: renew once, retry once.
      fetch: async (input, init) => {
        const used = bound.token, response = await send(input, init, used);
        if (!bound.userId || !(await rejectedToken(response))) return response;
        if (bound.token === used) {
          const renewed = await renewSession();
          if (renewed === 'offline') throw new TypeError('Network request failed while renewing the sign-in.');
          if (renewed?.userId === bound.userId && bound.token === used) bound.token = renewed.token;
        }
        if (init?.signal?.aborted) throw Object.assign(new Error('Request cancelled.'), { name: 'AbortError' });
        return bound.token === used ? response : send(input, init, bound.token);
      },
    },
  });
  bindings.set(client, bound);
  return client;
}
// Only the published workspace client renews; the provider's access probe does its own single refresh.
export function allowSessionRenewal(client: SupabaseClient, userId: string) {
  const bound = bindings.get(client);
  if (bound && userId) bound.userId = userId;
}
export function rebindFamilyClient(client: SupabaseClient, accessToken: string) {
  const bound = bindings.get(client);
  if (bound && accessToken) bound.token = accessToken;
}

export function mfaClient(signal?: AbortSignal) {
  if (configError) throw new Error(configError);
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `staff-mfa-${Crypto.randomUUID()}` },
    global: signal ? { fetch: (input, init) => fetch(input, { ...init, signal }) } : undefined,
  });
}
