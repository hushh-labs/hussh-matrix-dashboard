# Instagram analytics for the company account

Status: **local implementation with live read-only Meta verification**. On 2026-09-29, the account owner added enabled version 1 of `metrics-instagram-credential`. Its JSON format was valid, v26.0 identity matched the configured company account, and a reach total was returned for the exact requested interval `2026-09-22T00:00:00Z` to `2026-09-29T00:00:00Z`. The observed value is intentionally not kept as dashboard data in this repository. The owner confirmed that the previously exposed Instagram app secret was reset; this was not independently verified. No production migration, BigQuery ingestion, Scheduler change, push, or deploy has been performed. The feature flag defaults to `false`.

## Scope and architecture

- `src/server/instagram/client.ts`: server-only Instagram Login reader. The sole enabled metric is the previously tested `reach` request on `graph.instagram.com/v26.0`. Identity must resolve to configured string ID `17841436775785807` before a write.
- `src/server/instagram/credentials.ts`: reads the latest JSON Secret Manager version if configured; otherwise uses a process-only local bootstrap token. A Secret Manager version takes precedence so an old environment token cannot replace a refreshed token.
- `src/server/instagram/sync.ts`, `store.ts`: once-per-UTC-day worker guard, BigQuery lease, run record, account metadata, and deterministic upsert. A failed refresh leaves a prior observation untouched.
- `sql/instagram_analytics.sql`: additive BigQuery dataset/tables for the current reach slice. It is **never run at startup**. IDs are strings. Metric partitions expire after 730 days and run partitions after 180 days; confirm these periods with the data owner before migration.
- `server.ts`: private stored-data endpoint `GET /api/analytics/instagram` and operator-only, same-origin `POST /api/instagram/sync`. Both require a signed-in session even if aggregate dashboard public mode is enabled. The Instagram response bypasses the shared analytics cache because `canSync` differs by user.
- `src/Dashboard.tsx`, `src/components/InstagramPanel.tsx`: existing navigation and surfaces, last successful sync, exact requested UTC bounds, stale/error states, and an owned-site UTM link builder. No trend chart is drawn because this slice does not contain a genuine time series.
- `scripts/ingest-instagram.ts`: local/Cloud Run Job entry point. `scripts/ingest-hushh-ai-with-instagram.mjs` is a prepared replacement command for the **existing** Hushh AI Search Console Job. It preserves that job's exit status and calls the Instagram worker once per UTC day through a DB guard. Scheduler and Job configuration have **not** been changed.

## Metric contract

`reach` is one `total_value` for the exact `since` and `until` Unix seconds sent to Meta, with `period=day` and `metric_type=total_value`. The worker requests the seven completed UTC dates preceding the current UTC date. The provider response observed during setup gave no reporting boundaries, so these remain null. Meta may use its own reporting timezone; do not infer provider day boundaries from the UTC request. Never add these rolling totals together or represent them as daily points. `4869` appears only in an explicitly historical test fixture.

Value `0` is a valid available value. Missing `total_value.value` is `not_yet_available`; an API failure is `sync_failed`, `permission_missing`, or `reconnect_required`. Existing valid observations stay visible as stale or failed. Optional account metrics, media retrieval/insights, and a post/Reel table are **not enabled** because their support and response shapes for this exact login route could not be verified from Meta's current documentation. `capabilities.ts` records that boundary. No comments, DMs, follower lists, viewer identities, scraping, publishing, or ad data are collected.

## Private credential setup

**Local:** set `INSTAGRAM_ANALYTICS_ENABLED=true`, `INSTAGRAM_USER_ID`, and `INSTAGRAM_GRAPH_API_VERSION=v26.0` in ignored `.env.local`. Enter the access token only in the current PowerShell process as `$env:INSTAGRAM_ACCESS_TOKEN` using a private terminal; do not paste it into chat, command history, a screenshot, or this repository. The local variable is a bootstrap read token and has no unattended refresh. `.env.local` is inside a OneDrive path on this workstation, so do **not** save the token there. `npm run ingest:instagram` uses that process environment.

