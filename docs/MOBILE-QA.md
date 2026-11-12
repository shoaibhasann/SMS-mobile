# SMS Mobile pilot QA

6 November 2026 · Separate Android-first React Native app · Founder acceptance pending

## Android QA6 — 13 November

Use Android version code 6 (`SMS-Android-1.0.0-QA6.apk`), built from `main` at 6788557 with the end-to-end audit fixes. QA6 is signed with the Expo template debug key, not the sideload key of QA1–QA5, so it cannot install over those builds. On the old app turn off notifications (Account → **Turn off on this phone**), uninstall it, then install QA6 and sign in again. If the old app could not be opened, revoke its row under web Account settings → Mobile push notifications → **Registered devices** after signing in on QA6.

Emulator checks on the exact APK (Android 16, arm64): installing over QA5 is refused with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. A fresh install cold-starts in about 0.4 s to Sign in with the new logo and **Email or mobile number**. `sms-school://not-a-screen` and `sms-school:///_sitemap` show **Link not available**, and `SYSTEM_ALERT_WINDOW` is not requested. The APK carries only `arm64-v8a` and `armeabi-v7a`, so x86 emulators cannot install it. Signed-in flows and physical push delivery are open, and so is any Android app restriction on the Firebase API key that names the old certificate.

## Android QA5 — 10 November

Use Android version code 5 with the private Student or Guardian test account. Updating an installed APK can resume its saved session. A fresh install opens Sign in.

- [ ] **Sign in and sign out.** Sign out from Account and confirm. Relaunch and verify the sign-in form appears and school screens stay closed until login. Installing over a signed-in build should reopen the same account after access is checked.
- [ ] **Teachers.** Open Home → Class teachers as Student and Guardian. This QA section has an assigned subject teacher for English and Mathematics. A Class teacher label appears only when the school has designated one for the section.
- [ ] **Attendance.** The QA pupil has 37 saved days from 21 September to 10 November 2026. Switch year, month and status, verify November shows seven saved days, and clear the filters to see all 37. April–August have no saved QA records.
- [ ] **Homework.** Open Learning, check assignment due dates and submission status, then tap a row to open its details. Student can submit and Guardian can review. Learning lists current work first: undated and newest due dates at the top, with unsubmitted past-due work marked **Overdue** (IST); if submission status cannot be read, no row is marked Overdue. A pupil with no current class placement sees **No current class placement** instead of “No homework yet”. In Updates, a Homework card opens the same assignment only when **View homework** is selected; the app selects the linked child whose class holds it, or says it is not available for your linked children.
- [ ] **Leave.** Student requests for self and Guardian requests for a linked child. Review the request as Principal or School Admin in the web app. Verify the decision on mobile and confirm the saved attendance is unchanged.
- [ ] **Physical push.** Open Account → Mobile notifications. If offered, reconnect this phone and check that Android allows SMS notifications. Press Home to background the app. Have QA send a fresh test, look for **SMS school update**, and tap it. It should open **School updates**, also when an exam, homework or other detail screen was open (that detail screen closes, so Android Back never walks through a second copy of the tabs). Verify the fresh alert in **All** and **Unread** before marking it read. In the foreground, expect an in-app message and inbox refresh.

Engineering checks: 279 mobile tests, TypeScript and lint passed. The hosted teacher API returned the same assigned teacher for the Student and linked Guardian, and denied anonymous, wrong-role, unlinked and cross-school reads. The updated development app received two real FCM pushes on an isolated emulator. The foreground push showed an in-app message and refreshed Updates, and the background push appeared in the Android tray and opened Updates.

The exact signed QA5 APK upgraded QA4 on a separate emulator. Fresh Student login, Teachers, real homework statuses, and sign-out followed by relaunch all passed. After the first permission grant, the Account status check timed out once and Retry showed **On for this phone**. The signed QA5 then received a real background tray alert, and tapping it opened School updates with the matching test card. The previous physical v4 push was accepted by Firebase but did not appear on the tester’s phone. Physical QA5 delivery is open.

