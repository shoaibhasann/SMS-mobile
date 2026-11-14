# SMS Mobile

Separate React Native application for verified Guardian and Student accounts. Built with Expo SDK 58, React Native 0.88 and TypeScript; native screens use the existing SMS blue/violet palette, Sora and system appearance. This is not a WebView wrapper.

## Current pilot slice

- Email or verified-mobile + password sign-in against the existing Supabase project; no automatic signup, guardian linking or staff access. Phone-only Guardians set an app password in guardian contact settings on the website; Google-only Students set one through Forgot or set password with the same Gmail.
- Server-checked active school/family roles, linked-child selection, read-only retained attendance and refresh/pagination.
- Existing family Notifications with All/Unread, independent saved read state, mark one/all, older history and native result/leave detail targets.
- Optional per-Guardian/child Arrival and Exit inbox choices, both OFF by default. The current inbox uses the shared v8 API. Older installed apps keep their versioned endpoints. Absent alerts remain independent of gate choices.
- Learning: current-session published homework, private PDF/JPG/PNG upload (10 MB), Student submit/update and Teacher grade/feedback reload; Guardians read only their linked child’s submission.
- Published single-assessment results and family leave submission/history. Exam schedule alerts open exact, current exam details from Updates.
- Unconfirmed homework/leave mutations retain an encrypted, account/role/child-scoped exact retry intent across app restarts; school records are not cached for offline browsing.
- Native Android Firebase Installation ID registration with explicit phone permission, versioned preference enable, private installation proof, remote revoke compatibility, logout/account-switch cleanup and a fixed inbox-only push destination.
- Encrypted native session storage, no saved child/attendance/inbox cache, stale-request cancellation and session-bound API clients.

Term report cards, past-session homework history, original attachment downloads, Hindi translations, in-app phone OTP login and iOS push remain later app slices. Homework uploads use private Storage; authenticated original downloads remain on the school website. App registration does not prove provider acceptance or phone display.

## Run locally

Use Node **24.22.2** (`.nvmrc`) and Java/Android SDK for local Android builds.

```sh
nvm use
npm ci
cp .env.example .env.local
# Fill only the public Supabase project URL and publishable/legacy anon key.
npm run android
```

The app package ID is `tech.iamshoaib.sms`. Firebase client configuration is read from ignored `.private/google-services.json` or `SMS_FIREBASE_ANDROID_FILE`. It must contain that exact Android client. No Firebase service-account or Supabase service-role key belongs in this app.

`npm run android` generates the Android project and installs a development build. `npm start -- --port 8087` starts Metro separately. Firebase native modules require a development build; Expo Go is not the push test environment. Generated `android/` and `ios/` files are not edited or committed; config plugins own them. Android Google Services Gradle plugin is pinned to **4.5.0** through the local config plugin.

## Android release signing

Play accepts only a release bundle signed with the owner's upload key. `plugins/with-release-signing.js` makes `release` builds (AAB and APK) use that key when these Gradle properties are set. They normally go in `~/.gradle/gradle.properties`, never in this repository or the generated `android/`. Keep that file `chmod 600`, and never paste `./gradlew properties` output.

```properties
SMS_UPLOAD_STORE_FILE=/Users/<you>/.sms-signing/sms-upload.jks
SMS_UPLOAD_KEY_ALIAS=sms-upload
SMS_UPLOAD_STORE_PASSWORD=…
SMS_UPLOAD_KEY_PASSWORD=…
```

All four properties are required:
- Use the full path, because Gradle does not expand `~` or `$HOME`.
- With the PKCS12 keystore below, the key password is the store password.
- A bare `NullPointerException` in `:app:signReleaseBundle` means a property is missing.

To keep the passwords off disk, leave only the file and alias in `~/.gradle/gradle.properties`. Pass the passwords for one build as `ORG_GRADLE_PROJECT_SMS_UPLOAD_STORE_PASSWORD` and `ORG_GRADLE_PROJECT_SMS_UPLOAD_KEY_PASSWORD`.

Create the key once, outside this repository (`prebuild --clean` deletes `android/`). keytool asks for the password:

```sh
mkdir -p -m 700 ~/.sms-signing
keytool -genkeypair -v -keystore ~/.sms-signing/sms-upload.jks -alias sms-upload -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=SMS, O=SMS"
```

Back up the keystore away from this machine, and keep its password in a password manager rather than next to the file. If the upload key is lost or leaks, request an upload key reset in Play Console. The app keeps its updates, because Google holds the app signing key.

To build:
1. Raise `android.versionCode` in `app.json`.
2. Run `npx expo prebuild --platform android --clean`.
3. Run `cd android && ./gradlew bundleRelease`.
4. Run `keytool -printcert -jarfile app/build/outputs/bundle/release/app-release.aab`. The owner must be `CN=SMS, O=SMS`. `CN=Android Debug` means the properties were not read, so do not upload that bundle. `jarsigner -verify` prints `jar verified.` for both.

Before the first upload:
- Keep Play's default Google-generated app signing key.
- The key that signs the first bundle becomes the registered upload key, so do step 4 first.
- Play-installed copies are signed with Google's app signing key. Add the SHA-1 and SHA-256 from Play Console's App signing page wherever a certificate is registered, for example an Android restriction on the Firebase API key.
- Testers uninstall sideloaded QA builds before installing from Play.
- The package name `tech.iamshoaib.sms` cannot change once the Play app exists.

Without `SMS_UPLOAD_STORE_FILE`, release builds keep the template debug key. That key is public, so these builds suit only QA APKs handed directly to testers, and Play rejects them. Once the properties are set, every release build on the machine uses the upload key. Pass `-PSMS_UPLOAD_STORE_FILE=` to build a QA APK that still installs over QA6.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npx expo-doctor
npx expo export --platform android
```

Tests cover homework/results/leave wire contracts, private upload validation, exact persisted mutation retries, family notification state, account boundaries, encrypted storage and push lifecycle. See [engineering and founder QA](docs/MOBILE-QA.md). Test passwords and evidence live outside the repository. Source is saved on `main` in the private [SMS-mobile repository](https://github.com/shoaibhasann/SMS-mobile). Play upload signing is described in [Android release signing](#android-release-signing); no store listing or release is set up yet.

## Push activation boundary

The supplied Android client JSON configures the SDK. It is **not** a server sending credential. Firebase sender credentials, the existing server dispatch flag and the protected recurring dispatcher remain OFF until a permitted device and the end-to-end delivery path are separately verified. FCM acceptance, OS display and in-app read state are different observations. Neutral alert payloads contain no private school records.

Do not enable Firebase Auth, Firestore, Analytics or paid phone verification for this slice; Supabase remains the account/database boundary. Shared phones must disconnect the prior installation before another account enrolls. A remotely revoked identity cannot auto-reactivate; explicit re-enrollment gets a fresh Firebase installation and proof.

## Dependency notes

SDK-compatible dependency versions and `package-lock.json` are retained. `@grpc/grpc-js` is patched within its current major through an override; it is pulled by the Firebase package's unused web Firestore surface. Upstream Expo/ESLint tooling still has moderate dependency advisories; no forced SDK downgrade or unverified major override is applied. Recheck `npm audit` before distribution. Native delivery, actual physical devices, accessibility services and app-store signing are not certified by a JS bundle or unit-test pass.
