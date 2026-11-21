# Reporting implementation status

## 21 November 2026

The private Next.js web and collector revisions `p-f677ad88` serve the One UAT
pilot with version 2 of the runtime settings. The release owner verified native
task creation, cleared the expired dispatch while preserving its audit record,
and authorized one fresh manual One adoption request for 19 November UTC.
The pilot permits one job, claim and source call per execution UTC day. It has
no schedule and uses the One aggregate source. The 19 November publication
passed its reference check in the authenticated private page and API. It showed
2 active accounts and 9 confirmed outcomes, both with partial coverage. One
collector execution made one source request. Reopen and two Refresh requests
returned the same publication, with zero additional jobs or source requests.
[Queue repair and pilot scope](https://github.com/hushh-labs/hussh-matrix-dashboard/issues/184#issuecomment-7051822993)
[Acceptance receipt](https://github.com/hushh-labs/hussh-matrix-dashboard/issues/184#issuecomment-7058423975)

The public rollout has its own candidate and acceptance. PR #257 merged as
`4ef2eaaaccf0b8a3340d733216424f3be9cd830e`. The release owner staged a zero-traffic
revision with BigQuery off. PR #258 corrected standalone browser verification
and merged as `18c737a6dcbd61ce0cc198db39681d856286db74`. The existing release on
that commit passed browser tests from a clean checkout, built one image and
passed the isolated renderer check. Revision `hushh-matrix-dashboard-00459-qim`
is Ready at zero traffic with BigQuery off. The release stopped at the runtime
configuration gate because 18 retained-report settings were inherited as plain
values. The preceding revision `hushh-matrix-dashboard-uatmanual-66bf686d` still
served 100%. Preserve the retained settings and correct their representation
before running the existing release checks again. The documented release also
requires a monitored staff Google sign-in on the canonical domain and an exact
prior traffic split for rollback.
[Canonical release](https://github.com/hushh-labs/hussh-matrix-dashboard/actions/runs/44874358483)

The candidate also disabled hosted PLG UAT because its release variable was
unset. `ONE_PLG_HOSTED_UAT_VIEW_CONFIGURED=true` now restores the required
setting for the next release. Both existing UAT read secrets have one enabled
version, which matches the current serving references. The failed candidate is
immutable and still has the UAT workspace disabled.

Run the read-only recovery preflight with current Cloud Run service and revision
metadata before commissioning another build. For this recovery the reviewed
image and rollback split come from run `44874358483`. The check prints binding
names and release state only. It does not fetch secret contents, create a
revision or move traffic.

```powershell
$scope = @('--project=hushh-ai-prod', '--region=us-central1', '--format=json')
$rawService = gcloud run services describe hushh-matrix-dashboard @scope
if ($LASTEXITCODE -ne 0) { throw 'Could not read the Metrics service' }
$service = ($rawService -join "`n") | ConvertFrom-Json
$tag = @($service.status.traffic | Where-Object tag -eq 'release-candidate')
if ($tag.Count -ne 1) { throw 'Expected one release candidate' }
$rawRevision = gcloud run revisions describe $tag[0].revisionName @scope
if ($LASTEXITCODE -ne 0) { throw 'Could not read the candidate revision' }
@{
  service = $service
  candidate = ($rawRevision -join "`n") | ConvertFrom-Json
  expectedImage = 'us-central1-docker.pkg.dev/hushh-ai-prod/website-images/hushh-matrix-dashboard@sha256:a5dff98506c2e5d34190d09919d9f3594d7459e6888fa2fd6441384a8ef86e58'
  expectedTraffic = 'hushh-matrix-dashboard-uatmanual-66bf686d=100'
} | ConvertTo-Json -Depth 100 -Compress | node scripts/check-metrics-production-recovery.mjs
if ($LASTEXITCODE -ne 0) { throw 'Production recovery preflight failed' }
```

The preflight checks references and live traffic, so the release owner still
needs to preserve the exact existing values, confirm Secret Manager access for
the runtime and complete the canonical release checks. Use the captured serving
split for rollback during staff sign-in verification.

The existing pre-build check also detects inherited plain values for these
retained report settings. It stops the run before Cloud Build. The final
runtime verification, OAuth checks and traffic controls remain required.

### Live recheck and candidate preflight

- The first read after idle returned HTTP 503 in 7.23 s. For that request window,
  the collector completed its read with HTTP 200 in 8.66 s, after the web
  response. The next read returned the original 19 November publication with
  the same counts and partial coverage. The retry's HTTP round trip took 1.04 s.
  This is a cold-read failure to resolve before accepting the
  private pilot's availability. Qualify the existing scale-to-zero image and
  a bounded web-to-collector deadline within the web service's 15 s request
  limit. Preserve the source-call allowance. Repeat cold and warm reads and
  verify no collection, source call or publication replacement.
- The private One policy rejected the tested 7-, 14-, 30- and 90-day periods
  with HTTP 400. The separately gated Website report returned HTTP 503. The
  recheck initiated zero job submissions, collection executions and One source
  calls. Production historical-range controls passed against browser fixtures;
  live historical totals need separate verification.
- The unchanged runtime verifier rejected the deployed candidate with 18 plain
  settings. In an in-memory preflight with the live service metadata, projected
  Secret Manager references alone exposed the hosted-UAT mismatch. Projecting
  both the references and the serving UAT settings made the verifier pass.
  This validates the configuration shape. The new references, their values and
  the replacement revision still need live owner-side validation.
- The current serving site and zero-traffic candidate both passed anonymous
  OAuth boundary checks. The hosted UAT page redirected to login and its
  evidence API denied anonymous access. These checks establish access controls.
  Staff Google sign-in and the signed dashboard gate still need verification.
- The full local pass covered 107 browser tests and 1,186 unit tests (44
  skipped). The source inventory accounted for all 64 dashboard feature rows and
  12 capabilities. At Research commit `8bb6d7dab387adf2ad481e18f23f6c7a8035e928`,
  15 rows had no matching web runtime reference in that inventory, including
  Mail sign-in screen views, inbox views, receipt categorization and six KYC
  actions. Deployed emitter and live report coverage remain separate checks.

Website Activity code is merged in Metrics and the website source repository.
The Website UAT service has rolled back from revision `rc4b84bf649b2-6426183e`.
Its serving revision `rb01aafdbec73-8345876c` enables legacy telemetry and lacks
the new capture settings. Reconcile one closed website period in an isolated
pilot before expanding agents, historical reports or scope. The operating-policy
review covers ongoing collection, source limits and any bounded warehouse work.
[Release sequence](https://github.com/hushh-labs/hussh-matrix-dashboard/issues/184#issuecomment-7052503024)

## Earlier implementation evidence

The later held `metrics.reliability` increment adds a bounded native Cloud
Monitoring source for the existing Metrics hosting service. It preserves missing
data as unknown, refuses incomplete/continued responses, and shares the existing
durable source-call journal and explicit budget admission. No IAM, policy, source
activation, schedule or serving change follows. Ratios/latency remain unavailable
until their additional completeness/distribution evidence is established. See
[the reliability contract](./metrics-reliability.md).

Latest 14 November continuation: a separately defined warehouse-free website
activity adapter, durable source-read budget and bounded explicit Refresh are
implemented locally. See [definition, controls, evidence and activation gaps](./website-activity-and-refresh.md).
The corresponding website source is default off in a separate local branch;
neither it nor this application increment is live. Refresh is requested for
the final rollout; old schedules remain paused until accepted source/policy and
runtime qualification. Prior exact-head CI below does not certify newer source.
The later [operational forwarding boundary](./operational-forwarding.md) now
implements held OAuth/PLG/callback/assets routes without a provider-path fallback.
Its actual Express OAuth protocol test passes with Google exchange stubbed;
native shared-domain/legacy-UI handoff and resource wiring are not accepted.

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
  A reviewed closed date range is now required for GA4 collection; an old
  coverage start cannot silently extend past a provider pause/emitter change.
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
  Native ProtoJSON empty results decode only with response identity, matching
  timezone, quota receipt and consistent empty fields; empty suppressed/lossy
  responses remain unavailable. Provider-recorded zero is not actual zero
  visitors or emitter/reconciliation acceptance.
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
2. One aggregate source #9516 is merged into Dev at `8201d101`, with exact-head
   backend/native-database/merge-queue CI passed. It is not deployed or enabled;
   independent fixed-period reconciliation and production capacity remain open.
   The current website's public policy is first-party-only with GA4 paused.
   Its audited product-event persistence uses BigQuery, not an established
   warehouse-free aggregate. A source-owned decision/reconciliation is required;
   first-party events cannot be relabelled GA4 sessions/users. The separately
   observed website backend has telemetry enabled; actual writes/spend and its
   serving source provenance remain unverified. Metrics containment is retained.
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
Modeled operation/recovery measurements: [offline workload](./workload-measurement-20261114.md).
