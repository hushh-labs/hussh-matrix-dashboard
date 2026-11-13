# Metrics reporting rebuild

Tracking: [#184](https://github.com/hushh-labs/hussh-matrix-dashboard/issues/184).
Owner: [Neelesh Meena](https://github.com/DamriaNeelesh).
Technical lead: [Kushal Trivedi](https://github.com/kushaltrivedi5).

This is the review packet for definitions and collection policy. It does not
authorize collection, warehouse access, retirement of PLG, or release of the
incident hold. Definition review and runtime acceptance remain outstanding.

## Ownership and human-review status

This packet uses assisted drafting. Neelesh is responsible for reviewing, editing
and validating its reasoning and approving decisions within his authority; that
human approval has not been recorded. Assignment, a signed commit and automated
checks do not establish it. Kushal requested documentation corrections on
foundation head `bbc2fc31e99410a3c27c20e282cd048e903ff602` in
[review 5890330790](https://github.com/hushh-labs/hussh-matrix-dashboard/pull/185#pullrequestreview-5890330790).
Kushal approved the revised proposal packet at
`e41d134ac88a70c173aae92fd570d8ebeebbdaa3` in
[review 5895936005](https://github.com/hushh-labs/hussh-matrix-dashboard/pull/185#pullrequestreview-5895936005).
PR #185 merged into Main as `de0ad8142ba427ea4acbd74dd1893a8b3ea3a8dd`.
That approval accepts the proposal packet only: metric/source reconciliation,
measured operating limits and runtime acceptance remain pending. Collection
activation and deployment need separate acceptance; the cost hold stays active.
Draft #186's checks are separate implementation evidence, not those approvals.

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
| Definitions, map and policy | Proposal packet approved; metric/operating acceptance pending | Lead accepts definitions and measurement-based operating limits |
| Metrics identity | Pending | New application says Metrics; compatibility references inventoried |
| One and website reporting slice | Pending | Reconciled sources → immutable publication → authenticated Next.js view |
| Remaining reports | Pending | Every metric has approved definition, coverage and freshness |
| Qualification | Pending | Production-build correctness, recovery, performance and cost evidence |
| Cleanup | Pending | Consumer review, protected references, measured savings |
| Release | Held | Existing release controls, verified serving behavior and rollback |

Do not close #28, #48, #126 or Research #8248 as a consequence of this rebuild.
PLG's incomplete Consent creation and Documents acceptance remain recorded in
#126. Mocked or synthetic evidence does not establish live-source correctness.
