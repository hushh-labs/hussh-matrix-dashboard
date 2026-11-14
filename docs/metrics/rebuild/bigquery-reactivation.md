# BigQuery reactivation: estimate first, collector only

Status: preparation, not activation or a replacement for #184 acceptance.
The user requested optimized planning on 14 November. Dashboard BigQuery remains
off, refresh and report queue paused, deployment held and CI/CD unchanged. The
independent PLG UAT mail worker remains outside this warehouse change.

## Why the old switch stays off

The inherited wrapper has real native 100 MiB statement ceilings, durable
10 GiB/100-statement UTC-day reservations and no refunds. Preserve these records
in `one-plg-production/metricsQueryBudgetDays`; do not migrate or reset them.
Those are outer incident-containment limits, not a proposed normal allowance.
Its two executing slots are per process. Every wrapper invocation generates a
new provider ID; a timeout followed by another invocation can reserve/submit
another job. Legacy cache misses and Refresh still invoke source loaders, some
with more than twenty queries. Turning on the old flag reopens that path.

The published-report reader is passive and worker jobs have stable provider IDs,
durable capacity and fences. There is currently no warehouse source binding or
native-job recovery adapter. The worker deliberately requires BigQuery off.
Do not change that invariant merely to obtain a dry-run estimate.

## First measured plan: historical capture diagnostic

`scripts/metrics-bigquery-preflight.ts` is an operator-only estimator. It accepts
only `--output <new-receipt-path>`, an ephemeral token in
`METRICS_BQ_PLANNING_ACCESS_TOKEN`, and no execution/SQL/date/project options.
An operator uses their own currently authorized identity; this grants no runtime
IAM or alternate-account fallback. A missing/existing output, auth/metadata
failure, schema change, response over 1 MiB or RPC failure stops without retry.

The only request is a fixed native `dryRun=true` for
`hushh-pda.analytics_526603671.events_20261105`, billed/planned in
`hushh-ai-prod`, location US, a generated operator-only planning job ID, standard SQL, cache disabled and
`maximumBytesBilled=73400320` (70 MiB). Native table metadata is checked before
and after; views/external/clone/snapshot resources and selected-column masking
are rejected. Require SELECT, precise nonzero safe-integer estimate, exactly
that referenced table and no undeclared parameters/errors. No native result
method, execution switch, schedule or application import is present.
The native dry-run response omits the unpersisted job ID even when the request
supplies one. The receipt records that fact and the generated planning ID;
any returned ID must match. This is not native paid-job recovery, which must
require the actual persisted provider ID before a later submission/result read.

It proposes exported row counts by fixed platform/recorded-environment buckets
and the count of events carrying an account ID. One source row remains one row:
missing, duplicate and other env labels are explicit; no free-form label or
identity is returned. This is **not** distinct customers, One adoption, agent
success, production-only scope or a live report. No intraday/daily union is used.
The source reporting timezone is unverified and remains an acceptance blocker.
Metadata stability is not an atomic snapshot or completeness watermark. An
estimate cannot prove the query's data-dependent reconciliation.

Run the offline suite first:

```text
npx vitest run tests/metrics-bigquery-preflight.test.ts
npm run lint
```

Then use the exact operator script with a new receipt; never enable the runtime
flag just to plan. Successful estimation does not authorize paid execution.

## Minimum implementation before a paid collector pilot

1. Pick an approved report and fixed query/period/columns/scope. Prefer existing
   bounded source APIs for registrations, business outcomes, GA4 sessions and
   native Monitoring; warehouse exports do not replace their authority. Verify
   timezone, production stream/app/host/debug/env rules and eligible population.
2. In the existing job lifecycle, persist an immutable plan digest, billing
   project/location, stable provider job ID, original reservation UTC day,
   statement count and byte ceiling **before** submission. Reserve the same ID
   idempotently in the inherited ledger. The two databases cannot be treated as
   one transaction: retain durable phases for interruption between them.
3. Recover via bounded native lookup of that exact job ID/configuration before
   re-submission. Missing/ambiguous/running work retains reservation and shared
   capacity; conflict never creates a suffix/new ID. Record authoritative
   terminal failure separately from an unavailable observation. Bound result
   rows/bytes and polling. No unbounded automatic pagination or provider calls
   inside retriable Firestore transactions.
4. Reserve the whole report's worst-case work before executing. Proposed initial
   diagnostic is **one SELECT, at most 70 MiB, one global in-flight warehouse
   job, manual only, zero scheduled jobs**. This is a proposal, not an installed
   policy. No automatic cap increases, refunds on timeout or midnight recharges
   for recovery. Review a separate measured daily allowance before any cadence.
5. Prove duplicate delivery, lost acknowledgements, crashes before/after budget
   reserve, concurrent instances, rollover, terminal failures, late correction,
   publication fencing and repeated passive reads. Reconcile a fixed period
   independently; then qualify the exact image with a working rollback before
   releasing the cost hold. Preserve legacy data, reservations and PLG history.

## Cost accounting and explicit activation decision

[Google documents dry runs and native byte caps](https://docs.cloud.google.com/bigquery/docs/best-practices-costs).
A LIMIT does not bound scans. Clustered estimates may be conservative and
row-level-security estimates can be zero; this diagnostic refuses those cases
rather than pretending zero is a safe cost/completeness proof.

At the current [US on-demand list price](https://cloud.google.com/bigquery/pricing)
of USD6.25/TiB, a 70 MiB ceiling corresponds to approximately USD0.0004173 in
query compute before free usage. This is conditional on on-demand billing, not
a total invoice guarantee. Verify reservation/capacity assignments before
claiming that model. Billing minimums/rounding apply; do not assume free quota
remains. Storage, Firestore, Cloud Run, tasks, builds and logs are separate.

No storage copy, materialized table, transfer/export, index, slot reservation,
service enablement, IAM grant, paid build or scheduled refresh is authorized by
the estimator. Do not delete retained data to save an estimated amount. Any
future automated refresh needs accepted freshness, measured cost and recovery
evidence under #184, not just a successful query.

## 14 November measured evidence

The first native estimate at 16:16 UTC returned **16,683,611 bytes (15.91 MiB)**,
below 70 MiB, with unchanged table etag/schema/last-modified time before/after.
This was one dry run and two metadata GETs, not a data-row read or paid query.
Read-only review then required a complete outbound JobReference. Adding a
planning ID exposed the native response's omitted-ID behavior; the strict
trial correctly stayed held, and a bounded diagnostic confirmed every other
dry-run/query/project/location/control proof matched. Retain both receipts.
The estimator now models that observed behavior explicitly, with a regression
for omitted IDs and continued refusal of a conflicting returned ID.
The corrected outbound/response contract was then qualified at 16:23 UTC:
again 16,683,611 estimated bytes, unchanged metadata, no paid execution or result
reads. Across this investigation there were four free dry-run requests total,
including the two held contract trials; none was a paid-query retry. Raw
provider bodies, credentials and event rows were not persisted.

One bounded native project/inherited reservation-assignment search returned
HTTP200, no assignments and no continuation at 16:20 UTC. This supports the
project-level on-demand proposal, not a guarantee for all identities, future
assignments, other services or the entire billing account. A separate GET of
today's inherited daily ledger returned404: budget availability/authority for
execution remains unaccepted; no ledger was created or reset.
