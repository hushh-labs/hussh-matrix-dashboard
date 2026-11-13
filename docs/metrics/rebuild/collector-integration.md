# Reporting collector integration and activation evidence

This is implementation evidence for draft #186, targeting Main after the approved
#185 foundation proposal merged at `de0ad8142ba427ea4acbd74dd1893a8b3ea3a8dd`.
Proposal acceptance is not approval to activate collection or replace
the serving application. Existing BigQuery containment and budget reservations,
paused refresh jobs, deployment hold and the independent PLG worker are retained.

## Runtime boundary

The Next.js web process now has **no Firestore SDK, source credential or source
adapter**. It authenticates staff with the existing signed session and current
allowlist, then invokes the reporting service with an audience-bound Google ID
token. The private service checks that signed identity and the exact role for
each operation. Staff quota identity is an opaque HMAC; no raw staff email is
included in the reporting request. Private HTML/RSC/JSON remain no-store.

| Caller | Allowed private operations | Credential/data authority |
| --- | --- | --- |
| `metrics-report-web` | read publication, admit explicit custom job, job status | Invocation identity and existing staff authentication only; no database/source grants |
| `metrics-report-task-invoker` | collect one opaque job ID | Invocation identity only |
| `metrics-report-dispatcher` | reconcile dispatch, bounded maintenance, explicit scheduled admission | Invocation identity only; no public route or timer |
| Reporting service execution identity | Reporting transactions, approved source reads, fixed queue enqueue/lookup | Separate reporting database, source-specific grants and pinned secret versions; no warehouse permission |

