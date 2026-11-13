# Metrics definitions for review

All report definitions are versioned. Approval applies to a particular version,
source contract and scope. A changed definition requires a new publication.
The initial definitions are proposals for lead review, not historical truth.
Source descriptions below specify candidate or required contracts; they do not
establish that an API, source verification or approval already exists.

## Common counting rules

- An account is an authoritative immutable account ID, never a unique human.
  Deduplicate across devices only when a verified stable account identity exists.
- Anonymous devices/browsers, sessions and identified accounts are separate
  populations. Do not blend them or add overlapping distinct counts.
- Customer scope uses the product's current reviewed staff/test/automation and
  deletion policy. Unknown classification is excluded from customer KPIs and
  reported as a coverage gap. Marketing permission does not define customer scope.
- Use half-open timestamp intervals `[start, end)` with an explicit IANA timezone.
  GA4 `event_date` follows the registered reporting timezone, not automatically
  UTC. Read property metadata before interpreting dates. Never silently rebucket
  provider calendar totals. A cross-source comparison requires compatible dates.
- Daily and intraday exports overlap. Prefer finalized daily data for each
  covered date; provisional data and late correction windows remain labelled.
- Stock at a time differs from creation/deletion flows. A current directory
  cannot prove a historical stock or deletion history. Do not force a balance.
- Successful checks, information watermarks, computation and publication times
  are distinct. A successful fetch does not make old source information fresh.
- Each value has exact/provider-defined/estimate classification and available,
  partial, provisional, untracked or unavailable coverage. A source-confirmed
  empty population is zero. An unsupported metric has value null.

## Initial catalog

| ID / question | Source / counting unit / population | Formula, denominator and additivity | Period, coverage and reconciliation |
| --- | --- | --- | --- |
| `one.registrations` / How many accounts are registered? | Narrow authoritative backend aggregate; immutable accounts. Shared Firebase directory and eligible production customer accounts are separate measures. | Current eligible stock; distinct creations in range. Stock is non-additive. Creation flows add only across disjoint intervals. No conversion denominator. | Source timestamp and explicit creation timezone. No historical stock without deletion history. Reconcile aggregate against independently counted backend records using the same policy revision. |
| `one.adoption` / Are customers deliberately using One? | Backend aggregate of verified meaningful activity with stable account identity; distinct eligible accounts. | DAU, trailing 7-day and trailing 30-day distinct accounts over the entire window. Never sum daily distincts. Ratios require the same eligible population and compatible period. | End at last complete source day by default. Identity or emitter gaps make coverage partial/unavailable. Compare fixed-window distinct sets within the source owner; return only aggregate evidence. |
| `one.outcomes` / Which capabilities delivered value? | Authoritative committed business outcomes, deduplicated by effect identity in the product. Capability aggregates only. | Count unique confirmed effects and distinct account owners. Effect counts add across disjoint periods only if identity belongs to exactly one period. Attempts/returns are separate, not completed effects. Success rate requires correlated terminal attempts and matching effect identity. | Record occurred-at semantics, source generation and capability coverage. Reconcile effect totals to business records. Shared effects across agent paths count once. Unknown terminal outcomes remain unknown. |
| `one.claims` / How many agents were claimed? | No currently verified aggregate claim authority. Provisioned instances, account owners and claim CTA clicks differ. | Null until an authoritative claim contract is reviewed; no inferred ratio. | Untracked. Source-owner contract and reconciliation are prerequisites. |
| `hushhai.acquisition` / How does the website attract and engage visitors? | Candidate hushh.ai GA4 Data API property; property/scope/stream/timezone and key-event configuration verification remain pending. Expected measures are provider-defined sessions, active users, engaged sessions and key events. | Preserve provider identity semantics. Engagement rate = compatible engaged sessions / sessions, null when denominator zero. Do not sum distinct users across channels or days. Key events are not completed business outcomes without an authoritative link. | Property timezone and requested period must be verified before acceptance. Disclose thresholding, sampling, cardinality loss and data lag. Reconcile the exact same Data API request with the approved property report; do not treat export and UI measures as identical. |
| `hushhtech.business` / Is HushhTech delivering outcomes? | Candidate source: the existing public summary adapter `fetchHushhTechPublicAnalytics`, which sends only an `Accept` header. Authenticated source authority and the aggregate contract are not verified. | Proposed source-defined completed outcomes and compatible funnel denominators; unavailable until each count's authority, definition and population are validated. Add only declared additive flows. | Returned window validation exists; source authority/authentication, coverage and independent backend reconciliation remain pending. Neelesh owns gathering the evidence and identifying the backend contract owner; that source owner is not yet confirmed. |
| `products.reliability` / Are services operating reliably? | Cloud Monitoring per verified project/service/environment; requests, status classes and latency distributions. | Error rate = compatible errors / requests. Merge histograms before computing percentiles; never average p95 values. HTTP requests are not customers or invocations. | Monitoring interval/timezone, alignment and source lag explicit. Reconcile returned series and bucket sums. Separate health from customer adoption. |
| `products.cost` / What does reporting and product operation cost? | Attributed billing records or existing bounded aggregate export. Currency, credits, gross/net and attribution policy explicit. | Sum compatible currency amounts; cost per active account only for matching project scope, period and account denominator. Estimates separately labelled. | Billing lag and unallocated cost remain visible. Reconcile to billing statements for fixed periods; no warehouse query is authorized by this definition. |
| `one.retention` / Do activated accounts return? | Source-owned cohort aggregate using stable account identity and approved activation. | Distinct returning cohort accounts / eligible original cohort. Null until complete follow-up window. Never infer retention from new/returning device totals. | Cohort timezone, activation rule, complete-through date and exclusions versioned. Independently reconcile source-owned cohort counts. |

## Source gaps and required changes

The current Metrics production cohort adapter enumerates hashed membership rows
from `/api/one/plg/customer-cohort`; the registration path also traverses Firebase
accounts. The new web reader must not reuse either path. Request narrow aggregate
contracts in the owning backend if approved reporting cannot use existing APIs.
Do not build a second account or consent authority in Metrics.

HushhTech evidence is the reviewed
[public summary adapter](https://github.com/hushh-labs/hussh-matrix-dashboard/blob/bbc2fc31e99410a3c27c20e282cd048e903ff602/server.ts#L549-L564).
An HTTPS endpoint and a matching returned date window do not establish an
authenticated or authoritative business-metric contract. The actual source owner,
population/formulas, access requirements and fixed-period reconciliation must be
confirmed before acceptance. [Neelesh Meena](https://github.com/DamriaNeelesh)
coordinates this unresolved validation with the backend owner and
[Kushal Trivedi](https://github.com/kushaltrivedi5); no live request or authentication
implementation is part of this foundation correction.

The first reporting slice is `one.adoption` and `hushhai.acquisition`. A One
source stub can prove plumbing only; live acceptance needs the aggregate source.
GA4 identity, stream, hostname and environment must be verified against the
current collection map. UAT evidence never becomes production customer data.

## Regression origins

- #28: summed distinct users, agents claimed versus used, meaningful usage versus
  retries/health pings, acquisition property mismatch and incomplete identity.
- #48: identity leakage, missing phone resolution, stale period responses and
  environment isolation. Customer-level tables are outside this replacement.
- #126 / Research #8248: SDK returns and absent observations are not successful
  business effects, confirmed failure, inactivity or abandonment.

References: [GA4 schema](https://support.google.com/analytics/answer/7029846),
[GA4 reporting identity](https://support.google.com/analytics/answer/10976610).
