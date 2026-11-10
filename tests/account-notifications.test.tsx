// @vitest-environment jsdom
import { act, type EffectCallback, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Account from '../src/app/(school)/account';

const { auth, readPermission, readEnrollment, enable, disconnect, openSettings, confirm, rpc } = vi.hoisted(() => ({
  auth: { access: { userId: 'qa-user', name: 'QA User', roles: ['student'] }, role: 'student', revision: 0 },
  readPermission: vi.fn(), readEnrollment: vi.fn(), enable: vi.fn(), disconnect: vi.fn(), openSettings: vi.fn(),
  confirm: vi.fn(), rpc: vi.fn(),
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
}));
vi.mock('../src/push', async () => ({
  NativePushError: (await import('../src/push/core')).NativePushError,
  getPushAvailability: () => ({ available: true }), readNativePushPermission: readPermission, readPushEnrollment: readEnrollment,
  enableNativePush: enable, disconnectNativePush: disconnect,
}));
vi.mock('../src/ui/theme', () => ({ usePalette: () => ({ muted: '#64748b' }) }));
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
  auth.revision = 0;
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
});
