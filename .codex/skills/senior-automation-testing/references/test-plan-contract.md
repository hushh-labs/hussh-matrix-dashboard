# Test Plan Contract

Use this contract when turning a manual checklist into automated verification.

## Required Outputs

- A named command the team can run locally and in CI.
- Clear target selection: environment, host, project, service, branch, and revision when available.
- Deterministic exit code: `0` for pass, non-zero for fail.
- Structured summary with `ok`, `checkedAt`, `target`, and per-check results.
- Sanitized logs that never print secrets, person-level data, OTPs, emails, tokens, prompts, or financial values.

## Minimum Check Layers

1. Repository checks: lint/typecheck, build, formatting or whitespace checks, and secret scan.
2. API checks: health endpoint, core endpoint contracts, status codes, cache headers, required JSON fields, and privacy assertions.
3. UI checks: one happy-path smoke flow for critical frontend pages when the product has a UI.
4. Integration checks: cloud identity, secret-backed env vars, database/export/source availability, and explicit waiting states for known blockers.
5. Production checks: DNS, TLS, root page, health API, product API, deployed revision/image, and service logs for recent auth/IAM errors.

## API Assertions

- Assert success status codes exactly where possible.
- Validate JSON schema or required fields, not just HTTP 200.
- Check arrays have expected shape and aggregate fields use numbers, strings, booleans, or explicit nulls.
- Verify no raw stack traces, internal setup errors, tokens, OTPs, emails, or person-level records are exposed.
- For live dashboards, require `Cache-Control: no-store` or equivalent.

## Deployment Assertions

- The artifact should be traceable to the current commit SHA.
- Runtime env values that are secrets should resolve from the cloud secret store.
- The latest ready revision should serve traffic before the old revision is considered replaceable.
- Postdeploy probes should run against the public production URL, not only the provider URL.

## Failure Policy

- Fail fast for contract violations, exposed secrets, incorrect host, incorrect project, or failed deploy health.
- Mark optional data sources as `waiting` only when the product contract explicitly allows that state.
- Capture enough sanitized detail to debug without leaking credentials or user data.
