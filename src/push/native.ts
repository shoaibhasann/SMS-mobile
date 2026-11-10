import { PermissionsAndroid, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { NativePushError, type PushDriver, type PushPermission } from './core';

const permissionAttemptKey = 'sms.push.permission-prompted.v1';

// Imports stay lazy: an unconfigured build and ordinary sign-in never initialize Firebase.
export async function createNativeDriver(): Promise<PushDriver> {
  if (Platform.OS !== 'android') throw new NativePushError('Phone push enrollment is Android-only in this build.');
  const [app, messaging, installations] = await Promise.all([
    import('@react-native-firebase/app'), import('@react-native-firebase/messaging'), import('@react-native-firebase/installations'),
  ]);
  if (!app.getApps().length) throw new NativePushError('Firebase is not available in this build. Install the configured Android app.');
  const firebaseApp = app.getApp(), instance = messaging.getMessaging(firebaseApp);
  const failed = () => new NativePushError('The native phone registration could not be confirmed. Retry or disconnect before sharing this phone.', 'native');
  async function readPermission(): Promise<PushPermission> {
    if (await messaging.hasPermission(instance) === messaging.AuthorizationStatus.AUTHORIZED) return 'granted';
    return Number(Platform.Version) < 33 || await SecureStore.getItemAsync(permissionAttemptKey) === '1' ? 'settings' : 'prompt';
  }
  return {
    readPermission,
    async requestPermission() {
      const permission = await readPermission();
      if (permission !== 'prompt') return permission === 'granted';
      await SecureStore.setItemAsync(permissionAttemptKey, '1');
      return await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS) === PermissionsAndroid.RESULTS.GRANTED;
    },
    async register() {
      try {
        const installation = installations.getInstallations(firebaseApp);
        const before = await installations.getId(installation);
        // The native task confirms FCM registration before the asynchronous event reaches JS.
        await messaging.register(instance);
        const after = await installations.getId(installation);
        if (before !== after) throw failed();
        return after;
      } catch { throw failed(); }
    },
    async disconnect() {
      // Keep auto-init off even after explicit enrollment; account changes must not recreate a FID.
      const stopped = await Promise.allSettled([
        Promise.resolve().then(() => messaging.setAutoInitEnabled(instance, false)),
        Promise.resolve().then(() => messaging.unregister(instance)),
      ]);
      let deleted = false;
      try { await installations.deleteInstallations(installations.getInstallations(firebaseApp)); deleted = true; } catch { /* The core retains the cleanup tombstone. */ }
      if (!deleted || stopped.some(result => result.status === 'rejected')) throw failed();
    },
    async listen(callback) {
      let active = true;
      const received = messaging.onMessage(instance, message => { if (active) callback('received', message); });
      let opened: () => void;
      try { opened = messaging.onNotificationOpenedApp(instance, message => { if (active) callback('opened', message); }); }
      catch { received(); throw failed(); }
      void messaging.getInitialNotification(instance).then(message => {
        if (active && message) callback('opened', message);
      }).catch(() => {});
      return () => { active = false; received(); opened(); };
    },
  };
}