## Android emulator and Fast Refresh — 10 November

The visible emulator runs the existing Firebase-enabled dev app with Metro at `http://localhost:8087`. Keep Metro open to load UI and TypeScript edits on the same install. Reload in the Expo dev menu if a route change does not refresh.

- [ ] Student and Guardian Attendance each show 37 saved dates across two pages. Learning → Academic analysis shows three published assessments, Mathematics 70% → 85%, and English 80%.
- [ ] Open homework from Learning and Updates. The exact assignment opens in the app. The compact top-left arrow returns to the originating screen. Page headers show the workspace label and greeting on Home only.
- [ ] Account → Appearance: System (default) follows the Android dark theme, including live changes while the app is open; Light/Dark override it immediately and persist after relaunch. A choice made with the old Dark mode switch is kept.
- [ ] On a phone with a saved Google Password Manager entry, select it and confirm both fields fill before tapping Sign in. A temporary Android framework autofill service filled both fields on the emulator.
- [ ] To test remote delivery, enable notifications on the QA device, background SMS, and publish a fresh homework assignment to the linked QA section. Check the Android tray, then tap and open the matching assignment in Updates. The live 10 November emulator test received the generic SMS alert and opened the exact QA homework.

## Signed Android QA build — 10 November

Use signed QA3 (Android version code 3) and the privately supplied Student and Parent logins. QA3 upgrades the earlier signed QA APK in place. The exact APK passed emulator upgrade, first permission Allow, denial → Android settings recovery, and linked attendance. Physical delivery and tap acceptance are below.

- [ ] Open Home, Attendance and Learning with the Student or single-child Parent. No repeated profile card appears. With multiple linked children, the compact switcher changes only the selected child’s records.
- [ ] In Attendance, refresh and confirm a saved Present row. In Learning, check two homework tasks, including one graded task. In Updates, check homework and fee receipt alerts. **Open in SMS Web** on a fee card opens the matching invoice or receipt on the SMS Web workspace.
- [ ] On a fresh Android install, open Account → Mobile notifications → Turn on notifications. Allow the Android dialog. Verify Account resumes, the card shows On, and the Turn on action disappears.
- [ ] Deny or revoke Android notification permission. SMS offers Open Android settings. Allow permission there and return. Verify the card refreshes; use Turn on if this phone has not registered yet.
- [ ] Turn off alerts on this phone, sign out, and sign in with the other QA role. Only the current account's notification state is visible. Test actual phone delivery and tap into Updates separately.

## Android exam schedule alerts — 9 November

The Android Updates screen uses the same v8 family inbox as SMS Web. Tapping a push opens Updates after the app verifies the current family account. **View exam schedule** opens the current assessment by its source ID. It opens as its own screen: Android back or the arrow returns to the same Updates page and filter, and reopening Updates shows the inbox. An updated exam appears once with its new date and unread state. Opening it leaves the read state untouched. Class-wide exams can match multiple linked children while appearing once in a Guardian inbox.

- [ ] M-23: On an enrolled Android QA device with notifications allowed, background the app. Save a new exam for the QA pupil's current class and section. Verify actual Android notification display with generic text. Tap it, confirm Updates opens for the current account, then open **View exam schedule** and match the name, subject, date, class and instructions.
- [ ] M-24: Save the schedule again without editing it. Confirm the existing alert and its read state are retained. Change the date and confirm the current item shows **Exam schedule updated** with the new date. Mark it read and refresh to confirm persistence for this recipient.
- [ ] M-25: Use a disposable Guardian link or a different section. After revoking the only eligible link or completing the exam, reopen an old alert target and check the unavailable state. Verify disabled push preferences, device revocation and denied Android permission separately from inbox access.

