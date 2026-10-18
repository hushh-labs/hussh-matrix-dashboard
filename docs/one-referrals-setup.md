# One app referral analytics

`/referral-analytics` reads `/api/analytics/one/referrals` with `environment`, `startDate` and `endDate`. The API uses the existing authenticated, no-store aggregate cache. Production and UAT never share a cache key. Dates are inclusive UTC calendar dates, limited to 366 days.

The source is the One app PostgreSQL referral database, not GA4 referral page views. Registered referrals follow the app's `JOINED_REFERRAL_PREDICATE`: matching bound attribution, existing profile, no self-referral, and no rejected/revoked/ineligible relationship. Counts use distinct canonical account IDs. Qualification reflects the current state of the selected signup cohort; ledger and reward totals use their posting/earning dates. Points include signed reversals. Claims and weekly awards are not proof of delivery or payment.

## Runtime connection

An administrator must complete this setup before live counts are available:

1. Install [the aggregate function](../src/server/referral-summary.sql) in production (`hushh-pda:us-central1:hushh-vault-db`, database `hushh_vault`) and UAT (`hushh-pda-uat:us-central1:hushh-uat-pg`, database `postgres`) using the database owner. It is additive and does not change referral records or scoring.
2. Create a dedicated login with `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`, `default_transaction_read_only=on`, and `statement_timeout=15000`. Grant only database `CONNECT`, schema `metrics_dashboard` `USAGE`, and `EXECUTE` on `metrics_dashboard.referral_summary(date,date)`. Do not grant access to underlying tables. The function has a fixed search path and no public execution permission.
3. Create Secret Manager secrets `metrics-one-referrals-production` and `metrics-one-referrals-uat` in `hushh-ai-prod`. Each payload is a JSON object with `instance`, `database`, `user`, and `password`. Pass payloads through secure stdin; never commit values or log them.
4. Grant `metrics-dashboard-runtime@hushh-ai-prod.iam.gserviceaccount.com` Secret Accessor on only these two secrets and Cloud SQL Client in the two source projects. The Node Cloud SQL connector uses the runtime identity and encrypted connections; no public IP allowlist or downloaded service-account key is needed.
5. Verify both environments with an authenticated session. Verify the login can execute the aggregate function but cannot select account or referral rows. Without access, the endpoint returns a sanitized 503 and the UI shows unavailable values.

During development, the current operator's IAM policy denied `secretmanager.secrets.create`. The production function and restricted database role `metrics_referrals_reader` were installed; no runtime secret or cloud connection grant was created. Reset that role's password when completing the secret. UAT installation remains pending. Do not mark the live integration enabled until an administrator completes and verifies these steps.

Local checks: `npm run lint`, `npm test`, `npm run build`, and `npx playwright test tests/ui/referrals.pw.ts`. The UI tests use explicitly synthetic aggregates; live source checks must be recorded separately.
