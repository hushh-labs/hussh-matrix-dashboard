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
day; October 8 is the first full day. The 100 MB scan cap can make a larger raw
range unavailable rather than spend beyond the bound.

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

Play production and internal tracks both served build 10 / version 1.3.9. The
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

## Private configuration

Cloud Run: `hushh-ai-prod`, `us-central1`, `hushh-matrix-dashboard`; runtime:
`metrics-dashboard-runtime@hushh-ai-prod.iam.gserviceaccount.com`.

Bind server-only configuration with Secret Manager references:

| Environment variable | Secret |
| --- | --- |
| `ONE_GA4_IMPERSONATE_SERVICE_ACCOUNT` | `metrics-dashboard-one-ga4-reader` |
| `GOOGLE_PLAY_IMPERSONATE_SERVICE_ACCOUNT` | `metrics-dashboard-play-reporting-reader` |
| `GOOGLE_PLAY_REPORTS_BUCKET` | Create `metrics-dashboard-play-reports-bucket` after the real bucket is supplied |

Reader secrets identify the existing runtime service account. The bucket value
must be the `gs://pubsite_prod…` URI shown in Play Console **Download reports**;
enter it privately in Secret Manager's new-version form. Do not invent a URI,
paste credentials in chat, add frontend variables or create service-account keys.
The Play Console administrator must grant this runtime account read-only
**View app information** for `com.hussh.app`, including the access required for
bulk reports. The current team request is outstanding. The uploader's access
does not establish the runtime reader's access.

## Bounds, retention and cost

Provider requests: 10-second timeout, at most one retry for 429/selected 5xx,
Retry-After capped at 3 seconds, no redirects, 10 MiB maximum response.
At most two GA4 reports, four calendar months/eight CSV objects, and five vitals
requests per range. GA4 event history allows six named events/2,000 rows; vitals
allows 1,000 rows and fails safely on unexpected pagination. Version filters
allow 20 currently serving codes. CSVs allow 100,000 rows/16 KiB fields; malformed
quotes and duplicate country/day rows reject the report rather than inflate it.

Provider cache: one hour, 32 entries, coalesced requests, 12 new ranges per ten
minutes per replica. Added raw capture aggregate: five-minute/32-entry cache,
12 new queries per ten minutes per replica, 100 MB scan cap, 30-second job limit.
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
