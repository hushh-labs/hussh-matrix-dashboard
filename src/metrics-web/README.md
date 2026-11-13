# Metrics web application

This is the held Next.js reporting replacement for #184. Root `npm start` still
serves the existing application and PLG operational routes. This application
does not replace them or release the deployment hold.

```
npm ci
npm run build
npm --prefix src/metrics-web start
```

Next.js 16.4.6 and React 19.3.1 are pinned in the application lock. Node 22 is
supported by the existing repository controls. The build is standalone, traces
shared server-only report modules and uses one build worker.

Root `npm run build` qualifies both legacy and replacement artifacts through the
existing CI command. `npm run test:ui` starts the standalone build alongside the
legacy UI and verifies authentication/availability. No workflow file changed.
`src/metrics-web/Dockerfile` is a separate candidate container, built from repository
root. It is not wired to the existing production image or deployment workflow.
The application stays under `src/**`, so the existing CI path filter covers
application-only changes without a workflow edit.

## Runtime contract

The existing signed `hussh_matrix_session` cookie remains compatibility input.
Each request verifies its MAC, expiry and current `ALLOWED_EMAIL_DOMAINS` /
`ALLOWED_EMAILS`. The web process needs `SESSION_SECRET` and
`METRICS_SCOPE_DIGEST`, BigQuery explicitly false and secret-backed
`METRICS_REPORT_WEB_CONFIG` (fixed private service audience, timeout/byte bounds).
No database fallback, provider token, warehouse permission or source SDK is used.
Deploy these through secret-backed configuration only after the reviewed IAM
and operational-routing handoff. Do not copy legacy provider credentials.

The web identity can invoke only the private reporting service; it needs no
Firestore grant. That service checks signed identity and route-specific roles,
then performs current-authority/quota/job/publication transactions in an isolated
reporting database. Source credentials stay in its execution identity. Native IAM
and routing remain deployment prerequisites; nothing is provisioned here.

The sign-in link currently uses the existing hosted Google flow. It does not
establish standalone OAuth/callback acceptance for a candidate hostname. The
shared-domain cutover must preserve that flow and all PLG routes before promotion.

No policy or live data is seeded. Missing configuration/publications produces an
honest unavailable view. There is no fixture fallback. All protected routes are
dynamic/private/no-store; only explicit GET form submission changes the selected
period. No client polling, prefetch or page render starts collection.

## Collection contract and current limitations

`MetricsReports` implements separate published reads, durable job admission and
status. `MetricsReportWorker` fences claims/publication and retains capacity on
uncertainty. `MetricsCollection` runs the bounded collector lifecycle outside
Firestore transactions, with source binding approval and shared circuit checks.
The One/GA4 adapters use a durable source-call receipt before I/O. Lost source
acknowledgements stay delayed. Recovery with no journal can admit the first call
through the current worker fence; an existing uncertain journal cannot cause a
repeat call. The One aggregate endpoint is a proposed
backend contract, **not a deployed endpoint**. No existing private owner export
is used as a substitute. GA4 requires a verified property/timezone and fixed-period
reconciliation. A missing information watermark stays partial/unknown freshness;
a fresh fetch cannot establish completeness.

The durable enqueue bridge now reserves a deterministic task identity, fences
competing dispatchers and bounds lookup recovery. Missing native tasks remain
uncertain because completed/exhausted tasks can also be absent. Credential and
configuration failures require attention; they do not become retry storms.
Its separate `policy/dispatch` must explicitly be approved/enabled. The fixed
Cloud Tasks adapter uses a job-only body and pins the native API, worker audience
and invoker identity. No queue or cloud identity is provisioned. The held
collector supplies ADC-bound native transport; web rendering cannot import it.
Queue uncertainty appears as delayed progress, with queue wait
separate from worker elapsed time; status tells callers to stop polling for
attention/terminal states.

Scheduled/custom capacity, per-staff custom limits, shared circuit/backoff and
bounded reference-aware maintenance are behind explicit approved policies. The
collector entrypoint has no automatic startup work; no cloud schedule is created.
Accepted limits, live native wiring, source reconciliation and deployment remain
pending. Build and synthetic tests establish plumbing, not live-data correctness.
See [collector integration](../../docs/metrics/rebuild/collector-integration.md).
