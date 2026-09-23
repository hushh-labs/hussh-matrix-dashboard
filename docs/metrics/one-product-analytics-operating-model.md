# One product analytics operating model

This is the counting contract for the One KPI site. A larger number is not a
better number if its unit, source, or release channel is wrong. Each KPI must
show its date window, source, counting unit, availability, and definition.

## Sources of truth

| Question | Source | Unit | Do not substitute |
| --- | --- | --- | --- |
| How many accounts exist or were created? | One Firebase Authentication registry | Distinct immutable account UID | GA4 devices, events, or first opens |
| How many signed-in accounts used One? | GA4 export, meaningful events with stable salted `user_id` | Distinct account ID, deduplicated across devices and platforms | Anonymous app-instance IDs |
| How many app instances and sessions were active? | GA4 export for the exact One app stream | Distinct app-instance ID / sessions | Physical devices or people |
| Which One screens were visited? | One's typed `page_view` event with safe `route_id` | Route visits and distinct recognized routes | iOS automatic `screen_view` controller classes |
| How many store impressions, downloads, and redownloads? | App Store Connect / Play Console | Store-defined units, kept separate by store | GA4 `first_open` or active app instances |
| Did a feature deliver value? | Typed completion or failure events, validated against product state where possible | Successful actions and distinct identified accounts | Screen opens, retries, prefetches |

Never add platform-specific user rows to make a global unique-user total. Use
`COUNT(DISTINCT user_id)` across platforms for identified accounts. Accounts
are not guaranteed to be unique natural persons. Anonymous usage remains a
separate app-instance/browser diagnostic. Production and UAT backend routing
must not be inferred from GA4 property selection.

## Executive scorecard

Keep the first screen small and answer these questions in order:

1. **Growth:** total and new registered accounts; signed-in active accounts;
   activation to first value. Distinguish registration from first *observed*
   analytics activity.
2. **Acquisition:** store impressions, first-time downloads, redownloads, and
   listing conversion for released builds only. Show TestFlight/internal test
   traffic separately. A missing store connection is `Unavailable`, never 0.
3. **Engagement and retention:** account DAU/WAU/MAU, returning accounts and
   cohort retention. Label fixed 1/7/30-day windows and the last finalized day.
4. **Behaviour:** top named One routes, route visits, distinct signed-in
   accounts per feature, and success/failure funnels. Do not call UIKit
   controller presentations product screens or count background events as use.
5. **Quality:** crash, ANR, and startup health by app version/release channel,
   sourced from store/vitals and app telemetry with their coverage caveats.

Every breakdown needs the same range, timezone and unit as its headline.
Percentages name their denominator. Small aggregate cells must not expose raw
identifiers, paths, messages, locations, or user-authored content.

## Current measurement state (2026-09-23)

- Firebase registration and GA4 identified-account counts are available and
  reconciled. The shared Firebase realm contains both production and UAT
  accounts, so it is not a production-only acquisition number.
- One iOS route behaviour is measurable through typed `page_view` events with
  `route_id`. Automatic Firebase `screen_view` events have no product screen
  names and include system controller classes; keep them as diagnostics.
- The dashboard's App Store Connect endpoint reports **not connected** for
  App Store and TestFlight metrics. No store download number should be inferred
  from GA4.
- Android is pre-launch according to the product team. Historical Android GA4
  app-instance IDs are test/build traffic, not a public Android audience.
  Play Console release status and store statistics are not yet connected here.
- Web account identity coverage is incomplete; anonymous web browsers are
  never added to signed-in account counts.

## Release and QA contract

For each iOS or Android candidate build, record an explicit release channel
(`internal`, `testflight`/`closed_test`, or `store`) independently of backend
environment. Run a fresh-account and returning-account journey on each
platform. Confirm that the same account on two devices is one account, two
app instances, and two route journeys; repeated screen visits increase visits
but not distinct screens or accounts. Verify sign-out clears `user_id`, and
that test builds do not enter public acquisition KPIs.

The dashboard release gate independently reconciles its account, app-instance
and route aggregates against the GA4/Firebase sources. Once store connections
are available, add separate store-versus-dashboard contract checks; store and
GA4 totals are different populations and need not be numerically equal.

## Provider definitions

- [GA4 User-ID and cross-device identity](https://support.google.com/analytics/answer/9355972)
- [GA4 app-instance ID versus a physical device](https://support.google.com/analytics/answer/9356035)
- [Firebase automatic and manual screen views](https://firebase.google.com/docs/analytics/screenviews)
- [App Store Connect metric definitions](https://developer.apple.com/help/app-store-connect-analytics/reference/metrics-definitions)
- [Google Play acquisition and retention](https://support.google.com/googleplay/android-developer/answer/6263332)
