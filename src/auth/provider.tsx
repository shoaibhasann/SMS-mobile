import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { SupabaseClient } from '@supabase/supabase-js';
import { schoolClient, familyClient, configError } from './client';
import { createSessionGate, SessionTransitionError } from './session-gate';
import { readMfaStatus, verifyMfa, type MfaStatus } from './mfa';
import { readFamilyAccess, type FamilyAccess, type FamilyRole } from '../data';
import { cleanupSavedPushOnAuthLoss, disconnectNativePush } from '../push';

type Recovery = 'endSession' | 'finishSignOut' | null;
type AccessState = { status: 'checking' | 'signedOut' | 'ready' | 'error' | 'mfa'; access: FamilyAccess | null; client: SupabaseClient | null; error: string | null; recovery: Recovery; mfa: MfaStatus | null };
type Owner = { userId: string; schoolId: string; role: FamilyRole; client: SupabaseClient };
type Auth = AccessState & {
  role: FamilyRole; revision: number; foreground: boolean;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>; chooseRole(role: FamilyRole): Promise<void>; refresh(): void;
  verifyAuthenticator(factorId: string, code: string): Promise<void>;
};
const Context = createContext<Auth | null>(null);
const empty = (status: AccessState['status'], error: string | null = null, recovery: Recovery = null): AccessState => ({ status, access: null, client: null, error, recovery, mfa: null });
const disconnect = (owner: Owner) => disconnectNativePush({ client: owner.client, userId: owner.userId, role: owner.role });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccessState>(() => empty(configError ? 'error' : 'checking', configError));
  const [role, setRole] = useState<FamilyRole>('parent');
  const [revision, setRevision] = useState(0);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [gate] = useState(createSessionGate);
  const owner = useRef<Owner | null>(null);
  const mfaWork = useRef<AbortController | null>(null);
  const mounted = useRef(true), signedOut = useRef(false), pushCleared = useRef(false);
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
    }).then(() => {
      if (mounted.current) {
        if (signedOut.current) setState(empty('signedOut'));
        else clear();
      }
    }).catch(() => {
      if (mounted.current) setState(empty('error', 'Could not disconnect school alerts from this phone. Finish signing out to continue.', 'finishSignOut'));
    });
  }, [clear, gate, hasCleanSignOut]);

  useEffect(() => {
    mounted.current = true;
    if (configError) return () => { mounted.current = false; gate.invalidate(); };
    const client = schoolClient();
    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) confirmSignedOut();
      else { signedOut.current = false; pushCleared.current = false; clear(); }
    });
    const subscription = AppState.addEventListener('change', next => {
      setForeground(next === 'active');
      // Android's autofill picker backgrounds the app and needs the signed-out inputs to stay mounted.
      const keepLogin = hasCleanSignOut();
      if (next === 'active') {
        client.auth.startAutoRefresh();
        if (keepLogin) {
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
      if (!snapshot) { confirmSignedOut(); return; }
      hasSession = true;
      if (signedOut.current) setState(empty('checking'));
      signedOut.current = false; pushCleared.current = false;
      const client = familyClient(snapshot.access_token);
      const mfa = await readMfaStatus(client, snapshot.user.id, controller.signal);
      if (!current() || controller.signal.aborted) return;
      if (!mfa.allowed) { setState({ ...empty('mfa'), mfa }); return; }
      const access = await readFamilyAccess(client, controller.signal);
      if (!current() || controller.signal.aborted) return;
      if (snapshot.user.id !== access.userId) throw new Error('Account identity changed.');
      const nextRole = access.roles.includes(role) ? role : access.roles[0];
      const previous = owner.current;
      // Unexpected account, school, or role changes need an explicit cleanup before exposing another workspace.
      if (previous && (previous.userId !== access.userId || previous.schoolId !== access.schoolId || previous.role !== nextRole)) {
        throw new Error('Account context changed.');
      }
      owner.current = { userId: access.userId, schoolId: access.schoolId, role: nextRole, client };
      setRole(nextRole); setState({ status: 'ready', access, client, error: null, recovery: null, mfa: null });
    })().catch(() => {
      if (mounted.current && !controller.signal.aborted && current()) setState(empty('error',
        'Could not verify school access. Check your connection and try again.', hasSession ? 'endSession' : null));
    });
    return () => controller.abort();
  }, [revision, foreground, role, gate, confirmSignedOut]);

  async function signIn(email: string, password: string) {
    if (!email.trim() || !password) throw new Error('Enter your school email and password.');
    if (!signedOut.current || !pushCleared.current) throw new Error('Sign out to finish securing this phone before signing in.');
    let foundSavedSession = false;
    try {
      await gate.run('signIn', async () => {
        clear();
        const saved = await schoolClient().auth.getSession();
        if (saved.error || saved.data.session) {
          foundSavedSession = !!saved.data.session;
          signedOut.current = false; pushCleared.current = false;
          throw new Error('An existing sign-in could not be ruled out. Sign out and retry.');
        }
        const { error } = await schoolClient().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
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
        owner.current = null;
      });
      if (mounted.current) { setRole(next); clear(); }
    } catch (error) {
      if (!(error instanceof SessionTransitionError) && mounted.current) setState(empty('error', 'Could not switch workspaces. Sign out before changing accounts.', 'finishSignOut'));
      throw error;
    }
  }
  return <Context.Provider value={{ ...state, role, revision, foreground, signIn, signOut, chooseRole, verifyAuthenticator, refresh: clear }}>{children}</Context.Provider>;
}
export function useAuth() { const context = useContext(Context); if (!context) throw new Error('Auth provider missing.'); return context; }
