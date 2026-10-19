# One app referral rankings

`/referral-analytics` shows only Individual and Circles standings. Individual rows contain the published rank, public member handle and score, labelled Points. Pages contain at most 20 entries. Previous/Next pin the same source snapshot so a newly published ranking cannot move members between pages. Refresh starts at the latest snapshot.

The source is the One app's published PostgreSQL leaderboard, not GA4 page views or a sum of referral events. The score comes directly from `one_referral_leaderboard_snapshot_entries.cumulative_points`, matching the app's `points` API field. The app currently calls this score Coins; the dashboard uses the requested Points label without recalculating it. Do not substitute `SUM(points)` from the score ledger: that is a different measure.

Member names come exclusively from opted-in `one_referral_display_handles`. Missing handles display `Anonymous referrer`. Never join actor profiles, identity caches, emails, phones or Firebase account IDs to fill names. This endpoint requires a dashboard session even when other aggregate reports allow public access.

The app's Circles leaderboard currently returns `status=preview`, `competition_active=false` and no teams. The dashboard preserves “No circle standings yet.” rather than creating standings from private circle records. Pagination remains disabled until that product contract publishes standings.

## Source selection and freshness

`GET /api/analytics/one/referrals` accepts `board=individual|circles`, optional `environment=production|uat`, `afterRank` (default 0) and optional UUID `snapshotId`. A nonzero cursor requires an explicit environment and snapshot ID. Page size is fixed at 20; there is no date filter because the ranking is cumulative.

Without an explicit environment, choose Production if it has published entries, otherwise UAT if it has entries. Show environment buttons only when both have entries. A failed source remains unavailable; it is never treated as empty. No published snapshot is `waiting`; a removed pinned snapshot is `expired` and offers a restart. A published snapshot with no stored entries is genuinely empty. The timestamp displayed is the snapshot generation time, not query time.

A read-only check on 20 October 2026 found published entries in both environments: Production 329 stored entries (snapshot 18 October 21:41:50 UTC), UAT 105 (19 October 21:16:41 UTC). Production's snapshot header says 330; one stored entry is absent. Display existing published ranks and count actual stored entries for source selection; do not invent a missing member or renumber the leaderboard. The ranking SELECT was verified read-only across all 17 Production pages and 6 UAT pages, with no duplicate ranks between pages. The first UAT page's scores match the supplied screenshot, but its public handles are absent and consequently display `Anonymous referrer`. Populating those opted-in handles is an app-source dependency. These observations do not enable the live dashboard connection.

## Runtime connection — pending administrator setup

1. Install [the ranking projection](../src/server/referral-rankings.sql) as the database owner in Production (`hushh-pda:us-central1:hushh-vault-db`, database `hushh_vault`) and UAT (`hushh-pda-uat:us-central1:hushh-uat-pg`, database `postgres`). It reads existing snapshots and public handles; it never publishes snapshots or changes referral records.
2. Use a dedicated login with `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`, `default_transaction_read_only=on`, and `statement_timeout=15000`. Grant only database CONNECT, schema `metrics_dashboard` USAGE and EXECUTE on `metrics_dashboard.referral_rankings(integer,uuid)`. Do not grant underlying table access. The SECURITY DEFINER function has a fixed search path and no PUBLIC execution permission.
3. Create Secret Manager secrets `metrics-one-referrals-production` and `metrics-one-referrals-uat` in `hushh-ai-prod`. Each payload is a JSON object with `instance`, `database`, `user`, and `password`. Pass values securely; never commit or log them.
4. Grant `metrics-dashboard-runtime@hushh-ai-prod.iam.gserviceaccount.com` Secret Accessor on only those secrets and Cloud SQL Client in both source projects.
5. Verify an authenticated dashboard session can page through the standings, while unsigned requests get 401. Verify the database login can execute this function but cannot select underlying account/referral rows. Source failures return a sanitized 503 rather than zeros.

The previous aggregate function and restricted role `metrics_referrals_reader` were installed only in Production. That older function does not enable this rankings projection. Neither ranking function is installed by this change, and runtime secrets/grants remain pending. Reset the reader password when completing setup, remove the obsolete `referral_summary(date,date)` EXECUTE grant, and grant the ranking function instead. Do not mark live integration enabled before verification.

Local checks: `npm run lint`, `npm test`, `npm run build`, `npx playwright test tests/ui/referrals.pw.ts`. UI tests use synthetic public handles; source checks are read-only and recorded separately. Production deployment remains subject to the existing Cloud Build/Cloud Run IAM permissions.
