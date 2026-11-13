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
`METRICS_SCOPE_DIGEST`, plus an explicitly configured
`METRICS_REPORTING_PROJECT` / `METRICS_REPORTING_DATABASE` (`metrics-*`). No PLG
database fallback, provider token, warehouse permission or source SDK is used.
Deploy these through secret-backed configuration only after the reviewed IAM
and operational-routing handoff. Do not copy legacy provider credentials.

The web reader's Firestore identity needs only report/control reads plus the
quota writes used for admission. Worker publication and source receipts need a
separate identity. A namespace alone is not database IAM isolation. Infrastructure
and permission design remain a deployment prerequisite; nothing is provisioned
by this implementation.

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
uncertainty. `collectReport` makes source calls outside Firestore transactions.
The One/GA4 adapters use a durable source-call receipt before I/O. Lost source
acknowledgements stay delayed; redelivery recovers a stored receipt and never
silently repeats a provider call. The One aggregate endpoint is a proposed
backend contract, **not a deployed endpoint**. No existing private owner export
is used as a substitute. GA4 requires a verified timezone and information
watermark; a fresh fetch alone cannot establish source freshness.

Task dispatch, scheduled/custom fairness, source circuit/backoff, reference-aware
cleanup, approved policy values and live reconciliation are not yet implemented
or accepted. There is no collector entrypoint or active cloud schedule. The
production build and synthetic tests establish local plumbing only.
