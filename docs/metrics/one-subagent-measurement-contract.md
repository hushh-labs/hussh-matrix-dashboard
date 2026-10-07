# One subagent measurement contract

For a simple overview to share with the team, start with the
[One KPI team guide](./one-kpi-team-guide.md). The main feature view shows
**Devices / browsers** and **Times recorded**. Results, averages and source
events are available under **View details**; event names are under
**Technical details**.

## Why the 6.7k Live sharing row was confusing

A read-only production GA4 audit on 2026-10-07, using finalized daily exports
for **2026-09-08 through 2026-10-07**, found:

| Source | Recorded events | Distinct device/browser IDs | Meaning |
| --- | ---: | ---: | --- |
| `one_location_journey_action`, `action=location_share_viewed` | 6,653 | 11 | A shared location was viewed; repeat records count again |
| `one_location_share_confirmed` | 25 | 6 | A share confirmation was recorded; Check-In can also emit it |

The union contained **12** distinct IDs (the 11 view IDs and 6 confirmation IDs
overlap). The old SQL assigned both to `live_sharing` because it matched every journey
action beginning with `location_share_`. **6,653 + 25 = 6,678**, displayed as
**6.7k** by rounding to one decimal in thousands. Neither that number nor the
old “Successful” column meant 6,678 distinct shares, sessions, or people.
The screenshot does not show its selected dates; these dated observations
explain a matching rounded total rather than establish its exact date range.

The corrected dashboard separates **Sharing confirmations** from **Shared
location views**. For the audited range their averages are **25 / 6 = 4.2**
and **6,653 / 11 = 604.8** records per ID respectively. The averages describe
the whole range and do not claim every device had the same activity.
Counts can change as GA4 exports arrive or are revised.

`location_share_viewed` is emitted by the shared Location telemetry helper.
The aggregate data does not prove whether every repeated emission represents
a fresh human action. No request/task/session identifier is available to
deduplicate these records into unique sharing sessions. Do not describe them
as periodic location updates without separately verifying the emitting code.

## End-to-end data path

1. One web/native code emits typed events through its shared analytics adapter.
   Events can represent starts, views, accepted jobs, outcomes or diagnostics.
   One operation can emit several records. For example, Check-In can emit
   both a share-confirmation record and a check-in-completion record.
2. GA4 exports the records into BigQuery daily and intraday tables. The metrics
   query prefers the finalized daily table whenever both exist for one date.
   This prevents daily/intraday overlap from doubling exported counts; it
   does not remove repeated client emissions or legacy/current emitters.
3. `fetchOneAppSummary` in `server.ts` scopes events to the chosen property,
   exact One web host, native app ID `com.hushh.app`, and selected export dates.
   Production and UAT properties are queried separately. A native row's
   property does not establish its backend environment or release channel.
4. `oneCapabilitySql` classifies capability-level deliberate/background
   events. `featureUsageQuery` classifies feature stages and counts accounts,
   device IDs, event records and result values. `locationBehaviorQuery`
   separately produces Location features, daily activity and journey reach.
5. `/api/analytics/one/app` and `/api/analytics/all` return aggregate counts,
   availability flags, date/freshness metadata and per-feature source-event
   subtotals. No individual identity or location rows are returned.
6. The frontend renders exact device and activity counts with short feature
   definitions. Open **View details** for averages, result partitions and
   contributing event names. **How to read these KPIs** is available on every
   subagent view.

Streaming data is provisional and has export latency. The UI polls on its
configured refresh interval (normally 30 seconds), and aggregate API responses
have a 30-second server cache. Refreshing the page cannot remove GA4 export
delay. The date selector governs export-day inclusion; daily Location points
are grouped by UTC event timestamp. GA4 export-day boundaries can differ from
UTC if the property has a different reporting timezone.

## Metric formulas and limits

| Display | Calculation on matching records | What it means |
| --- | --- | --- |
| Identified accounts | `COUNT(DISTINCT NULLIF(user_id, ''))` | Signed-in account IDs; anonymous records excluded; not necessarily unique humans |
| Devices | `COUNT(DISTINCT CONCAT(platform, ':', user_pseudo_id))` | Platform-scoped app-instance/browser IDs; not physical devices or people |
| Times recorded | `COUNT(*)` | Every matching exported record, including repeats and stages |
| Average per device | events / distinct IDs | Whole-range average; dash when denominator is zero/unavailable |
| Successful | `COUNTIF(result = 'success')` | Success at the emitting stage, which can be a view or request |
| Canceled / no-op | `COUNTIF(result = 'expected_error')` | Expected blocks/cancellations/no-op outcomes; not true failures |
| Failed | `COUNTIF(result = 'error')` | Recorded true errors at this stage |
| No result | events − success − expected error − error | Missing/other result values; never assumed successful |

The former **Non-error share** was actually successes / all records. It
excluded expected errors and used a denominator that could contain events
with no result. The activity count and an average in View details replace it. There is no
request-level completion percentage without matched requests and outcomes.

One ID can be used by several accounts, and one account can use several IDs.
Therefore accounts can exceed devices in some rows. Feature account/device
counts overlap; never sum them to get total unique accounts/devices. Daily
distinct-device counts also cannot be summed into a unique range total.

Capability headline accounts/devices use only the catalogue's deliberate
events. Capability total telemetry includes background events too. Feature
rows can represent different stages and background diagnostics, so summing
their counts does not reconstruct the headline deliberate-action count.
Founder briefing outcome totals additionally apply the catalogue's explicit
outcome-event allowlist; they are not sums of every feature result column.

