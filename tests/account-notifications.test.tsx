// @vitest-environment jsdom
import { act, type EffectCallback, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Account from '../src/app/(school)/(tabs)/account';

const { auth, readPermission, readEnrollment, enable, disconnect, openSettings, confirm, rpc, setAppearance } = vi.hoisted(() => ({
  auth: { access: { userId: 'qa-user', name: 'QA User', roles: ['student'] }, role: 'student', revision: 0 },
  readPermission: vi.fn(), readEnrollment: vi.fn(), enable: vi.fn(), disconnect: vi.fn(), openSettings: vi.fn(),
  confirm: vi.fn(), rpc: vi.fn(), setAppearance: vi.fn(),
}));
vi.mock('../src/auth/provider', () => {
  const client = { rpc };
  return { useAuth: () => ({ ...auth, client }) };
});
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: { firebaseConfigured: true } } } }));
vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return { useFocusEffect: (effect: EffectCallback) => useEffect(effect, [effect]) };
});
vi.mock('react-native', () => ({
  Alert: { alert: confirm }, Linking: { openSettings }, View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, accessibilityLabel, accessibilityState, onPress }: { children?: ReactNode; accessibilityLabel?: string; accessibilityState?: { checked?: boolean }; onPress(): void }) =>
    <button role="radio" aria-label={accessibilityLabel} aria-checked={accessibilityState?.checked} onClick={onPress}>{children}</button>,
}));
vi.mock('../src/push', async () => ({
  NativePushError: (await import('../src/push/core')).NativePushError,
  getPushAvailability: () => ({ available: true }), readNativePushPermission: readPermission, readPushEnrollment: readEnrollment,
  enableNativePush: enable, disconnectNativePush: disconnect,
}));
vi.mock('../src/ui/theme', () => ({ usePalette: () => ({ muted: '#64748b' }), useDarkMode: () => ({ appearance: 'system', darkMode: false, setAppearance }) }));
vi.mock('../src/ui/primitives', () => ({
  Card: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Screen: ({ children }: { children?: ReactNode }) => <main>{children}</main>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Button: ({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress(): void }) => <button disabled={disabled} onClick={onPress}>{label}</button>,
  Skeleton: () => <span>Loading settings</span>,
  ErrorCard: ({ message }: { message: string }) => <div role="alert">{message}</div>,
  Title: () => null,
}));

const registration = { state: 'registered', deviceId: 'device', generation: 1 };
let root: Root, container: HTMLDivElement;
const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent === label);
const render = async () => { await act(async () => { root.render(<Account />); }); };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.resetAllMocks();
  auth.revision = 0; auth.role = 'student'; auth.access.roles = ['student'];
  openSettings.mockResolvedValue(undefined);
  readPermission.mockResolvedValue('granted');
  readEnrollment.mockResolvedValue(registration);
  rpc.mockReturnValue({ abortSignal: async () => ({ data: { preferences: { enabled: true }, devices: [{ id: 'device', revoked_at: null }] } }) });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); vi.unstubAllGlobals(); });

