# Reporting implementation status

13 November 2026. Foundation review packet: PR #185.

Kushal approved the foundation proposal packet at `e41d134`; #185 merged into
Main at `de0ad8142ba427ea4acbd74dd1893a8b3ea3a8dd`. This is documentation/proposal
acceptance only. The approved review explicitly keeps metric/source
reconciliation, measured operating limits, runtime, collection and deployment
acceptance pending. The incident hold is retained while this implementation
continues.

## Implemented locally

- Independently runnable Metrics Next.js 16.4.6 App Router application, exact
  dependency lock, standalone candidate container and Metrics branding.
- Separate report read, computation-admission and status routes. Existing signed
  Google session compatibility with current domain/email authorization checks.
- Private audience-bound web → reporting-service client. The web process has no
  Firestore/source SDK or provider credentials; the private service verifies
  signatures and exact operation roles. Missing config/publication renders
  unavailable. Explicit reporting database has no PLG fallback.
- Transactional request quotas, durable enqueue intent, cross-instance job
  coalescing, capacity, immutable snapshots and atomic publication pointers.
- Fenced worker claims/publication, expiry of unstarted work, recovery-only
  handling of uncertain work and stable provider identities. No refund/release
  of unsettled work on timeout or lease expiry.
- Durable task enqueue bridge with deterministic identity, dispatch leases,
  bounded native lookup, delayed/attention states and queue/execution timings.
  Missing queue tasks never authorize replacement. A separate approved dispatch
  policy is required; native transport and cloud wiring remain held.
- Byte/entry-bounded immutable body cache, checked behind current authority and
  publication identity on every read; runtime requires explicit bounds.
- One aggregate-source contract adapter and GA4 whole-period report adapter.
  GA4 requires an explicitly reviewed website stream/hostname scope, filters
  platform to web and rejects legacy property-wide bindings. Stream/host changes
  invalidate the source generation. This prevents mixing app streams into website
  totals; live provider compatibility/count reconciliation is still required.
  The GA4 credential path separately pins a reviewed native reader identity,
  uses short-lived read-only impersonation after source admission and refuses
  silent direct-identity fallback. No IAM or property access grant was added.
  Both reserve a durable source-call receipt before I/O. No raw provider payload,
  owner directory or private content persists. Recovery before a journal exists
  can admit the first source call through the current fence. An admitted uncertain
  call never becomes a second provider request.
- Held collector entrypoint and fixed native ADC/Secret Manager/One/GA4/task
  transports, with byte/deadline limits and purpose-pinned numbered keys.
  Configuration validation requires no source or database access.
- Shared source circuit, provider Retry-After, jitter, fenced probe and attention
  on credential/schema failure. Recovery attempts and polling are bounded.
- Separate scheduled/custom capacity, per-staff custom capacity and cross-lane
  coalescing. Explicit bounded maintenance reconciles durable intent and safely
  prunes old superseded artifacts/quota buckets, protecting active publications,
  uncertain work, inherited reservations and permanent head sequences.
- GA4 actual values without a completeness watermark display partial coverage
  and unknown source freshness. Malformed output cannot become zero. Equivalent
  timezone aliases are normalized; source periods do not silently become UTC.
- Existing `npm run build` qualifies legacy and Next.js builds. Existing UI
  command checks the standalone application alongside the legacy UI. Source
  layout falls within the existing CI path filter; workflow files are unchanged.

The existing `npm start`, PLG runtime, private worker, keys, reservations, source
permissions and scheduled state are not replaced by this implementation.

## Evidence and limits

Focused synthetic tests exercise competing readers/workers, quota accounting,
capacity, atomic publication, unknown results, source loss, fencing, scope and
generation changes, strict aggregate payloads, session revocation/expiry, cache
bounds and the absence of source imports from the web graph. Local production
build checks the authenticated unavailable view and API privacy behavior.

Current Windows build measured 926,034 bytes across 24 static files and
50,005,210 bytes across 2,148 standalone files, versus the earlier 61,147,007-byte
artifact. These are local artifact sizes, not reclaimed cloud storage, latency,
memory or recurring savings. The web lock removes Firestore and uses exact
Google invocation-auth dependency 10.6.2; production-dependency audit is clean.
Legacy root dependencies are preserved. Exact current CI evidence is recorded on
#186 and in the operator checkpoint.

An attempted checksum-pinned local Firestore emulator download/launch was
rejected by automatic approval review before execution. No alternate launch was
attempted. `METRICS_REPORTS_EMULATOR_TESTS=true` with an explicit localhost
`FIRESTORE_EMULATOR_HOST` enables the same transaction suite against the native
adapter, but that complete suite is currently unverified. A representative native
reporting probe now runs inside the existing localhost-only budget qualification:
coalescing across instances, lease recovery, stale-worker rejection, publication,
source invalidation and retained uncertain capacity. It also asserts that reporting
cannot change inherited budget counters/reservations. Hosted evidence for that
expanded probe passed in CI 43393680334 on `701ad5cf`. Dispatch recovery passed
in CI 43410691679 on `b2af31d`. The collector increment adds journaled collection,
honest GA4 freshness, shared circuit, separate capacity and bounded maintenance.
That increment passed all three jobs in CI43419122723 at `ab185b0`: 735 tests,
68 browser cases, both builds and the existing 44-case native storage lane with
the extended awaited reporting probe. This is exact-head historical evidence;
new heads retain their own qualification record. Local mocks and native storage
do not certify native IAM, queues, source accuracy or live behavior.

## Remaining before collection or release

1. Accepted metric definitions and measured operating policy from #184's lead
   review. No activation defaults or production policy are seeded.
2. Authoritative One aggregate endpoint and independent fixed-period source
   reconciliation. `/api/one/metrics/adoption` is proposed, not deployed. GA4
   needs verified property/timezone, configured key events and independent
   reconciliation. Where no source watermark exists, freshness stays unknown.
3. Complete optional native suite and actual Linux container qualification. The
   representative native reporting probe has passed in the existing Linux CI.
4. Actual native transport/worker/queue wiring and accepted numerical policy.
   Collector, fair capacity, source circuit and reference-aware maintenance are
   implemented default-closed. No collector or scheduler has been activated.
5. Reader/admission/worker IAM and operational routing handoff. The private
   invocation boundary requires native signed-identity checks and database-level
   grants before release. The current sign-in link uses the
   existing hosted flow; standalone OAuth callback acceptance is not established.
6. Additional HushhTech, acquisition, retention, reliability and cost reports;
   measured team workload, agreed performance/freshness/cost objectives and alerts.
7. Existing Metrics release controls, zero-traffic qualification, live accuracy,
   serving behavior and rollback. Keep BigQuery and the incident hold in place.

Implementation is in progress. This is not Ready for QA or a live-data acceptance.
Detailed runtime/source contract: [collector integration](./collector-integration.md).
Current source evidence: [14 November inspection](./source-verification-20261114.md).
