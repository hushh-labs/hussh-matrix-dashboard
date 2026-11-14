# Native worker health

Use `GET /health` for the private Cloud Run reporting collector. The former
`/healthz` alias remains available inside the container for compatibility, but
Google Frontend can reserve that path before a request reaches the service.
Native qualification of exact image `d809df5f` found the same frontend HTML404
for both advertised hostnames and authenticated/anonymous `/healthz` requests.
The anonymous root correctly returned403 and the private web sign-in returned200.

The health response contains only `{"status":"ok"}` with private/no-store.
It does not inspect staff authority, Firestore, sources, queue state or collection
readiness. Cloud Run IAM still protects the service. A successful health response
therefore establishes process reachability, not source/publication acceptance.
POST, trailing-slash and internal role checks retain their existing behavior.

The focused regression fails unchanged `151b066` (five original controls pass).
This is an application route correction, with no CI/CD, image definition, runtime
permission or collection-policy change. Qualify its new image before using it
as native health proof; the prior failed probe receipt remains retained.

Reference: [Cloud Run known issues](https://docs.cloud.google.com/run/docs/known-issues#reserved-url-paths).

## Retained session normalization

The same native candidate qualification also rejected a trusted release cookie.
An in-memory compatibility diagnostic established that the existing secret has
surrounding whitespace: the retained sign-in signer and release helper trim it,
while the report verifier did not. No key or cookie was persisted in evidence.
The verifier now applies the same trim before signature and staff-quota hashing.
The regression proves the same authority and quota identity with newline-wrapped
config, while blank keys and tampered cookies still fail closed. Browser fixtures
now use the actual percent-encoded OAuth cookie format rather than a raw shortcut.
Existing secret versions, allowlists and Google sign-in behavior are unchanged.
