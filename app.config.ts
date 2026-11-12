import type { ConfigContext, ExpoConfig } from 'expo/config';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export default ({ config }: ConfigContext): ExpoConfig => {
  const androidFile = resolve(process.env.SMS_FIREBASE_ANDROID_FILE ?? '.private/google-services.json');
  const firebaseConfigured = process.env.SMS_BUILD_PLATFORM !== 'ios' && existsSync(androidFile);
  if (firebaseConfigured) {
    const file = JSON.parse(readFileSync(androidFile, 'utf8'));
    if (!file.client?.some((client: { client_info?: { android_client_info?: { package_name?: string } } }) => client.client_info?.android_client_info?.package_name === 'tech.iamshoaib.sms')) {
      throw new Error('Firebase Android configuration must match tech.iamshoaib.sms.');
    }
  }
  return {
    ...config, name: 'SMS', slug: 'sms-mobile',
    android: { ...config.android, ...(firebaseConfigured ? { googleServicesFile: androidFile } : {}) },
    plugins: [...(config.plugins ?? []), ...(firebaseConfigured ? ['@react-native-firebase/app', ['@react-native-firebase/messaging', { installationIdEnabled: true, android: { notificationIcon: './assets/notification-icon.png', notificationColor: '#0c69e2' } }] as [string, Record<string, unknown>], './plugins/with-google-services.js'] : [])],
    extra: { ...config.extra, firebaseConfigured },
  };
};
