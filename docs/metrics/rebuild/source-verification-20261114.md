# Source verification and historical restoration evidence

14 November 2026 IST. Read-only inspection for #184; no collection or release
acceptance. Source inspection follows the foundation's proposal-only approval.

## What the earlier live dashboard establishes

The retained application is Express/Vite with process-local report/provider
caches. Legacy cache misses can invoke provider loaders; warehouse-derived
One/Growth/Search Console paths rely on the warehouse being available. The
incident's BigQuery-off gate and paused refresh schedules are retained. An old
visible number or successful source fetch does not establish a reconciled
current value, persisted publication or complete historical population.

The current Cloud Run observation is generation 374, revision
`hushh-matrix-dashboard-plg-uat-20261109` at 100%, BigQuery false. The new report
web/collector is not serving. Merging the foundation docs did not activate data.
No old report endpoint or warehouse query was used to reconstruct measurements.
Existing source code/configuration is restoration evidence, not live acceptance.

## Existing website property: directly observed

Existing documented identifiers match the fingerprints of the configured
Secret Manager property/measurement values. No key/token payload is recorded.

| Observation | Evidence and limit |
| --- | --- |
| Property | `458078330`, name `hushhconnect-60e07`, in Analytics account `328605063`. Personal authorized session and the official read-only Admin `properties.get` both succeed (HTTP200); service level is `GOOGLE_ANALYTICS_STANDARD`. Work session shows **Missing permissions** for this exact property. Access to GCP projects and access to an Analytics property are different checks. |
| Website stream | Official read-only Admin `dataStreams.get` succeeds (HTTP200): `14681621075`, **Hushh AI Website**, `WEB_DATA_STREAM`, URL `https://www.hushh.ai`, measurement `G-PPEF1CSJ5H`; matches existing configured measurement. |
| Mixed property | Five streams shown: Android/iOS and older web/windows streams plus the website stream. A property-only total is not a website-only total. |
| Collection | Website stream displays **Data collection isn't active for your website** and **No data received in past 48 hours**. This is the provider UI's observed status, not proof of the cause, exact last-event timestamp or historical absence. No emitter or analytics setting was changed. |
| Reporting timezone | Official read-only Admin response verifies **`Etc/GMT`**, a fixed zero-offset timezone. Earlier UI-only label **United Kingdom / (GMT+00:00) GMT+00:00** was insufficient; do not infer Europe/London or daylight-saving behavior from that label. |
| Configured key events | All five displayed, pagination **1–5 of 5**: `app_store_subscription_convert`, `app_store_subscription_renew`, `first_open`, `in_app_purchase`, `purchase`; each shows **No stream data detected**. They are configured property events, not verified website business conversions. No event was enabled or edited. |

The existing operator identities cannot mint a token for the configured reader
(403), including after normal Work sign-in. Existing runtime resource policy has
a direct TokenCreator binding, but its effective delegation/Analytics authority
has not been exercised. These operator failures do not prove runtime failure.
No IAM binding or Analytics access grant was changed to make a check pass.

The owner completed Google APIs Explorer's terms/sign-in and read-only consent
directly in the existing personal browser. Only `analytics.readonly` is selected;
edit/full Analytics scope and API-key use are disabled. No browser credential is
copied to the collector or persisted in source artifacts.

