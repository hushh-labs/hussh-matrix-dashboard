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

## Source correction and remaining proof

The held GA4 adapter now pins website stream, web platform and approved production
hosts together, while retaining whole-period distinct-user calculation. Unscoped
bindings fail closed; changed stream/hosts change source generation. This is an
application correction, not an activated binding or accepted reconciliation.

Still required: reporting identity and current website-domain/stream mapping; accepted
metric definitions; fixed-period request with the exact same filters and
independent reference counts; quality/lag/empty-state verification; working
collector identity; measured operating limits and native runtime/release proof.
Recent missing collection must be diagnosed before claiming current traffic is
restored. UI access does not supply API credentials to the collector.

The One aggregate was absent from the audited Research default-main route tree.
[Research Dev PR #9516](https://github.com/hushh-labs/hushh-research/pull/9516)
now proposes its product-owned implementation at
`b885d43336bda4d5d3d74fc43802d709babf85a1`. It reads existing persisted
successful-chat metadata and domain-owned effect proofs in one read-only
business snapshot, with current identity/exclusion/deletion barriers. It never
calls private owner exports or returns identifiers/content to Metrics.

This is default-off candidate source, not a live accepted API. It inherits a
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
local database absence caused a skip. Normal push hooks pass. Hosted exact-head
locked/native results, fixed-window independent source reconciliation, actual
population size, query/deadline measurements and runtime authority remain
unaccepted. No endpoint/configuration was activated by opening the PR.

Registrations, HushhTech, retention, reliability, operating cost and other legacy
measurements require their source-specific work after the accepted first slice.

No BigQuery query, scheduler activation, paid-resource provisioning, cloud build,
serving/configuration/IAM mutation, CI/CD edit or PLG/email change was performed.
