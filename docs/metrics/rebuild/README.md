# Metrics reporting rebuild

Tracking: [#184](https://github.com/hushh-labs/hussh-matrix-dashboard/issues/184).
Owner: Neelesh Meena. Technical lead: Kushal Trivedi.

This is the review packet for definitions and collection policy. It does not
authorize collection, warehouse access, retirement of PLG, or release of the
incident hold. Definition review and runtime acceptance remain outstanding.

Read in order:

1. [Metric catalog](./metric-catalog.md): questions, populations and reconciliation.
2. [System and compatibility map](./system-map.md): existing consumers and cutover.
3. [Operating policy](./operating-policy.md): enforced containment and measurements.

## Evidence baseline

Source baseline is Main `f835c5d31a5ef8456c7561556673fdbe24e3a53c`.
The 13 November 2026 read-only audit found the shared Metrics service Ready,
generation 374, serving `hushh-matrix-dashboard-plg-uat-20261109` at 100%.
`METRICS_BIGQUERY_ENABLED=false`. Deployment workflow is `disabled_manually`
and `METRICS_DEPLOYMENT_HOLD=true`. Search Console ingestion, PLG sync and Dev
attempt mail schedules are paused. The independent UAT attempt mail schedule
is enabled and its job is Ready at generation 4 on reviewed source `7514eea4`.
These are observations at audit time; operators must reread before mutations.

The existing Express application invokes source loaders on process-cache misses.
It has no durable published-report boundary. Its dated source inventory includes
historical proposals, not accepted current definitions. New definitions below
supersede incompatible proposals only for the replacement's reports.

The three pinned Research references in #184 were read. Cache scope, generation
fences, thin routes and standalone output are relevant patterns. Research's
native, vault, branch and release rules do not become Metrics requirements.
The observability documents linked by #28 have moved to
`docs/operations/observability/` and `docs/development/quality/` in Research.
Current event emitters still need source- and release-specific verification.

## Delivery ledger

| Phase | State | Required exit |
| --- | --- | --- |
| Definitions, map and policy | Proposed for review | Lead accepts definitions and measurement-based operating limits |
| Metrics identity | Pending | New application says Metrics; compatibility references inventoried |
| One and website reporting slice | Pending | Reconciled sources → immutable publication → authenticated Next.js view |
| Remaining reports | Pending | Every metric has approved definition, coverage and freshness |
| Qualification | Pending | Production-build correctness, recovery, performance and cost evidence |
| Cleanup | Pending | Consumer review, protected references, measured savings |
| Release | Held | Existing release controls, verified serving behavior and rollback |

Do not close #28, #48, #126 or Research #8248 as a consequence of this rebuild.
PLG's incomplete Consent creation and Documents acceptance remain recorded in
#126. Mocked or synthetic evidence does not establish live-source correctness.
