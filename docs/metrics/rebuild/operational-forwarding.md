# Held operational forwarding for the Metrics cutover

The new Next.js application has a default-closed operational route boundary.
This implements forwarding; it does not activate it or qualify native routing.
The retained legacy app and independent PLG mail worker stay unchanged.

Only known Google sign-in/callback/session/logout paths, PLG pages and APIs,
PLG integration/preferences/unsubscribe callbacks, legacy assets/favicon and
login/denied pages can be forwarded. New report APIs are owned by Next.js.
Unknown/provider paths, including `/api/analytics/*`, never reach a legacy source
loader through this boundary. A legacy PLG UI requiring additional aggregate
paths needs explicit route/dependency review; no broad fallback is installed.

`METRICS_LEGACY_WEB_CONFIG` is strict/default absent. Its approved values are
`approved`, `legacyOrigin`, `webNativeOrigin`, `publicOrigin`, `timeoutMs`,
`maxRequestBytes`, `maxResponseBytes`. The retained origin is pinned to the
verified legacy Cloud Run service URL; the new native web service must be
distinct and named `metrics-report-web-*`. The public origin is exactly
`https://metrics.hussh.ai`. This prevents replacing the retained service with
Next.js and accidentally proxying back into itself. An approval field is not
proof of actual reviewed resource identity.

Bounds are at most30seconds total,64KiB request and2MiB response, with no retries.
These are refusal ceilings, not approved performance settings. Bodies are read
within the remaining deadline and bounded before forwarding/allocation. Failed
or interrupted operations remain unavailable, not proof an upstream side effect
did not occur. A timeout cannot justify repeating mail or worker actions.

The proxy preserves raw signed callback bytes, original Origin, allowed cookies,
HMAC/Svix headers and upstream authorization/denial status. It strips incoming
Host/forwarded and spoofable Google infrastructure identity headers. Existing
legacy handlers keep their current cookie, signature, role and origin authority;
the new web process is not another PLG/consent/provider authority.

Redirects are never followed server-side. Only the canonical Metrics origin or
Google Accounts may be returned as destinations. Separate host-only Set-Cookie
headers are preserved; domain-changing cookies refuse. Responses are private,
no-store and vary on Cookie/Authorization; decoded bodies do not retain stale
upstream encoding/length/cache headers. No source credentials enter this module.

Logic tests cover unknown/provider refusal, finite config/origin isolation,
byte-exact signatures, spoofed-header removal, preserved denied/unsubscribe
responses, cookies/redirects, body limits and stalled fetches. An integration
case drives the actual existing Express OAuth start/callback/session/logout
through this boundary into the reporting cookie verifier. Google exchange is
stubbed. Missing verified Workspace-domain metadata is still denied; the
positive fixture includes it rather than changing production authorization.

Before serving cutover, verify the actual retained image/target, Google callback
and browser cookie flow, all required PLG UI assets/API dependencies, signed
provider callbacks and unsubscribe links, denial/revocation/origin boundaries,
real request/response durations, native ingress and rollback. The actual Linux
container and identity/routing/storage/queue setup remain separate acceptance
requirements. Do not point the domain at a source-free web build because local
protocol tests passed.
