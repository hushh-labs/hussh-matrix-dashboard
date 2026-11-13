# Reporting implementation status

13 November 2026. Foundation review packet: PR #185.

## Implemented locally

- Independently runnable Metrics Next.js 16.4.6 App Router application, exact
  dependency lock, standalone candidate container and Metrics branding.
- Separate report read, computation-admission and status routes. Existing signed
  Google session compatibility with current domain/email authorization checks.
- Explicit reporting database configuration with no PLG fallback. Missing
  configuration or publication renders unavailable; no seeded or fixture data.
- Transactional request quotas, durable enqueue intent, cross-instance job
  coalescing, capacity, immutable snapshots and atomic publication pointers.
- Fenced worker claims/publication, expiry of unstarted work, recovery-only
  handling of uncertain work and stable provider identities. No refund/release
  of unsettled work on timeout or lease expiry.
- Durable task enqueue bridge with deterministic identity, dispatch leases,
  bounded native lookup, delayed/attention states and queue/execution timings.
  Missing queue tasks never authorize replacement. A separate approved dispatch
  policy is required; native transport and cloud wiring remain held.
- Optional byte/entry-bounded immutable body cache, checked behind current
  report authority and publication identity on every read.
- One aggregate-source contract adapter and GA4 whole-period report adapter.
  Both reserve a durable source-call receipt before I/O. No raw provider payload,
  owner directory or private content persists. Recovery before a journal exists
  can admit the first source call through the current fence. An admitted uncertain
  call never becomes a second provider request.
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

Replacement build measured 926,034 bytes across 24 static asset files and
61,147,007 bytes across 2,758 standalone files on Windows. These are artifact
sizes, not cold-start latency, process memory, selected-page transfer size or a
Linux container image measurement. New application production-dependency audit
reported zero vulnerabilities after pinning Firestore 9.4.1. Legacy root
dependency versions were preserved.

An attempted checksum-pinned local Firestore emulator download/launch was
rejected by automatic approval review before execution. No alternate launch was
attempted. `METRICS_REPORTS_EMULATOR_TESTS=true` with an explicit localhost
`FIRESTORE_EMULATOR_HOST` enables the same transaction suite against the native
adapter, but that complete suite is currently unverified. A representative native
reporting probe now runs inside the existing localhost-only budget qualification:
coalescing across instances, lease recovery, stale-worker rejection, publication,
source invalidation and retained uncertain capacity. It also asserts that reporting
cannot change inherited budget counters/reservations. Hosted evidence for that
expanded probe passed in CI 43393680334 on `701ad5cf`. The next extension adds
durable dispatch-acknowledgement recovery to that same native probe; its new
current-head CI receipt is required separately.

## Remaining before collection or release

1. Accepted metric definitions and measured operating policy from #184's lead
   review. No activation defaults or production policy are seeded.
2. Authoritative One aggregate endpoint and independent fixed-period source
   reconciliation. `/api/one/metrics/adoption` is proposed, not deployed. GA4
   needs verified property/timezone and an independently justified information
   watermark. Successful checks alone cannot establish source freshness.
3. Complete optional native suite and actual Linux container qualification. The
   representative native reporting probe has passed in the existing Linux CI.
4. Live task transport/worker wiring, scheduled/custom fairness, bounded polling UI,
   shared circuit/backoff and reference-aware cleanup. Admitted intent is durable;
   no collector entrypoint or scheduler has been activated.
5. Reader/admission/worker IAM and operational routing handoff. Firestore
   collection names are not IAM isolation. The current sign-in link uses the
   existing hosted flow; standalone OAuth callback acceptance is not established.
6. Additional HushhTech, acquisition, retention, reliability and cost reports;
   measured team workload, agreed performance/freshness/cost objectives and alerts.
7. Existing Metrics release controls, zero-traffic qualification, live accuracy,
   serving behavior and rollback. Keep BigQuery and the incident hold in place.

Implementation is in progress. This is not Ready for QA or a live-data acceptance.
