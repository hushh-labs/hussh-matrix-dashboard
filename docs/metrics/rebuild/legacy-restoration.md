# Finite first restoration of the legacy dashboard

The operator's 15 November instruction explicitly authorizes going beyond the
normal query allowance for the first dashboard fill, before continuing the
Next.js migration. This is a separate, manual restoration decision. It does not
activate recurring collection, change CI/CD, erase the incident ledger, or grant
an unlimited warehouse budget. PLG routes and the independent mail worker remain
outside this operation.

## Normal behavior

Normal execution retains 100 MiB per statement, 100 statements/10 GiB reserved per
UTC day, durable reservations and native byte/time limits. A free native estimate
now rejects known oversized statements before consuming those reservations.
Historical first-seen is separate from bounded activity, so its failure cannot
erase valid account/platform/agent data. Failed daily reads remain unavailable.
The briefing initially selects the latest complete day; One initially selects
today. Larger ranges are explicit choices. One loads the selected environment;
production health is requested separately. Drilldowns retain that selection.

## Exact-source one-time permit

Only a trusted operator can create the Firestore document
`metricsRestorationPermits/restore_<16 lowercase hex characters>` in the existing
`hushh-ai-prod/one-plg-production` database. There is no HTTP permit-writing API.
The candidate carries that ID and its exact qualified source SHA in
`METRICS_LEGACY_RESTORATION_ID` and `METRICS_LEGACY_RESTORATION_SOURCE`.

The document has a source SHA, creation time, fixed `asOf`, expiry no more than
one hour later, phase, finite byte/job limits, plans and nonrefundable counters.
Hard outer ceilings are **64 GiB total, 80 distinct jobs, 16 GiB per job**. The
actual approved plan can be smaller. At USD6.25/TiB on-demand list pricing,
64 GiB is USD0.390625 of query compute before free usage. This is not a whole-GCP
invoice guarantee: hosting, Firestore, builds, registry, logs and networking are
separate. Do not assume free quota is available.

1. Qualify the exact source, build a bounded image and create a zero-traffic
   candidate with existing identity/secret bindings and the normal BQ flag.
2. Create the permit once in `planning`, immediately before preflight. Request
   a fixed, recorded set of actual dashboard reports. Every warehouse request
   is a native dry run; no paid query is admitted in planning, including after
   its expiry. Other bounded existing source APIs can supply their aggregates.
3. Clock functions are frozen to the permit timestamp outside SQL strings and
   comments. Plans bind exact SQL, membership namespace, source, project and US
   location; parameters/types are refused. SQL itself includes the period and
   environment. Identical statements shared by reports use one plan/job.
4. Inspect the measured plan and its sum before opening it. Seal the sorted plan
   digest, keep the original creation/expiry and change only phase to `open`.
   No arbitrary periods, source substitutions or unplanned SQL gain an allowance.
5. Request the same reports once. Reserve each full execution ceiling atomically
   in this permit, outside the ordinary daily ledger. The native maximum equals
   that reservation. Stable provider IDs recover an existing exact job after a
   lost acknowledgement; conflicts stop, and uncertainty never creates a suffix
   job or refund. Expiry and limits are rechecked transactionally.
6. Inspect each report's actual available/partial/error states and reconcile
   fixed periods. HTTP200 is insufficient. Only after acceptance, the trusted
   signed `metrics-release-probe@hushh.ai` session may issue the same read with
   `X-Metrics-Restoration-Publish: 1`. This saves a write-once aggregate snapshot;
   ordinary signed-in staff cannot publish it.
7. Close the permit before public promotion, even if any report failed. Verify
   the serving revision, auth, populated reports, retained timestamps, cache
   reuse and rollback. Preserve all permit/reservation/job evidence.

Do not create another permit to work around a failure, reset counters at midnight,
extend the expiry, refund a timeout or automatically enlarge the measured plan.
Enumerating 80 queries is not proof that every period or integration is covered.
Missing credentials, absent source history and unconfirmed business outcomes
remain unavailable; device identifiers remain separate from identified accounts.

## Durable presentation without another initial scan

Accepted snapshots are bounded to 32 reports of at most 700,000 bytes each and
24 hours. Their key includes the exact canonical report URL and current cohort
namespace; their schema/source must match. Their displayed timestamp remains the
oldest source time (`asOf`), with completion recorded separately. No new timestamp
is assigned when reading them. Authentication precedes reads and current customer
membership is checked again afterward. A changed cohort cannot reuse old totals.
Named referral rows and all PLG routes remain outside this persistence layer.

After closure/expiry, ordinary reads and Refresh can reuse the accepted snapshot
without warehouse execution. Refresh reports that it has retained the dated
snapshot rather than claiming a new computation. A new period or missing snapshot
uses only the normal limits; expiry never authorizes a fresh restoration job.
Snapshots are retained as recovery evidence; no TTL deletion or old-data cleanup
is enabled here. The longer-term published-report collector remains separate
work under #184 and its accepted operating-policy/reconciliation requirements.

## One-time historical recovery after the initial fill

A separate recovery permit may be created only with an immutable claim tied to
one original closed permit. The claim pins both permit IDs and source commits,
the original reserved bytes, new byte/job caps and the unextendable time window.
Every preparation, plan, reservation and publication checks the claim and the
original closed ledger. The new maximum plus the original reservation cannot
exceed the original 64 GiB ceiling. Recovery cannot chain from a recovery or
change the original reservations. The operator must dry-run the exact requested
periods and inspect plan coverage before opening the permit; fixed 30/90-day
production and UAT requests can still exceed the remaining allowance. No cap
implies that arbitrary periods or missing history are complete.

The old source-bound snapshots remain read-only. Their original source, cohort,
URL, as-of and 24-hour retention remain intact; a new binary never relabels them
as the recovery source. Preset controls use the saved publication date, shown
in the report, while those snapshots are retained. Unsupported or incomplete
source data remains unavailable, and warehouse failures still block publication.
The GA4 website reader binds processed reports to the verified stream and both
approved domain families. Realtime is stream-wide because GA4 realtime does not
provide a hostname dimension. Provider zero is not proof of zero actual visitors.

A diagnostic-only revision may measure additional native dry-run estimates in
an existing planning permit without changing its approved plans or spending its
allowance. It records at most 500 distinct SQL bindings and their report URLs,
with per-statement estimates capped at 512 GiB for dry runs only. This mode
cannot reserve, execute or publish and fails closed outside the planning phase.
The observed sum is a lower bound when dependent branches cannot be reached or
when estimates are unavailable; it is not authority to execute. Source identity,
claim, original ledger and expiry remain unchanged.
The diagnostic stores a digest of each frozen SQL statement and its existing
cohort-scope hash, not the SQL or identity rows. These are used to compare
against completed, metadata-verified earlier jobs before any replacement work.
