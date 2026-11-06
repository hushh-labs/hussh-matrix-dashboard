# Metrics BigQuery containment — 7 November 2026

The dashboard remains stopped until the owner explicitly authorizes a restart.
This change is prepared for review. It does not restart Cloud Run, restore
BigQuery permissions, unpause schedules, or release the deployment hold.

## Incident containment

- `hushh-matrix-dashboard` in `hushh-ai-prod/us-central1`: manual scale set to zero.
- `metrics-dashboard-runtime` direct BigQuery Job User grant removed.
- The six inspected Cloud Scheduler jobs remain paused.
- GitHub workflow `deploy-main.yml` disabled manually. Repository variable
  `METRICS_DEPLOYMENT_HOLD=true` adds a second hold. Both deployment jobs in this
  change require that variable to be explicitly `false`; an unset variable blocks deployment.

Do not resume any of these controls as part of reviewing, testing, or merging
this change. Do not run production analytics/reconciliation probes during the hold.

## Query execution policy

All dashboard query execution goes through `src/server/bigquery-cost-control.ts`.
The native SDK is loaded only behind this boundary; the uncapped `bq` CLI fallback
has been removed. Instagram persistence and platform capture use the same boundary.

| Control | Enforced setting |
| --- | --- |
| Default execution | Disabled; only exact `METRICS_BIGQUERY_ENABLED=true` enables it |
| Billing project | `hushh-ai-prod` only |
| Maximum per SQL statement | 100 MiB; callers may lower but cannot increase it |
| Daily reserved scan bytes | 10 GiB per UTC reservation day, shared across instances |
| Daily reserved statements | 100, including scripts, cache hits and failed submissions |
| SQL scripts | At most 8 fixed statements; loops, procedures and dynamic SQL rejected |
| Native execution deadline | 30 seconds requested, including each script statement |
| Process concurrency | 2 executing or reserving requests, at most 32 waiting |

`maximumBytesBilled` is attached to every paid query job. Multi-statement jobs also
receive `scriptOptions.statementByteBudget`; the ledger reserves the full ceiling
for **each** fixed statement before any SDK submission. Transaction/control
statements conservatively consume slots too. Caller-provided job IDs, sessions,
destinations, billing project, location and cache options cannot replace the policy.
Platform capture's estimates are forced dry runs; they cannot execute SQL.

The daily ledger uses native Firestore transactions in the existing
`hushh-ai-prod/one-plg-production` database:
`metricsQueryBudgetDays/<UTC-day>/reservations/<stable-job-id>`.
Its existing database-scoped runtime role is required. Missing permissions,
unavailable Firestore, malformed counters and exhausted budgets all block queries.
No in-memory or CLI fallback exists. Reservations are never refunded, even after
timeouts or ambiguous RPC failures, and persist across restarts and scaling.
Do not delete or reset budget documents to bypass an exhausted day.

The day is determined immediately before reservation in UTC (05:30 IST). A job
submitted near midnight can finish in the following billing day. The ledger
limits reservations, not the cloud invoice's exact posting date. Query deadlines
and cancellation are additional controls; billing enforcement relies on byte
ceilings and durable reservations.

This is a scan budget for the dashboard runtime, not an account-wide dollar cap.
Storage, Firestore, Cloud Run, other services and other identities are outside it.
Google's shared-project per-user quota applies to every user individually, so it
was not reduced as an isolated dashboard fix. Billing alerts do not stop spending.

## No idle analytics scans

Server startup warmups, 5-minute preset warmups and 30-second active refreshes
are removed. No server timer retains analytics loaders. Browser polling, refresh
polls and speculative date-range prefetching are removed. Only selecting a report
or pressing Refresh requests its resource. An open idle tab creates no refreshes.

Browser and server snapshots can be reused for 30 minutes, with their original
timestamps. Expiration alone starts no work: a later user request must occur.
Explicit Refresh waits for its result and coalesces overlapping requests. A failed
refresh can retain a still-valid dated snapshot with a refresh-error indicator;
expired values are not returned as current. Authentication and customer membership
checks remain outside shared response caching.

Large legacy raw-event queries will fail under the 100 MiB limit. Do not raise
the limit to restore those reports; build small partitioned/preaggregated reporting
tables first and validate their estimates before requesting a restart.

## Verification and eventual release

Local checks use synthetic data, mocked BigQuery and a localhost Firestore
emulator. No production analytics query is needed:

```
npm run lint
npm run test:metrics:cost
npm test
npm run build
npx playwright test tests/ui/dashboard.pw.ts -g "idle reports"
```

CI's existing native Firestore job additionally runs
`tests/bigquery-budget-firestore.test.ts` and fails if that case is skipped.
It tests atomic contention, idempotent reservations, restart persistence and UTC
rollover against an isolated demo database.

Only after owner authorization: review the saved report, replace expensive source
queries, confirm no inherited IAM bypasses, verify the database-scoped ledger role,
and wire an explicitly approved enable flag through Secret Manager under the
repository's runtime-config rules. Deploy and verify the exact reviewed revision
through the canonical release workflow while preserving the stop controls until
the approved restart. Releasing workflow, query access and scaling controls are
separate deliberate operator actions, never automatic effects of this PR.

References: [BigQuery cost controls](https://docs.cloud.google.com/bigquery/docs/best-practices-costs),
[script job options](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/Job#scriptoptions),
[custom quotas](https://docs.cloud.google.com/bigquery/docs/custom-quotas).
