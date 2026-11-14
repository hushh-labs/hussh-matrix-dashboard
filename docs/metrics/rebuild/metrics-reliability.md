# Warehouse-free Metrics hosting reliability (held candidate)

This report is **not activated**. No live reporting policy, source binding,
budget, collection job, IAM grant, queue or publication is created by this change.
BigQuery remains off, existing refresh paused and CI/CD unchanged. The existing
public dashboard and independent PLG mail worker retain their images and state.

## Definition and limits

`metrics.reliability` version 1 is the first bounded slice of the catalog's
`products.reliability` family. Its only target is the verified existing hosting
tuple `hushh-ai-prod / hushh-matrix-dashboard / us-central1 / production`.
It is **not** One or HushhTech reliability, adoption, customers, agents, business
outcomes or availability/uptime. It includes staff, API and health-check traffic.

The source is Cloud Monitoring `run.googleapis.com/request_count`, DELTA/INT64,
aligned with `ALIGN_SUM` to hourly buckets over one to seven complete UTC dates.
Every returned revision/status series and point is validated and summed. Counts
are native recorded requests, not distinct requests independently deduplicated by
Metrics. No raw labels, request bodies, user identities or credentials persist.

| Metric | Unit | Meaning and coverage |
| --- | --- | --- |
| `requestCount` | request | Sum of validated returned request buckets; partial. Empty response is unavailable. |
| `serverErrorCount` | request | Sum of validated HTTP 5xx buckets; partial. Missing 5xx series is unknown, not zero. |
| `serverErrorRatio` | ratio | Unavailable until a complete compatible denominator is independently established. Hour unions cannot prove this. |
| `p95LatencyMs` | millisecond | Untracked until compatible native histogram merge and percentile calculation are implemented and reconciled. |

Explicit returned zero buckets can yield zero recorded counts. Omitted buckets,
revisions, status classes and absent series never establish zero. Fetch time is
not source completeness; source watermark remains null. Counts can be summed
only over disjoint, identically scoped windows; rates and percentiles cannot.

The adapter rejects a continued/truncated result, execution errors or unreachable
regions, foreign resource scope, duplicate series, overlapping buckets, invalid
intervals/units/status classes, fractional/negative/unsafe counts and unsafe sums.
It accepts reverse-ordered native buckets without truncating to the first point.
One request is bounded to 1,000 native points via `pageSize` (the API's FULL-view
unit), 1,000 series and a second 5,000-point parser ceiling. A returned continuation
is refused instead of initiating automatic pagination. The approved response-byte
and deadline limits also apply. No retry or alternate-provider fallback exists.

## Recovery, isolation and cost policy

Only the collector obtains a keyless `monitoring.read` scoped credential. The web
application reads published aggregates; page loads, navigation, filters and report
cache misses cannot reach Monitoring. The HTTP transport pins the native project
endpoint, method GET, no redirects and no request body.

The existing durable journal admits source work under a fenced lease and records
its intent and budget before I/O. Duplicate tasks recover a completed receipt;
an uncertain acknowledgement retains its reservation and does not replay the read.
Publication uses the existing transactional/fenced lifecycle and current access.

Live activation additionally requires an approved `monitoring-read-budget` policy
with an explicit measured daily query allowance. The validation ceiling of 1,000
is not a proposed allowance or default. The reservation key is fixed to target and
UTC day, independent of staff, control revision, source generation or new policy.
Lowered limits and retained usage cannot be reset by changing report generations.
The existing request quotas, job capacity, payload/deadline limits and circuit
breaker remain required. IAM access is not granted by this application change.

Cloud Monitoring API access is not a promise of zero total cost. Account for reads,
Cloud Run, Firestore, queue, build, log and storage usage in the operating review.
No production source call or cost measurement is part of local fixture tests.

## Acceptance remaining

Before activation, verify current source ownership and least-privilege collector
access. Independently reconcile one fixed closed UTC day with the exact service,
region, metric, status classes, alignment and all revisions. Preserve the native
response's completeness/error/continuation metadata and reference bucket sums.
An old rolling-window legacy wrapper is not an independent calendar-day baseline.
Record the reviewed binding/reconciliation digest, coverage dates and measured
budget; then qualify collector publication and repeated read reuse through the
actual serving candidate. Existing source, authentication, rollback and public
serving gates remain required. This candidate does not restore every report.

Primary contracts: [ListTimeSeriesResponse](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/ListTimeSeriesResponse),
[timeSeries.list](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.timeSeries/list).
