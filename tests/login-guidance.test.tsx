// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

type Props = { children?: ReactNode; accessibilityLabel?: string; onPress?(): void; placeholder?: string };
const { auth, openURL, Box } = vi.hoisted(() => ({ auth: { status: 'signedOut', foreground: true, error: null, signIn: vi.fn() }, openURL: vi.fn(),
  Box: ({ children }: Props) => <div>{children}</div> }));
vi.mock('react-native', () => ({
  ActivityIndicator: () => null, Image: ({ source }: { source?: unknown }) => <img alt="" data-logo={String(source)} />, KeyboardAvoidingView: Box, ScrollView: Box, View: Box, Platform: { OS: 'android' },
  StyleSheet: { create: <T,>(value: T) => value }, Keyboard: { addListener: () => ({ remove() {} }) }, Linking: { openURL },
  useWindowDimensions: () => ({ height: 800, fontScale: 1 }),
  Pressable: ({ children, accessibilityLabel, onPress }: Props) => <button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>,
  TextInput: ({ accessibilityLabel, placeholder }: Props) => <input aria-label={accessibilityLabel} placeholder={placeholder} />,
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: Box }));
vi.mock('expo-router', () => ({ Redirect: () => null }));
vi.mock('lucide-react-native', () => ({ ArrowRight: () => null, CircleAlert: () => null, Eye: () => null, EyeOff: () => null, LockKeyhole: () => null, Mail: () => null }));
vi.mock('../src/auth/provider', () => ({ useAuth: () => auth }));
vi.mock('../src/auth/client', () => ({ configError: null }));
vi.mock('../src/ui/primitives', () => ({ Screen: Box, Skeleton: () => null, Text: ({ children }: Props) => <span>{children}</span> }));
vi.mock('../src/ui/auth-problem', () => ({ AuthProblem: () => null }));
vi.mock('../src/ui/mfa-verification', () => ({ MfaVerification: () => null }));
vi.mock('../src/ui/theme', () => ({ usePalette: () => ({}) }));
import Login from '../src/app/login';

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => { roots.splice(0).forEach(root => root.unmount()); }); vi.unstubAllGlobals(); });

it('explains how mobile-number and Google accounts get an app password', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div'), root = createRoot(container); roots.push(root);
  await act(async () => root.render(<Login />));
  expect(container.querySelector('input[aria-label="Email or mobile number"]')).not.toBeNull();
  expect(container.querySelector('[data-logo$="sms-logo.png"]')).not.toBeNull();
  expect(container.textContent).toContain('Invited with a mobile number? Set an app password in Account settings on the SMS website, then sign in here with that mobile number.');
  expect(container.textContent).toContain('Signed up with Google? Use Forgot or set password with the same Gmail to create an app password.');
  const link = container.querySelector<HTMLButtonElement>('button[aria-label="Forgot or set password? Opens the SMS website"]');
  expect(link?.textContent).toBe('Forgot or set password?');
  await act(async () => link?.click());
  expect(openURL).toHaveBeenCalledWith('https://sms-web-shoaibhasann.vercel.app/forgot-password');
});
