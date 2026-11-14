const { withAppBuildGradle } = require('expo/config-plugins');

// Play only accepts release builds signed with the owner's upload key, which never enters this repository. The four
// SMS_UPLOAD_* Gradle properties (normally in ~/.gradle/gradle.properties) select it. Without SMS_UPLOAD_STORE_FILE,
// release builds keep the template debug key, which is only fit for sideloaded QA builds.
const releaseSigning = `        release {
            if (findProperty('SMS_UPLOAD_STORE_FILE')) {
                storeFile file(findProperty('SMS_UPLOAD_STORE_FILE'))
                storePassword findProperty('SMS_UPLOAD_STORE_PASSWORD')
                keyAlias findProperty('SMS_UPLOAD_KEY_ALIAS')
                keyPassword findProperty('SMS_UPLOAD_KEY_PASSWORD')
            }
        }
`;
const signingConfigs = /\n\s*signingConfigs \{\n/;
const releaseBuildType = /(buildTypes \{[\s\S]*?\n\s*release \{\n(?:\s*\/\/[^\n]*\n)*\s*)signingConfig signingConfigs\.debug\n/;

function addReleaseSigning(contents) {
  if (contents.includes('SMS_UPLOAD_STORE_FILE')) return contents;
  if (!signingConfigs.test(contents) || !releaseBuildType.test(contents)) {
    throw new Error('android/app/build.gradle has no recognizable signingConfigs or release build type; release signing cannot be configured.');
  }
  return contents
    .replace(signingConfigs, match => match + releaseSigning)
    .replace(releaseBuildType, (_, head) => `${head}signingConfig(findProperty('SMS_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug)\n`);
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, result => {
    if (result.modResults.language !== 'groovy') throw new Error('A Groovy android/app/build.gradle is required to configure release signing.');
    result.modResults.contents = addReleaseSigning(result.modResults.contents);
    return result;
  });
};
module.exports.addReleaseSigning = addReleaseSigning;
