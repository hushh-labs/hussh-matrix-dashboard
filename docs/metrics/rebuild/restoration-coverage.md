# Existing sections and restoration coverage

14 November 2026 IST. This inventory preserves the user's requirement to restore
the familiar sections, date selection and legitimate sources. It does not accept
old totals as a correctness baseline or authorize restarting old source loaders.
Legacy source/runtime files remain unchanged and serving while #184 progresses.

## Every existing navigation surface

Source: `src/lib/dashboard-navigation.ts`, `src/Dashboard.tsx` and `server.ts` at
application head `9510cba79cb2b7c0eaa6d56b831d1e513800c32d`.

| Existing section | Existing reader / source boundary | Replacement coverage and required restoration proof |
| --- | --- | --- |
| Overview (`briefing`) | `/api/analytics/founder`; `FounderBriefingPanel`, founder period definitions and source calculations | Not replaced. Account/feature/day/platform/outcome and search totals need versioned, independently reconciled publications. Retain single-day/completed-range selection; incomplete outcomes cannot become successes. |
| Website traffic (`overview`) | `/api/analytics/all?view=overview`; One production/UAT feed/export, hushh.ai Data API, HushhTech public summary/backend, Monitoring and Search Console | Only the held hushh.ai four-metric adapter is implemented. Every additional source/card needs its own period/population/quality contract. The original API currently fans out to source loaders on cache misses; it is not the new publication reader. |
| Growth (`growth`) | `/api/analytics/all?view=growth` and `/api/analytics/growth`; One exports, registrations and growth calculations | Not replaced. Acquisition, activation, retention, cost and daily measures need compatible populations/denominators and whole-window distinct counting. Anonymous devices remain separate from identified accounts. |
| Compare periods (`compare`) | `/api/analytics/growth/compare`; 30-day/90-day/history source windows | Not replaced. Each non-additive period requires its own reconciled result; daily distincts cannot be summed into history totals. Preserve requested period/freshness and expose known historical gaps. |
| One app (`one`) | `/api/analytics/all?view=one`, `/api/analytics/one/app`, production/UAT account sources, exports and related health | The held two-metric One aggregate adapter is proposed, but the source endpoint is not established. Registrations, claims, per-capability adoption/outcomes, installations, identities and platform breakdowns are not supplied by that stub. Product backends retain account/consent/outcome authority. |
| Referrals (`referrals`) | `/api/analytics/one/referrals`; viewer-permitted individual/circle rankings, separate from the shared aggregate cache | Preserve its authenticated operational route/owner. Person-level rankings must not be copied into reporting snapshots or public/shared caches. Not part of the read-only aggregate rebuild's source inventory. |
| Hussh Connect (`apps`) | `/api/analytics/all?view=apps`, `/api/analytics/app-store-connect`, `/api/analytics/one/android`; existing iOS/Android/web and environment boundaries | Not replaced. App Store Connect analytics, Android reporting, installs, native/web accounts and usage retain their distinct units and release scopes. Downloads/devices are not account registrations. |
| Instagram (`instagram`) | Private `/api/analytics/instagram`; existing Graph observations persisted through `BigQueryInstagramStore` | Preserve stored observations and operational sync/auth dependencies. Its current read path is warehouse-backed; BigQuery stays off. A reviewed retained aggregate publication/storage handoff is needed before restoration; never replace missing observations with zeros or auto-run `/api/instagram/sync` on page reads. |
| Data sources (`platforms`) | Same overview payload with source status/freshness/coverage cards | Not replaced. Report source status, watermark, computation/publication time and unavailable/partial coverage independently. A successful HTTP check or configured key does not establish working measurement. |
| Growth workspace (`plg`) | `/plg/*`, `/api/plg/*`, `/integrations/plg/*`, callbacks/preferences/unsubscribe and independent UAT worker | Preserve #126 operational ownership, current identities, signing/budget namespaces and accepted worker image. No migration into aggregate reporting and no email/replay action follows from this rebuild. |
| One Location (separate navigation) | Existing Location route/funnel/feature/journey analysis and its environment-scoped source contract | Preserve existing route. Attempts, retries, permissions, circles, sharing and confirmed outcomes remain distinct. Location's full report is not covered by the new two-report slice. |

## Source preservation and safe restoration

- One production/UAT export datasets and their existing public feed VIEW resources
  were found through metadata only. The sampled 5 November event tables exist.
  Table-name inventories run through 10 November and contain known older gaps;
  neither inventory proves complete historical rows or current collection.
- Existing PLG Firestore database has deletion protection and point-in-time
  recovery enabled. Its data, budget reservations, worker, indexes, keys and
  retention have not been changed by this rebuild.
- Keep the existing OAuth callback and session-cookie compatibility, private
  routes, source credentials, images and rollback anchors until each consumer's
  handoff is accepted. The Next.js web identity receives no source credentials.
- Hushh.ai's property and website stream are now confirmed by read-only Admin
  API, including exact `Etc/GMT` timezone. One fixed-period report returned no
  metric columns/rows; no counts are accepted from it. See
  [source evidence](./source-verification-20261114.md).
- Current `www.hushh.ai` redirects to `www.hussh.si`. Its source/property mapping
  and reporting scope need review; the old host filter must not be silently
  broadened or historical data relabelled as the new domain.
- HushhTech public summary, its database aggregate, Monitoring, Search Console,
  App Store Connect and Instagram remain separate source verifications. A
  configured environment variable is not accepted source authority or freshness.
- No backfill, source scan, new snapshot copy, retention change, data deletion,
  scheduler activation or warehouse access follows from this inventory.

## Serving acceptance

The first two-report collector/store/web slice must be accepted before expanding
under #184. It cannot replace all existing sections yet. Completion requires
explicit accepted coverage for every in-scope section above, preserved operational
routes, current source/reconciliation evidence, measured operating policy and
exact-source serving/rollback proof. Unsupported metrics stay unavailable with
their period/coverage explanation. Existing source files and stored history are
retained throughout this staged restoration.