These names are required **proposed identities**, not proof that resources or IAM
bindings exist. Review native IAM and task queue overrides before provisioning.
The reporting service must require Cloud Run invoker authentication; application
signature/role checks are additional enforcement. Only `Authorization` carries
the signed token. No trust is placed in queue-name headers or decoded unsigned
JWT claims. See [Cloud Run service identity](https://docs.cloud.google.com/run/docs/authenticating/service-to-service)
and [Cloud Tasks OIDC delivery](https://docs.cloud.google.com/tasks/docs/creating-http-target-tasks).

## Explicit configuration, with no activation defaults

All runtime configuration remains secret-backed when provisioned. No secret,
database, task queue, identity, job or schedule has been created by this change.

- Web requires `METRICS_BIGQUERY_ENABLED=false`, existing session configuration,
  and `METRICS_REPORT_WEB_CONFIG`: exact `audience` (private HTTPS run.app origin),
  `timeoutMs`, `maxResponseBytes`. Missing or invalid config displays unavailable.
- Worker requires `METRICS_WORKER_RUNTIME=reporting`, BigQuery explicitly false,
  and `METRICS_COLLECTOR_CONFIG`: exact project, isolated `metrics-*` database,
  scope digest, worker audience, three invocation identities, queue parent,
  `collectionEnabled`, RPC deadline, request/response byte limits and immutable
  body cache entry/byte bounds. Authority, pointer and quota checks still occur
  on cache hits; expiry never executes a source loader. No emulator
  or PLG database fallback is accepted.
- `npm run metrics:collector -- --check-config` validates and emits a sanitized
  status without constructing a database client or accessing ADC/secrets/sources.
- `--serve` additionally requires an explicit PORT. Startup does not enqueue,
  compute or scan. Enabling the process alone does not supply collection policy.

The reporting store independently requires reviewed reporting, dispatch,
collection, maintenance and source-circuit policies. The reporting policy sets
read/status/compute quotas, separate scheduled/custom capacity and per-staff
custom capacity, period/lease/job/aggregate size bounds. A zero scheduled
capacity keeps that lane closed. No production numerical policy is seeded.

Source bindings require explicit approval, enablement, report/scope, revision,
coverage start, reconciliation evidence digest, bounded transport settings and
source generation derived from that exact content. Changes invalidate reuse.
GA4 additionally pins property/timezone, its approved `readerServiceAccount`, one numeric website stream and a
canonical, explicit subset of `hushh.ai` / `www.hushh.ai` hostnames. Its request
ANDs the exact stream, `platform=web` and approved hosts; property-wide app
traffic and other hosts cannot enter website totals. A missing scope is rejected
before provider access. Reader/scope changes alter source generation, invalidating old
publications/receipts rather than relabelling them. The collector lazily uses native
Google impersonation for that exact reader with only `analytics.readonly` and a
five-minute token lifetime. It does not accept user credentials, key files,
delegate chains or token-endpoint overrides in a binding, forward the runtime's
headers, or fall back to direct runtime Analytics access after a refusal. Actual
reader permission and the collector's resource-level delegation remain release
prerequisites; this code creates no IAM grant. Existing operator CLI failures do
not establish runtime failure. One pins environment and a numbered
`metrics-one-aggregate-source-{environment}` Secret Manager version. Existing PLG
signing keys, BCC senders and owner exports are not used.

## Source status and truthful results

GA4's adapter uses whole-period `runReport` metrics, no device-to-account join and
no sum of daily distinct users. It validates property timezone, metric headers,
row consistency and integer values. A valid empty provider report can mean
zero; malformed/missing metric values cannot. Thresholding/sampling/other-row
loss stays partial. This API does not establish an information-completeness
watermark: actual provider values remain partial, with source freshness unknown.
Publication time bounds display age but does not fabricate data freshness.

The One adapter targets the **proposed, not deployed** narrow endpoint
`POST /api/one/metrics/adoption` on the pinned environment origin. Its request
contains only period, definition version, source generation and scope digest.
It signs exact JSON bytes using HMAC-SHA256 over
`metrics-one-aggregate-v1:{timestamp milliseconds}:{body}`. Backend implementation
must independently enforce origin/environment, purpose, freshness/replay bounds,
aggregate-only access and the approved population/outcome definition. It must
return the exact `AggregateResult` contract with independently reconciled account
and business-outcome totals, real source watermark and the requested period.

The existing retained, capped private PLG owner evidence cannot establish these
global totals. No owner exports are enumerated. **Do not enable the One binding
until that backend contract and a fixed-period reconciliation are accepted.** A
manually supplied reconciliation digest is a binding to evidence, not a test that
the underlying counts are correct.

## Delivery, recovery, fairness and retention

Admission reuses a publication before creating work, charges even cached or
coalesced requests, and records durable job/enqueue intent. Scheduled and custom
work coalesce by the same canonical report key but retain separate reserved
capacity; one staff account has its own custom limit. A shared source circuit
enforces reviewed failure thresholds, exponential jitter, provider Retry-After,
one fenced probe and explicit attention on credential/schema failure.

Provider I/O occurs outside retriable database callbacks. The source journal
reserves once before I/O and persists only validated aggregate output. Completed
receipts recover without key lookup or source request. An unacknowledged native
read has no recoverable query ID, so it stays uncertain and is never resubmitted.
Claim/recovery limits stop retries and polling with attention required; they do
not release capacity or refund inherited paid-work reservations.

The private explicit maintenance operation scans at most one reviewed page each
of jobs and quota buckets, with a fenced durable cursor. It can reconcile an
orphan enqueue intent or resume the same job. Reference-checked cleanup removes
only old terminal, superseded report artifacts and expired quota buckets. Active
publications, unresolved jobs/receipts and permanent head sequences are protected.
Deletion-operation counts are not reclaimed bytes or recurring savings. No timer,
automatic schedule, TTL policy or live cleanup is installed.

## Verification and remaining activation gates

Local tests cover the private HTTP client → admission → durable dispatch →
journaled source → atomic publication → repeated reads, using loopback and
synthetic providers. The existing native Firestore qualification additionally
checks collection, circuit, separate capacity and bounded maintenance. Neither
is live-source, native IAM/task queue or real user-session acceptance.

The [14 November source inspection](./source-verification-20261114.md) verified
the existing property/website stream and exact `Etc/GMT` timezone through Admin
API. The one fixed-period Data API response lacked metric columns/rows and is
not accepted counts. The old website also redirects to a different domain,
whose source/scope is unverified. None establishes effective collector access.
The [offline workload](./workload-measurement-20261114.md) measures logical
operations, cache reuse and recovery with synthetic data, not native costs.

Remaining before activation: accepted metric definitions and measured operating policy
following #185's proposal-only approval;
real One aggregate backend and fixed-period reconciliation; accepted GA4
domain/stream/reporting identity, key-event definitions and period reconciliation; measured
team workload/cost limits; native IAM/queue and signed-session qualification;
Linux container and PLG/OAuth/compatibility routing handoff; exact-source release,
zero-traffic acceptance and rollback. Broader HushhTech, retention, reliability
and operating-cost reports remain pending under #184. No Ready for QA/Done claim.
