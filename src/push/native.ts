import { PermissionsAndroid, Platform } from 'react-native';
import { NativePushError, type PushDriver } from './core';

// Imports stay lazy: an unconfigured build and ordinary sign-in never initialize Firebase.
export async function createNativeDriver(): Promise<PushDriver> {
  if (Platform.OS !== 'android') throw new NativePushError('Phone push enrollment is Android-only in this build.');
  const [app, messaging, installations] = await Promise.all([
    import('@react-native-firebase/app'), import('@react-native-firebase/messaging'), import('@react-native-firebase/installations'),
  ]);
  if (!app.getApps().length) throw new NativePushError('Firebase is not available in this build. Install the configured Android development build.');
  const firebaseApp = app.getApp(), instance = messaging.getMessaging(firebaseApp);
  const failed = () => new NativePushError('The native phone registration could not be confirmed. Retry or disconnect before sharing this phone.', 'native');
  return {
    async requestPermission() {
      return Number(Platform.Version) < 33 || await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS) === PermissionsAndroid.RESULTS.GRANTED;
    },
    async register() {
      let unsubscribe = () => {}, timer: ReturnType<typeof setTimeout> | undefined;
      let receive!: (installationId: string) => void;
      let currentId: string | null = null, observedId: string | null = null;
      const received = new Promise<string>(resolve => { receive = resolve; });
      try {
        // Subscribe before register: the SDK can replay an already registered FID immediately.
        unsubscribe = messaging.onRegistered(instance, value => {
          observedId = value; if (value === currentId) receive(value);
        });
        await messaging.register(instance);
        // A previous unregister event can still be crossing the native bridge; reject stale cache replay.
        currentId = await installations.getId(installations.getInstallations(firebaseApp));
        if (observedId === currentId) receive(currentId);
        return await Promise.race([received, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(failed()), 10_000);
        })]);
      } catch { throw failed(); }
      finally { clearTimeout(timer); unsubscribe(); }
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