## Every subagent's feature definitions

| Agent | Features and counting rules | Interpretation |
| --- | --- | --- |
| Location | Sharing confirmations: `one_location_share_confirmed`; views: journey `location_share_viewed`; check-in/out events and `nearby_check_in_result`; SOS trigger; sent requests and `location_request_*`; public-link creation and `public_link_*`; contact sync and `contact_sync_*`; invites and `contact_invitation_*`/`circle_code_shared`; Circle creation and other `circle_*` | Views, requests, handoffs, sync, creation and confirmation are different stages. Only the independent fulfilled-request KPI counts `location_request_fulfilled` successes. Check-In can also contribute a sharing confirmation. |
| Finance | Portfolio views; recommendation views; analysis-start records; `import_parse_completed`; `import_save_completed` | A view is not an investment outcome; a started stream is not completed analysis. Parsing and saving are separate stages of one import. Background market/profile load diagnostics are excluded from deliberate use. |
| Consent | `consent_pending_loaded` only with `load_surface=screen`; `consent_action_submitted`; `consent_action_result`; `one_consent_preferences_updated`; explicit unlock request/unlocked events; permission-grant events | Screen loads, submissions, outcomes and preference updates are separate. Warm prefetches do not fill preferences or screen-view rows. General consent results are not labelled data unlocks. Revocation-specific measurement remains a declared gap. |
| Gmail | `gmail_connect_started`; `gmail_connect_result` only `action=complete` plus `one_gmail_connected`; `gmail_sync_requested`; `gmail_sync_result` `action=queue`; `action=complete` plus `one_gmail_receipt_synced`; sign-in-screen views; actual inbox views; category-applied records | OAuth start differs from connection completion. Queue acceptance differs from finished sync. Starts, completions and repeat sync jobs are not unique Gmail accounts or unique receipts. |
| Advisor | Verification checks/status changes; workspace visits; request creation/strategy requests | Checks are not all approvals; visits repeat; requests do not prove delivered strategies. Client-handoff measurement remains a declared gap. |
| Information Marketplace | Marketplace browses and profile views (legacy/current event names) | These measure exploration, not deals or purchases. Subscription measurement remains a declared gap. |
| Memory | `one_memory_action`, actions `capture_prepared`, `capture_saved`, `detail_edited`, `detail_deleted`, `export_saved`, `auto_save_changed` | Counts the named action and result. PKM context resolution/save-confirmation diagnostics are excluded from deliberate Memory use and customer-outcome totals. |
| Wallet | `one_wallet_action`, `card_added` / `card_deleted` | Action records, not current card inventory or unique cards. Card contents are not metrics. |
| Calendar | `one_calendar_action`, `connected` / `disconnected` / `chat_opened` | Connection attempts/outcomes and assistance opens, not scheduled calendar events or current connected-account inventory. |
| KYC | `one_kyc_action`, `access_approved`, `access_denied`, `redraft_completed`, `reply_sent`, `reply_rejected`, `workflow_refreshed` | Distinct workflow stages, not unique completed KYC cases. Content and identity details are excluded. |
| CRM | `one_crm_action`, `record_created` / `record_updated` / `record_deleted` | Action records. Feature-flagged/UAT activity does not prove a publicly launched production feature. |
| Sign-up & onboarding | Auth starts; Google sign-in starts/completions; phone verification starts/completions; profile creation; onboarding completion | Several stages per account; not new registered users. Phone/Google completion events now reach their own rows instead of being swallowed by the sign-in CASE branch. |

Each detail panel shows the exact matching event names returned by BigQuery;
action-based rows also explain their action filter. A known event definition
and a matching exported record are separate facts. **Observed in export**
means a record exists, not that the full product workflow was independently
tested. A missing feature emitter remains unmeasured. A successful query with
no matching record shows zero; a failed source shows unavailable/dashes.

## Dated audit examples beyond Location

The same 2026-09-08–2026-10-07 production daily-export audit found 4,417 consent
screen-load records, 9 consent submissions and 9 consent outcomes. The prior
preference row combined submissions with screen loads/prefetches; these
categories are now separate. It also found 51 Gmail connection-start records,
25 terminal connection records (13 successes, 11 expected outcomes, 1 error),
8 queue outcomes and 292 sync-completion records. These stage totals cannot
be divided to claim conversion: requests/jobs can start outside the window
and repeated/automatic jobs are retained. Memory had 6 preparation records
and 5 save records; they are separate stages, not 11 saved memories.

## Verification

- `npm test`: exact formatting, average-denominator handling, result partition
  and feature stage semantics, alongside the existing regression suite.
- `npm run test:metrics:agent-feature-classification`: source classification
  boundaries, separate Location views/confirmations, Consent stages,
  onboarding branches and explicit result counts.
- `npm run test:ui:agent-feature-render`: agent/Location table units, exact
  large counts, corrected rows and unavailable-source rendering.
- `npm run test:api:one-location -- --base-url <dashboard-origin>`: full
  feature catalogue, privacy, result partition and per-source-event subtotal
  reconciliation for Production and UAT. Protected origins require the
  documented release-probe session.

The audit ran the revised `featureUsageQuery` directly against production
BigQuery and checked that source-event subtotals equal their feature totals.
This validates the aggregate query and counting contract. It does not certify
every native emitter, eliminate repeated emissions, or prove a future export.
