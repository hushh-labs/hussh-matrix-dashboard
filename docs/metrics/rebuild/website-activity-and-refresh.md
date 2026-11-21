# Website activity and deliberate refresh

20 November 2026. [Website source PR #1068](https://github.com/hushh-labs/hushh-search-console/pull/1068)
is merged. Its new capture mode still requires owner acceptance and a serving
revision with the reviewed policy. Collection remains held.
The user now requests refresh as part of the final rollout. This supersedes the
desired permanent refresh pause, but does not restart legacy collection jobs.
BigQuery stays off; #179/#180 reservations and CI/CD remain unchanged.

21 November 2026: Website UAT serves `rb01aafdbec73-8345876c` at 100% after
rollback from later images, including `rc4b84bf649b2-6426183e`. Its current
template has `TELEMETRY_ENABLED=true`, no `WEBSITE_METRICS_ENABLED` setting,
ingress `all` and an `allUsers` invoker grant. The warehouse-free source requires
legacy telemetry off during new capture. Keep the serving traffic outside this
pilot. The current collector pins that public UAT origin and sends an HMAC
signature. An IAM-protected source needs an independently reviewed UAT-only
origin and an audience-bound invocation token in addition to the HMAC. The
existing binding must refuse an arbitrary origin or production fallback.

### Proposed closed-period Website UAT pilot

1. Establish the source population as the five consent-bound event types on an
   isolated staff pilot route. Verify the exact image and use an existing
   restricted ingress or identity boundary that denies public requests before
   datastore work. Review the source revision's rollback reason before reusing
   its image. If isolation cannot be demonstrated, leave capture disabled.
2. Propose one UTC capture day, one operator and at most 20 accepted receipts
   for the five event types. Use one source instance with zero minimum and one
   concurrent collector claim, one task attempt and one manual report per
   execution UTC day. Disable legacy telemetry for the isolated candidate and
   stop capture at the end of the UTC day. The accepted-record cap does not
   limit charges from refused requests.
3. Record expected accepted receipts by event type before reading the source
   rollup. Compare that tally to the independent receipt enumeration and source
   rollup for the closed day. With a 20-receipt ceiling, one day's consumer
   budget is 23 logical read units. Reject missing days and overflow. Use the
   resulting evidence to pin the admitted period and source generation.
4. Submit one manual report. Check the signed source response, publication,
   partial coverage in the authenticated page, and reuse without extra source
   calls. Record request and RPC counts, latency and usage across both services
   and their stores. Twenty successfully accepted receipts account for up to
   60 point reads and 60 writes under the documented transaction shape. Measure
   refused captures and other RPC and index work separately. Preserve historical
   reports and reservations.

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
warehouse execution or raw event records reach the web application.
Production and UAT bindings each require their exact source origin and a
numbered key in the matching project and environment. Use a separate authorized
reporting scope for UAT. The page labels the source environment only when the
binding matches the saved publication. Approved binding fields include the
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