Engineering: Android 36 emulator passed disposable Student login, OS permission, real installation registration, live exam queue creation, Updates → exact exam, reschedule and persisted Mark as read. The old job became ineligible. All 253 mobile tests, TypeScript, Expo lint and Android bundle export passed. FCM acceptance and Android tray display/tap remain blocked until the server sender is configured.

The push payload identifies only the Updates destination. Other v8 inbox rows remain readable alongside exam alerts. Homework opens in the app. Announcement, fee reminder and fee payment cards have **Open in SMS Web**, which opens the exact notice, fee or receipt on the authenticated SMS Web workspace. A **Mark all as read** confirmed in a dialog left open while the app was in the background still applies when the same account and role return to Updates; otherwise the app says the updates were not marked.

## Optional Guardian gate alerts — 7 November

Parent Updates now exposes per-child Arrival/Exit switches, both OFF for a fresh link. Choices auto-save with an immutable consent UUID and optimistic version. Pending mutations block competing switches/refresh; unknown/conflicting outcomes require refresh. Account/session changes abort stale actions, and revoked links/recovered owners cannot restore earlier consent. These choices affect the school inbox only; Absent alerts remain independent. A missing scan does not automatically mean Absent.

The updated five-kind inbox includes actual gate-event time and Delayed metadata, exact linked-child Attendance targets (opened on page 1 with filters cleared), independent read state and All/Unread/bulk-read. Four explicit v2 APIs preserve older installed three-kind clients. Turning an option OFF hides retained gate items; enabling later does not backfill already processed scans. Re-enabling within the same link can show retained items/read state.

Final whole checks pass **249 tests/10 files**, TypeScript and warning-free Expo lint; Android Hermes export passes. Six component behavior tests use DOM-mocked React Native primitives, covering default OFF, pending/same-event/cross-child mutation guards, access denial, uncertain-save reconciliation and unmount cancellation. A managed read-only probe runs the exact immutable-session client factory and native data helpers against hosted Supabase: **16 checks pass**, native TOTP session closes, no preference/read writes. This is SDK/component evidence, not installed-binary or physical-device acceptance. The actual gate HTTP/web evidence is tracked in the web repository's `docs/implementation/GATE-ALERTS-QA.md`.

- [ ] NGA-01: In a separately distributed updated native build, enable Arrival only, restart and confirm the saved choice; another Guardian and sibling stay independent.
- [ ] NGA-02: Receive one eligible synthetic IN/OUT through the gate endpoint, inspect actual event time and open the correct child's retained daily attendance.
- [ ] NGA-03: Toggle OFF/ON, inspect All/Unread/count/read persistence and test uncertain saves, background/account switching and link revocation.
- [ ] NGA-04: Confirm Absent while both gate options are OFF, old app compatibility and unchanged old records. Real terminal scans and phone-push display need separate acceptance.

