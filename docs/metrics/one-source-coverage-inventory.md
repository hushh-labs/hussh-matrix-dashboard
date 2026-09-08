# One / hushh.ai Metric Dictionary and Source Coverage Inventory

Status: first pass, evidence-backed. Produced for `hussh-matrix-dashboard#28`.

**Verification window (fixed, used for every count below): 2026-08-08 → 2026-09-06 UTC, 30 days.**
All counts were read directly from `hushh-pda.analytics_526603671` (the production GA4 export)
on 2026-09-07. Every number in this document is an aggregate. No identifiers, prompts, or
per-user rows are reproduced here.

This document is deliberately an inventory and a reconciliation, not a design. It records what
is collected, what the dashboard currently shows, and where the two disagree. A page returning
HTTP 200 is not proof that its metrics are correct, and neither is a chart.

---

## 0. Headline findings

Five things are true today that the repository's own documentation says are not.

1. **The production GA4 export has been live since 2026-05-01 and is fresh through 2026-09-06.**
   `hushh-pda.analytics_526603671` holds 129 `events_*` tables plus `events_intraday_20260907`,
   `users_*` and `pseudonymous_users_*`. The README's standing blocker
   ("GA4 export dataset not materialized") has been stale for roughly four months.

2. **The production `kai_public_dashboard_feed` view is a hardcoded stub.** Its SQL is a literal
   `UNNEST([STRUCT(...)])` that always returns `production_ready = FALSE` and the string
   *"Production GA4 export dataset hushh-pda.analytics_526603671 is not visible/materialized yet."*
   It reads no event table. Every production Kai number the dashboard renders from that feed is a
   constant, not a measurement. This is a view fix, not a dashboard fix.

3. **GA4 User-ID is bound on iOS and not on web.** Over the window, web produced 25,808 events
   from 412 distinct `user_pseudo_id` and **zero** distinct `user_id`. iOS produced 122,442 events
   from 102 pseudo-ids and 39 `user_id`s. Cross-surface identity stitching — the entire purpose of
   `hushh-webapp/lib/observability/identity.ts` — is non-functional on production web. Until that
   is fixed no person-level DAU/WAU/MAU is computable for web, and web and app user counts cannot
   be added together.

4. **The dashboard counts devices and labels them people.** Every One query uses
   `COUNT(DISTINCT user_pseudo_id)`; the One panel labels the result "Distinct people per platform".
   On the events where `user_id` is present the two disagree badly in *both* directions —
   `one_location_onboarding_completed` shows 13 pseudo-ids against 27 `user_id`s.

5. **hushh.ai website traffic is already sitting in a dataset the dashboard queries, and the
   dashboard does not use it.** `hushh.ai` and `www.hushh.ai` contributed 7,359 events from 150
   distinct devices to the *product* property over the window. Meanwhile `HUSHH_AI_GA4_PROPERTY_ID` is
   empty and the hushh.ai panel's product-event summary returns `not_configured` with null counts.
   hushh.ai acquisition can be reported today with a host filter and no new instrumentation.

---

## 1. Metric dictionary

Definitions below are proposals where the issue asked for a decision. Anything still genuinely
open is marked **UNRESOLVED** rather than silently defaulted.

### 1.1 Shared conventions

| Choice | Proposal | Rationale |
| --- | --- | --- |
| Reporting timezone | **UTC** | The GA4 export is partitioned by UTC `event_date`; a different reporting zone forces a per-query re-bucket and makes the daily tables non-authoritative. Label every window "UTC" in the UI. |
| Window type | **Rolling**, ending at the last *complete* UTC day | Calendar windows make the current period look like a collapse until it closes. The intraday table is available for a separately-labelled "last 24h" tile only. |
| 28 vs 30 day | Report **MAU-30** and label it "30-day active"; report **MAU-28** separately if a week-aligned comparison is wanted | Never print "MAU" unqualified. The two differ and the issue explicitly asks for accurate labelling. |
| Identity | **`user_id` where present, `user_pseudo_id` otherwise, and the mix disclosed** | See §1.2. A single blended count without disclosure is the thing to avoid. |
| Never | Sum daily unique counts to obtain WAU or MAU | Measured cost of this error in this window: **495 vs 359**, a 38% overcount. See §3.2. |

