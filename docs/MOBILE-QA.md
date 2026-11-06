# SMS Mobile pilot QA

6 November 2026 · Separate Android-first React Native app · Founder acceptance pending

## Engineering evidence

- Actual Supabase SDK checks pass for existing Guardian and Student QA accounts: verified context, exact own/linked child, 30 retained attendance rows, identical reload, foreign-child denial and unchanged existing notification/read state. Teacher family access is denied. All three owned SDK Auth sessions are signed out.
- A revoked Guardian session-bound client cannot apply a delayed mark-all operation using the next Student account's session. No school source rows or provider sends are created by that check.
- Android JS production export and Firebase prebuild pass. Generated Google Services plugin is4.5.0; Installation ID messaging is ON and auto-init is OFF. Expo Doctor passes20/20 checks.
- Final89tests/fourfiles, full TypeScript and ESLint pass. Android Gradle debug APK build passes and is installed/launched in the owned Android36 emulator with Metro8087. Production Android JS export includes the redesigned login and illustration. Native visual/interactive acceptance remains unchecked: available computer-use control does not expose the qemu emulator window; no alternate UI-automation or physical-device pass is claimed.

The initial loose login was replaced with a compact SMS masthead, branded illustration, equal-width icon fields, an inset password reveal, short recovery/footer copy and keyboard-aware decoration. The existing palette/system appearance and Sora remain unchanged.

## Founder checks — do not tick from engineering tests

Use existing private QA credentials; never paste passwords, session tokens, FIDs, installation proofs or sender keys into this document.

- [ ] M-01: Sign in as Guardian. Only currently linked children appear. Student login exposes only its own profile; a Teacher-only account is denied.
- [ ] M-02: Switch siblings and attendance pages, refresh and reopen the app. Child names and saved records remain scoped correctly; unmarked days are not fabricated as absent.
- [ ] M-03: Check all six attendance labels, empty/error/loading states, older/previous pages and refresh after link revocation. No attendance edit control exists.
- [ ] M-04: Notifications All/Unread and unread count agree after refresh. Mark one and mark all persist for this user/role only. Confirm the same account's web inbox agrees.
- [ ] M-05: Open an absent update for another linked sibling: attendance selects that child. Revoked/unavailable children fail closed. Result/leave details open only the fixed school website and verify web access separately.
- [ ] M-06: Sign out/switch account or role during a slow read, write or open confirmation. Previous rows disappear; an old dialog cannot write using the next account's token.
- [ ] M-07: Background/foreground, offline/reconnect and expired sessions do not display stale records as current. Sign-out failures show a retry message; device cleanup failures block another enrollment.
- [ ] M-08: Light/Dark follow system settings. Check small/large phone, landscape, keyboard, long names, largest font, TalkBack and reduced motion. Tap targets remain usable and bottom controls respect safe areas.
- [ ] M-09: Enable on this phone requests Android permission explicitly. Denial never reports a successful registration. Granted permission creates only this own account/role installation. Account master preference enable is separately confirmed; it never claims phone delivery.
- [ ] M-10: Revoke from the web while queued, disconnect, logout, account/role switch, fresh session and reinstall/reset. The previous identity cannot silently reactivate or transfer to another owner. Other phones/children/read states remain intact.
- [ ] M-11: After approved server configuration, create a fresh eligible event. Record job, provider acceptance, real phone display, tap→authenticated inbox and permitted source record separately. Duplicate/expired/revoked jobs must not leak private data.
- [ ] M-12: Test foreground/background/terminated app, disabled OS permission, FID rotation and notification tap before login. Arbitrary payload URLs must not navigate or execute. Previously accepted neutral OS alerts cannot be recalled retroactively.

## Still blocked before production app distribution

Real FCM sender/scheduler activation, physical Android delivery, iOS/APNs lifecycle, a release signing identity, agreed app-store/privacy materials and founder acceptance. A debug APK needs Metro and is not a Play Store release. Do not advertise the full commercial SMS as complete; see the web repository's `docs/implementation/WEB-REMAINING.md`.
