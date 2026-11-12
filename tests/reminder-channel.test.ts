import { describe, expect, it } from 'vitest';
import appJson from '../app.json';
import { addReminderChannel } from '../plugins/with-reminder-channel';

// Shape of the Expo SDK 58 prebuild MainApplication.kt onCreate.
const mainApplication = `class MainApplication : Application(), ReactApplication {
  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }
}
`;

describe('Android Reminders notification channel', () => {
  it('is registered by a config plugin in app.json', () => {
    expect(appJson.expo.plugins).toContain('./plugins/with-reminder-channel.js');
  });
  it('creates the low-importance sms-reminders channel at app start, before React Native loads, exactly once', () => {
    const contents = addReminderChannel(mainApplication);
    const created = contents.indexOf('NotificationChannel("sms-reminders", "Reminders", android.app.NotificationManager.IMPORTANCE_LOW)');
    expect(created).toBeGreaterThan(contents.indexOf('super.onCreate()'));
    expect(created).toBeLessThan(contents.indexOf('loadReactNative(this)'));
    expect(contents).toContain('android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O');
    expect(addReminderChannel(contents)).toBe(contents);
  });
  it('fails the prebuild instead of silently skipping an unrecognized MainApplication', () => {
    expect(() => addReminderChannel('class MainApplication')).toThrow(/reminder channel/);
  });
});