describe('phone notification settings', () => {
  it('replaces enrollment with the per-phone turn-off action after the server confirms it', async () => {
    readEnrollment.mockResolvedValueOnce(null);
    await render();
    expect(container.textContent).toContain('Off for this phone');
    await act(async () => { button('Turn on notifications')!.click(); });
    expect(enable).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('On for this phone');
    expect(button('Turn on notifications')).toBeUndefined();
    expect(button('Turn off on this phone')).toBeDefined();
  });

  it('opens Android settings for a blocked permission and rechecks after the auth resume revision', async () => {
    readPermission.mockResolvedValueOnce('settings');
    await render();
    expect(container.textContent).toContain('Off for this phone');
    expect(button('Turn on notifications')).toBeUndefined();
    await act(async () => { button('Open Android settings')!.click(); });
    expect(openSettings).toHaveBeenCalledOnce();
    expect(enable).not.toHaveBeenCalled();
    auth.revision += 1;
    await render();
    expect(container.textContent).toContain('On for this phone');
    expect(button('Open Android settings')).toBeUndefined();
  });
  it('asks to reconnect after the Firebase installation changes and shows On only after verification', async () => {
    readEnrollment.mockResolvedValueOnce({ ...registration, state: 'pending', needsReconnect: true });
    await render();
    expect(container.textContent).toContain('Off for this phone');
    expect(button('Reconnect notifications')).toBeDefined();
    await act(async () => { button('Reconnect notifications')!.click(); });
    expect(enable).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('On for this phone');
  });
  it('shows a phone that has not refreshed for 90 days as needing reconnect instead of On', async () => {
    const stale = new Date(Date.now() - 91 * 86_400_000).toISOString();
    rpc.mockReturnValue({ abortSignal: async () => ({ data: { preferences: { enabled: true }, devices: [{ id: 'device', revoked_at: null, last_seen_at: stale }] } }) });
    await render();
    expect(container.textContent).toContain('Off for this phone');
    expect(container.textContent).toContain('Reconnect to receive alerts');
    expect(container.textContent).not.toContain('Disconnect the previous registration');
    await act(async () => { button('Reconnect notifications')!.click(); });
    expect(enable).toHaveBeenCalledOnce();
  });
});

describe('account cleanup and appearance', () => {
  it('offers Disconnect this phone when enabling is blocked by this user’s other-workspace registration', async () => {
    readEnrollment.mockResolvedValue(null);
    const { NativePushError } = await import('../src/push/core');
    enable.mockRejectedValueOnce(new NativePushError('Disconnect the previous phone registration before enabling alerts.', 'cleanup'));
    disconnect.mockResolvedValue({ serverRevoked: true, nativeCleared: true });
    await render();
    expect(button('Disconnect this phone')).toBeUndefined();
    await act(async () => { button('Turn on notifications')!.click(); });
    expect(container.textContent).toContain('Disconnect the previous phone registration');
    expect(button('Disconnect this phone')).toBeDefined();
    await act(async () => { button('Disconnect this phone')!.click(); });
    const turnOff = confirm.mock.calls[0][2].find((item: { text: string }) => item.text === 'Turn off');
    await act(async () => { turnOff.onPress(); });
    expect(disconnect).toHaveBeenCalledWith(expect.objectContaining({ userId: 'qa-user', role: 'student' }));
    expect(button('Disconnect this phone')).toBeUndefined();
  });
  it('drops the cleanup Disconnect button after a later successful Turn on and after a role switch', async () => {
    readEnrollment.mockResolvedValue(null);
    const { NativePushError } = await import('../src/push/core');
    const blocked = () => enable.mockRejectedValueOnce(new NativePushError('Disconnect the previous phone registration before enabling alerts.', 'cleanup'));
    blocked();
    await render();
    await act(async () => { button('Turn on notifications')!.click(); });
    expect(button('Disconnect this phone')).toBeDefined();
    enable.mockResolvedValueOnce(undefined);
    await act(async () => { button('Turn on notifications')!.click(); });
    expect(button('Disconnect this phone')).toBeUndefined();
    blocked();
    await act(async () => { button('Turn on notifications')!.click(); });
    expect(button('Disconnect this phone')).toBeDefined();
    auth.access.roles = ['student', 'parent']; auth.role = 'parent';
    await render();
    expect(container.textContent).toContain('Guardian account');
    expect(button('Disconnect this phone')).toBeUndefined();
  });
  it('offers System, Light and Dark appearance with System selected by default', async () => {
    await render();
    const radio = (label: string) => container.querySelector(`[role="radio"][aria-label="${label}"]`) as HTMLButtonElement | null;
    expect(radio('System appearance')?.getAttribute('aria-checked')).toBe('true');
    expect(radio('Light appearance')?.getAttribute('aria-checked')).toBe('false');
    await act(async () => { radio('Dark appearance')!.click(); });
    expect(setAppearance).toHaveBeenCalledWith('dark');
  });
});