**Hosted:** in Google Cloud Console → project `hushh-ai-prod` → Security → Secret Manager, create an existing-infrastructure secret named `metrics-instagram-credential`. Add a version whose **secret value** is JSON (shown here with placeholders only):

```json
{"accessToken":"<ENTER PRIVATELY>","tokenType":"unknown"}
```

Set `tokenType` to `long_lived` and add `issuedAt` and `expiresAt` as verified ISO UTC timestamps **only after** checking the generated token's actual type and expiration. Never derive either from the opaque string or the old seven-day test. If metadata remains unknown, reads can work but automatic refresh is disabled. The worker reads `projects/hushh-ai-prod/secrets/metrics-instagram-credential/versions/latest` through the Secret Manager API and writes a new version when a verified long-lived token is within 14 days of expiry and at least 24 hours old. It does not invent an OAuth refresh token. An expired token stops Meta reads and shows reconnect required. Reconnect privately by adding a new verified secret version, then run the worker. A refresh response is saved before the worker uses the new credential; an old bootstrap env value is ignored whenever `INSTAGRAM_CREDENTIAL_SECRET` is set.

Set `INSTAGRAM_CREDENTIAL_SECRET=projects/hushh-ai-prod/secrets/metrics-instagram-credential` for both the dashboard service and existing Hushh AI Search Console Job using the repository's Secret Manager-backed runtime configuration pattern. Set `INSTAGRAM_ANALYTICS_ENABLED`, `INSTAGRAM_USER_ID`, `INSTAGRAM_GRAPH_API_VERSION`, `INSTAGRAM_BQ_PROJECT`, `INSTAGRAM_BQ_DATASET`, and `INSTAGRAM_ANALYTICS_ADMIN_EMAILS` through their own secret-backed env references. Never set a raw token with `--set-env-vars`, expose it as `VITE_`, or enable HTTP URL tracing on the refresh call. Grant `roles/secretmanager.secretAccessor` on this one credential secret to the dashboard and Job runtime service accounts; grant `roles/secretmanager.secretVersionAdder` only to the Job runtime service account. Manual dashboard sync deliberately reads without refreshing. Grant dataset-scoped BigQuery read/write and job execution permissions to those accounts; do not broaden project-wide permissions. [Google's Secret Manager roles](https://docs.cloud.google.com/secret-manager/docs/access-control) document those grants.

The earlier setup screenshot exposed an Instagram app secret. **Confirm it was reset before rollout.** This worker does not use that secret and does not change Meta app settings or existing permissions.

## Database and local verification

The SQL file targets the existing `hushh-ai-prod` BigQuery project but has not been applied. For migration testing, use an **approved isolated test project/dataset** and replace both project and dataset identifiers in a temporary copy of the SQL outside the repo. Do not run the file as written until a production migration is explicitly approved. No isolated database was available to this local task, so actual BigQuery migration and DML execution remain unverified.

```powershell
npm run lint
npm test
npm run build
npm run ingest:instagram  # disabled config returns not_configured without Meta/BigQuery calls
git diff --check
```

After a test migration and private token setup, run `npm run ingest:instagram`, read `GET /api/analytics/instagram` with an authenticated dashboard session, compare the stored total to the **same live request interval**, run the worker a second time, and verify one metric row for that observation key. Check the existing analytics and auth probes. Never compare a new value to the old `4869` fixture. If the integration is disabled, the existing dashboard and analytics continue normally.

## Scheduling and resource limits

The project already has three enabled Cloud Scheduler jobs in `hushh-ai-prod/us-central1`, for the three Search Console ingestions. They are the only Scheduler jobs observed in that project on 2026-09-29. The planned zero-new-job route is to update the **existing** `hushh-ai-search-console-ingest` Cloud Run Job command and its Scheduler container override from `scripts/ingest-hushhtech-search-console.mjs` to `scripts/ingest-hushh-ai-with-instagram.mjs`, retaining `--days 16` and all existing env, secret bindings, service account, IAM, target URI, and six-hour schedule. The wrapper runs Search Console as before and checks the Instagram once-daily guard. It records Instagram failure separately without changing the Search Console exit status. Verify a manually invoked scheduled wrapper and then observe an actual scheduled execution before calling automation verified. This change requires deployment approval and has **not** happened.

The worker makes at most one identity call and one reach call per daily attempt, each with a 10-second timeout and at most three bounded attempts for transient failures. Scheduled attempts stop after one attempt per UTC day. Manual sync requires an allowlisted operator email, same-origin request, 15-minute cooldown, and the same distributed BigQuery lease. BigQuery jobs have a 100 MB per-query billed-bytes cap, and reads look back at most 30 days. These limits bound use but do not guarantee a zero bill: BigQuery query/storage free usage, Cloud Run Job runtime, network egress, and Secret Manager version counts are shared billing-account resources. Google currently documents [three free Scheduler jobs per billing account](https://cloud.google.com/scheduler/pricing), [BigQuery usage-based billing](https://cloud.google.com/bigquery/pricing), and [Cloud Run Job runtime billing](https://cloud.google.com/run/pricing). Check this billing account before approving the job change. No new vendor, hosting plan, Scheduler job, or paid connector is required by the code.

## Website outcomes

The link builder only emits approved `https://hushh.ai/` and `https://one.hushh.ai/` destinations with `utm_source=instagram`, `utm_medium=organic_social`, a validated campaign slug, and placement/variant slug. It does not redirect or store campaign metadata. Existing Hushh AI GA4 reporting exposes aggregate `sessionSourceMedium` and channel data, but this repository's Hushh AI product event source is still `not_configured`; it has no tested campaign-level visit → signup → activation → retention join or consent/identity contract. Hushh AI, One web, and native app ingestion belong to other surfaces. The UTM builder is implemented and unit-tested; end-to-end acquisition reporting is **incomplete**. A shared bio link only supports placement-level attribution, and a store-link click is not an install.

## Rollout, rollback, and outstanding verification

1. Confirm the exposed app secret was reset, verify token type/expiry privately, and review Meta's current access-level/App Review rules for this one internal company account. The prior real identity and reach requests establish test access only.
2. Review billing headroom and create an isolated test BigQuery dataset for migration/DML tests. Apply the additive SQL there; exercise success, mismatch, failure, and repeat sync.
3. Approve production migration, secret/IAM binding, existing Job/Scheduler update, and dashboard deployment separately. Keep the flag off until prerequisites pass. New CI checks, if introduced later, must stay advisory for seven days; this change adds no CI gate.
4. Verify identity → same-interval reach → persisted row → dashboard, repeat without duplication, protected job invocation, then observe a scheduled execution and Secret Manager refresh version after eligibility. Run `npm run test:prod:hushh-ai` and `npm run test:prod:one` after authorized deployment.
5. Disable with `INSTAGRAM_ANALYTICS_ENABLED=false` through the existing secret-backed config and redeploy affected revisions. Existing analytics remain active. Revert the existing Scheduler/Job command to `scripts/ingest-hushhtech-search-console.mjs` if the wrapper causes trouble. Retain or delete historical Instagram tables according to the approved retention decision; do not delete them as a routine rollback.

Meta documentation attempted on 2026-09-29: [Insights overview](https://developers.facebook.com/documentation/instagram-platform/insights), [user insights](https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights), [token refresh](https://developers.facebook.com/documentation/instagram-platform/reference/refresh_access_token), and [access levels](https://developers.facebook.com/docs/graph-api/overview/access-levels/). The first three were inaccessible from this environment and the fourth returned HTTP 429. Optional metric support, access level, and current refresh eligibility therefore need direct re-verification before rollout. The code keeps the observed-working `v26.0` request unchanged.
