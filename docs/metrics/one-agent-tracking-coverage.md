# One agent tracking coverage

Tracking is partial. Correctly reconciling exported counts does not establish
that every product workflow emits measurements. The feature inventory in
`src/lib/agent-measurement-contract.mjs` distinguishes missing emitters from
a readable export with no matching records. Positive exported evidence takes
precedence over a stale inventory gap.

The source review used hushh-research commit
`8cf525dec25664ef45c3a71f77f5cc5c8aa40b52` on October 8, 2026.
References in event types, schema declarations, tests and generated contracts
are not treated as proof of an emitting runtime call. A source caller does not
prove that every deployed web release or installed native build contains it.

## Why the three Gmail rows were zero

One emits Gmail connection, sync request, queue, processing result and receipt
load events. The audited app has no separate emitters for Mail sign-in views,
inbox views or receipt categorization. Processing receipts successfully cannot
be converted into a count of inbox visits or categorized receipts.

A 90-day production-property audit (July 10–October 7) found old
`hushh_mail_signin_screen_view` records on `hushh-pda.firebaseapp.com`, outside
the One host scope. These are excluded deliberately. Neither reporting property
contained a matching One-scoped record for the three feature measurements.
Their rows now display **Not tracked yet / —** with a plain explanation.
This does not mean the app has no mail functionality or nobody used it.

For September 8–October 7, an independent BigQuery query and the live API
agreed on these stage records:

| Gmail stage | Production property | UAT property |
| --- | ---: | ---: |
| Connection starts | 54 | 163 |
| Terminal connection results | 26 | 107 |
| Sync requests | 11 | 21 |
| Queue results | 8 | 21 |
| Processing results | 292 | 539 |
| Successful processing results | 281 | 527 |
| Expected processing outcomes | 10 | 10 |
| Failed processing results | 1 | 2 |

These are event records, not unique jobs, emails or users. Automatic jobs,
repeat records, outcomes from earlier requests and client polling can affect
these totals. They cannot establish a sync conversion funnel.

Production-property native records can carry `env=uat`. Property, app build
and backend environment are different dimensions. These counts are not a
claim that every record represents production-backend customer activity.

## Coverage by agent

| Agent | Verified measurement boundary | Remaining gap |
| --- | --- | --- |
| Location | Sharing confirmations, views, check-in/out, SOS, requests, public links, contact sync, invitations and Circle stages | Unique sessions and delivery outcomes cannot be inferred from generic action records. |
| Finance | Portfolio/recommendation views, accepted analysis starts, import parse/save results | Starts do not establish finished analyses or investment outcomes. |
| Consent | Screen loads, submissions and action outcomes | Separate preference updates, data unlock, permission grants and withdrawal events. |
| Gmail | Connection and sync stages plus receipt-load diagnostics | Mail sign-in visits, inbox visits and categorized receipts. Mail send/read/modify workflows are also outside these rows. |
| Advisor | Verification/status checks, workspace visits and request records | Client handoff. |
| Marketplace | Profile-view caller exists; no One-scoped records were observed in the audited range | Browsing and subscription emitters. |
| Memory | Prepare/save/edit/delete/export and automatic-saving changes | Background PKM resolution is diagnostic, not agent invocation or deliberate Memory usage. |
| Wallet | Card addition/removal results | Current inventory and reveals are not measured. |
| Calendar | Connection results, disconnections and assistance opens; 13 production-property and 68 UAT records in the audited range | Event syncing, creation, editing and deletion are not covered by these actions. |
| KYC | Typed event definitions exist | No workflow callers found for any of the six configured actions. Capability counts remain unavailable. |
| CRM | Feature-flagged create/update/delete callers exist; no scoped records in the audited range | A source caller does not establish a production launch. |
| Onboarding | General authentication, phone verification and emitted onboarding completions | Profile creation has no event. Registered accounts remain sourced from Firebase Authentication. |

Google sign-in had a **mapping defect** rather than a missing provider flow.
The current app emits `auth_started`, `auth_succeeded`, `auth_failed` with
`action=google`. The corrected Google row includes them while general auth
starts/sign-ins retain their records. In the audited range there are **1,026**
Google step records in the production property and **1,189** in UAT. The starts,
results and other auth rows overlap; do not add them as distinct attempts.

The 17 known missing feature measurements are: profile creation; Consent
preference updates, unlock, grants and withdrawal; the three Gmail rows;
Advisor handoff; Marketplace browsing and subscription; and all six KYC
actions. Their lack of exported records is not evidence of no product use.

## Repeatable end-to-end verification

`npm run audit:metrics:agent-signals` reads both properties, applies the same
verified surface scope, prefers finalized daily exports over overlapping
intraday exports, and independently computes counts. It compares each feature's
accounts, device IDs, records, successful/expected/failed results and classified
outcome totals. It also verifies all agent-level distinct unions and daily
chart points. It fails on missing API sources, date mismatch, unknown feature
keys or numeric disagreement. Known tracking gaps remain explicit in its JSON
report even when the exported counts reconcile.

```bash
npm run audit:metrics:agent-signals -- \
  --start-date 2026-09-08 --end-date 2026-10-07 --repeat 3 \
  --app-repo <hushh-research-checkout> --app-ref <reviewed-commit>
```

Use the existing private release-session mechanism for protected endpoints;
never paste signed cookies or secrets into commands or reports. `--cli` uses
the authenticated BQ CLI instead of SDK ADC. Repetitions are bounded to three,
query cache is disabled for source comparisons, and source/API calls have
timeouts. Output contains aggregate counts and source file paths only.

The original mapping passed three calculation comparisons because both used
the same old accepted names. Reviewing the emitting code exposed the provider
mapping defect; the revised independent audit correctly failed against the old
live Google row. This negative control distinguishes numeric consistency from
correct product meaning. Missing instrumentation must be added in the owning
app, released, exercised through a real consented journey and then observed in
the correct export before its workflow can be certified end to end.