One fixed-period Data API read used 5 November 2026, the four intended metrics,
ANDed website-stream/web-platform/production-host filters and limit one. Copying
the rendered request editor confirmed the exact request. HTTP200 returned only
metadata, quota and kind, without metric headers, rows or an explicit row count.
The source timezone again matched `Etc/GMT`; the property quota reports one
token consumed. The original receipt conservatively rejected counts because
headers/rowCount were absent. Subsequent inspection of Google's actual
[RunReportResponse proto](https://github.com/googleapis/googleapis/blob/master/google/analytics/data/v1beta/analytics_data_api.proto)
and [ProtoJSON default-value rules](https://protobuf.dev/programming-guides/json/#presence-and-default-values)
corrects that parser assumption: rowCount is an implicit-presence int32 and rows
and metricHeaders are repeated fields; default zero/empty values can be omitted.

The held adapter now accepts that native empty encoding only with the expected
runReport kind, matching property timezone, the requested quota receipt and
consistent empty rows/count/headers. Thresholding, sampling, other-row loss or
an emptyReason cannot produce an invented empty result. A metadata object
without the native response kind still refuses. Regression checks fail against
the earlier parser and pass after the correction.

This decodes **zero provider-recorded results for the exact requested scope**,
with partial coverage and unknown information freshness. It does not prove zero
real website visitors, correct emitter/property mapping or independent period
reconciliation. The original raw-inspection receipt remains unchanged. No
further metric report was repeated to force an answer. A subsequent read-only
stream creation-time lookup stalled in Google account sign-in, so it supplies
no new metadata or counts. Effective collector delegation, verified coverage
dates and an independent usable reference remain unverified.

The first bounded HTML inspection accepted no response. A subsequent native
client exposed redirects rather than silently following them. Read-only HEAD
on `https://www.hushh.ai/` returns HTTP301 to `https://www.hussh.si/`. A bounded
static GET of that observed destination returned HTTP200 and 70,839 HTML bytes,
with no literal GA4 measurement ID or Tag Manager ID found. No script ran.
Tags loaded dynamically or subject to consent remain unverified; absence from
static HTML does not establish absence at runtime.

This is a current source-mapping discrepancy: the earlier binding candidate
only accepted historical `hushh.ai` / `www.hushh.ai` hosts. It would exclude
`www.hussh.si` even if that site's runtime sends events to the old property.
The owner confirmed that both domains belong in **one website report** because
the redirect is intentional. The held application now permits explicit reviewed
subsets of those two domains, including their apex/www forms. One whole-period
provider calculation covers the host set; daily/domain distincts are not summed.
New scope changes source generation and cannot relabel existing publications.

This product-scope decision does not verify which property/stream receives the
destination's events, cross-domain identity/consent configuration or useful
reference counts. The combined binding must remain off until those checks and
reconciliation pass. If the domains use different properties, their distinct
user totals cannot be added into a purported deduplicated website population.
No hostname, stream, emitter, redirect or Analytics configuration was changed.
This does not prove the cause of every missing dashboard measurement.

The separately named `hushh-ai-website` Cloud Run service is Ready at generation
1578/100% on its observed revision, but domain mapping and its exact source
repository/commit are not verified. Do not assume that service is the current
redirect destination or accept an old repository tag as serving evidence.

## Current website source and collection-policy discrepancy

The current destination is not established by the old `hushh.ai-website`
repository. A focused source search found the website in
[`hushh-search-console` at `e5cb3f1a`](https://github.com/hushh-labs/hushh-search-console/tree/e5cb3f1a463f751c23146a601da15f7f3ddf2034).
A bounded public GET of `/analytics/consent-bootstrap.js` returned 14,555 bytes,
SHA256 `ddf889954751d4c8781b28a463f23389a44eb0d67cc0b9a98328da223519c35b`.
Its Git blob `51473673e665968c39c051134687a78eed48b8a6` exactly matches that
revision's asset. This proves that one asset, not the entire serving deployment
or its backend source provenance. No website JavaScript or event beacon ran.

The destination's public, no-store `/api/analytics/config` returned version 2,
`requiresConsent=true`, `consentScope=privacy.analytics`,
`collectionMode=first-party-only`, `disabled=false`, `firstPartyEnabled=true`.
GA4 is **paused** (`configuredStatus=ready`); GTM is **paused** and not configured.
These are actual public configuration results, not a conclusion from absent
static tags. The existing
[configuration](https://github.com/hushh-labs/hushh-search-console/blob/e5cb3f1a463f751c23146a601da15f7f3ddf2034/src/lib/analytics/config.ts)
and [consent loader](https://github.com/hushh-labs/hushh-search-console/blob/e5cb3f1a463f751c23146a601da15f7f3ddf2034/public/analytics/consent-bootstrap.js)
deliberately separate first-party capture from consent-gated provider tags.
Do not unpause tags or change consent to make Metrics counts appear.

The current source tree's first-party
[event route](https://github.com/hushh-labs/hushh-search-console/blob/e5cb3f1a463f751c23146a601da15f7f3ddf2034/backend/app/api/analytics.py)
has no aggregate reader. Its
[capture implementation](https://github.com/hushh-labs/hushh-search-console/blob/e5cb3f1a463f751c23146a601da15f7f3ddf2034/backend/app/data/capture.py)
persists product events only through `BigQueryCaptureSink` when telemetry is
enabled. `BigtableContextSink.capture_product_event` is a no-op; its separate
chat-context records contain private content and must not become a global
reporting scan. Capture failures are caught, so an event HTTP acknowledgement
does not establish durable capture. Server-generated event UUIDs also do not
establish deduplication of repeated browser submissions.

Native read-only metadata separately observed `hushh-search-console-api` Ready,
generation 1508, with 100% traffic on
`hushh-search-console-api-re7e384b81935-970bc33f`, image digest
`sha256:71be478f5b7411b63d77502d5d40c6d2d5a9ecfd4fac52739adcc6cef9c693f6`.
**That serving revision has literal `TELEMETRY_ENABLED=true` and
`BIGTABLE_ENABLED=false`.** Metrics's own BigQuery-off switch does not disable
this other application's telemetry. Domain-to-backend mapping, complete serving
source provenance, actual writes and attributed spend were not verified. This
is a source/cost dependency requiring owner reconciliation, not a billing claim
or permission to mutate the website. No settings, rows or warehouse jobs were
changed or queried.

The source repository's existing
[report generator](https://github.com/hushh-labs/hushh-search-console/blob/e5cb3f1a463f751c23146a601da15f7f3ddf2034/scripts/reporting/generate_prod_uat_analytics_report.py)
uses uncapped BigQuery reads and private directory/context material. It was
inspected as text only, never imported or executed. Reusing it would violate
this rebuild's warehouse-off and aggregate-only boundaries. No existing
warehouse-free product-event aggregate was established by this audit.

### Decision packet before current-website collection

| Evidence | Affected decision / smallest correction | Required verification |
| --- | --- | --- |
| GA4 is intentionally paused in the observed live config; the independent provider UI is empty | Preserve GA4 for explicitly reconciled historical periods only. The candidate now requires an inclusive `coverageThrough` as well as `coverageFrom`. No automatic extrapolation into current dates or provider activation. | Definition owner accepts the property/stream/hosts, period, identity and reconciliation receipt. Range changes change source generation and invalidate old reuse. |
| Current first-party product events have no established warehouse-free aggregate | Source owner must choose a reviewed narrow aggregate contract and counting semantics before current website measurements can be restored. Do not label event counts as GA4 sessions, engaged sessions, users or conversions. | Source-owned durability/deduplication, consent/current identity, environment, fixed-period independent counts, retention and measured operating cost. Additional infrastructure needs a demonstrated need and review. |
| Another application's serving telemetry flag is true | Reconcile its native deployment/source, destination and attributed ingestion cost with that application's owner; keep Metrics's own source/collection hold. | Metadata/source provenance and bounded existing operational evidence. No warehouse activation, blanket flag changes, private-content scans or new credential grants follow from this finding. |

No new infrastructure, provider consent or website behavior is proposed as an
implicit activation. Existing historical storage is retained. A common
hostname/redirect decision alone cannot bridge these different source semantics.

## Source correction and remaining proof

The held GA4 adapter now pins website stream, web platform and approved production
hosts together, while retaining whole-period distinct-user calculation. Unscoped
bindings fail closed; changed stream/hosts change source generation. This is an
application correction, not an activated binding or accepted reconciliation.

Still required: reporting identity and an accepted current website source decision; accepted
metric definitions; fixed-period request with the exact same filters and
independent reference counts; quality/lag/empty-state verification; working
collector identity; measured operating limits and native runtime/release proof.
Recent missing collection must be diagnosed before claiming current traffic is
restored. UI access does not supply API credentials to the collector.

The One aggregate was absent from the audited Research default-main route tree.
[Research Dev PR #9516](https://github.com/hushh-labs/hushh-research/pull/9516)
merged its product-owned implementation into Dev as
`8201d101c359e022d74103c154610e108e8157c8` on 14 November at 07:08:55 UTC.
The seven authored file blobs match tested PR head
`b885d43336bda4d5d3d74fc43802d709babf85a1`. It reads existing persisted
successful-chat metadata and domain-owned effect proofs in one read-only
business snapshot, with current identity/exclusion/deletion barriers. It never
calls private owner exports or returns identifiers/content to Metrics.

This is default-off merged source, not a deployed or live accepted API. It inherits a
50-candidate current-identity/lifecycle bound and seven retained days; overflow,
active RLS, changed authority or limited outcomes refuse the entire result.
Those conservative compatibility bounds are not reviewed production capacity.
Retained-positive counts always have partial coverage. A database snapshot
timestamp is not an ingestion/completeness watermark across devices/private
agents. The dedicated generation/policy/reconciliation manifest must bind real
reviewed receipts before enablement; an approved boolean is not reconciliation.

Local 140 focused route/service checks pass. The RLS negative control fails when
the refusal is removed and passes after restoration. A real disposable
PostgreSQL snapshot/dedup case was added to the existing database lane, but
local database absence caused a skip. Exact-head hosted
[PR CI 43567576157](https://github.com/hushh-labs/hushh-research/actions/runs/43567576157)
passed: 27,398 backend tests / 144 skips, mypy 468 files, database shard one
1,143 passes / one skip, shard two 1,260 passes / zero skips. Shard two explicitly
executed the 28 cases in `test_feed_agent_outcomes_postgres.py`, including the new
SQL snapshot/shared-effect regression. Integration passed 222 web and 368 backend
checks. The ordinary
[merge queue 43569360957](https://github.com/hushh-labs/hushh-research/actions/runs/43569360957)
passed on the exact landed combined commit. These disposable synthetic fixtures
do not establish production source counts. Fixed-window independent reconciliation, actual
population size, query/deadline measurements and runtime authority remain
unaccepted. No endpoint/configuration was activated by opening the PR.

Registrations, HushhTech, retention, reliability, operating cost and other legacy
measurements require their source-specific work after the accepted first slice.

No BigQuery query, scheduler activation, paid-resource provisioning, cloud build,
serving/configuration/IAM mutation, CI/CD edit or PLG/email change was performed.
