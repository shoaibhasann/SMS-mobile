# SMS Mobile pilot QA

6 November 2026 · Separate Android-first React Native app · Founder acceptance pending

## Staff/account MFA compatibility — 7 November

The app now checks the own-account security bootstrap before reading family profiles, roles or child records. An enrolled family account, or a mixed staff/Guardian account, receives an authenticator-code screen before the family workspace. Verification uses an isolated nonpersistent client bound to the captured owner, refreshes the current primary session without adopting isolated tokens, and rechecks the native-backed database decision. Wrong codes remain retryable; account changes/backgrounding hide protected records and abort verification. Auth loss during a pending verification still completes saved push cleanup.

Native enrollment is intentionally not included. A required account without a factor opens the stable website for its own separate sign-in/setup, with no tokens in the URL; afterward sign out and sign in again on the phone. Pure staff accounts still do not gain family-role access. Web staff policy and role/link rules remain authoritative.

TypeScript, Expo lint and all 217 tests across eight files pass; Android Hermes export passes. Live backend QA proves real native TOTP, lower-assurance denials, pure-family own/linked-child access and exact factor/session revocation. These checks do not establish physical Android/iOS interaction, app distribution or real FCM delivery. Use [the staff MFA checklist](https://kids-corner-erp-frontend.vercel.app/qa/staff-mfa-checklist.md) for device acceptance; MFA-13/14 remain manual.

## Current phase: native Learning

Learning adds current-session published homework, Student text/private attachment submission, linked Guardian read-only work/feedback, published single-assessment results and family leave history/submission. Result and leave updates open exact native details; an old result alert shows the latest published revision for that assessment. Opening a detail never marks an alert read.

Unknown homework/leave writes preserve an encrypted exact request scoped to the original account, school, child and operation. Restarting or switching accounts cannot reuse that request under another owner. Only confirmed or first explicitly rejected writes unlock editing; a previous unknown outcome remains locked until reconciled. Unsaved drafts are not an offline record cache. A server-accepted write may finish while the app backgrounds or signs out; sign-out does not undo it.

The current slice uses the existing Sora/blue system Light/Dark palette. There are five tabs: Home, Attendance, Learning, Updates and Account. Homework, Results and Leave details use fixed native routes and verified UUID/child targets.

## Engineering evidence

- Mobile source regression tests cover Auth lifecycle, strict family/homework/results/leave wire contracts, private upload type/signature/path/10 MB checks, stale requests, role/child isolation, exact encrypted retries and push lifecycle. The final release count/build evidence is recorded with the release below.
- Hosted SDK preflight verified the actual mobile data methods for Guardian and Student: three homework tasks, two published results and seven leave rows, direct result/decision targets, foreign-child denial and Teacher-only family denial. All three sessions closed; this read-only preflight made no school mutations/provider sends.
- A separate no-mutation before-patch probe proved still-unexpired signed-out JWTs could read older academic/result/leave endpoints. Native Auth and notification session checks already denied them. The targeted SQL patch adds private live-session checks to eight existing academic/result/leave helpers while retaining cohort/role predicates; hosted after-patch evidence belongs in the release below.
- Native visual/touch/accessibility acceptance is not established by SDK tests or a successful bundle. The available computer-use surface does not expose the qemu emulator window; no alternate native UI automation or physical-device pass is claimed.

## Founder checks — do not tick from engineering tests

Use existing private QA credentials; never paste passwords, session tokens, FIDs, installation proofs or sender keys into this document.

- [ ] M-01: Sign in as Guardian. Only currently linked children appear. Student login exposes only its own profile; a Teacher-only account is denied.
- [ ] M-02: Switch siblings and attendance pages, refresh and reopen the app. Child names and saved records remain scoped correctly; unmarked days are not fabricated as absent.
- [ ] M-03: Check all six attendance labels, empty/error/loading states, older/previous pages and refresh after link revocation. No attendance edit control exists.
- [ ] M-04: Notifications All/Unread and unread count agree after refresh. Mark one and mark all persist for this user/role only. Confirm the same account's web inbox agrees.
- [ ] M-05: Open an absent update for another linked sibling: attendance selects that child. Revoked/unavailable children fail closed. Result/leave updates open the exact native result/decision for that child. An older result alert shows the latest published revision; unavailable/revoked targets fail closed.
- [ ] M-06: Sign out/switch account or role during a slow read, write or open confirmation. Previous rows disappear; an old dialog cannot write using the next account's token.
- [ ] M-07: Background/foreground, offline/reconnect and expired sessions do not display stale records as current. Sign-out failures show a retry message; device cleanup failures block another enrollment.
- [ ] M-08: Light/Dark follow system settings. Check small/large phone, landscape, keyboard, long names, largest font, TalkBack and reduced motion. Tap targets remain usable and bottom controls respect safe areas.
- [ ] M-09: Enable on this phone requests Android permission explicitly. Denial never reports a successful registration. Granted permission creates only this own account/role installation. Account master preference enable is separately confirmed; it never claims phone delivery.
- [ ] M-10: Revoke from the web while queued, disconnect, logout, account/role switch, fresh session and reinstall/reset. The previous identity cannot silently reactivate or transfer to another owner. Other phones/children/read states remain intact.
- [ ] M-11: After approved server configuration, create a fresh eligible event. Record job, provider acceptance, real phone display, tap→authenticated inbox and permitted source record separately. Duplicate/expired/revoked jobs must not leak private data.
- [ ] M-12: Test foreground/background/terminated app, disabled OS permission, FID rotation and notification tap before login. Arbitrary payload URLs must not navigate or execute. Previously accepted neutral OS alerts cannot be recalled retroactively.

## Founder Learning checks

Teacher grading and Principal leave review happen on the existing web workspace; staff accounts cannot use this family-only app.

- [ ] M-13: Learning → select the right child. Only current-session published homework for the exact active class/section appears. Drafts, another sibling’s class and another school stay hidden; page/refresh keeps the correct context.
- [ ] M-14: As Student, open a QA task, enter a response and attach an original PDF/JPG/PNG up to 10 MB. Invalid/empty/oversized or renamed executable content fails. Save, reload and reopen: text/file name persist without public file URLs.
- [ ] M-15: On the web, the assigned Teacher grades that response. Reload/reopen the Student app: marks/feedback agree and reviewed work is locked. Guardian sees only the selected linked child’s response/feedback with no edit/upload controls. Another teacher cannot grade it.
- [ ] M-16: Lose the save response, restart/reopen and retry the locked request. The same request ID/payload returns the original submission; it cannot silently become another child/account’s work. Unreadable pending storage blocks a new write.
- [ ] M-17: Published results show only school-reviewed latest revisions and the original class/session. Refresh, change child, paginate and open a result update. Draft/unpublished, foreign-child and revoked-link requests fail; no class rank, raw roster or private review metadata appears.
- [ ] M-18: Submit valid leave dates/reason. Reopen/refresh: one Pending row exists. Exact retry creates no second request. Invalid dates, reverse ranges and pending/approved overlaps fail. Use a school-approved valid session date for QA.
- [ ] M-19: A different authorized Principal/Admin reviews leave on the web. Refresh/open the decision update in the app: saved status/reason match. Approved leave never edits attendance automatically; other linked children and historical attendance/fees remain unchanged.
- [ ] M-20: During slow upload/save, switch account, background or sign out. Old callbacks cannot borrow the new token; reopening the original account recovers only its own unconfirmed intent. A write already accepted by the server may finish; do not assume sign-out cancels it.
- [ ] M-21: Check five-tab labels, form keyboard, file picker Cancel, loading/empty/error/offline states, long text, system Dark/Light, large font and TalkBack on real Android. No hidden staff controls or clipped submission button.
- [ ] M-22: Original attachment downloads/past-session homework remain on the authenticated web workspace for this slice. Unreferenced private uploads may need a retention sweep after persistent cleanup/network failure; they must never become publicly readable.

The initial mobile runtime `8c28b7e` is a historical foundation checkpoint. Current source is saved on the private repository’s `main`; release evidence below describes the Learning slice.

## Still blocked before production app distribution

Real FCM sender/scheduler activation, physical Android delivery, iOS/APNs lifecycle, a release signing identity, agreed app-store/privacy materials and founder acceptance. A debug APK needs Metro and is not a Play Store release. Do not advertise the full commercial SMS as complete; see the web repository's `docs/implementation/WEB-REMAINING.md`.


## Learning release — verified engineering checkpoint

- 206 mobile tests across seven files pass; full ESLint and TypeScript pass. Expo Doctor passes 20/20. Final production Android JS export and the regenerated Android Gradle debug APK build pass; the new build is installed/launched in the owned Android 36 emulator with Metro 8087. These are build/SDK checks, not a native touch or visual acceptance pass.
- Actual hosted SDK flow uses a new isolated QA homework/leave fixture: original private PDF upload → Student submit → assigned web Teacher grade 8/10 → identical Student and linked Guardian reload. Exact retries, stale revisions, immutable submitted files, wrong child and read-only Guardian boundaries pass. Existing published assessment targets reload exactly; native family details do not expose roster/private review fields.
- Student leave → independent Principal approval → Student/Guardian exact decision reload and one alert per recipient pass. Existing attendance, finance, links, old source rows and previous notification/read fields remain identical. All owned Auth sessions are closed; no SMS, email or FCM is sent.
- The session patch is hosted as `20261106180524_require_live_academic_family_sessions`, source SHA-256 `d4a5cbf04b938772bef9f10cfaf083a8f5bf029601df699a02afe7e9b8956e6a`. A private eight-routine/30-policy rollback snapshot was captured first. Immediate 1,307 attendance and 16 fee-payment row fingerprints remain unchanged after DDL. Current web regression coverage passes 1,997 tests across 148 files; the replay plan has 87 sources/17 patches.
- Fresh/no-store Storage requests, direct academic tables and result/leave/homework RPCs reject retained signed-out tokens. Fresh private-file requests also deny anonymous, foreign-child and valid-but-unassigned same-school Teacher access. Already-running authorized academic writes retain ordinary statement-snapshot behavior.

### Private-file revocation limit — open pilot gate

An actual raw URL replay with the same old JWT returned a CDN HIT after logout. A fresh unique `cacheNonce` with `cache: 'no-store'` is denied; normal web downloads already use that path, and this native slice does not download original files. Cached bytes/URLs previously authorized for that JWT may remain available until its expiry. Do not claim immediate revocation of every raw object URL. Strict revocation requires a noncached, current-session checked proxy/S3 delivery path and denial of direct raw-read bypass, before real-school rollout. [Supabase’s verified provider behavior](https://supabase.com/kb/troubleshooting/storage-private-bucket-files-still-accessible-after-remove-access-or-logout).

Unknown upload/cleanup failures can also leave unreferenced private objects. Add a retention sweep before wider distribution. Original downloads, past-session homework, term report cards, Hindi, actual mobile OTP, signed app distribution and real phone delivery remain separate scope. Founder cases above stay unchecked.
