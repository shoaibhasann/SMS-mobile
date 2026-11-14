import { describe, expect, it } from 'vitest';
import appJson from '../app.json';
import { addReleaseSigning } from '../plugins/with-release-signing';

// Shape of the Expo SDK 58 prebuild android/app/build.gradle signing section.
const buildGradle = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            def enableShrinkResources = findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'false'
            shrinkResources enableShrinkResources.toBoolean()
        }
    }
}
`;

describe('Android release signing', () => {
  it('is registered by a config plugin in app.json', () => {
    expect(appJson.expo.plugins).toContain('./plugins/with-release-signing.js');
  });
  it('signs release builds with the SMS_UPLOAD_* key only when one is configured, exactly once', () => {
    const contents = addReleaseSigning(buildGradle);
    // The release config sits inside signingConfigs, and the debug config stays intact.
    expect(contents).toContain('    signingConfigs {\n        release {\n');
    expect(contents).toContain("storeFile file('debug.keystore')");
    const signing = contents.slice(contents.indexOf('signingConfigs {'), contents.indexOf('buildTypes {'));
    for (const name of ['STORE_FILE', 'STORE_PASSWORD', 'KEY_ALIAS', 'KEY_PASSWORD']) expect(signing).toContain(`findProperty('SMS_UPLOAD_${name}')`);
    expect(signing).toContain("if (findProperty('SMS_UPLOAD_STORE_FILE')) {");
    const buildTypes = contents.slice(contents.indexOf('buildTypes {'));
    expect(buildTypes).toContain("signingConfig(findProperty('SMS_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug)");
    // The debug build type, and only it, keeps the template debug key unconditionally.
    expect(buildTypes.match(/signingConfig signingConfigs\.debug/g)).toHaveLength(1);
    expect(buildTypes.indexOf('signingConfig signingConfigs.debug')).toBeLessThan(buildTypes.indexOf('release {'));
    expect(addReleaseSigning(contents)).toBe(contents);
  });
  it('fails the prebuild instead of silently keeping debug signing on an unrecognized build.gradle', () => {
    expect(() => addReleaseSigning('android {\n}\n')).toThrow(/release signing/);
    expect(() => addReleaseSigning(buildGradle.replace('signingConfig signingConfigs.debug\n            def', 'def'))).toThrow(/release signing/);
  });
});
