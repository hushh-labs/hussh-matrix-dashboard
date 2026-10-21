# Android and Google Play analytics

## Architecture and source boundaries

The existing Express server, authenticated React One dashboard, GA4 BigQuery
datasets, Cloud Run service and Secret Manager are reused. No database or paid
connector is added. `src/server/one-scope.mjs` scopes Android to `com.hussh.app`
and production stream `15395548050` (UAT `15395713075`). iOS remains
`com.hushh.app`. Legacy Android is excluded from current-product reports.

`server.ts` adds bounded aggregate capture diagnostics to One and Android to the
founder briefing. Founder Android customers require an explicit production
backend tag; automatic or UAT-tagged events do not establish that classification.
Raw production capture diagnostics only scan dates on or after the export repair,
7 October 2026. Earlier-only windows return an explicit waiting state without a
new diagnostic query; requested report dates remain unchanged. Historical GA4
aggregate reads still cover the selected range. October 7 is a partial capture
day; a full daily export must be observed before claiming complete coverage. Capture shares the existing platform aggregate scan. Dry-run estimates enforce a
maximum 100 MB incremental allowance over that baseline; the paid query retains
that billed-byte limit, a 30-second job deadline and a 40-second client deadline.
A failed optional estimate or an excessive increment preserves the baseline
platform report and marks capture unavailable. Failed paid reads never launch a
second scan. This does not backfill missing native events.

Incomplete Android comparison history suppresses aggregate growth comparisons
when Android contributes. Final daily exports take precedence over overlapping
intraday exports. No person-level records leave these endpoints.

`src/server/android-reporting.ts` reads historical aggregate GA4 reports, Play
monthly CSV reports and Android vitals. `/api/analytics/one/android` requires the
existing dashboard session and an exact inclusive range of 1–90 days. Only the
company package/production property is supported. `AndroidAnalyticsPanel.tsx`
separates these sources within the existing One page; UAT never displays cached
production provider reports.

## Definitions and dates

- Signed-in accounts: distinct existing `user_id` with meaningful activity.
  Missing bindings are not reported as zero people. Platform audiences overlap.
- App-instance IDs: device/application identifiers, not unique people.
- Firebase `first_open`: first launch following installation/reinstallation;
  not a download, store click or unique new account.
- Native first-open funnels use the same One app/package/stream scope as other
  One reports. The return window starts at the observed `first_open` reporting
  date, not the SDK's lifetime first-touch timestamp. Week-1 percentages are
  withheld until a finalized daily export covers seven days after every observed
  first open in the cohort. Intraday data cannot close that window. Progress
  counts remain visible; pending later steps are not reported as final drop-off.
- GA4 historical active/total users: provider range totals, requested once.
  Daily users are never summed. Daily event counts are repeatable actions, not
  signups or reconstructed account/retention cohorts.
- Play installs/uninstalls/upgrades: sums of documented daily user/device flows,
  not current installed-base snapshots. Listing acquisitions and daily visitor
  measurements remain legacy export metrics; repeated visitors are not unique
  people across the range. Conversion rates are not averaged.
- Vitals: daily user-perceived crash/ANR provider rates for version codes
  currently serving production, with `OS_PUBLIC` cohort. The same version can
  also serve testers. Rates and rounded normalization users are not added.
- GA4 daily dates use `event_date`; both verified properties use `Etc/GMT+8`
  (fixed UTC−08:00). Event timestamps are displayed in UTC. Play vitals use
  `America/Los_Angeles` and exclusive end boundaries capped by provider freshness.
  Play CSV dates are provider dates, not converted or presented as GA4 dates.
- Known zero, absent values, permission denial, privacy thresholds, query failure
  and missing configuration are separate. Provider freshness is distinguished
  from the last date actually observed. Play CSVs can lag 3–7 days.

## Verified infrastructure facts, 7–8 October 2026

Production GA4 property `526603671` had the correct new Android stream, but its
existing BigQuery link excluded it. On 7 October the stream was appended while
preserving the legacy streams, daily/streaming flags and excluded Voice stream.
GA Admin validation subsequently passed. This is export configuration proof,
not an observed new-package exported event or historical raw backfill.

On October 7, Play production and internal tracks both served build 10 / version 1.3.9. The
September 28 release source `e633b369d383d366d68217cf97c21750b9b0272b` was built
against UAT. Historical aggregate GA4 reads succeed. Vitals metadata and a
read-only build-10 query succeed using the existing upload identity but return
no rows for September 28–October 4. Empty rows do not mean zero crashes.

The dashboard runtime has GA4 viewer access and a self-only token-creator binding
to mint short-lived read-scoped credentials. No publisher private key is copied
into the dashboard. Enablement of the existing Play reporting API is separate
from Play Console authorization. Runtime vitals access and report-bucket access
must be tested independently. No attached Android device was available during
the implementation; installed-device sign-in/activation/retention proof remains
required. Native metadata/reviewer-guard changes require a new app release.

