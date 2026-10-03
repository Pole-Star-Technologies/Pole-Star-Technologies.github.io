# Google Play Console — answers, filled from evidence

For the release described in `site.config.json` (MeetingAI 1.3.0 build 14, with
the version fields kept in sync there). Written from the shipped APK and the live backend,
so the form and the policy page cannot drift apart. Re-derive it with the
commands in `README.md` whenever the app changes.

## Store listing

| Field | Answer |
|---|---|
| App name | MeetingAI |
| Package | `com.meetingAIv1` |
| Category | Productivity |
| Privacy policy | `https://<site.base>/privacy.html` (printed by `node build.mjs`) |
| Developer email / support | `si.tech.polestar@gmail.com` |
| Target audience | **18+ only.** Play has no 21+ category; our Terms require users to be 21+, and the policy states it. Do not add any audience category below 18, and do not use highly-targeted advertising imagery (we do not run ads). |
| Ads | **No.** No ads SDK is present in the build (`grep -inE "ads\|admob" pubspec.yaml`). |
| In-app purchases | Subscriptions: `basic_monthly`, `basic_annual`, `premium_monthly`, `premium_annual`, `business_monthly`, `business_annual` (rows in `public.tier_pricing`, `active = true`). Register all six as products before submission. |
| App access | Sign-in with a Google account is required; there is no demo mode. Reviewers: support page §"For app reviewers" — access details on request within 24 h. Never publish credentials on the site. |
| Content ratings | Private, user-recorded business conversations; no user-generated content shown to other users; no violence/sexual content. Declare "no user-generated content" only if the share feature stays private to the account. |

## Data safety — the actual answers

| Data type | Collected | Shared with third parties | Used for |
|---|---|---|---|
| Precise location | **Yes** (optional; captured at sign-in only, never during recording) | No | Security / fraud prevention, app functionality |
| Approximate location | **Yes** (same capture, coarse fallback) | No | Security / fraud prevention |
| Name | **Yes** (from Google Sign-In) | No | App functionality, account management |
| Email address | **Yes** | No | App functionality, account management, security |
| Photo (profile picture URL) | **Yes** (from Google Sign-In) | No | App functionality |
| User IDs | **Yes** (Supabase auth uid; device authorisation ids) | No | App functionality, security |
| Audio recordings | **Yes** (recordings you make; private bucket, owner-scoped) | **Yes — Google (Gemini API), as a data processor for transcription**, cloud mode only | App functionality |
| Files and documents (transcripts, minutes) | **Yes** | **Yes — Google (Gemini API)**, cloud mode only | App functionality |
| Device or other IDs | **Yes** (device info in session records, user agent, IP address, `device_authorizations.device_id`) | No | Security / fraud prevention, app functionality |
| Purchase history | **Yes** (tier, Play product id, Play purchase token, expiry) | **Yes — Google Play** for billing; shared with Google for transaction processing | App functionality, accounting, fraud prevention |
| App activity (in-app actions) | **Yes, limited**: usage counters (`usage_events`: meeting minutes, tokens, model, strategy) | No | App functionality (quota enforcement), service quality |
| Crash logs / diagnostics | **No.** No crash-reporting SDK is installed | — | — |
| Web URL browsing | **No** | — | — |
| Contacts, call log, SMS, camera, calendar | **No** | — | — |

### Data safety sub-questions

| Question | Answer |
|---|---|
| Is data encrypted in transit? | **Yes.** HTTPS/TLS to Supabase, to Google, and to our edge functions. |
| Users can request deletion? | **Yes**, self-service: Profile → Delete account. Verified end-to-end 2026-10-02; the server-side `delete_my_account()` refuses to run while the caller's audio is still in Storage. |
| Data can be recovered by users? | **Not as an export service.** The app shares/exports individual meetings; there is no bulk archive button — answer honestly rather than "yes". |
| Data used for advertising / ad-locked? | **No / No.** |
| Any data not listed in the form? | IP address and user agent are covered by "Device or other IDs". Session tokens are **not** stored — a one-way digest is (`md5:` prefix in `user_sessions.session_token`, see migration 17 §1) — so do not declare "other authentication information". |

## Encryption / cryptographic declaration

| Question | Answer | Basis |
|---|---|---|
| Does the app use cryptographic functionality beyond Android/Google-provided and TLS? | **No.** TLS for transport; Android keystore-backed secure storage for tokens (`flutter_secure_storage`); SHA-256 digest checks on downloaded model files. No custom crypto, no encryption of user files by our own code. | `pubspec.yaml` dependency list; `lib/services/*` |
| If Play asks whether encryption is exempt | Transport-layer security only → generally the Annex I exemption. This is a legal declaration: answer deliberately, do not click through. | |

## Play App Signing (affects Google Sign-In, not data safety)

Decide explicitly, in the Console, before the first upload:

* **Play App Signing enabled (default):** Play re-signs what users install with
  Play's App signing key. After the first upload, copy the Console's
  *App signing key certificate* SHA-1/SHA-256 into the Google Cloud Console
  Android client for `com.meetingAIv1` (and the Firebase Android app entry if
  that is where the package is registered), or **every Play installer gets
  `ApiException: 10` at sign-in** while your local builds keep working.
* **Manage your own key:** this build's key (`CN=MeetingAI`, SHA-1
  `E9:EA:B8:17:C5:87:23:C4:B1:A2:A4:E3:C3:FE:F0:FE:33:7E:6D:33`) is the identity
  and nothing further needs registering.

Verify after upload by downloading the artefact back from the Console:
`tools/verify_signing.sh <downloaded.aab>`.

## Known open items, so they are not surprises at review

1. `sync_entitlement` trusts a client-reported purchase token; server-side
   verification with Google needs a service secret in the edge function — an
   upgrade-fraud door, not a store blocker.
2. 9 rows in `public.entitlements` with `source='support'` from before the grant
   script was guarded.
3. No server-side sweep of Storage for accounts that vanish without using the
   in-app delete button (deleting the account itself does clear the caller's
   objects first).
4. Deleting a meeting inside the app removes the local file but does **not**
   delete the storage objects left by past cloud transcriptions of large
   recordings; the policy states this, and the fix is a prefix delete on meeting
   deletion.
