# Founder briefing: production-only KPI contract

The first tab on `metrics.hushh.ai` is a concise briefing, not a replacement for the diagnostic tabs. It uses two **equal, complete 30-day UTC windows**, with a three-day reporting buffer. A positive or negative percentage is `(current - previous) / previous × 100`. When the previous value is zero, the UI says “new activity” rather than showing an infinite percentage. Missing sources show a dash, never zero.

| Product | Briefing measure | Counting unit and source | Important limit |
| --- | --- | --- | --- |
| One | Signed-in accounts active | Distinct stable GA4 `user_id` with meaningful activity on the production One web host or public native app, in the selected window | This is only the identifiable account-linked slice, not all humans or all registrations. A signed-in account is deduplicated across events and devices. |
| One | Accounts seen for the first time | Distinct account IDs whose first account-tagged meaningful event in available GA4 export history falls within the window | First **observed** is not new registration. History starts with available export/account tagging. |
| One | Accounts completing location activation | Distinct account IDs with `one_location_activation_completed` in the window | A completed action is counted once per account. It does not imply every other account failed. |
| HushhTech | New registered accounts | Production Supabase `auth.users` creation date in the window | Registrations are not active users. The separate total is the as-of-window-end account stock. |
| Hushh AI | Google Search clicks | Search Console production site click aggregate for the window | Clicks are not unique visitors or customers and cannot establish market share. The trend is withheld until both exports cover their full windows. |

The One GA4 property includes public native events bearing `env=uat`. They are not called production-backend users; a warning stays visible until the client labeling is corrected and verified. The One account coverage value is a diagnostic for how much activity can be tied to a stable account, not a multiplier for estimating unknown people. The page does not show device or screen counts in headline cards, or add populations across products.

One account trends are withheld until account-tagged export history covers the *entire* earlier comparison window. The current count remains visible. This prevents a newly instrumented identity source from producing a false growth spike.

“Market” here means **our own measurable discovery via Google Search**, not competitive rank, share of market, addressable market, or customer sentiment. Those would require separate verified data sources and definitions.

Verification: `npm run lint`, `npm test`, `npm run build`, then `npm run test:prod:founder` with an authenticated short-lived QA session against a zero-traffic candidate and again against the live production URL. The contract probe checks window boundaries, types, no-store, privacy, zero-vs-unavailable, coverage, and export freshness. A real Google sign-in remains a separate manual release gate.
