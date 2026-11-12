// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const os = vi.hoisted(() => ({ scheme: 'light' as 'light' | 'dark' | null }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' }, useColorScheme: () => os.scheme }));
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn() }));
import { ThemeProvider, dark, light, useDarkMode, usePalette } from '../src/ui/theme';

let root: Root, node: HTMLDivElement, seen: { appearance: string; darkMode: boolean; palette: typeof light; setAppearance(value: 'system' | 'light' | 'dark'): void };
function Probe() { const theme = useDarkMode(), palette = usePalette(); useEffect(() => { seen = { ...theme, palette }; }); return null; }
const render = async () => { await act(async () => { root.render(<ThemeProvider><Probe /></ThemeProvider>); }); };
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear(); os.scheme = 'light'; node = document.createElement('div'); document.body.append(node); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.unstubAllGlobals(); });

it('follows the Android dark theme when no appearance was chosen, including live changes', async () => {
  os.scheme = 'dark'; await render();
  expect(seen).toMatchObject({ appearance: 'system', darkMode: true, palette: dark });
  os.scheme = 'light'; await render();
  expect(seen).toMatchObject({ darkMode: false, palette: light });
});
it('keeps a choice made with the old Dark mode switch over the system setting', async () => {
  localStorage.setItem('sms.appearance.dark', '0'); os.scheme = 'dark'; await render();
  expect(seen).toMatchObject({ appearance: 'light', darkMode: false });
  await act(async () => root.unmount()); root = createRoot(node);
  localStorage.setItem('sms.appearance.dark', '1'); os.scheme = 'light'; await render();
  expect(seen).toMatchObject({ appearance: 'dark', darkMode: true });
});
it('persists Light/Dark overrides and returns to following the system', async () => {
  os.scheme = 'dark'; await render();
  await act(async () => { seen.setAppearance('light'); });
  expect(seen).toMatchObject({ appearance: 'light', darkMode: false });
  await vi.waitFor(() => expect(localStorage.getItem('sms.appearance.dark')).toBe('light'));
  await act(async () => { seen.setAppearance('system'); });
  expect(seen).toMatchObject({ appearance: 'system', darkMode: true });
  await vi.waitFor(() => expect(localStorage.getItem('sms.appearance.dark')).toBe('system'));
});
