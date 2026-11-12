import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js';
import { schoolClient, familyClient, rebindFamilyClient, allowSessionRenewal, configError } from './client';
import { createSessionGate, SessionTransitionError } from './session-gate';
import { signInCredentials } from './credentials';
import { readMfaStatus, verifyMfa, type MfaStatus } from './mfa';
import { readFamilyAccess, type FamilyAccess, type FamilyRole } from '../data';
import { cleanupSavedPushOnAuthLoss, disconnectNativePush } from '../push';

type Recovery = 'endSession' | 'finishSignOut' | null;
type AccessState = { status: 'checking' | 'signedOut' | 'ready' | 'error' | 'mfa'; access: FamilyAccess | null; client: SupabaseClient | null; error: string | null; recovery: Recovery; mfa: MfaStatus | null };
type Refreshed = { userId: string; token: string };
type Owner = { userId: string; schoolId: string; role: FamilyRole; client: SupabaseClient };
type Auth = AccessState & {
  role: FamilyRole; revision: number; tokenRevision: number; foreground: boolean;
  signIn(identifier: string, password: string): Promise<void>;
  signOut(): Promise<void>; chooseRole(role: FamilyRole): Promise<void>; refresh(): void;
  verifyAuthenticator(factorId: string, code: string): Promise<void>;
  whileExternal<T>(work: () => Promise<T>): Promise<T>;
};
const Context = createContext<Auth | null>(null);
const empty = (status: AccessState['status'], error: string | null = null, recovery: Recovery = null): AccessState => ({ status, access: null, client: null, error, recovery, mfa: null });
const disconnect = (owner: Owner) => disconnectNativePush({ client: owner.client, userId: owner.userId, role: owner.role });
// The last chosen workspace, per user, so a mixed-role account reopens where its push binding and work live.
const roleKey = 'sms.family.role.v1', roleOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
async function readSavedRole(userId: string): Promise<FamilyRole | null> {
  try {
    const saved = JSON.parse(await SecureStore.getItemAsync(roleKey, roleOptions) ?? 'null') as { userId?: unknown; role?: unknown } | null;
    return saved?.userId === userId && (saved.role === 'parent' || saved.role === 'student') ? saved.role : null;
  } catch { return null; }
}
const saveRole = (userId: string, role: FamilyRole) => SecureStore.setItemAsync(roleKey, JSON.stringify({ userId, role }), roleOptions).catch(() => {});
// Sign-out leaves no previous user's id on the phone; a failed delete only costs a preference.
const forgetRole = () => SecureStore.deleteItemAsync(roleKey, roleOptions).catch(() => {});
const deniedCopy = (error: unknown) => error instanceof Error && error.name === 'FamilyAccessDenied' ? error.message
  : error instanceof Error && error.name === 'SessionRejected' ? 'Your sign-in could not be renewed. Check that the phone’s date and time are set automatically, then try again.'
    : 'Could not verify school access. Check your connection and try again.';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccessState>(() => empty(configError ? 'error' : 'checking', configError));
  const [role, setRoleState] = useState<FamilyRole>('parent');
  // The access read reads the role from a ref: publishing the restored role must not start a second read.
  const roleRef = useRef<FamilyRole>('parent');
  const setRole = useCallback((next: FamilyRole) => { roleRef.current = next; setRoleState(next); }, []);
  const [revision, setRevision] = useState(0);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [gate] = useState(createSessionGate);
  const owner = useRef<Owner | null>(null);
  const restoreRole = useRef(true);
  const refreshed = useRef<Refreshed | null>(null);
  const [tokenRevision, setTokenRevision] = useState(0);
  const mfaWork = useRef<AbortController | null>(null);
  const mounted = useRef(true), signedOut = useRef(false), pushCleared = useRef(false);
  const external = useRef(0), externalPause = useRef(false);
  const whileExternal = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    external.current += 1;
    try { return await work(); } finally { external.current -= 1; }
  }, []);
  const hasCleanSignOut = useCallback(() => signedOut.current && pushCleared.current
    && !owner.current && !gate.running && !gate.blocked, [gate]);
  const clear = useCallback(() => {
    gate.invalidate();
    if (!mounted.current) return;
    if (!gate.blocked || gate.running) setState(empty('checking'));
    setRevision(value => value + 1);
  }, [gate]);
  const confirmSignedOut = useCallback(() => {
    signedOut.current = true;
    gate.invalidate();
    if (!mounted.current || gate.running) return;
    if (hasCleanSignOut()) {
      setState(current => current.status === 'signedOut' ? current : empty('signedOut'));
      return;
    }
    setState(empty('checking'));
    void gate.run('authLoss', async () => {
      if (!pushCleared.current && !(await cleanupSavedPushOnAuthLoss()).nativeCleared) {
        throw new Error('Phone notification cleanup is incomplete. Retry signing out before sharing this phone.');
      }
      owner.current = null;
      pushCleared.current = true;
      await forgetRole(); setRole('parent');
    }).then(() => {
      if (mounted.current) {
        if (signedOut.current) setState(empty('signedOut'));
        else clear();
      }
    }).catch(() => {
      if (mounted.current) setState(empty('error', 'Could not disconnect school alerts from this phone. Finish signing out to continue.', 'finishSignOut'));
    });
  }, [clear, gate, hasCleanSignOut, setRole]);

  useEffect(() => {
    mounted.current = true;
    if (configError) return () => { mounted.current = false; gate.invalidate(); };
    const client = schoolClient();
    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) { refreshed.current = null; confirmSignedOut(); }
      // A same-user token rotation only rebinds the token: rechecking here loops forever when a fast device clock
      // makes every getSession() refresh. An in-flight read already got the new token from getSession().
      else if (event === 'TOKEN_REFRESHED' && !signedOut.current && (!owner.current || owner.current.userId === session.user.id)) {
        refreshed.current = { userId: session.user.id, token: session.access_token };
        if (owner.current) { rebindFamilyClient(owner.current.client, session.access_token); setTokenRevision(value => value + 1); }
      } else { signedOut.current = false; pushCleared.current = false; clear(); }
    });
    const subscription = AppState.addEventListener('change', next => {
      // An app-opened picker (Android DocumentsUI) pauses the activity; keep the screen and its pending work mounted.
      if (next !== 'active' && external.current > 0) { externalPause.current = true; return; }
      setForeground(next === 'active');
      // Android's autofill picker backgrounds the app and needs the signed-out inputs to stay mounted.
      const keepLogin = hasCleanSignOut();
      if (next === 'active') {
        client.auth.startAutoRefresh();
        // The picker may resolve before 'active' arrives, so the return is keyed on the pause, not the counter.
        if (keepLogin || externalPause.current) {
          externalPause.current = false;
          gate.invalidate();
          setRevision(value => value + 1);
        } else clear();
      } else {
        mfaWork.current?.abort();
        gate.invalidate();
        client.auth.stopAutoRefresh();
        if (!keepLogin && !gate.blocked) setState(empty('checking'));
      }
    });
    if (AppState.currentState === 'active') client.auth.startAutoRefresh();
    return () => { mounted.current = false; mfaWork.current?.abort(); gate.invalidate(); listener.subscription.unsubscribe(); subscription.remove(); client.auth.stopAutoRefresh(); };
  }, [clear, confirmSignedOut, gate, hasCleanSignOut]);

  useEffect(() => {
    if (configError || !foreground) return;
    const current = gate.beginRead();
    if (!current) return;
    const controller = new AbortController();
    let hasSession = owner.current !== null;
    void (async () => {
      const { data, error } = await schoolClient().auth.getSession();
      if (!current() || controller.signal.aborted) return;
      if (error) throw error;
      const snapshot = data.session;
      refreshed.current = null; // Only a refresh after this snapshot is newer than its token.
      if (!snapshot) { confirmSignedOut(); return; }
      hasSession = true;
      if (signedOut.current) setState(empty('checking'));
      signedOut.current = false; pushCleared.current = false;
      let client = familyClient(snapshot.access_token);
      // A phone clock behind the server keeps handing out a token the server already rejects: renew it once.
      const mfa = await readMfaStatus(client, snapshot.user.id, controller.signal).catch(async (error: unknown) => {
        if (!(error instanceof Error) || error.name !== 'SessionRejected') throw error;
        const renewed = await schoolClient().auth.refreshSession();
        if (!current() || controller.signal.aborted) throw error;
        // The refresh never reached Auth: that is a connection problem, not a clock or account problem.
        if (isAuthRetryableFetchError(renewed.error)) throw new Error('Sign-in renewal could not reach the school server.');
        if (renewed.error || !renewed.data.session || renewed.data.user?.id !== snapshot.user.id) throw error;
        client = familyClient(renewed.data.session.access_token);
        return readMfaStatus(client, snapshot.user.id, controller.signal);
      });
      if (!current() || controller.signal.aborted) return;
      if (!mfa.allowed) { setState({ ...empty('mfa'), mfa }); return; }
      const access = await readFamilyAccess(client, controller.signal);
      if (!current() || controller.signal.aborted) return;
      if (snapshot.user.id !== access.userId) throw new Error('Account identity changed.');
      const previous = owner.current;
      const preferred = !previous && restoreRole.current ? await readSavedRole(access.userId) ?? roleRef.current : roleRef.current;
      if (!current() || controller.signal.aborted) return;
      const nextRole = access.roles.includes(preferred) ? preferred : access.roles[0];
      // Unexpected account, school, or role changes need an explicit cleanup before exposing another workspace.
      if (previous && (previous.userId !== access.userId || previous.schoolId !== access.schoolId || previous.role !== nextRole)) {
        throw new Error('Account context changed.');
      }
      // The auth listener may have recorded a newer token during the awaits above (TS narrows the ref to null).
      const late = refreshed.current as Refreshed | null;
      if (late?.userId === access.userId) rebindFamilyClient(client, late.token);
      owner.current = { userId: access.userId, schoolId: access.schoolId, role: nextRole, client };
      allowSessionRenewal(client, access.userId);
      restoreRole.current = false;
      setRole(nextRole); setState({ status: 'ready', access, client, error: null, recovery: null, mfa: null });
    })().catch((error: unknown) => {
      if (mounted.current && !controller.signal.aborted && current()) setState(empty('error', deniedCopy(error), hasSession ? 'endSession' : null));
    });
    return () => controller.abort();
  }, [revision, foreground, gate, confirmSignedOut, setRole]);

  async function signIn(identifier: string, password: string) {
    if (!identifier.trim() || !password) throw new Error('Enter your school email or mobile number and password.');
    const credentials = signInCredentials(identifier, password);
    if (!credentials) throw new Error('Enter a valid school email or 10-digit mobile number.');
    if (!signedOut.current || !pushCleared.current) throw new Error('Sign out to finish securing this phone before signing in.');
    let foundSavedSession = false;
    try {
      await gate.run('signIn', async () => {
        clear(); restoreRole.current = true;
        const saved = await schoolClient().auth.getSession();
        if (saved.error || saved.data.session) {
          foundSavedSession = !!saved.data.session;
          signedOut.current = false; pushCleared.current = false;
          throw new Error('An existing sign-in could not be ruled out. Sign out and retry.');
        }
        const { error } = await schoolClient().auth.signInWithPassword(credentials);
        if (error) throw new Error('Sign-in failed. Check your details and connection.');
        signedOut.current = false; pushCleared.current = false;
      });
      clear();
    } catch (error) {
      if (!(error instanceof SessionTransitionError) && mounted.current) setState(signedOut.current && pushCleared.current
        ? empty('signedOut') : empty('error', 'Could not confirm sign-in. Check your connection and try again.', foundSavedSession ? 'endSession' : null));
      throw error;
    }
  }
  async function verifyAuthenticator(factorId: string, code: string) {
    if (state.status !== 'mfa' || state.mfa?.action !== 'challenge' || !foreground) throw new Error('Reopen authenticator verification.');
    const userId = state.mfa.user_id, controller = new AbortController();
    try {
      await gate.run('mfa', async () => {
        mfaWork.current = controller;
        await verifyMfa(schoolClient(), userId, factorId, code, controller.signal);
      });
      clear();
    } catch (error) {
      if (controller.signal.aborted && mounted.current) clear();
      throw error;
    } finally {
      if (mfaWork.current === controller) mfaWork.current = null;
      if (signedOut.current) confirmSignedOut();
    }
  }
  async function signOut() {
    if (state.access && (!owner.current || owner.current.userId !== state.access.userId
      || owner.current.schoolId !== state.access.schoolId || owner.current.role !== role)) {
      throw new Error('Your workspace changed. Reopen the account menu before signing out.');
    }
    try {
      await gate.run('signOut', async () => {
        clear();
        const previous = owner.current;
        if (previous) await disconnect(previous).catch(() => {});
        const { error } = await schoolClient().auth.signOut({ scope: 'local' });
        if (error) throw new Error('Sign-out could not be confirmed.');
        signedOut.current = true;
        if (!(await cleanupSavedPushOnAuthLoss()).nativeCleared) throw new Error('Phone cleanup could not be confirmed.');
        owner.current = null; pushCleared.current = true;
        await forgetRole(); setRole('parent');
      });
      if (mounted.current) setState(empty('signedOut'));
    } catch (error) {
      if (!(error instanceof SessionTransitionError) && mounted.current) setState(empty('error', 'Could not finish signing out. Try again before sharing this phone.', 'finishSignOut'));
      throw error;
    }
  }
  async function chooseRole(next: FamilyRole) {
    if (state.status !== 'ready' || !state.access?.roles.includes(next) || next === role) return;
    if (!owner.current || owner.current.userId !== state.access.userId || owner.current.schoolId !== state.access.schoolId || owner.current.role !== role) {
      throw new Error('Your workspace changed. Reopen the account menu before changing roles.');
    }
    try {
      await gate.run('role', async () => {
        clear();
        const previous = owner.current;
        if (previous) {
          const cleanup = await disconnect(previous);
          if (!cleanup.nativeCleared || !cleanup.serverRevoked) throw new Error('Phone cleanup could not be confirmed.');
        }
        if (signedOut.current) throw new Error('Your sign-in changed.');
        if (previous) await saveRole(previous.userId, next);
        owner.current = null;
      });
      if (mounted.current) { setRole(next); clear(); }
    } catch (error) {
      if (!(error instanceof SessionTransitionError) && mounted.current) setState(empty('error', 'Could not switch workspaces. Sign out before changing accounts.', 'finishSignOut'));
      throw error;
    }
  }
  return <Context.Provider value={{ ...state, role, revision, tokenRevision, foreground, signIn, signOut, chooseRole, verifyAuthenticator, whileExternal, refresh: clear }}>{children}</Context.Provider>;
}
export function useAuth() { const context = useContext(Context); if (!context) throw new Error('Auth provider missing.'); return context; }
