# One unique-user KPI contract

This contract defines the user-growth numbers shown on the One App page. It
prevents device, session, event, and account counts from being used
interchangeably.

## Headline growth KPIs

All headline user KPIs use the stable, salted One account identifier exported
to GA4 as `user_id`.

- **Total unique users**: `COUNT(DISTINCT user_id)` among accounts with a
  meaningful One event in the selected range.
- **New unique users**: those selected-range accounts whose earliest observed
  meaningful One event in all available export history is inside the selected
  range.
- **Returning unique users**: selected-range accounts first observed before
  the selected range.
- **DAU / WAU / MAU**: distinct `user_id` values active in fixed 1-, 7-, and
  30-day windows anchored to the latest finalized GA4 export day.

Every event, session, and device carrying the same account ID contributes one
user at most. The required arithmetic invariant is:

`new unique users + returning unique users = total unique users`

“New” currently means first observed by One analytics, not account creation.
When an authoritative One authentication/account aggregate becomes available,
registered total and newly created accounts should be added as separate KPIs;
they must not silently replace this active-user definition.

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
  New + Returning = Total partition.
- The reconciliation test independently queries BigQuery and must exactly match
  selected-range users, active-user windows, devices, totals, and platform rows.

