# SMS Mobile

Separate React Native application for verified Guardian and Student accounts. Built with Expo SDK 58, React Native 0.88 and TypeScript; native screens use the existing SMS blue/violet palette, Sora and system appearance. This is not a WebView wrapper.

## Current pilot slice

- Email/password sign-in against the existing Supabase project; no automatic signup, guardian linking or staff access.
- Server-checked active school/family roles, linked-child selection, read-only retained attendance and refresh/pagination.
- Existing family Notifications with All/Unread, independent saved read state, mark one/all, older history and native result/leave detail targets.
- Learning: current-session published homework, private PDF/JPG/PNG upload (10 MB), Student submit/update and Teacher grade/feedback reload; Guardians read only their linked child’s submission.
- Published single-assessment results with history paging/latest revisions, and family leave submission/history/independent school decisions.
- Unconfirmed homework/leave mutations retain an encrypted, account/role/child-scoped exact retry intent across app restarts; school records are not cached for offline browsing.
- Native Android Firebase Installation ID registration with explicit phone permission, versioned preference enable, private installation proof, remote revoke compatibility, logout/account-switch cleanup and a fixed inbox-only push destination.
- Encrypted native session storage, no saved child/attendance/inbox cache, stale-request cancellation and session-bound API clients.

Term report cards, past-session homework history, original attachment downloads, Hindi translations, phone OTP login and iOS push remain later app slices. Homework uploads use private Storage; authenticated original downloads remain on the school website. App registration does not prove provider acceptance or phone display.

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

## Checks

```sh
npm run typecheck
npm run lint
npm test
npx expo-doctor
npx expo export --platform android
```

Tests cover homework/results/leave wire contracts, private upload validation, exact persisted mutation retries, family notification state, account boundaries, encrypted storage and push lifecycle. See [engineering and founder QA](docs/MOBILE-QA.md). Test passwords and evidence live outside the repository. Source is saved on `main` in the private [school-management-mobile repository](https://github.com/shoaibhasann/school-management-mobile). App-store release/signing is not configured.

## Push activation boundary

The supplied Android client JSON configures the SDK. It is **not** a server sending credential. Firebase sender credentials, the existing server dispatch flag and the protected recurring dispatcher remain OFF until a permitted device and the end-to-end delivery path are separately verified. FCM acceptance, OS display and in-app read state are different observations. Neutral alert payloads contain no private school records.

Do not enable Firebase Auth, Firestore, Analytics or paid phone verification for this slice; Supabase remains the account/database boundary. Shared phones must disconnect the prior installation before another account enrolls. A remotely revoked identity cannot auto-reactivate; explicit re-enrollment gets a fresh Firebase installation and proof.

## Dependency notes

SDK-compatible dependency versions and `package-lock.json` are retained. `@grpc/grpc-js` is patched within its current major through an override; it is pulled by the Firebase package's unused web Firestore surface. Upstream Expo/ESLint tooling still has moderate dependency advisories; no forced SDK downgrade or unverified major override is applied. Recheck `npm audit` before distribution. Native delivery, actual physical devices, accessibility services and app-store signing are not certified by a JS bundle or unit-test pass.
