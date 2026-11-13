# Current system and compatibility map

Source baseline: Main `f835c5d3`, inspected 13 November 2026.

| Boundary | Existing implementation | Replacement / compatibility obligation |
| --- | --- | --- |
| Web | Vite React `src/Dashboard.tsx`, Express `server.ts`, root Dockerfile Node 22 | Next.js App Router standalone web application. Keep legacy service serving until routing and dependencies are accepted. |
| Report routes | `/api/analytics/all`, founder, growth, One/Kai aliases, app, ga4, Android, hushhai, hushhtech, App Store Connect, Instagram | Published-report DAL and versioned reports. Inventory each route consumer before removal; legacy aliases cannot silently change metric meaning. |
| Source access | `server.ts` provider functions; `one-customer-cohort`, `one-account-scope`, `android-reporting`, `instagram` modules | Source-specific collector adapters. Web identity loses provider credentials only after legacy operational handoff. No source work from render or cache misses. |
| Cache | `AggregateCache` process LRU (100 route entries, 30 minutes); browser `metrics-resource` (48 entries, 30 minutes); other provider caches | Durable immutable reports and atomic pointers. Bounded server body cache checks current authority/pointer before reuse. Browser memory remains session-scoped. |
| Authentication | Google OAuth PKCE/state/nonce, verified-email allowlist/domain rules, signed `hussh_matrix_session`, host-only cookies | Preserve approved staff policy and `https://metrics.hussh.ai/auth/callback`. Cookie name is retained compatibility, not visible branding. No sign-in weakening or new OAuth client required by this plan. |
| Cost containment | `bigquery-cost-control.ts`: durable daily `metricsQueryBudgetDays` reservations in `one-plg-production`; queue/counters local to each wrapper instance in one process; new provider job ID per runtime invocation | Retain reservations/namespaces; BigQuery stays disabled. Cross-worker logical-job recovery and shared concurrency are replacement requirements, not inherited guarantees. No budget reset through rename, cache bust, expiry or retry. |
| HushhTech candidate source | `fetchHushhTechPublicAnalytics` in `server.ts` calls a public summary endpoint with only `Accept: application/json` and checks the returned window | Source authority, authentication/access contract, population/formulas and reconciliation pending. Neelesh gathers evidence and identifies the backend contract owner; existing values do not establish an accepted authenticated source. |
| PLG UI and APIs | `/plg/*`, `/api/plg/*`, including UAT workspace, own evidence and directory | Owned by #126. Keep current authenticated application and data boundaries operational during rebuild. Do not migrate private customer directories into reporting storage. |
| PLG integration | `/integrations/plg/*`, provider callbacks, signed sync, cycle, preferences and unsubscribe routes | Preserve exact URLs, token validation, origin and signing bindings. No routing cutover until negative auth, revocation and callback regression checks pass. |
| UAT mail | Private Cloud Run job `one-plg-attempt-mail-uat` and one-minute scheduler; source `7514eea4` at audit | Retain worker image, identity, source secret, mailbox control, dedup/uncertainty records and scheduler. The rebuild cannot remove its build inputs. |
| Persistence | Firestore `one-plg-production`; separate PLG namespaces, Terraform state and historical migration evidence | Add reporting namespaces only with scoped permissions. No database conversion, PLG collection rename or retention reuse. |
| Collection schedules | Three Search Console ingestion schedules, PLG sync and Dev mail paused; UAT mail enabled | Preserve incident state. Reporting schedules require accepted policy before activation. |
| Release | `.github/workflows/deploy-main.yml` disabled; hold true. Existing responsive/storage/infrastructure CI | Do not edit CI/CD. Use existing commands for checks. Surface incompatibilities before any release-control change. |

## Metrics naming and technical rename map

New visible application name, metadata, component symbols and package metadata use
**Metrics**. Existing identifiers below have active external consumers and stay
until a deliberate migration:

| Legacy identifier | Consumers / migration prerequisite |
| --- | --- |
| GitHub `hussh-matrix-dashboard` | Remotes, links, Actions references, WIF repository conditions, integrations; coordinate repository rename only after destination and bindings exist. |
| Cloud Run `hushh-matrix-dashboard` | Custom domain, OAuth callbacks, candidate/rollback checks, revision names; preserve serving URL and traffic ownership. |
| Registry image/repositories | Deployment scripts, UAT job, Dev qualification, rollback anchors; retain digest references until no consumers remain. |
| `matrix-*` service accounts / WIF provider | IAM, secret access, Terraform, Dev/UAT qualification; reviewed identity migration with rollback. |
| `hussh_matrix_session` | Existing browser sessions and auth checks; bounded compatibility until sign-in migration accepted. |
| PLG collections, budget and reservation namespaces | Active worker recovery/idempotency and historical spend; never rename by search/replace. |
| Historical issues, PRs, receipts | Acceptance history; retain original names and immutable references. |

## Cutover invariant

The reporting web runtime may read only reporting storage and its own auth config.
Do not point the shared domain at it until PLG UI/integration forwarding, current
authorization, callback paths and rollback have been verified. The first feature
build is independently runnable; it does not replace `npm start` or the serving
root image. No production route or operational workload is retired by that PR.
