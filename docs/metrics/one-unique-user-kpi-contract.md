# One unique-user KPI contract

This contract defines the user-growth numbers shown on the One App page. It
prevents device, session, event, and account counts from being used
interchangeably.

## Headline registered-user KPIs

The headline user KPIs come from the shared One Firebase Authentication realm.
Production and UAT keep separate backend routing and GA4 properties, but both
builds authenticate accounts in this same identity registry.

- **Total registered users**: current distinct Firebase Authentication account
  records, deduplicated by immutable Firebase UID.
- **New registered users**: current account records whose authoritative
  `createdAt` timestamp is inside the selected date range.

Repeated sign-ins, sessions, events, browsers, phones, and tablets never
increase these counts. Disabled accounts remain included and are reported
separately. Deleted accounts are not present in the current registry snapshot.
The account system cannot prove that two separately created accounts belong to
two different humans, so the dashboard calls these registered users/account
records rather than claiming unique natural persons.

## Identified active-user KPIs

Activity KPIs use the stable, salted One account identifier exported to GA4 as
`user_id`.

- **Identified active users**: `COUNT(DISTINCT user_id)` among accounts with a
  meaningful One event in the selected range.
- **Newly observed active users**: those selected-range accounts whose earliest
  observed meaningful One event in all available export history is inside the
  selected range.
- **Returning active users**: selected-range accounts first observed before the
  selected range.
- **DAU / WAU / MAU**: distinct `user_id` values active in fixed 1-, 7-, and
  30-day windows anchored to the latest finalized GA4 export day.

Every event, session, and device carrying the same account ID contributes one
user at most. The required arithmetic invariant is:

`newly observed active users + returning active users = identified active users`

“Newly observed” means first seen by One analytics. “New registered” separately
means the account-creation timestamp from Firebase Authentication.

## Device KPIs

Device DAU, WAU, MAU, acquisition, install, retention, and feature-adoption
metrics use a platform-namespaced GA4 device/browser identifier. They describe
product reach and anonymous use, not people. They are secondary diagnostics and
must never be labelled as unique users.

## Identity coverage

Anonymous activity cannot be accurately converted into people. The dashboard
therefore publishes the share and count of active devices carrying a stable
account ID beside user KPIs. Account counts are exact for the identified slice;
they are not an estimate of unobserved humans.

The same persistent account ID must be set after authentication on web, iOS,
and Android, and cleared on logout. A dummy, blank, email, phone number, or
other directly identifying value is not allowed.

## Data integrity controls

- Production and UAT properties remain separate.
- Native and the environment's exact One web host are included; other hosts are
  excluded.
- Finalized daily tables take precedence when an overlapping GA4 intraday table
  exists, preventing event double-counting.
- Public-contract tests enforce user semantics and prohibit identifier leakage.
- KPI-invariant tests enforce fixed-window nesting, identity coverage, and the
  newly-observed + returning = identified-active partition.
- The reconciliation test independently queries BigQuery and must exactly match
  selected-range users, active-user windows, devices, totals, and platform rows.
- A second reconciliation independently reads Firebase Authentication in
  memory and must exactly match total, new, created-through-range-end, and
  disabled account aggregates for both dashboard environment views. It logs
  only counts and never account records or identifiers.

## One Location request fulfilment

“Fulfilled request actions” counts successful
`one_location_journey_action` events whose action is
`location_request_fulfilled`. The app emits success only after the request is
approved and an encrypted location envelope is published. Error events are
reported separately. The KPI is an action count, not a user count or a
fulfilment percentage; distinct successful devices are supporting context.

When the exact fulfilment action has not emitted in the selected environment
and range, the dashboard shows **Waiting** rather than a fabricated zero. A
rate is not reported because privacy-safe telemetry carries no request ID, so
request-level matching and de-duplication cannot be proven from GA4 alone.