Use the [shared gate-alert checklist](https://sms-web-shoaibhasann.vercel.app/qa/gate-alerts-checklist.md). These boxes remain unchecked until actual native/founder testing. No new APK, EAS update, signed distribution, SMS or FCM activation is included in this source release.

## Clean native sign-in — 7 November

The login removes the illustrated hero and security badge in favor of a centered SMS wordmark, heading and 400pt maximum-width form. Field labels stay left-aligned; existing Sora, semantic Light/Dark colors, password-manager support, reveal control, recovery link and MFA routing remain. Compact/keyboard/large-text layouts start from the top and scroll; taller screens center the form without fixed heights. Native-device checks for 360pt width, landscape, large system text, both themes and keyboard reachability remain manual.

Password recovery opens the SMS Web site. End-to-end reset acceptance requires a delivered recovery email and the production callback URL in Supabase Auth's redirect allowlist.

TypeScript, Expo lint and 217 tests across eight files pass after this layout change. The Android Hermes export also passes; the removed illustration is absent from the exported asset manifest. Native touch/visual acceptance remains unchecked.

## Staff/account MFA compatibility — 7 November

The app now checks the own-account security bootstrap before reading family profiles, roles or child records. An enrolled family account, or a mixed staff/Guardian account, receives an authenticator-code screen before the family workspace. Verification uses an isolated nonpersistent client bound to the captured owner, refreshes the current primary session without adopting isolated tokens, and rechecks the native-backed database decision. Wrong codes remain retryable; account changes/backgrounding hide protected records and abort verification. Auth loss during a pending verification still completes saved push cleanup.

Native enrollment is intentionally not included. A required account without a factor opens the stable website for its own separate sign-in/setup, with no tokens in the URL; afterward sign out and sign in again on the phone. Pure staff accounts still do not gain family-role access. Web staff policy and role/link rules remain authoritative.

TypeScript, Expo lint and all 217 tests across eight files pass; Android Hermes export passes. Live backend QA proves real native TOTP, lower-assurance denials, pure-family own/linked-child access and exact factor/session revocation. These checks do not establish physical Android/iOS interaction, app distribution or real FCM delivery. Use [the staff MFA checklist](https://sms-web-shoaibhasann.vercel.app/qa/staff-mfa-checklist.md) for device acceptance; MFA-13/14 remain manual.

## Current phase: native Learning

Learning adds current-session published homework, Student text/private attachment submission, linked Guardian read-only work/feedback, published single-assessment results and family leave history/submission. Result and leave updates open exact native details; an old result alert shows the latest published revision for that assessment. Opening a detail never marks an alert read.

Unknown homework/leave writes preserve an encrypted exact request scoped to the original account, school, child and operation. Restarting or switching accounts cannot reuse that request under another owner. Only confirmed or first explicitly rejected writes unlock editing; a previous unknown outcome remains locked until reconciled. A retry of that same request also unlocks, with the draft kept, when the server rejects it after checking its request ID (a conflict or invalid input), because that proves the earlier attempt never saved; an access error on retry stays locked. Unsaved drafts are not an offline record cache. A server-accepted write may finish while the app backgrounds or signs out; sign-out does not undo it.

The current slice uses the existing Sora/blue system Light/Dark palette. There are five tabs: Home, Attendance, Learning, Updates and Account. Homework, Results and Leave details use fixed native routes and verified UUID/child targets.

## Engineering evidence

- Mobile source regression tests cover Auth lifecycle, strict family/homework/results/leave wire contracts, private upload type/signature/path/10 MB checks, stale requests, role/child isolation, exact encrypted retries and push lifecycle. The final release count/build evidence is recorded with the release below.
- Hosted SDK preflight verified the actual mobile data methods for Guardian and Student: three homework tasks, two published results and seven leave rows, direct result/decision targets, foreign-child denial and Teacher-only family denial. All three sessions closed; this read-only preflight made no school mutations/provider sends.
- A separate no-mutation before-patch probe proved still-unexpired signed-out JWTs could read older academic/result/leave endpoints. Native Auth and notification session checks already denied them. The targeted SQL patch adds private live-session checks to eight existing academic/result/leave helpers while retaining cohort/role predicates; hosted after-patch evidence belongs in the release below.
- Native visual/touch/accessibility acceptance is not established by SDK tests or a successful bundle. The available computer-use surface does not expose the qemu emulator window; no alternate native UI automation or physical-device pass is claimed.

## Founder checks — do not tick from engineering tests

Use existing private QA credentials; never paste passwords, session tokens, FIDs, installation proofs or sender keys into this document.

- [ ] M-01: Sign in as Guardian. Only currently linked children appear. Student login exposes only its own profile; a Teacher-only account, an inactive profile or a revoked family role is told the account has no family access in the SMS app (with Sign out), not to check the connection.
- [ ] M-01a: The login field accepts an email or a 10-digit mobile number. A phone-only Guardian who set an app password on the website signs in with that mobile number; a Google-only Student signs in after Forgot or set password with the same Gmail. The guidance under Sign in explains both paths and hides while the keyboard is open.
- [ ] M-02: Switch siblings and attendance pages, refresh and reopen the app. Child names and saved records remain scoped correctly; unmarked days are not fabricated as absent. After switching to another app and back (or a routine token refresh) the selected sibling stays selected while it is still linked; a background return re-checks access and then reopens the same tab and screen (for example a homework detail, or Attendance with its filters and page) for the same account, school and role; if access changed it opens Home. Unsaved typed drafts are not kept across that recheck.
- [ ] M-03: Check all six attendance labels, empty/error/loading states, older/previous pages and refresh after link revocation. No attendance edit control exists.
- [ ] M-04: Notifications All/Unread and unread count agree after refresh. Mark one and mark all persist for this user/role only. Confirm the same account's web inbox agrees.
- [ ] M-05: Open an absent update for another linked sibling: attendance selects that child. Revoked/unavailable children fail closed. Result/leave updates open the exact native result/decision for that child. An older result alert shows the latest published revision; unavailable/revoked targets fail closed. After a link is revoked, Retry on the Attendance, Teachers, Results, Homework, Leave or Academic analysis error re-checks the linked children instead of repeating the same error (Homework and Leave retry in place while an unsent draft is open, so the draft is kept).
- [ ] M-06: Sign out/switch account or role during a slow read, write or open confirmation. Previous rows disappear; an old dialog cannot write using the next account's token.
- [ ] M-07: Background/foreground, offline/reconnect and expired sessions do not display stale records as current. Only an app-opened file picker keeps the current screen while backgrounded; any other app switch hides records until access is rechecked. Sign-out failures show a retry message; device cleanup failures block another enrollment.
- [ ] M-07a: Turn off automatic time and set the phone clock about 2 h ahead, then sign in or reopen the app. It reaches the family workspace (no endless skeleton, no sign-out), and staying in the foreground for an hour does not reset the current screen, draft or selected sibling. A routine token refresh only rebinds the session token; it does not recheck or reload screens.
- [ ] M-07b: With automatic time off and the clock about 10 min behind, reopen the app after the hourly token expiry (or tap Try again). The app renews the sign-in once and reaches the workspace without signing out. If the server still rejects the renewed sign-in, it says the sign-in could not be renewed and to check the phone’s date and time; if the renewal itself has no connection (turn on airplane mode for this step), it says to check the connection. While a screen is open past the expiry, its next read renews the sign-in once (one renewal shared by all requests) and retries once, so the screen loads instead of showing an access error.
- [ ] M-08: With Appearance = System, Light/Dark follow system settings. Check small/large phone, landscape, keyboard, long names, largest font, TalkBack and reduced motion. Tap targets remain usable and bottom controls respect safe areas.
- [ ] M-09: Turn on notifications prompts for Android permission on first use. Allowing it registers this phone for the current account and shows On for this phone. After denial, use Open Android settings and return to check the refreshed state. While notifications are on, opening the app (or a token refresh) quietly re-registers this phone at most every six hours (a check that finds nothing to register, or a registration the server rejects, retries at most every 10 minutes, even with a skewed clock; a check cancelled by an account change, an unready sign-in or a missing Android permission retries on the next start or token refresh, so re-allowing notifications in Android settings takes effect straight away), so web **Last registered** moves forward; a phone unseen for 90 days shows **Reconnect notifications** here and **Stale** on the web. At the device limit, Turn on shows the server reason (remove an old device first). A failed or unconfirmed Turn on never blocks Disconnect this phone or a workspace switch. If the Turn on reply was lost after the server saved the phone, Disconnect this phone revokes that registration by this phone's own installation, so it stops counting toward the 10-device limit without using the web.
- [ ] M-09a: Mixed Guardian + Student account: turn on notifications in the Student workspace, force-stop and relaunch. The app reopens directly in the Student workspace (one access check, no Guardian screen first). After sign-out the saved workspace is forgotten, so the next sign-in starts in Guardian. Switching workspaces disconnects that registration without forcing sign-out; if the other workspace's registration blocks Turn on, **Disconnect this phone** appears.
- [ ] M-09b: On a fee due date after 08:00 IST, the due-today fee reminder arrives silently in the shade (no sound, no heads-up banner) on the Android **Reminders** notification channel (Settings → Apps → SMS → Notifications). Absence, results, leave and other alerts keep the default sounding channel.
- [ ] M-10: Revoke from the web while queued, disconnect, logout, account/role switch, fresh session and reinstall/reset. The previous identity cannot silently reactivate or transfer to another owner. Other phones/children/read states remain intact.
- [ ] M-11: After approved server configuration, create a fresh eligible event. Record job, provider acceptance, real phone display, tap→authenticated inbox and permitted source record separately. Duplicate/expired/revoked jobs must not leak private data.
- [ ] M-12: Test foreground/background/terminated app, disabled OS permission, FID rotation and notification tap before login. Arbitrary payload URLs must not navigate or execute. Previously accepted neutral OS alerts cannot be recalled retroactively.

## Founder Learning checks

Teacher grading and Principal leave review happen on the existing web workspace; staff accounts cannot use this family-only app.

- [ ] M-13: Learning → select the right child. Only current-session published homework for the exact active class/section appears. Drafts, another sibling’s class and another school stay hidden; page/refresh keeps the correct context.
- [ ] M-14: As Student, open a QA task, enter a response and attach an original PDF/JPG/PNG up to 10 MB. Invalid/empty/oversized or renamed executable content fails. Save, reload and reopen: text/file name persist without public file URLs. On Android the picker round-trip (including Cancel) keeps the typed response and the Homework screen, and the picked file uploads; access is rechecked in place on return.
- [ ] M-15: On the web, the assigned Teacher grades that response. Reload/reopen the Student app: marks/feedback agree and reviewed work is locked. Guardian sees only the selected linked child’s response/feedback with no edit/upload controls. Another teacher cannot grade it.
- [ ] M-16: Lose the save response, restart/reopen and retry the locked request. The same request ID/payload returns the original submission; it cannot silently become another child/account’s work. Unreadable pending storage blocks a new write.
- [ ] M-17: Published results show only school-reviewed latest revisions and the original class/session. Refresh, change child, paginate and open a result update. Draft/unpublished, foreign-child and revoked-link requests fail; no class rank, raw roster or private review metadata appears.
- [ ] M-18: Submit valid leave dates/reason. Reopen/refresh: one Pending row exists. Exact retry creates no second request. Invalid dates, reverse ranges and pending/approved overlaps fail. Use a school-approved valid session date for QA.
- [ ] M-19: A different authorized Principal/Admin reviews leave on the web. Refresh/open the decision update in the app: saved status/reason match. Approved leave never edits attendance automatically; other linked children and historical attendance/fees remain unchanged.
- [ ] M-20: During slow upload/save, switch account, background or sign out. Old callbacks cannot borrow the new token; reopening the original account recovers only its own unconfirmed intent. A write already accepted by the server may finish; do not assume sign-out cancels it. Back stays available during a slow upload or save; a save with no reply after about 20 s shows as unconfirmed with **Retry the same submission**.
- [ ] M-21: Check five-tab labels, form keyboard, file picker Cancel, loading/empty/error/offline states, long text, system Dark/Light, large font and TalkBack on real Android. No hidden staff controls or clipped submission button.
- [ ] M-22: Original attachment downloads/past-session homework remain on the authenticated web workspace for this slice. Unreferenced private uploads may need a retention sweep after persistent cleanup/network failure; they must never become publicly readable.
- [ ] M-26: Force a render error on a screen (development build). The error screen shows **Retry** and **Go to Home**; Go to Home reloads the app to Home even when Retry keeps failing, and the status bar icons stay readable in Light and Dark appearance.

The initial mobile runtime `8c28b7e` is a historical foundation checkpoint. Current source is saved on the private repository’s `main`; release evidence below describes the Learning slice.

## Still blocked before production app distribution

Real FCM sender/scheduler activation, physical Android delivery, iOS/APNs lifecycle, a release signing identity, agreed app-store/privacy materials and founder acceptance. A debug APK needs Metro and is not a Play Store release. Do not advertise the full commercial SMS as complete; see the web repository's `docs/implementation/WEB-REMAINING.md`.

- [ ] Release APK permissions: `adb shell dumpsys package tech.iamshoaib.sms | grep SYSTEM_ALERT_WINDOW` returns nothing (blocked through `app.json` `android.blockedPermissions`; run `npx expo prebuild --platform android` before building so the generated manifest picks it up). Debug builds may still request it for the React Native dev overlay.
- [ ] App icon: after `npx expo prebuild --platform android` and a new build, the launcher shows the blue ribbon S on its light tile (check a round and a squircle launcher), a notification shows a white S in the status bar and the S in the logo blue in the shade (Android never draws a coloured small icon; iPhone shows the app icon), and the login screen shows the logo above "SMS".


## Learning release — verified engineering checkpoint

- 206 mobile tests across seven files pass; full ESLint and TypeScript pass. Expo Doctor passes 20/20. Final production Android JS export and the regenerated Android Gradle debug APK build pass; the new build is installed/launched in the owned Android 36 emulator with Metro 8087. These are build/SDK checks, not a native touch or visual acceptance pass.
- Actual hosted SDK flow uses a new isolated QA homework/leave fixture: original private PDF upload → Student submit → assigned web Teacher grade 8/10 → identical Student and linked Guardian reload. Exact retries, stale revisions, immutable submitted files, wrong child and read-only Guardian boundaries pass. Existing published assessment targets reload exactly; native family details do not expose roster/private review fields.
- Student leave → independent Principal approval → Student/Guardian exact decision reload and one alert per recipient pass. Existing attendance, finance, links, old source rows and previous notification/read fields remain identical. All owned Auth sessions are closed; no SMS, email or FCM is sent.
- The session patch is hosted as `20261106180524_require_live_academic_family_sessions`, source SHA-256 `d4a5cbf04b938772bef9f10cfaf083a8f5bf029601df699a02afe7e9b8956e6a`. A private eight-routine/30-policy rollback snapshot was captured first. Immediate 1,307 attendance and 16 fee-payment row fingerprints remain unchanged after DDL. Current web regression coverage passes 1,997 tests across 148 files; the replay plan has 87 sources/17 patches.
- Fresh/no-store Storage requests, direct academic tables and result/leave/homework RPCs reject retained signed-out tokens. Fresh private-file requests also deny anonymous, foreign-child and valid-but-unassigned same-school Teacher access. Already-running authorized academic writes retain ordinary statement-snapshot behavior.

### Private-file revocation limit — open pilot gate

An actual raw URL replay with the same old JWT returned a CDN HIT after logout. A fresh unique `cacheNonce` with `cache: 'no-store'` is denied; normal web downloads already use that path, and this native slice does not download original files. Cached bytes/URLs previously authorized for that JWT may remain available until its expiry. Do not claim immediate revocation of every raw object URL. Strict revocation requires a noncached, current-session checked proxy/S3 delivery path and denial of direct raw-read bypass, before real-school rollout. [Supabase’s verified provider behavior](https://supabase.com/kb/troubleshooting/storage-private-bucket-files-still-accessible-after-remove-access-or-logout).

Unknown upload/cleanup failures can also leave unreferenced private objects. Add a retention sweep before wider distribution. Original downloads, past-session homework, term report cards, Hindi, actual mobile OTP, signed app distribution and real phone delivery remain separate scope. Founder cases above stay unchecked.
