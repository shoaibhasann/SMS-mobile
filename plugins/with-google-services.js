const { withProjectBuildGradle, withAndroidColors, withDangerousMod } = require('expo/config-plugins');
const { mkdir, copyFile } = require('node:fs/promises');
const path = require('node:path');
module.exports = function withGoogleServices(config) {
  config = withProjectBuildGradle(config, result => {
    result.modResults.contents = result.modResults.contents.replace(/com\.google\.gms:google-services:[\d.]+/g, 'com.google.gms:google-services:4.5.0');
    return result;
  });
  config = withAndroidColors(config, result => {
    const colors = result.modResults.resources.color ?? [];
    result.modResults.resources.color = [...colors.filter(color => color.$.name !== 'notification_icon_color'), { $: { name: 'notification_icon_color' }, _: '#0c69e2' }];
    return result;
  });
  return withDangerousMod(config, ['android', async result => {
    const folder = path.join(result.modRequest.platformProjectRoot, 'app/src/main/res/drawable');
    await mkdir(folder, { recursive: true });
    await copyFile(path.join(result.modRequest.projectRoot, 'assets/notification-icon.png'), path.join(folder, 'notification_icon.png'));
    return result;
  }]);
};