### 1.2 Unique-user identity — UNRESOLVED, and blocking

`user_pseudo_id` is a per-app-instance / per-browser id. `user_id` is the salted SHA-256 of the
Firebase UID set by `identity.ts`, and is the only person-scoped key available.

Measured over the window:

| Platform | Events | Distinct `user_pseudo_id` | Distinct `user_id` |
| --- | ---: | ---: | ---: |
| IOS | 122,442 | 102 | 39 |
| WEB | 25,808 | 412 | 0 |
| ANDROID | 1,048 | 1 | 0 |

Two independent problems:

- **Web binding is dead.** 412 web users, zero `user_id`. `applyWebUserId` requires `window.gtag`
  and a resolvable measurement id; one of those is not being satisfied in the production build.
  This needs to be confirmed and fixed in `hushh-research` before any person-level web metric is
  published.
- **On iOS the two ids are not nested.** For several events distinct `user_id` *exceeds* distinct
  `user_pseudo_id` (`one_location_onboarding_completed`: 13 vs 27; `account_delete_completed`:
  9 vs 20; `one_location_setup_completed`: 10 vs 22). That is many accounts on few devices, i.e.
  QA/demo devices, and it means the current pseudo-id counts *understate* people on exactly the
  One Location events the dashboard leads with.

**Recommendation:** publish device-scoped counts labelled "devices/browsers" until web User-ID is
fixed, and publish person-scoped counts only for iOS with an explicit coverage note. Do not blend
the two into one "people" number.

### 1.3 DAU / WAU / MAU

**Meaningful activity (proposed):** a One-surface event that is not machine-generated. Excluded:
`api_request_completed`, `warmup_completed`, `startup_readiness_warmup_completed`,
`cache_resource_resolved`, `route_readiness_completed`, `route_refresh_completed`, `web_vital`,
`session_start`, `first_visit`, `first_open`, `user_engagement`, `notification_receive`,
`notification_dismiss`, `notification_foreground`, `app_update`, `os_update`, and
`one_location_foreground_retry` (a geolocation retry, not a use).

| Metric | Definition | Query basis | Dashboard field today | Gap |
| --- | --- | --- | --- | --- |
| One DAU | Distinct actors with ≥1 meaningful One event in one UTC day | `analytics_526603671.events_*`, One surface filter | **none** | One panel has no DAU/WAU/MAU at all |
| One WAU | Distinct actors over the trailing 7 complete UTC days | same | **none** | not built |
| One MAU-30 | Distinct actors over the trailing 30 complete UTC days | same | **none** | not built |
| Kai DAU/WAU/MAU | `current_dau` / `current_wau` / `current_mau` from the public feed | `analytics_public.kai_public_dashboard_feed` | "DB DAU/WAU" tiles | Production view is a stub (§0.2). UAT view not readable with current credentials (§5). Underlying definition of `current_*` is **UNRESOLVED** — it is not documented anywhere in either repo. |

Measured for the window, One surface (native + `one.hushh.ai`), device-scoped:

