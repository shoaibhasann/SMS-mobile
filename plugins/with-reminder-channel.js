const { withMainApplication } = require('expo/config-plugins');

// The web dispatcher sends due-today fee reminders on this channel (lib/notifications/fcm.ts).
// Low importance shows them in the shade without sound or a heads-up banner; other alerts keep the default channel.
const channel = `    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
      getSystemService(android.app.NotificationManager::class.java)?.createNotificationChannel(
        android.app.NotificationChannel("sms-reminders", "Reminders", android.app.NotificationManager.IMPORTANCE_LOW))
    }
`;
const onCreate = /override fun onCreate\(\) \{\n\s*super\.onCreate\(\)\n/;

// Application.onCreate runs before FCM posts a background notification, so the channel always exists first.
function addReminderChannel(contents) {
  if (contents.includes('"sms-reminders"')) return contents;
  if (!onCreate.test(contents)) throw new Error('MainApplication.onCreate was not found; the reminder channel cannot be registered.');
  return contents.replace(onCreate, match => match + channel);
}

module.exports = function withReminderChannel(config) {
  return withMainApplication(config, result => {
    if (result.modResults.language !== 'kt') throw new Error('A Kotlin MainApplication is required to register the reminder channel.');
    result.modResults.contents = addReminderChannel(result.modResults.contents);
    return result;
  });
};
module.exports.addReminderChannel = addReminderChannel;
