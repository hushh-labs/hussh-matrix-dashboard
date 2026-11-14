# Website activity and deliberate refresh

14 November 2026. Local implementation/review packet; collection remains held.
The user now requests refresh as part of the final rollout. This supersedes the
desired permanent refresh pause, but does not restart legacy collection jobs.
BigQuery stays off; #179/#180 reservations and CI/CD remain unchanged.

## Separate metric definition

`hushhai.activity` is a proposed source-owned report for accepted page-view,
search-submitted/completed/failed and call-to-action event records. Source repo:
`hushh-labs/hushh-search-console`, base `e5cb3f1a`. The new default-off source uses
its existing Datastore-mode database, no warehouse query. It stores only UTC
counting metadata and opaque server receipt IDs. Its own review packet is
`docs/ops/website-metrics-source.md` in that repository.

Counting unit is **event**, basis **source_recorded**, period at most seven UTC
days. No identified-account or anonymous-device totals are derived. Source UUID
deduplication covers repeated internal storage delivery, not browser retries or
unique human attempts. Each event total is additive across disjoint UTC periods
within the same counting generation. There is no ratio denominator or conversion
claim. Gemma-specific events and other unlisted feature paths are excluded.
The source population is backend-wide for the five accepted event names in that
environment; a marketing-only population/domain split is not established. Scope
review must resolve that distinction before activation. No path/hostname filter
is invented from an opaque scope digest.

An independent bounded source receipt count must equal the atomic rollup.
Missing days, overflow and corruption refuse; a missing day cannot become zero.
Current-day output is provisional, closed-period output partial, watermark
unknown. The existing consent-bound browser paths remain best effort. Server
acceptance does not establish global consent/capture completeness or bot removal.
GA4 `hushhai.acquisition` remains a separate provider-defined report restricted
to its reviewed historical source range. No GA4 users/sessions are relabelled.
Both historical hushh.ai and redirected hussh.si can belong to the reviewed
website scope; arbitrary hosts and app streams are not added by this patch.

## Consumer boundary and cost admission

Only the collector can read a purpose-pinned numbered website key, sign the
fixed native source URL and call the aggregate endpoint. No source key, SDK,
warehouse execution or raw event records reach the web application. Production
bindings cannot use UAT endpoints or keys. Approved binding fields include the
counting generation, verified history window and a finite daily receipt ceiling.

Before any key/provider I/O, the same transaction reserves a source-call journal
and a daily source-read budget. The approved policy is
`policy/website-read-budget` with exactly `approved: true` and positive integer
`dailyReadUnits`. The retained day record excludes generation/staff/job sequence,
so those changes cannot reset usage. The stored ceiling can only decrease.
An uncertain call keeps its reservation; redelivery cannot issue another call.
Cached/repeated report reads use the same publication without another source
request. Existing request quotas still charge cached reads and polling.

Reservation is `periodDays * (maxEventsPerDay + 3)`: two point reads/day plus
bounded receipts and a query sentinel. These are logical engineering units,
not measured billable operations or a currency guarantee. Source transaction
RPCs/index reads, public ingress, Firestore reporting work, hosting, builds,
logging and retained storage need native measurement and an accepted allocation.
No live numerical policy is seeded. Source capture writes are separately gated
and finite; the consumer reservation alone cannot cap untrusted source traffic.

## Refresh behavior

The explicit Refresh button calls existing authorized computation admission.
Admission first checks the current valid publication and shared job; it can
return the publication without source I/O. It uses the same durable capacity,
budget, source journal and fenced publication protocol as other admitted work.
Changing dates needs Apply. Page loads, cache misses, navigation, prefetching and
button rendering never create collection work.

Client polling stops after twenty status reads or a two-minute overall budget;
each fetch/body wait is bounded to at most ten seconds and remaining budget.
Payloads are limited to 8 KiB; provider backoff is bounded to 1–30 seconds.
Authorization/quota/errors stop without retry or another admission. Navigation
aborts local polling and fences late responses, not shared server work. Missing
runtime disables the button. There is no browser timer or automatic schedule.

Existing private scheduled admission and maintenance can reuse the same controls.
Automatic cadence still needs a measured per-source policy, exact service/queue
identity and approved source range. Do not resume old Search Console/BQ jobs to
implement refresh. Activation is part of rollout after #184's acceptance gates.

## Current evidence and remaining acceptance

The source's SDK-managed local emulator qualified atomic writes, rollback,
lost-ack recovery, native contention/refusal and signed aggregate reconciliation.
Its actual FastAPI output and HMAC were consumed by the Node collector factory,
journal and publication path with one source call for ten repeated reads.
That latter reporting store/transport is synthetic and the source dataset is a
local fixture. It is cross-language contract proof, not live reconciliation.

Still required: source-owner/lead acceptance of definition and measured policy;
ordinary source UAT qualification and release within its build budget; actual
source/IAM/fixed-period accuracy; One source capacity/reconciliation; native
reporting/queue identities; serving-container and OAuth/PLG routing; controlled
candidate, serving revision and rollback. Wider #184 product/reliability/cost
coverage is not complete. No live collection, schedule, key/config or traffic
was changed, and no source Cloud Build was triggered by this implementation.
