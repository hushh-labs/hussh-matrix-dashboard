# Held application hosting handoff

The existing Cloud Run service and public domain can retain their operational
hosting while forwarding only the new report surface to a distinct private
Next.js service. This avoids replacing the retained native origin, proxy loops,
domain/certificate changes or moving PLG126 into the source-free web identity.
It is an application boundary, not a replacement deployment workflow.

`METRICS_REPORT_WEB_FORWARDING_CONFIG` is absent by default. When configured it
requires exactly `approved`, `webNativeOrigin`, `publicOrigin`, `timeoutMs`,
`maxRequestBytes` and `maxResponseBytes`, with the same pinned origins and refusal
ceilings as the operational proxy (job admission at most8KiB). Metrics BigQuery
must be literally false. Runtime values remain Secret Manager-backed. No live
configuration is installed by this code.

The root HTML/RSC, `_next/static` assets and explicit report/read/job routes use
the new web service. Native Google invocation identity has the web service's
exact audience; browser cookies and original Origin remain separate. Spoofable
infrastructure headers and caller bearer credentials are not forwarded. Reads
do not create source jobs, and errors cannot fall back to old source loaders.
Protected output remains private/no-store, including RSC, JSON and redirects.

Known OAuth, PLG, signed integrations, legacy assets and health paths keep their
existing handlers. Other old analytics/provider/chat paths fail closed during
handoff rather than silently invoking source loaders. This is intentional: only
approved published reports can replace their data. Removing an old product view
does not establish replacement coverage or justify invented values.

The existing root image builds both applications. It can execute the independent
Next.js standalone entrypoint or collector with an explicit service command;
each service must use its own identity/configuration. The source-free web has no
database/provider grant. The retained operational identity keeps its existing
dependencies; it is not reused as the web or collector identity. The private
worker requires its native per-role identities and isolated reporting database.

Before activation, qualify the exact Linux image, native web invocation/session
flow, provider-free page loads, actual PLG/OAuth/callback/assets dependencies,
current report publications, latency/body bounds and the rollback. Keep source
collection and the warehouse hold unchanged until their separate prerequisites
pass. Existing release controls must qualify/build the exact source and candidate;
this code neither changes CI/CD files nor creates a bypass release lane.
