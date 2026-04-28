---
name: senior-automation-testing
description: Design and implement senior-grade automated testing and release verification workflows. Use when the user asks to avoid manual testing, write scripts or automations, verify APIs or dashboards, add production probes, create CI test commands, validate deployments, or safely redeploy after code/config changes.
---

# Senior Automation Testing

## Goal

Replace manual verification with deterministic checks that a senior test engineer would trust: scripts, API contracts, UI smoke coverage, production probes, deployment verification, and clear pass/fail reporting.

## Workflow

1. Define the target and risk.
   - Identify the product, environment, URLs, APIs, deployment target, owner branch, and the user-visible behavior that must be protected.
   - State assumptions when the target is ambiguous. Do not test or deploy the wrong production service.

2. Inventory existing verification.
   - Read `package.json`, test folders, CI workflows, deployment docs, Dockerfiles, health endpoints, and existing probe scripts.
   - Prefer existing repo commands and conventions before adding new tooling.

3. Build layered automation.
   - Static: lint, typecheck, formatting/diff checks, build, dependency checks when already established.
   - Unit/integration: isolate business logic and API handlers with fake external dependencies where practical.
   - API contracts: health, auth boundaries, status codes, response schema, cache headers, required source/freshness blocks, latency budget, and privacy assertions.
   - UI smoke: use Playwright or the repo's browser test runner for critical flows; capture screenshots only when visual correctness matters.
   - Production probe: DNS/TLS, root page, health API, product API, aggregate API, deployed revision/image, and logs for auth/IAM failures.

4. Write scripts.
   - Put reusable scripts in the repo's existing `scripts/` or test directory.
   - Add a single operator command such as `npm run test:prod:<target>` or `npm run verify:<target>`.
   - Emit machine-readable JSON summaries plus concise human output.
   - Exit non-zero on a real failure.
   - Redact secrets, tokens, emails, OTPs, person-level rows, prompts, and financial values.
   - Support environment overrides for hosts/projects, with safe canonical defaults.

5. Verify APIs like contracts, not screenshots.
   - Validate response shape, required fields, freshness states, and aggregate-only privacy constraints.
   - Treat unavailable integrations as explicit `waiting`/`unavailable` states only when that is the product contract.
   - Assert `no-store`/`no-cache` headers for live metrics APIs.
   - Use bounded timeouts and limited retries for network checks.

6. Redeploy only through the documented path.
   - Redeploy after code/config changes only after local checks pass.
   - Use commit-tagged artifacts or source revisions that can be traced to Git.
   - Keep runtime config in the platform secret store.
   - After deploy, verify the live revision, URL, health API, product API, and production probe.
   - If postdeploy checks fail and a known previous healthy revision exists, follow the repo's rollback procedure.

7. Report evidence.
   - List the exact commands run, deployed revision or URL, pass/fail result, and any unverified gap.
   - Do not describe manual browser inspection as proof unless the user explicitly asked for manual testing.

## References

- Read [references/test-plan-contract.md](references/test-plan-contract.md) when designing a new automation suite or deciding what belongs in a production probe.
- Read [references/prod-probe-patterns.md](references/prod-probe-patterns.md) when implementing a script that checks a live service.
