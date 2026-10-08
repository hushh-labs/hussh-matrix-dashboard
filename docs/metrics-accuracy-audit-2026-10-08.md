# Metrics accuracy audit — 8 October 2026

## Scope and changes

The audit compares matching reporting intervals and source definitions. A passed
contract does not establish complete event capture, identity coverage or a source
that is currently unavailable.

- `src/server/one-retention.mjs` and `server.ts`: acquisition denominator comes
  from exported web `first_visit` / native `first_open` IDs, including those that
  never return. Activity with an old lifetime first-touch cannot add a survivor
  to an otherwise unobserved acquisition cohort. Return is meaningful activity
  on reporting days 1–7, deduplicated per platform/app or browser ID.
- A Sunday cohort needs all 14 daily tables covering its acquisition week and
  the seven days following its last possible arrival. Intraday exports, missing
  dates and the partial Android export cutover cannot establish completeness.
  Pending returns/rates are null, not zero. Historical unexported arrivals cannot
  be reconstructed. These IDs are not deduplicated people or Play downloads.
- `OneAppPanel.tsx`: size-weighted return rate across complete cohorts; no
  position-based omission of the last cohort or missing-as-zero chart points.
  The preceding 84-day reporting window, timezone (Etc/GMT+8, UTC−8), up to eight
  observed weeks, partial states and counts are visible.
- Retention query replaces the existing query, uses a 32-entry/five-minute cache and a 12-cold-query/ten-minute budget per replica,
  and now has a 1 GB scan cap/30-second job timeout. Unlimited CLI fallback is
  disabled for this bounded query. A cap failure produces unavailable history.
- `src/server/hushhtech-window.mjs`: request explicit dates and reject a provider
  response that does not confirm that interval. A rolling response cannot be
  relabelled as a historical month.
- `analytics-service.ts` / `Dashboard.tsx`: unavailable HushhTech funnel counts
  remain unavailable in both reports; period reports are labelled with the
  selected range. Period persisted users / MAU cannot become total registered
  accounts. Missing infrastructure/search/collected counts do not become zero.
- `src/server/ga4-windows.mjs` / `server.ts`: the seven-day Data API report now
  requests `6daysAgo` through `today`, exactly seven inclusive calendar dates.
  The processed two-calendar-day report is labelled "Yesterday + today",
  separate from a true rolling 24-hour export. Provider timezone is shown in
  report warnings when returned. Google documents inclusive endpoints and
  property-timezone relative dates in its [DateRange reference](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/DateRange).
- HushhTech selected-range totals cannot populate independent 1-day/7-day source
  cards unless both actual boundaries and reported length match that period.
  Seven-day active users cannot stand in for selected-month active users.

## Evidence obtained before this release

- Baseline production: Hushh.ai, One, KPI invariants, aggregate privacy contract,
  independent One source reconciliation and Firebase registered-account
  reconciliation passed. Further iOS account/usage/platform probes passed.
- One stable range 7 September–6 October: dashboard and BigQuery both reported
  786 browser/app IDs, 1,610 sessions and 431,904 events. Active windows anchored
  to finalized 6 October both reported DAU/WAU/MAU 34/301/782; identified account
  windows were 19/140/192. These are distinct populations.
- Registered Firebase accounts, 9 September–8 October: 2,597 total / 435 new;
  production and UAT match the shared account store. Account rows are not logged.
- Instagram: all 12 stored account observations across 7/30/90-day windows
  matched API values and exact requested timestamps. No duplicate observation
  keys were found. Stored reach was 492 / 5,573 / 5,862 for UTC windows ending
  8 October exclusive, beginning 1 October / 8 September / 10 July respectively.
  A fresh Meta identity read resolved the configured company account; a fresh
  seven-day reach request for that exact interval also returned 492. These are
  dated observations, not seeded values or expectations for future runs.
- Instagram last successful stored sync: 8 October 00:38 UTC. Secret metadata
  now says long-lived, issued 29 September, expiry 27 November. This audit did
  not exchange/refresh a token or observe unattended renewal; dates must not be
  extended by editing metadata.
- Natural Scheduler execution `hushh-ai-search-console-ingest-jpg4s` started at
  00:30 UTC and logged Instagram `success` / reach `available` at 00:38 UTC.
  The 06:30 execution `hushh-ai-search-console-ingest-nbdpq` logged
  `already_synced_today`. This proves scheduled ingestion and the daily guard,
  independently of a manual invocation; it does not prove token renewal.
- App Store Connect contract passed its **not connected** branch, with null
  production metrics. No Apple measurement reconciliation is claimed.
