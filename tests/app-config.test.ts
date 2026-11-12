import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigContext, ExpoConfig } from 'expo/config';
import { getPrebuildConfigAsync } from '@expo/prebuild-config';
import { compileModsAsync } from '@expo/config-plugins/build/plugins/mod-compiler';
import appJson from '../app.json';
import appConfig from '../app.config';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
beforeEach(() => { vi.stubEnv('SMS_FIREBASE_ANDROID_FILE', '/nonexistent/google-services.json'); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('Android release manifest permissions', () => {
  it('blocks draw-over-apps and AD_ID in the resolved config', () => {
    const result = appConfig({ config: appJson.expo as ExpoConfig } as ConfigContext);
    expect(result.android?.blockedPermissions).toEqual(expect.arrayContaining(['android.permission.SYSTEM_ALERT_WINDOW', 'com.google.android.gms.permission.AD_ID']));
  });

  it('removes SYSTEM_ALERT_WINDOW and AD_ID from the introspected Android manifest (same as `expo config --type introspect`, no Gradle)', async () => {
    const { exp } = await getPrebuildConfigAsync(projectRoot, { platforms: ['android'] });
    const config = await compileModsAsync(exp, { projectRoot, introspect: true, platforms: ['android'], assertMissingModProviders: false });
    const manifest = config._internal?.modResults?.android?.manifest?.manifest;
    const permissions = (manifest?.['uses-permission'] ?? []) as { $: Record<string, string> }[];
    const node = (name: string) => permissions.filter(row => row.$['android:name'] === name).map(row => row.$['tools:node']);
    expect(manifest?.$['xmlns:tools']).toBe('http://schemas.android.com/tools');
    expect(node('android.permission.SYSTEM_ALERT_WINDOW')).toEqual(['remove']);
    expect(node('com.google.android.gms.permission.AD_ID')).toEqual(['remove']);
  });

  it('replaces the Expo template placeholder behind the launch window with the launcher tile colour', async () => {
    const { exp } = await getPrebuildConfigAsync(projectRoot, { platforms: ['android'] });
    const config = await compileModsAsync(exp, { projectRoot, introspect: true, platforms: ['android'], assertMissingModProviders: false });
    const styles = (config._internal?.modResults?.android?.styles?.resources?.style ?? []) as { $: Record<string, string>; item?: unknown[] }[];
    expect(styles.find(style => style.$.name === 'Theme.App.SplashScreen')?.item).toEqual([{ $: { name: 'android:windowBackground' }, _: '@color/iconBackground' }]);
    expect(config._internal?.modResults?.android?.colors?.resources?.color).toContainEqual({ $: { name: 'iconBackground' }, _: '#f7f9fd' });
  });
});
