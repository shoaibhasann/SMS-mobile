import type { SupabaseClient } from '@supabase/supabase-js';
import { familyClient, mfaClient } from './client';

export type MfaStatus = {
  user_id: string; required: boolean; allowed: boolean;
  action: 'none' | 'enroll' | 'challenge' | 'sign_in'; current_aal: 'aal1' | 'aal2';
  verified_totp_count: number;
};
export type MfaFactor = { id: string; friendly_name?: string; created_at: string };
const denied = () => new Error('Your security session changed. Sign in again or retry.');
function cancelled(signal?: AbortSignal) {
  if (signal?.aborted) { const error = new Error('Verification cancelled.'); error.name = 'AbortError'; throw error; }
}
export function parseMfaStatus(value: unknown, userId: string): MfaStatus {
  const row = value as Partial<MfaStatus> | null;
  if (!row || typeof row !== 'object' || Array.isArray(row) || !userId || row.user_id !== userId
    || typeof row.required !== 'boolean' || typeof row.allowed !== 'boolean'
    || !['none', 'enroll', 'challenge', 'sign_in'].includes(String(row.action))
    || !['aal1', 'aal2'].includes(String(row.current_aal))
    || !Number.isSafeInteger(row.verified_totp_count) || Number(row.verified_totp_count) < 0
    || row.allowed !== (row.action === 'none') || (row.required && row.allowed && row.current_aal !== 'aal2')) throw denied();
  return row as MfaStatus;
}
export async function readMfaStatus(client: SupabaseClient, userId: string, signal?: AbortSignal): Promise<MfaStatus> {
  cancelled(signal);
  const query = client.rpc('get_my_staff_mfa_status');
  const result = await (signal ? query.abortSignal(signal) : query);
  cancelled(signal);
  if (result.error) {
    const error = denied();
    // An expired or rejected JWT: the provider renews the session once instead of reporting a connection problem.
    if (result.status === 401 || ['PGRST301', 'PGRST303'].includes(result.error.code ?? '')) error.name = 'SessionRejected';
    throw error;
  }
  return parseMfaStatus(result.data, userId);
}
async function ownedSession(primary: SupabaseClient, userId: string, signal?: AbortSignal) {
  cancelled(signal);
  const result = await primary.auth.getSession();
  cancelled(signal);
  const session = result.data.session;
  if (result.error || !session || session.user.id !== userId) throw denied();
  const identity = await primary.auth.getUser(session.access_token);
  cancelled(signal);
  if (identity.error || identity.data.user?.id !== userId || identity.data.user.is_anonymous) throw denied();
  return session;
}
async function isolatedClient(primary: SupabaseClient, userId: string, signal?: AbortSignal) {
  const snapshot = await ownedSession(primary, userId, signal), isolated = mfaClient(signal);
  const result = await isolated.auth.setSession({ access_token: snapshot.access_token, refresh_token: snapshot.refresh_token });
  cancelled(signal);
  if (result.error || result.data.user?.id !== userId) throw denied();
  return isolated;
}
export async function listMfaFactors(primary: SupabaseClient, userId: string, signal?: AbortSignal): Promise<MfaFactor[]> {
  const isolated = await isolatedClient(primary, userId, signal);
  const result = await isolated.auth.mfa.listFactors();
  cancelled(signal);
  if (result.error || !result.data) throw denied();
  return result.data.totp;
}
export async function verifyMfa(primary: SupabaseClient, userId: string, factorId: string, code: string, signal?: AbortSignal): Promise<void> {
  if (!/^\d{6}$/.test(code) || !factorId) throw new Error('Enter the latest six-digit code from your authenticator.');
  const isolated = await isolatedClient(primary, userId, signal);
  const result = await isolated.auth.mfa.challengeAndVerify({ factorId, code });
  cancelled(signal);
  if (result.error) {
    if (result.error.status === 429) throw new Error('Too many attempts. Wait before trying again.');
    if (['mfa_verification_failed', 'mfa_challenge_expired', 'validation_failed'].includes(result.error.code ?? '')) {
      throw new Error('That code was not accepted. Use the latest code and try again.');
    }
    throw denied();
  }
  await ownedSession(primary, userId, signal);
  // Refresh the current session; never copy a delayed isolated account's tokens to shared storage.
  const refreshed = await primary.auth.refreshSession();
  cancelled(signal);
  if (refreshed.error || refreshed.data.user?.id !== userId || !refreshed.data.session) throw denied();
  const status = await readMfaStatus(familyClient(refreshed.data.session.access_token), userId, signal);
  if (!status.allowed) throw denied();
}
