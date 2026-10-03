# MeetingAI public site

The privacy policy, terms and support pages for **MeetingAI** (`com.meetingAIv1`),
by **Pole Star Technologies**. These are the URLs the Google Play Console listing
points at, so they are treated as a release artefact, not as a scratch pad.

```
src/                    the source of every page (with {{tokens}} in it)
site.config.json        every fact the pages state about the operator and the app
build.mjs               strict template -> dist/ ; refuses to write on any error
dist/                   generated, git-ignored, uploaded to Pages by CI
.github/workflows/      build + deploy to GitHub Pages
```

## Why this is a separate repo from the app

The app repo is private and contains signing notes, keystore paths, security
findings and database migrations. This site is public by definition. Nothing
that is not a customer-facing sentence belongs in here.

## Deploy

1. `node build.mjs` — must pass locally first.
2. Push to `main`.
3. GitHub Pages (Settings → Pages → **Source: GitHub Actions**) picks up the
   `Deploy public site` workflow and serves `dist/`.

Enable Pages once, with any token that can manage the repo:

```bash
gh api -X POST "repos/OWNER/REPO/pages" \
  -f build_type=workflow \
  -f "workflow_path=.github/workflows/deploy.yml" \
  -f source_branch_name=main \
  -f source_workflow_path=.github/workflows/deploy.yml
```

If `site.base` in `site.config.json` is wrong for the repo it is deployed to,
the canonical-link check in `build.mjs` fails, and CI fails with it. That is the
point of the check: a policy page whose `<link rel="canonical">` points
somewhere else is a page Google will quietly not rank.

## The rules that make this page trustworthy

* **The policy describes the shipped build.** Every page carries
  `data-app-version="<versionName>+<versionCode>"`. If the app's version or its
  data flows change, this repo gets a commit **before** the app is released.
* **No placeholders reach production.** `build.mjs` errors out if `site.config.json`
  still contains `TODO`, if any `{{token}}` is unresolved, if an internal link
  points at a page that does not exist, or if a canonical URL disagrees with
  `site.base`.
* **Nothing internal belongs here.** This repo is public. Internal table names, RPC names, storage bucket names, keystore or signing detail, and security findings stay in the app repo; only sentences meant for a user get published.
* **Claims are reproducible.** The factual claims in the policy come from the
  commands in the next section, run against the real build and the live project
  — not from an earlier draft of this file.

## Where the claims came from

Run these and the policy can be checked line by line.

| Claim | Evidence |
|---|---|
| Permission list (§3 of the policy) | `aapt2 dump badging build/app/outputs/apk/release/app-release.apk` |
| "No analytics/ad SDKs" | `grep -inE "firebase\|analytics\|crashlytics\|sentry\|ads" pubspec.yaml` → nothing |
| Tables and columns we store (§2) | `select table_name, string_agg(column_name, ', ') from information_schema.columns where table_schema='public' group by 1` |
| Session token stored as a digest (§2.4) | `supabase/migrations/17_function_grants_and_account_deletion.sql` §1 |
| Deletion order, and that it refuses while audio remains (§9) | same migration, `delete_my_account()` |
| Recordings bucket is private (§4, §10) | `select id, public from storage.buckets` |
| Region (§4) | `supabase projects list` |
| Cloud transcription used `direct`/`storage`, models used (§5) | `select strategy, provider, count(*) from usage_events group by 1,2`; `supabase/functions/gemini-proxy/prompts.ts` (`MODELS`) |
| Offline Whisper models (§5.1) | `select model_key, engine from transcription_models` |
| The build these claims describe | `tools/verify_signing.sh build/app/outputs/bundle/release/app-release.aab` → `PASS`, cert `CN=MeetingAI` |

## Store listing mapping

| Play Console field | Value |
|---|---|
| Privacy Policy | `{{site.base}}{{site.policyPath}}` → fill from `site.config.json` (`node build.mjs` prints both) |
| Support / email | `{{site.supportPath}}` page, and `{{org.supportEmail}}` |
| Terms | `{{site.termsPath}}` (not required by Play, linked from the app's Profile screen) |
| Target audience | 18+ in the Console (Play has no 21+ category); **our own terms require 21+** and the policy says so |
| Ads | None. No ads SDK in the build |
| Data safety | answered in the app repo (private): `playstore-release/DATA_SAFETY_ANSWERS.md` — it names tables, RPCs and open findings, so it does not live here |

## Local preview

```bash
node build.mjs && npx --yes serve dist
```

## Changing it

Edit `site.config.json` for operator/app facts, `src/*.html` for prose, then
`node build.mjs`. Bump `site.updated` and add a row to the policy version
history table in `src/privacy.html` whenever the substance changes — the history
table is the audit trail for "when did you tell users".