| Basis | MAU-30 | WAU-7 | DAU (2026-09-06) |
| --- | ---: | ---: | ---: |
| All One events (what the panel's totals use today) | 359 | 92 | 17 |
| Meaningful events only | 358 | 92 | 16 |

Note honestly: the exclusion list barely changes *user* counts, because almost anyone who fires
a background event also does something real. It changes *invocation* counts enormously — see §1.5.
The exclusion list matters for "agents used", not for DAU.

### 1.4 Agents claimed — NOT MEASURABLE TODAY

There is **no claim event anywhere in the codebase.** The phrase in the product is
`onboarding.claim_one` — a voice/CTA action id on the public intro screen
(`hushh-webapp/components/onboarding/IntroStep.tsx`: *"the person can claim their private agent
and continue to sign in"*). It is a button target, present in
`app/page.voice-action-contract.json` and the generated surface map. It emits no analytics event
and writes no business record on click.

Distinguishing the five things the issue asks to separate:

| Concept | Authoritative record today | Status |
| --- | --- | --- |
| Owner (a person who has an agent) | Firebase/Supabase account rows | Exists, **not wired to the dashboard** |
| Agent instance | per-user Cloud Run pod, keyed by HusshID (`consent-protocol/scripts/ops/pod_lifecycle_drill.py`) | Exists as a provisioning mechanism; **no queryable registry of provisioned pods was found** |
| Claim event | — | **Does not exist.** Needs either an emitter or a decision to derive claims from account creation |
| Provisioned pod | Cloud Run services in the pod project | Enumerable via the Cloud Run API; **not currently read by the dashboard** |
| Currently active agent | — | Undefined; depends on the pod registry above |

**Recommendation:** do not put an "agents claimed" tile on the dashboard yet. Decide first whether
a claim is (a) account creation, (b) first successful auth, or (c) pod provisioning, then either
emit a dedicated event or read the authoritative business record. Option (c) is the only one that
matches the word "claimed" as the product uses it, and it is a business record, not telemetry.

### 1.5 Agents used — measurable, but the current number does not mean what it says

The dashboard derives agents from event-name prefixes in `ONE_AGENT_CASE_SQL` (`server.ts:1727`).
Replaying that exact CASE over the window on the One surface:

| Dashboard "agent" | Devices | `user_id`s | Events | What it actually counts |
| --- | ---: | ---: | ---: | --- |
| Sign-up & onboarding | 124 | 21 | 697 | auth + phone verification + onboarding. Reasonable. |
| Kai | 41 | 34 | 889 | 78% of the events are `market_insights_loaded`, a **load-health** event, not a use |
| Nav / Consent | 40 | 33 | 1,714 | includes the warm prefetch — see below |
| One Location | 16 | 28 | 1,752 | **1,242 of 1,752 events are `one_location_foreground_retry`**, a geolocation retry |
| Email | 9 | 6 | 12 | `gmail_receipts_loaded` + `hushh_mail_signin_screen_view` |
| Agent chat | 5 | 4 | 10 | **only `agent_pkm_context_resolved`** — a PKM diagnostic |
| Vault / World model | — | — | — | **Always empty.** No `pkm_*` or `vault_*` event is emitted anywhere |
| RIA | 1 | 0 | 15 | `ria_onboarding_submitted` only |

Three specific defects, each with a measured size:

- **"Agent chat" is not agent usage.** The One app emits no agent invocation event. `agent_%`
  matches exactly the three `agent_pkm_*` reliability events, of which only
  `agent_pkm_context_resolved` fired. "5 people used Agent chat" is really "5 devices had PKM
  context resolve". A real `agent_turn_completed`-style event is the single highest-value missing
  emitter in the whole inventory.
- **"Nav / Consent" counts a background prefetch.** `consent_pending_loaded` carries `load_surface`
  precisely to separate a real screen view from the unlock warm prefetch, and the dashboard ignores
  it. Split by that param: `screen` 721 events / 12 devices, `warm` 215 / 14, and `NULL` 778 / 28
  (emitted before the param shipped). Filtering to `load_surface = 'screen'` takes the bucket from
  **40 devices to 12**.
- **"One Location" is dominated by a failure signal.** Excluding `one_location_foreground_retry`
  leaves 510 events. The retry event is a reliability metric and belongs on the operational panel,
  not in an adoption bucket.

**Recommendation:** replace the prefix CASE with an explicit event→capability map maintained
against `hushh-webapp/lib/observability/events.ts`, and report three separate numbers per
capability — distinct actors, distinct agent instances, successful invocations — rather than one
"users" number. Show "Vault / World model" as *not instrumented*, never as 0.

### 1.6 hushh.ai website

hushh.ai is tagged with `G-PPEF1CSJ5H` (`hushh.ai-website/src/app/sitemetadata.jsx`), which matches
`HUSHH_AI_GA4_MEASUREMENT_ID` in `.env.example`. But `HUSHH_AI_GA4_PROPERTY_ID` is **empty**, so the
dashboard makes no GA4 Data API call for hushh.ai, and `buildHushhAiProductEvents` (`server.ts:3386`)
returns a fixed list of seven aspirational event names — `signup_started`, `signup_completed`,
`login`, `cta_clicked`, `demo_requested`, `contact_submitted`, `product_page_viewed` — every one with
`status: 'not_configured'` and `count: null`. **None of those seven event names is emitted anywhere
in any repository.** They are a wish list, not a taxonomy.

What is actually collected on hushh.ai hosts, in the product property, over the window:

| Event | Events | Devices |
| --- | ---: | ---: |
| `web_vital` | 3,703 | 148 |
| `session_start` | 1,394 | 147 |
| `user_engagement` | 755 | 117 |
| `first_visit` | 1,085 | 108 |
| `cta_click` | 137 | 18 |
| `site_search` | 203 | 6 |
| `search_submitted` / `search_completed` | 23 / 19 | 4 / 4 |
| `google_sign_in_started` / `_completed` / `_failed` | 8 / 4 / 4 | 3 / 2 / 1 |
| `doodle_shown`, `gemma_status_checked` | 12 / 12 | 4 / 4 |

Top page groups, counted as distinct devices over the whole window rather than summed across
rows: `/` 75 devices (2,487 events), `/one*` 42 devices (1,186 events, covering `/one`,
`/one/puppy`, `/one/roadmap`, `/one/uae`, `/one/factory`, `/one/kyc`), `/careers*` 30 devices
(715 events). Also present: `/research/*`, `/demo`, `/app`, `/privacy`, `/champions/*`.

Two things to note before building anything on this:

- **`page_view` is absent for hushh.ai hosts.** Zero over the window, against 1,269 for
  `one.hushh.ai`. Automatic events (`session_start`, `first_visit`) arrive but page views do not.
  Acquisition and engaged-visitor metrics cannot be built until this is understood — it is likely
  the two-property split (page views going to `G-PPEF1CSJ5H`, custom events to `G-2PCECPSKCR`),
  which must be confirmed against the live domain-to-deployment mapping, not assumed.
- **A usable conversion funnel exists in principle** — `/` → `/one` → `cta_click` →
  `google_sign_in_started` → `google_sign_in_completed` → arrival on `one.hushh.ai` — but the last
  hop cannot be joined, because web `user_id` is empty (§1.2) and anonymous website traffic must
  not be merged with authenticated One usage without an approved basis. Report the two sides
  side by side, unjoined, and say so.

---

## 2. Instrumentation reconciliation

### 2.1 Declared vs emitted vs observed

`hushh-webapp/lib/observability/events.ts` declares 70 event names. Comparing that list against
call sites and against what actually landed in BigQuery:

**Declared but never emitted (3).** `ria_verification_status_changed`, `ria_request_blocked_policy`,
`mcp_ria_read_tool_called`. The event matrix documents the first as emitted from
`app/ria/onboarding/page.tsx`; that is now stale. The other two are already flagged
"declared only" in the matrix. Zero rows in BigQuery for all three. Do not build tiles on them.

**Observed in BigQuery but not in the declared taxonomy (12+).** `web_vital`, `cta_click`,
`site_search`, `search_submitted`, `search_completed`, `notification_receive`,
`notification_dismiss`, `notification_foreground`, `notification_open`,
`hushh_mail_signin_screen_view`, `google_sign_in_started` / `_completed` / `_failed`,
`doodle_shown`, `gemma_status_checked`, `one_location_visit_rated`,
`one_location_review_handoff_opened`, `app_update`, `os_update`, `screen_view`. Some are GA4
automatic events; the rest are emitted outside the typed `trackEvent` path, which means they are
outside the governance the taxonomy exists to provide. `one_location_visit_rated` and
`one_location_review_handoff_opened` in particular are real One Location product events with no
schema entry.

**Documented but incomplete.** `docs/reference/operations/observability-event-matrix.md` covers the
Kai/investor/RIA era and omits the entire `one_location_*` family (13 events), `account_reset_*`,
and `startup_readiness_warmup_completed`. The issue's caution that One Location events extend
beyond the older funnel descriptions is confirmed.

### 2.2 Funnel dedup caveat

`growth.ts` enforces once-per-user milestones through `hasClaimedOncePerUser`, which reads
`hushh_growth_context_v1` from **localStorage**. That is once-per-browser-profile, not per account.
A user who signs in on two browsers, clears storage, or switches devices re-enters the funnel.
Step-to-step ratios remain readable; absolute funnel-entry counts are inflated by an unknown amount.
This must be stated as a definition note on any funnel view.

### 2.3 Surface filter — sound

`oneAppSurfaceFilter` admits native platforms plus web with `page_location` host = `one.hushh.ai`.
Audited over the window: every WEB event carries `page_location` (25,808/25,808) and every native
event carries none. There is no silent drop. The filter is correct and the reasoning in its comment
holds — it excludes 150 devices of hushh.ai marketing traffic that would otherwise inflate the
One denominator.

---

## 3. Source-to-dashboard reconciliation, 2026-08-08 → 2026-09-06

### 3.1 Surface totals

| Surface | Events | Devices | `user_id`s | In One panel? |
| --- | ---: | ---: | ---: | --- |
| `native:IOS` | 122,442 | 102 | 39 | yes |
| `web:one.hushh.ai` | 17,288 | 256 | 0 | yes |
| `web:www.hushh.ai` | 5,604 | 118 | 0 | no — correctly excluded |
| `web:hushh.ai` | 1,755 | 44 | 0 | no — correctly excluded |
| `web:uat.hushh.ai` | 1,052 | 14 | 0 | **no — but see §5** |
| `native:ANDROID` | 1,048 | 1 | 0 | yes |
| `web:hushh-pda.firebaseapp.com` | 101 | 26 | 0 | no — sign-in redirect |
| `web:ipl-arena.hushh.ai` | 8 | 2 | 0 | no |

### 3.2 Deduplication check

Sum of the 30 daily unique-device counts: **495**. True 30-day distinct devices: **359**.
Mean DAU: 16.5. The naive sum overstates by 37.9%. This is the check to keep in CI against any
future MAU implementation.

### 3.3 Freshness

| Source | Latest data | Lag | Notes |
| --- | --- | --- | --- |
| `analytics_526603671` daily | 2026-09-06 | ~1 day | expected for GA4 daily export |
| `analytics_526603671` intraday | 2026-09-07 | minutes–hours | `events_intraday_*`; the only basis for a "last 24h" tile |
| `searchconsole_searchconsole_hushh_ai` | 2026-09-04 | ~3 days | 31,867 rows, from 2026-04-27; export is healthy |
| `analytics_public.kai_public_dashboard_feed` (prod) | n/a | n/a | **constant stub, no freshness** |

---

## 4. Production / UAT separation

- **`uat.hushh.ai` traffic is landing in the production GA4 property**: 1,052 events from 14 devices
  over the window, inside `hushh-pda.analytics_526603671`. The One panel's host filter keeps it out
  of One numbers, but any query over that dataset that does not filter by host will include UAT
  activity in a production KPI. Every production query in `server.ts` that does not carry the One
  surface filter needs auditing for this.
- The property/stream matrix says UAT should route to property `533362555` in `hushh-pda-uat`.
  The presence of `uat.hushh.ai` rows in production means either the UAT web build resolves the
  production measurement id, or the host is served by the production deployment. This must be
  resolved at the source, not filtered around in the dashboard.

---

## 5. Access and configuration gaps found while verifying

| Gap | Evidence | Impact |
| --- | --- | --- |
| UAT BigQuery unreadable | `bq ls hushh-pda-uat:analytics_533362555` → `Access Denied: bigquery.tables.list` for the current ADC identity | The One UAT panel and every Kai UAT tile fail for this operator. Whether they fail for the deployed service account is untested. |
| `HUSHH_AI_GA4_PROPERTY_ID` empty | `server.ts:99` defaults it to `''`, and `.env.example` ships it blank — yet `scripts/check-hushh-ai-ga4-data-api.mjs:4` hardcodes `DEFAULT_PROPERTY_ID = '458078330'` | The property id is known; only the server is not given it. The hushh.ai GA4 card renders "not configured" for want of one env var. Confirm `458078330` is the live property, then set it. |
| `ONE_APP_*` undocumented | `server.ts:72-76` reads `ONE_APP_GA4_PROJECT`, `ONE_APP_GA4_DATASET`, `ONE_APP_GA4_WINDOW_DAYS`, `ONE_APP_UAT_*`, `ONE_APP_WEB_HOST`, `ONE_APP_UAT_WEB_HOST`; none appear in `.env.example` | The One panel silently falls back to the Kai production dataset. It happens to be the right dataset, which is why nobody noticed. |
| README inventory incomplete | README describes three products; the server also serves `/api/analytics/one` | Confirms the issue's note that the README is not a complete inventory |

---

## 6. Remaining gaps, by category

**Instrumentation** (owner: `hushh-research`)
1. No agent invocation event. Blocks "agents used" entirely. Highest value.
2. No agent claim event or queryable pod registry. Blocks "agents claimed" entirely.
3. Web GA4 User-ID binding does not fire in production. Blocks all person-level web metrics.
4. `one_location_visit_rated`, `one_location_review_handoff_opened` and the `google_sign_in_*`,
   `notification_*`, `cta_click`, `site_search` families emit outside the typed taxonomy.
5. Three declared-only events should be emitted or removed from the contract.
6. `pkm_*` / `vault_*` — declared as a dashboard bucket, never emitted.

**Access / configuration**
7. UAT BigQuery read access for the dashboard identity.
8. Set `HUSHH_AI_GA4_PROPERTY_ID` (candidate `458078330`, already hardcoded in the GA4 probe),
   and decide whether hushh.ai reports from the Data API or from a BigQuery export of
   `G-PPEF1CSJ5H`. This is close to a one-line fix and should be verified first.
9. Resolve `uat.hushh.ai` routing into the production property.
10. Document `ONE_APP_*` in `.env.example`.

**Aggregation**
11. Replace the production `kai_public_dashboard_feed` view stub with a real query over
    `analytics_526603671`. Single highest-impact change in this list.
12. Build One DAU / WAU-7 / MAU-30 with the agreed definitions and an explicit identity basis.
13. Replace `ONE_AGENT_CASE_SQL` with an explicit event→capability map; add the `load_surface`
    filter; move `one_location_foreground_retry` to operational.
14. Add a hushh.ai host-filtered acquisition query against the data already present.

**UI**
15. Relabel "Distinct people per platform" to match what is counted.
16. Surface definition notes, identity basis, source provenance and freshness per tile.
17. Render not-instrumented and stale distinctly from zero. `Vault / World model` showing nothing
    is the current worst case.
18. Add One DAU/WAU/MAU and capability drilldowns once §12–13 land.

---

## 7. Re-running these checks

`npm run test:metrics:one-reconciliation` runs `scripts/check-one-metrics-reconciliation.mjs`,
a read-only probe that reproduces every finding above against live data: export freshness, the
sum-of-daily-uniques dedup check, per-platform identity coverage, active users on both bases, the
agent-invocation gap, the consent prefetch split, UAT bleed into the production property, and
hushh.ai site traffic. It queries only; it writes nothing and prints only aggregates.

The four items that are *expected* to fail today — web User-ID, agent invocation events, UAT bleed,
hushh.ai `page_view` — are reported as `GAP` and do not fail the run, so the probe is green while
those remain open and goes red on a genuine regression. `--strict-gaps` enforces them, which is what
to use once each is fixed. `--json` emits machine-readable output for CI.

The probe uses a **rolling** window ending at the last complete UTC day, so its counts will drift
from the fixed 2026-08-08 → 2026-09-06 window pinned in this document. That is intended: the fixed
window is the audit record, the rolling window is the ongoing check. They are not expected to match.

## 8. How every number here was produced

Queries were run with `bq query --use_legacy_sql=false` against
`hushh-pda.analytics_526603671.events_*` with `_TABLE_SUFFIX BETWEEN '20260808' AND '20260906'`.
The One surface filter used throughout is the one in `server.ts`:
`platform IN ('IOS','ANDROID') OR NET.HOST(page_location) = 'one.hushh.ai'`.
The agent bucket table in §1.5 replays `ONE_AGENT_CASE_SQL` verbatim so the comparison is against
what the dashboard actually renders, not a paraphrase.
