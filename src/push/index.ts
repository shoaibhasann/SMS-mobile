import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { createPushLifecycle } from './core';
import { createNativeDriver } from './native';

const key = 'sms.push.binding.v1';
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const lifecycle = createPushLifecycle({
  platform: () => Platform.OS,
  storage: {
    read: () => SecureStore.getItemAsync(key, options),
    write: value => SecureStore.setItemAsync(key, value, options),
    clear: () => SecureStore.deleteItemAsync(key, options),
  },
  identity: async () => ({
    installationId: Crypto.randomUUID(),
    secret: Array.from(await Crypto.getRandomBytesAsync(32), value => value.toString(16).padStart(2, '0')).join(''),
  }),
  driver: createNativeDriver,
});
export const { getPushAvailability, readNativePushPermission, readPushEnrollment, enableNativePush, refreshNativePushRegistration, disconnectNativePush, cleanupSavedPushOnAuthLoss, attachPushInboxHints, subscribePushInboxRefresh, subscribePushRegistration } = lifecycle;
export { NativePushError } from './core';
export type { PushRole, PushOwner, PushEnrollment, PushArguments, PushHint } from './core';
