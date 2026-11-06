# UAT workspace on Metrics

`/plg/uat/workspace` uses the existing Metrics Google work-profile login and
operator membership. It reads the registered UAT directory, agent activity,
search and numbered cursor pages. `/plg/uat` shows the signed-in owner's current
UAT observations. These pages do not load Production campaign records or use
them to infer UAT activity, eligibility or email delivery.

The hosted view is default off. `PLG_UAT_VIEW_ENABLED=true` requires the actual
Production Metrics origin and Firestore project/database tuple, with no Dev or
UAT runtime impersonation. An explicitly conflicting cloud project is refused.
The Production dashboard's existing secrets can remain mounted, but cannot be
reused for UAT signatures. No runtime, secret or access configuration is activated
by this application change.

Directory reads also require `PLG_UAT_AUDIENCE_ENABLED=true` and the separate
`PLG_UAT_AUDIENCE_SECRET`. Owner reads require `PLG_UAT_EVIDENCE_ENABLED=true`,
`PLG_UAT_IDENTITY_MODE=live-signed` and `PLG_UAT_SOURCE_SECRET`. The corresponding
One UAT routes must already be deployed and explicitly activated. These keys
must be bound through Secret Manager; they must differ from Production source,
directory, subscription, worker, cycle and signing credentials and each other.

The hosted Matrix workflow owns this switch. After One UAT is deployed and its
signed read routes are verified, provision the two dedicated Secret Manager
containers from `infra/one-plg` and load the matching UAT owner and directory
keys into `metrics-one-plg-uat-source-secret` and
`metrics-one-plg-uat-audience-secret` in `hushh-ai-prod`. Set the Matrix
repository variable `ONE_PLG_HOSTED_UAT_VIEW_CONFIGURED=true` and use the
existing zero-traffic candidate and promotion process. Clearing the variable
disables all three view flags and removes both UAT mounts on the next release.

Requests use only fixed `https://api.uat.hushh.ai` routes and UAT HMAC purposes.
Redirects, Production payloads and asserted delivery authority are refused.
The owner view derives an email hash from the verified session and rechecks
current UAT identity and owner epoch around the snapshot. The directory uses
existing operator authorization and same-origin checks, supports cancellation,
and never opens the Production campaign store. There is no per-person UAT
allowlist beyond existing work-profile sign-in policy for dashboard access.

Activity capture remains best effort. Missing events are unknown. Reading these
pages does not grant email permission: each One UAT user separately enables
activity emails, and the independently deployed worker must prove current
recipient authority, durable deduplication and actual provider feedback.
Search/pagination tests and local source fixtures do not establish live UAT
activity, Inbox delivery, every-agent coverage or a delivery-time guarantee.