- Local release checks: 149 tests / 18 files, TypeScript, Vite build, existing
  10 platform render checks, whitespace and redacted secret scan passed.
  `node scripts/check-one-retention-fixture.mjs` also passed on BigQuery using
  only literal CTE fixtures; no production table/event was created.
- The first zero-traffic candidate (00250-dek) was withheld: its 100 MB
  retention cap was too small for the existing export query. Source dry runs
  measured approximately 376 MB production / 717 MB UAT. The corrected reader
  aggregates reporting dates per ID, uses a 1 GB ceiling, retains the 84-day
  window and enforces five-minute/32-entry caching plus 12 cold queries per ten
  minutes per replica. It never falls back to an unlimited query. These scans
  use existing infrastructure and may be billable; no free-usage guarantee.
- Corrected candidate 00251-xiq passed all nine existing manual dashboard release
  checks. Independent production and UAT retention queries matched each of its
  eight cohort sizes and complete return counts/rates; both newest cohorts
  stayed pending with null rates. Production mature totals were 39 / 601,
  approximately 6.49%, rather than an unweighted average of cohort percentages.
  The final date-label fixes require their own subsequent candidate verification.

## Remaining source and release limitations

- Hushh.ai GA4 is currently unavailable in the runtime. Its structural release
  check passes the waiting branch; that is not numeric source reconciliation.
  The independent configured-reader authentication probe returned HTTP 403, so no Hushh.ai
  GA4 count comparison or live seven-day correction is claimed. Missing values
  remain null / waiting. Reader impersonation/property access needs an
  administrator's diagnosis; the failed authentication probe does not prove
  that property-level Viewer access is missing.
- HushhTech's own `/api/metrics/summary?window_days=7` currently returns 503.
  Its serving Cloud Run revision `hushh-tech-website-00225-gif` lacks
  `GCP_SERVER_ACTOR_UID`; the valid server identity is not established by this
  repository. Both HushhTech source health/flow probes fail, and remain failing
  checks. The dashboard retains independently readable Monitoring, Search
  Console and database aggregates while showing the unavailable funnel.
  Source repair belongs to the HushhTech service owner; do not create a dummy
  actor, disable server authorization or assume legacy Supabase equals the
  migrated product's entire current account population.
- Play runtime read-only access is Active, but exact company CSV GET/metadata
  listing still returns access denied. No company monthly report is present in
  Console. No store-download zeros are inferred; the private support draft has
  not been sent. Readable version metadata is not proof of CSV reporting access.
- Current Android raw export begins 7 October (partial; first full reporting
  day is 8 October). Earlier Data API aggregate history is a separate source.
  Backend/installer distinctions and cross-device identity gaps remain visible.
- Research PR #7599 was merged by the user as
  `a03ad89850a813486b408fa9e6c9c387633ae388`; exact main smoke run
  [37766605248](https://github.com/hushh-labs/hushh-research/actions/runs/37766605248)
  passed. Hosted final PR validation passed all 22 jobs. This does not publish
  the new instrumentation in a Play binary. Native release and the user's
  deferred physical-device journey remain separate verification requirements.
- Existing reconciliation reports incomplete cross-device identity, no
  deliberate non-PKM agent invocation emitter and no page_view on hushh.ai
  hosts in the One property. Missing emitters do not establish zero usage.

## Repeat, release and rollback

```bash
npm run lint
npm test
npm run test:ui:one-platforms
npm run build
node scripts/check-one-retention-fixture.mjs # existing ADC, BigQuery job permission
git diff --check
```

Use existing authenticated release probes, supplying credentials privately via
the existing Secret Manager pattern. Keep anonymous probes free of the release
fetch adapter: it automatically authenticates target requests. No new CI gate
was added; existing retention arithmetic assertions were updated for null
pending rates. The fixture is an operator check, not a new mandatory CI gate.

Build the exact main SHA with the existing Dockerfile, manually deploy a tagged
zero-traffic candidate, preserve runtime identity/secret bindings/limits, run
existing release gates and matching-window reconciliation, then promote traffic.
Capture current traffic before deploying; never copy an old rollback revision
from this document blindly. Restore that captured traffic if verification fails.
No migration, production data mutation, secret rotation, source permission
expansion, app publishing or hosting-plan change is needed for these fixes.

Existing Cloud Build/Run, BigQuery, exports and Secret Manager usage may incur
charges. No paid connector, new cloud service or plan was introduced; guaranteed
zero additional usage cost has not been verified.
