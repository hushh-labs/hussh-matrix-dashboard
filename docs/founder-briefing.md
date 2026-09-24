# One founder briefing: production KPI contract

The first tab on `metrics.hushh.ai` briefs the founder on **One only**. Other products remain in their detailed tabs. The view supports 7/30/90 completed UTC days, a calendar-month selection, and an exact custom 1–90-day range. Reports end three days before the current UTC date so daily exports can settle. Every selection is compared with the immediately preceding period of the same number of days. The UI prints both exact date boundaries; it never silently clamps an invalid custom range.

| Measure | Definition | Important limit |
| --- | --- | --- |
| Identifiable active accounts | `COUNT(DISTINCT user_id)` across meaningful GA4 events on the `one.hushh.ai` web host and shipped iOS bundle in the selected range | Cross-platform deduplicated for bound accounts only. Anonymous traffic cannot be turned into unique people. Android test-build events are excluded. |
| iOS / web identifiable accounts | Distinct stable account IDs within each platform separately | Platform rows can overlap; never add them to claim unique people. |
| Accounts using a measured agent | Distinct account IDs that emitted a catalogued agent interaction or selected view | This is a union across agents, not the sum of agent rows. |
| Agent account audience | Distinct account IDs per agent with catalogued deliberate-use events | One person may use several agents. Low identity coverage means this is not every user. |
| Agent interactions | Count of catalogued GA4 action and selected-view rows, excluding onboarding and known machine/background events | Repeat interactions count again. Ranking by interactions does **not** rank unique people. Marketplace currently records profile views, not completed transactions. |
| iOS / web agent interactions | Agent event rows split by platform | The two platform counts reconcile to the agent's interaction total. |
| First observed accounts | Distinct IDs whose first account-tagged meaningful GA4 event falls in the selected range | Not new Firebase registrations. |
| Location first value | Distinct IDs with `one_location_activation_completed` in the range | A measured action, not an assumption about every other account. |
| One Google Search clicks and impressions | Search Console aggregate for the production One web host | Search clicks are not unique visitors, app users, or market share. Incomplete exports are unavailable, not zero. |

The agent catalogue and deliberate/background event classification are shared with the detailed One panel in `server.ts`. Agent capabilities without deliberate-use instrumentation (Memory, Wallet, Calendar, KYC, CRM) say **not measured**, not zero. Onboarding is a journey stage rather than an agent, so it is excluded from the agent ranking.

One's production GA4 property includes public native events bearing `env=uat`. The founder page flags this labeling conflict and does not describe those as production-backend users. The page does not substitute device/browser identifiers for people. Its identity-coverage percentage describes the share of tracked app/browser identifiers linked to an account; it is **not** used to extrapolate unknown people.

Account growth percentages and the earlier-period account trend are withheld until account-tagged export history covers the entire earlier comparison window. Agent-interaction comparisons are withheld when the earlier period begins before the trusted event history on 2026-05-01. An agent's earlier interaction count of zero does not earn a green growth badge, because instrumentation may have started during the comparison. Missing data appears as a dash. Every percentage uses `(selected - earlier) / earlier × 100` only when the earlier number is nonzero and both windows are comparable.

Verification: `npm run lint`, `npm test`, `npm run build`, then `npm run test:prod:founder` with an authenticated short-lived QA session against a zero-traffic candidate and again against the live URL. Probe at least the default range, a 7-day custom range, and a calendar month. The contract checks exact windows, platform and agent deduplication bounds, daily/action reconciliation, no-store, privacy, and unavailable states. Real Google sign-in remains a separate interactive release gate.
