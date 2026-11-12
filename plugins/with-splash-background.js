const { AndroidConfig, withAndroidStyles } = require('expo/config-plugins');

// Without expo-splash-screen the SDK 58 template keeps Expo's placeholder bitmap as the launch window background.
// A plain colour (the launcher tile's own) replaces it; Android 12+ draws the launcher icon on top by itself.
module.exports = function withSplashBackground(config) {
  return withAndroidStyles(config, result => {
    result.modResults = AndroidConfig.Styles.assignStylesValue(result.modResults, {
      add: true, parent: { name: 'Theme.App.SplashScreen', parent: 'AppTheme' }, name: 'android:windowBackground', value: '@color/iconBackground',
    });
    return result;
  });
};
