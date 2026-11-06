import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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

export function familyClient(accessToken: string) {
  if (configError || !accessToken) throw new Error('A verified school session is required.');
  // Bind reads/writes to one session; stale UI callbacks must never borrow the next account's token.
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