### Observed production verification

Dashboard PR [#94](https://github.com/hushh-labs/hussh-matrix-dashboard/pull/94)
landed as `e24dd0b90aa6bffeb83455882b768877b11058b2`. Manual Cloud Build
`bdacf8f5-f6a6-4a87-9518-f68d90ac135d` succeeded; Cloud Run revision
`hushh-matrix-dashboard-00235-jin` was tested at zero traffic and then promoted.
The preceding ready revision was `hushh-matrix-dashboard-00234-wut`.

The follow-up PR [#97](https://github.com/hushh-labs/hussh-matrix-dashboard/pull/97)
landed as `20511f06f4a6395142d353fe93a5ba733ab535fd`, preserving the intervening
dashboard changes. Manual Cloud Build `07216028-fbd5-4d83-9f36-0ac5544eafb8`
succeeded. Revision `hushh-matrix-dashboard-00240-hud` passed zero-traffic
verification and served 100% of production traffic at that release. Its rollback
target was `hushh-matrix-dashboard-00238-vin`; use a fresh traffic snapshot before
any later rollback rather than assuming an older revision is still appropriate.

This follow-up bounds raw diagnostics to the export repair date and preserves
missing release-event counts as unavailable rather than zero. Its unit suite
passed 121 tests in 14 files, plus type checking, build and One render checks.
The candidate passed 148 founder contract checks and the seven-section One
production checks. Interactive Google sign-in, existing web/iOS and stored
Instagram reads, and the same-window independent GA4 comparison were verified.
The production 30- and 90-day presets loaded real aggregate history, with no
horizontal page overflow at desktop or 390-pixel mobile width. These observations
do not establish that Play reporting permissions or a new device export work.

- September 28–October 4: runtime history returned **21 active app users,
  21 tracked app users and 4,279 events**, exactly matching an independent
  read-only GA4 request for stream `15395548050` and the same window.
- The repeated endpoint read returned the identical cached report. This is
  aggregate report reconciliation, not event ingestion or account deduplication
  proof for the missing historical raw rows.
- Anonymous access, invalid dates, ranges over 90 days and UAT provider scope
  rejection passed. Existing One production checks (seven sections), founder
  contract (148 checks), and stored Instagram reads passed on the candidate.
- The production endpoint repeated the same-window match. The signed-in live
  One page displayed historical Android reporting on desktop and at 390×844,
  without page-wide horizontal overflow. The 7-day preset loaded October 1–7:
  28 active app users, 28 tracked app users and 4,994 events.
- Runtime Play vitals returned `permission_missing`; install/listing reports
  returned `not_configured`. Their counts were not fabricated.
- The new stream's export membership is verified, but fresh package-specific
  exported events and a physical-device sign-in/Location journey remain pending.
  The user chose to perform that device test later.

These are dated observations, not fixture values or expected future totals.
The native source changes have not been shipped in a new Play binary. Native
release and real-device proof must be recorded separately from dashboard release.

### October 8 revalidation and fresh Android capture

Serving revision `hushh-matrix-dashboard-00245-gac` was observed before and after
read-only API revalidation. The September 28–October 4 history again matched an
independent same-window GA4 read (21 active users / 4,279 events). Auth/date
validation, cached repeat, existing One web/iOS/UAT sections, shared registered
accounts, and stored Instagram reporting passed. Interactive signed-in One
reporting was also opened with the company operator account.

The October 7 raw capture response now contains 26 events, 6 app-instance IDs,
1 identified account, 5 first opens and 1 route visit. The release table includes
12 version-1.3.9 events with Play installer `com.android.vending` and an unlabeled
backend environment, 8 with another installer and a production tag, and 6 with
another installer and no backend tag. These are aggregate observations after
the export repair, not invented historical rows, six unique people, or proof
that every store-installed event is production-backend customer activity. The
user's controlled sign-in/One Location journey is still deferred. Native metadata
and reviewer-guard changes remain in research PR #7599 awaiting release gates.

### October 8 production release and current limits

Dashboard PRs [#104](https://github.com/hushh-labs/hussh-matrix-dashboard/pull/104)
and [#105](https://github.com/hushh-labs/hussh-matrix-dashboard/pull/105) landed
with DCO signoffs. Exact main source
`dc9ecc94097ce5a6aef63cf5790fcbca08c6cb33` was built by manual Cloud Build
`550e7cc3-3763-4f21-a375-9c75d98f3154`. Candidate
`hushh-matrix-dashboard-00248-doj` passed the release gates at zero traffic and
was promoted to 100% on October 8. Its captured rollback target is
`hushh-matrix-dashboard-00245-gac=100`. Take another traffic snapshot before a
later rollout; an older ready revision is not automatically a rollback target.
Existing session affinity, runtime identity, secrets, 1 CPU / 1 GiB,
minimum zero and maximum three replicas were preserved.

- Local dashboard verification: lint/type checking, 138 tests in 17 files,
  10 One render checks, production build, whitespace and redacted secret scan
  passed. Existing build chunk-size advice remains advisory.
- Candidate verification passed the existing authentication, metrics-flow
  (including GCP jobs/schedulers/datasets), Hushh AI, One, location, KPI,
  public aggregate contract, registered-account and iOS/platform reconciliation
  probes. Founder contracts passed default, August and 90-day windows; the
  separate source-only reconciliation passed. The latter still reports existing
  identity-coverage and missing-event gaps; those were not suppressed.
- Public-site verification passed a genuinely anonymous authentication probe,
  a fresh interactive Google sign-out/sign-in with the approved company account,
  date/scope rejection, health, One web/iOS/UAT sections and stored Instagram.
  A temporary authenticated QA cookie was used separately for CLI data probes;
  it was never used as evidence of the Google callback.
- The public September 28–October 4 Android history again matched the
  independent same-window GA4 values (21 active users / 21 tracked users /
  4,279 events). A repeated cached read was identical. These are dated
  observations, not expected future values.
- For October 7, fresh raw capture increased to 31 events, 7 app-instance IDs,
  5 first opens and 2 route visits. Observed version 1.3.9 rows were 16 Play /
  unlabeled backend, 8 other installer / production, 6 other / unlabeled and
  1 Play / UAT. The last exported timestamp was
  `2026-10-08T07:27:56.848918000Z`. This confirms exported current-package
  activity, not a controlled physical-device journey or production-backend
  classification for every Play-installed event.
- The public October 7 native funnels correctly withheld week-one rates for
  both Android and iOS (`retentionWindowComplete=false`, final share `null`).
  Desktop and 390-pixel mobile views displayed the selected dates, version
  diagnostics and pending states without page-wide horizontal overflow.
- The report bucket is now secret-backed in the serving revision. Saved Console
  scope was independently checked after submission. The runtime's Play API
  successfully resolved current production version code **11**; this task did
  not publish that build. Crash/ANR queries for September 28–October 4 returned
  no rows (`not_yet_available`).
- Runtime CSV object GET and exact-object metadata LIST still returned
  `permission_missing`. No monthly reports appeared for the company app in
  Console. The approved grant, configured bucket and readable vitals metadata
  do not prove bulk-report access or a measured installation count. If denial
  persists, ask Play support to check nonfinancial bulk-report provisioning for
  the existing reader; do not add financial, Admin or publishing permissions.

Native source remains separately tracked in
[research PR #7599](https://github.com/hushh-labs/hushh-research/pull/7599).
Independent maintainer review and the governed native release are still required;
no new Android binary was published by this task. The user's physical-device
sign-in/One Location test remains deferred. No new scheduler is needed for the
bounded cached provider reads; existing export configuration, scheduled
execution and a controlled app journey are distinct kinds of evidence.

## Private configuration

Cloud Run: `hushh-ai-prod`, `us-central1`, `hushh-matrix-dashboard`; runtime:
`metrics-dashboard-runtime@hushh-ai-prod.iam.gserviceaccount.com`.

Bind server-only configuration with Secret Manager references:

| Environment variable | Secret |
| --- | --- |
| `ONE_GA4_IMPERSONATE_SERVICE_ACCOUNT` | `metrics-dashboard-one-ga4-reader` |
| `GOOGLE_PLAY_IMPERSONATE_SERVICE_ACCOUNT` | `metrics-dashboard-play-reporting-reader` |
| `GOOGLE_PLAY_REPORTS_BUCKET` | `metrics-dashboard-play-reports-bucket` |

Reader secrets identify the existing runtime service account. The bucket value
must be the `gs://pubsite_prod…` URI shown in Play Console **Download reports**;
enter it privately in Secret Manager's new-version form. Do not invent a URI,
paste credentials in chat, add frontend variables or create service-account keys.
The Play Console administrator must add this existing runtime account through
**Users and permissions → Invite new user**. Google requires **Account
permissions → View app information (read-only)** at **Global** scope to read
bulk reports. This provider requirement gives the reader access to nonfinancial
app information across the developer account; obtain explicit approval for that
scope before submitting the grant. The dashboard still requests reports only
for `com.hussh.app`. In the inspected Console, the global app-information
permission automatically checks and locks **View app quality information
(read-only)** at global scope as an inherited permission; this cannot be narrowed
to one app while retaining bulk-report access. Include that inherited scope in
the approval. Do not grant Admin, financial data, publishing, release management, or user
management permissions. Do not generate a service-account private key.

On October 8, 2026 the operator explicitly approved the global read-only grant,
including inherited app-quality access. Console submission was completed and
the runtime account was verified **Active / Never expires**. No Admin,
financial, publishing, release-management or user-management access was granted.
The real developer-account bucket root was copied using Console's report URI
control, stored in `metrics-dashboard-play-reports-bucket`, and granted only
runtime Secret Manager accessor access. Other apps' report data was not downloaded.
Before runtime verification, the
`com.hussh.app` Statistics page displayed **No monthly reports available** for
installs, crashes, and store performance. These observations do not mean zero
installs or crashes. Runtime reporting verification and production bucket binding
are recorded below; an active Console grant alone does not prove
the reporting API is available.
Google documents a 3–7 day posting delay for these daily-captured monthly CSVs.
Do not assume reports will appear immediately after the grant or infer their
availability from the app's release date.

## Bounds, retention and cost

Provider requests: 10-second timeout, at most one retry for 429/selected 5xx,
Retry-After capped at 3 seconds, no redirects, 10 MiB maximum response.
At most two GA4 reports, four calendar months/eight CSV objects, two exact-object
metadata listings after an object 403, and five vitals
requests per range. GA4 event history allows six named events/2,000 rows; vitals
allows 1,000 rows and fails safely on unexpected pagination. Version filters
allow 20 currently serving codes. CSVs allow 100,000 rows/16 KiB fields; malformed
quotes and duplicate country/day rows reject the report rather than inflate it.
The metadata fallback asks for at most one name using the exact requested
company-package object prefix; it never lists other apps. Empty successful
listing means no report yet; denied listing retains an access error. This avoids
misreporting GCS's ambiguous absent-object 403 as a missing Console grant.

Provider cache: one hour, 32 entries, coalesced requests, 12 new ranges per ten
minutes per replica. Added raw capture aggregate: five-minute/32-entry cache,
12 new capture attempts per ten minutes per replica, a 100 MB incremental scan
allowance, and a 30-second job limit. Platform rows retain their 30-second cache;
a capture-cache hit reads only the baseline platform columns. No CLI fallback
can bypass the bound.
Existing Cloud Run maximum is three replicas, so limits are per replica, not
global quotas. No in-process scheduler is introduced: the existing GA4 daily
and streaming exports supply data; provider reports are bounded cached reads.

CSV bodies and provider errors are not persisted, logged, exported or returned.
Only aggregate responses remain in finite memory until expiry/restart. Existing
GA4/BigQuery retention and consent/deletion policies remain authoritative.
Deleting or disabling access does not remove existing upstream records.

There is no new paid connector or hosting plan. Additional export volume,
streaming, BigQuery scans, Secret Manager versions/access, Cloud Build and Cloud
Run requests can consume existing billable resources. A guaranteed $0 cloud
usage increase has not been established; check the existing budgets/free quotas.

## Test, release and rollback

```bash
npm ci
npm run lint
npm test
npm run test:ui:one-platforms
npm run test:metrics:android-capture-sql # inline fixture only, UAT job project
npm run build
git diff --check
```

Research-side proof: `npm run verify:analytics`, `npm run typecheck`,
`npm run verify:capacitor:static`, `npm run verify:capacitor:plugins`, GA Admin
validation and canonical `scripts/ci/orchestrate.sh core`. Native/device and
release gates are independent; focused tests do not prove a Play rollout.

Use a DCO-signed PR into the permitted base. Build the exact reviewed/landed SHA
with the existing Dockerfile/Artifact Registry. Deploy a tagged **zero-traffic**
candidate, preserving service identity, limits, IAM and existing secret bindings;
add only the reader references with `--update-secrets`. Test runtime history and
Play availability, anonymous 401, authenticated date validation, One/founder,
Instagram, web/iOS and interactive sign-in before traffic promotion. Use an
in-memory short-lived release session for CLI probes; never print its cookie.

Compare live report values for the same source/window, not a historical fixture.
Confirm new package-specific exported rows and a real device journey before
claiming full capture. Check Play downloads only after the real bucket and
runtime access are supplied. No app publishing, test-user creation, synthetic
production event or historical data insertion is part of these read probes.

To disable provider reads, remove the two reader bindings and deploy the reviewed
revision; existing One/Instagram analytics continue. To roll back the dashboard,
restore the previously recorded ready revision's traffic using the existing
manual production procedure. Do not remove the corrected shared GA4 export link
or revoke unrelated Firebase/Meta permissions during a dashboard rollback.

Official contracts: [Play exports](https://support.google.com/googleplay/android-developer/answer/6135870?hl=en),
[vitals query](https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/vitals.crashrate/query),
[first-open definition](https://support.google.com/analytics/answer/9234069),
[Firebase debug export behavior](https://firebase.google.com/docs/analytics/debugview),
[GA export-stream update](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1alpha/properties.bigQueryLinks/patch).
