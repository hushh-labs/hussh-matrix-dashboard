# Collection and cost policy proposal

Status: measurement and technical-lead review required before activation.

## Verified inherited containment and its scope

BigQuery is disabled. Preserve #179/#180: native maximum 100 MiB per statement,
100 reserved statements and 10 GiB worst-case reserved bytes per UTC day,
with at most eight statements per request. The inherited wrapper allows two
active and 32 waiting invocations **per wrapper instance in one process**, with
a 30-second native job/statement timeout. Its counters and waiting queue are
process-local, not a deployment-wide concurrency or durable queue limit.
These are inherited containment ceilings, not approved targets or permission to
execute. Earlier operator 70 MiB diagnostic approvals were individual queries,
not standing collection authorization.

The Firestore daily budget and its reservation records are durable across
instances, and the wrapper has no refund path for a reserved invocation. A
timeout, RPC error or process interruption does not remove that budget record.
This does **not** establish stable logical-job/provider-job recovery: the runtime
generates a new provider job ID per invocation, and its process-local queue slot
is released or handed to the next waiter when the invocation settles. A later
invocation can therefore obtain a different job ID and another reservation.
Query LIMIT is not a scan-spending limit.

Source evidence at the reviewed foundation head:
[fixed ceilings](https://github.com/hushh-labs/hussh-matrix-dashboard/blob/bbc2fc31e99410a3c27c20e282cd048e903ff602/src/server/bigquery-cost-control.ts#L5-L16),
[durable reservations](https://github.com/hushh-labs/hussh-matrix-dashboard/blob/bbc2fc31e99410a3c27c20e282cd048e903ff602/src/server/bigquery-cost-control.ts#L90-L145),
[process-local queue and per-invocation ID](https://github.com/hushh-labs/hussh-matrix-dashboard/blob/bbc2fc31e99410a3c27c20e282cd048e903ff602/src/server/bigquery-cost-control.ts#L149-L184),
[slot release](https://github.com/hushh-labs/hussh-matrix-dashboard/blob/bbc2fc31e99410a3c27c20e282cd048e903ff602/src/server/bigquery-cost-control.ts#L210-L213).

Stable logical-job identity, cross-worker reconciliation and retained uncertain
work capacity are **required replacement behavior**, not inherited guarantees.
They require implementation and exact-source recovery evidence before acceptance;
this foundation PR implements none of those runtime changes.

## Baseline and measurement method

Run `node scripts/measure-metrics-baseline.mjs` for source-tree measurements.
It reads local files only, does not import the application, and never calls a
provider, cloud API, warehouse or package installer. Record its JSON alongside
test/build receipts. Its output contains file byte sizes, line counts, and direct
dependency/development-dependency counts. It does not parse or emit configured
cost caps, or measure staff traffic, latency, freshness, billed work or operating
cost. The inherited ceilings above come from manual source inspection, not this
script's measurements. See the
[offline script](https://github.com/hushh-labs/hussh-matrix-dashboard/blob/bbc2fc31e99410a3c27c20e282cd048e903ff602/scripts/measure-metrics-baseline.mjs).

The live audit found one vCPU/1 GiB and revision maximum three instances, with a
service-level maximum 100. Do not multiply these into an invented spend cap or
change scaling without measured workload and the reviewed operating policy.
The legacy built assets inspected in the previous worktree totalled 1,483,337
bytes; largest was 704,484 bytes. That is an old local build, not the replacement
production-build measurement.

## Policy decisions and activation gates

| Control | Implementation requirement | Evidence needed before setting/activating values |
| --- | --- | --- |
| Source cadence | Independent per source/report; no startup/page-triggered collection | Source update lag and team decision/freshness needs; batch compatible reports |
| Freshness | Store checked-at, source watermark, computed-at and published-at separately | Source-specific permitted stale age and invalidation behavior |
| Cache | Immutable aggregate bodies bounded by bytes and entries; pointer/auth checked before reuse | Serialized report sizes, observed reuse, memory plateau under navigation |
| Requests | Durable verified-staff quotas for reads, polling and compute; cached/coalesced requests still counted | Team concurrency, tab behavior and cost per class; protect anonymous login separately |
| Admission | Check current publication/job, capacity, source circuit and paid budget transactionally; durable enqueue intent | Source quotas, queue wait/execution observations and scheduled/custom fairness |
| Worker | Bounded concurrency, fenced leases and provider-job recovery; no provider I/O in transaction functions | Actual execution duration, interruption and uncertain-ack tests |
| Retries | Only recoverable errors; provider backoff/jitter and remaining deadline/budget | Provider guarantees and measured latency; schema/auth failures require correction |
| Paid work | Reserve worst-case cost before native submission; no automatic budget increase | Fixed query dry-run and native ceiling; accepted source-specific spend allocation |
| Retention | Reference-aware cleanup; unresolved jobs/reservations and active publications protected | Recovery/reproducibility need, privacy, measured storage and consumer inventory |
| Observability | Bounded labels and complete paid-work receipts; omit personal data, tokens and raw keys | Cost/lag/queue/reconciliation alerts and evidence that telemetry does not inflate adoption |

Before review, collection admission stays default closed. Local tests use explicit
test policies, never production defaults. Existing Firestore can host derived
reports, but named databases are billable and a namespace is not an IAM boundary.
Verify database-level identity separation or a private constrained reader before
deploying the reporting web identity. Do not promise zero hosting/storage cost.

## Required replacement publication protocol

The following is a design requirement, not an inventory of inherited behavior or
an acceptance claim for draft #186. Its exact-source implementation and recovery
checks, source reconciliation and runtime acceptance are separate evidence.

1. Authenticate and authorize; validate closed report/filter definitions.
2. Charge request quota, reuse current publication or coalesce an existing job.
3. If approved and within capacity/budget, atomically record job/enqueue intent.
4. Claim a fenced lease; recover any existing native provider job before work.
5. Validate aggregate-only results, definitions, period, scope, watermark and
   reconciliation. Stage immutable chunks under the active generation.
6. Publish one pointer atomically only when every required chunk is complete,
   current and owned by the live worker. A stale worker cannot overwrite it.
7. Failed sources leave prior permitted publication readable with its original
   watermark. Invalidated scope/definition/deletion state prevents reuse.

Report reads have no loader or enqueue callback. Cache expiry is passive. A
refresh first rereads the pointer; explicit computation uses ordinary admission.
Cloud Tasks can deliver duplicates and reorder work; correctness comes from the
durable job/lease/native-job protocol, not task ordering or deduplication alone.

## Qualification and review packet

Measure production-build read/render latency, cold start, queue wait, provider
calls, bytes billed, memory, Firestore operations, cache hits/evictions and storage
with representative staff requests and bursts. Break cost down into reporting,
custom compute, collection, retained PLG, logging, images and maintenance. Report
estimates and native receipts separately; do not rely on promotional credits.

[Kushal Trivedi](https://github.com/kushaltrivedi5) reviews definitions and resulting
operating policy per #184. [Neelesh Meena](https://github.com/DamriaNeelesh) owns
gathering the source/reconciliation and workload evidence and validating the
packet's reasoning; neither assignment nor assisted drafting records approval.
Code, local fixtures and recovery tests may progress while review is pending. Collection,
schedule activation and cost-hold release do not progress ahead of acceptance.

Meaningful-activity allowlist/aggregate contract, eligible population rules,
verified GA4 property/scope/timezone, independent fixed-period reconciliations and
measured numerical operating limits remain open prerequisites. Correcting these
documents does not close any of them.

References: [BigQuery cost controls](https://docs.cloud.google.com/bigquery/docs/best-practices-costs),
[Firestore transactions](https://docs.cloud.google.com/firestore/native/docs/manage-data/transactions),
[Cloud Tasks delivery](https://docs.cloud.google.com/tasks/docs/common-pitfalls),
[Firestore pricing](https://cloud.google.com/firestore/pricing).
