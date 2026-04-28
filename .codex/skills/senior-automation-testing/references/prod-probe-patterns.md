# Production Probe Patterns

Use these patterns when writing a live-service probe.

## Probe Shape

Recommended result object:

```json
{
  "ok": true,
  "target": "example.com",
  "checkedAt": "2026-04-29T00:00:00.000Z",
  "results": [
    { "check": "dns", "status": "ok", "detail": "example.com 1.2.3.4" },
    { "check": "health", "status": "ok", "detail": "ok" }
  ]
}
```

Use `status: "ok" | "fail" | "warn" | "waiting"` consistently. Exit non-zero for `fail`; do not exit non-zero for an expected `waiting` state unless readiness is an acceptance criterion.

## Standard Checks

- DNS resolves to the expected provider record.
- HTTPS root returns the expected success status.
- `/api/health` or equivalent returns a valid health payload.
- Product analytics/API endpoint returns the required contract.
- Aggregate endpoint includes the product block when relevant.
- `Cache-Control` is correct for live endpoints.
- No raw setup errors, stack traces, credentials, or person-level values are present.
- Cloud provider reports the expected latest ready revision/image when credentials are available.

## Implementation Guidance

- Prefer Node `fetch`, the repo's test runner, or existing CLI helpers.
- Add timeout wrappers so a dead service cannot hang the test indefinitely.
- Keep output stable enough for CI logs.
- Redact with allowlists instead of trying to blacklist every possible secret.
- Make hosts and projects overridable by env vars, but default to canonical production names.
