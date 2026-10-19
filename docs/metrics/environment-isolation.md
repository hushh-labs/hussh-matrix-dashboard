# One environment reporting isolation

This implementation is the reporting/containment foundation. It does not switch
Firebase authority, move customer data, publish a mobile update or certify that
all staff identities have been classified.

## Reporting contract

`src/server/one-scope.mjs` owns the environment predicate. One product facts
require the selected `env`, exact web host and stream or native package and
stream, and absence of debug mode on every platform. Missing and conflicting
provenance is excluded from business totals. The same predicate covers app
summaries, current and historical account windows, Overview, Growth, founder
reports, AI snapshots and generated aggregate feeds. Marketing acquisition
retains a separate web-only denominator.

Referral reporting uses the existing separate database connections. Before
opening a pool, it validates the selected secret's instance and database against
the environment contract; a UAT secret pointing at PROD is refused. This does not
install or modify referral functions, credentials or customer records.

Global account totals use distinct stable account IDs across platforms, never
the sum of platform rows. App/browser IDs and sessions retain separate labels.
Backend scope is not proof of external-customer ownership or unique humans.

The legacy store builds can send UAT-tagged events into a production analytics
property. They cannot qualify as PROD usage. Collection mismatch diagnostics are
labelled separately; UAT reports never substitute production totals. Full legacy
UAT coverage requires verified binary/stream provenance before a migration or
historical model can be certified.

## Account registry configuration

| Setting | Meaning |
| --- | --- |
| `ONE_PROD_FIREBASE_AUTH_PROJECT` | Existing production authority; legacy `ONE_FIREBASE_AUTH_PROJECT` remains a fallback for PROD only |
| `ONE_UAT_FIREBASE_AUTH_PROJECT` | Explicit UAT authority; empty never falls back to production |
| `ONE_PROD_ACCOUNT_REGISTRY_SCOPE` | Defaults to `legacy_shared` |
| `ONE_UAT_ACCOUNT_REGISTRY_SCOPE` | Defaults to `unverified` |

`isolated` is an operational acceptance assertion, not an automatic inference
from a project name. Both projects must be configured and different. Before
declaring PROD isolated, audit historical shared-directory membership and the
internal-account cohort. Moving UAT alone does not clean the existing registry.
Unverified registry counts and daily registrations are null, with a reason;
they are never copied into both environment cards. Cache and in-flight request
keys include both authority mappings, scope, environment and date range.
Public responses identify the authority by a stable SHA-256 reference. The
independent reconciliation probe derives that reference locally; internal project
names continue through the existing public-payload sanitizer.

Store runtime configuration in Secret Manager. Do not commit identities or
credentials. The aggregate API exposes only counts and public source metadata.

## Aggregate view deployment

`node scripts/render-one-feed-scope.mjs --write` updates the generated predicate
in `sql/kai_public_dashboard_feed.production.sql`. The exported
`renderOneFeedSql('uat')` derives the UAT view using the same contract and UAT
lineage. Apply reviewed view definitions separately from code deployment.

Every feed row must name the requested environment, with exactly one matching
`source_environment` status marker and one `reporting_scope_version` marker.
Unversioned, duplicate or contradictory feeds are withheld, including the CLI
fallback path. An edited SQL file is not proof that a live view was changed.
If PROD and UAT are configured to the same aggregate source, both are withheld;
source inference must never relabel a production feed as UAT.

Automatic SDK first opens historically lack backend provenance. Their absence
after filtering cannot establish zero installs or retention. First opens and
retention are withheld until acquisition coverage is verified. Existing source
timezones are retained; this change does not claim that all historical daily
series have been normalized to a new reporting timezone.

## Verification and cutover gates

- `npm test`, `npm run lint`, `npm run build` and responsive UI checks.
- `npm run test:metrics:feed-scope` checks generated view parity.
- `npm run test:metrics:environment-fixtures` executes real BigQuery SQL against
  synthetic rows only. It proves exact PROD/UAT platform selection and one
  account across three platforms without querying customer tables.
- Existing platform, iOS, public-contract and KPI probes enforce the revised
  environment contract. Registration reconciliation checks each configured
  authority independently.
- Before claiming cutover completion, run
  `npm run test:metrics:one-registered-accounts -- --require-isolated` with the
  deployed source configuration. Ordinary containment can pass with safely
  withheld legacy counts; `cutoverReady` remains false.
- Independently verify installed binaries, live streams/exports and views,
  internal classification coverage, source timezone/coverage, cross-realm token
  rejection, legacy customer recovery and finalized-day reconciliation.

The application repository owns the matching identity/release changes. Preserve
existing PROD UIDs, encrypted data and key relationships. Do not repoint old UAT
clients or resume unscoped legacy cleanup jobs under a new Auth authority.
