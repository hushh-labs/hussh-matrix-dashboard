---
name: metrics-hushh-ai-ops
description: Operate, deploy, map, and extend metrics.hushh.ai. Use when working on the Hussh Matrix Dashboard, Cloud Run service hushh-matrix-dashboard, metrics.hushh.ai DNS/domain mapping, Namecheap CNAME, Google-managed certificate, Secret Manager runtime config, production probes, or new dashboard development that needs current production context.
---

# metrics.hushh.ai Ops

## Goal

Give Codex the production and development context needed to safely change, deploy, verify, and debug `metrics.hushh.ai` without rediscovering the Cloud Run, DNS, Secret Manager, and dashboard contracts each time.

## Canonical Context

- Product: Hushh Matrix Dashboard
- Repo: `hushh-labs/hussh-matrix-dashboard`
- Production URL: `https://metrics.hushh.ai`
- GCP project: `hushh-ai-prod`
- Region: `us-central1`
- Cloud Run service: `hushh-matrix-dashboard`
- Runtime service account: `metrics-dashboard-runtime@hushh-ai-prod.iam.gserviceaccount.com`
- Artifact Registry repo: `us-central1-docker.pkg.dev/hushh-ai-prod/website-images`
- DNS provider: Namecheap BasicDNS for `hushh.ai`
- Domain mapping: `metrics.hushh.ai` -> Cloud Run service `hushh-matrix-dashboard`
- DNS record: `metrics` CNAME -> `ghs.googlehosted.com`

## Workflow

1. Read repo context first.
   - Check `docs/deploy-metrics-hushh-ai.md`, `docs/metrics-hushh-ai-hosting-handoff.md`, `package.json`, `server.ts`, and existing production probe scripts.
   - Treat Cloud Run and live endpoints as the source of truth when docs contain stale revision/image values.

2. Keep runtime config secret-backed.
   - Use `$gcp-secret-manager` when adding, rotating, or wiring any token, key, credential, runtime env var, Supabase secret, Mixpanel secret, GA4 config, or Cloud Run service config.
   - Do not commit raw values or deploy plain secret values through `--set-env-vars`.
   - Verify Cloud Run env vars use `valueFrom.secretKeyRef`.

3. Develop against the aggregate dashboard contract.
   - Keep public APIs aggregate-only.
   - Do not expose raw user rows, emails, OTP rows, tokens, prompts, financial values, provider setup errors, or stack traces.
   - Keep unavailable data sources as explicit `waiting`/`unavailable` states rather than fake zeros, unless the source truly returned zero.

4. Deploy traceable revisions.
   - Run `npm run lint`, `npm run build`, `git diff --check`, and a targeted secret scan before deploy.
   - Build and deploy commit-tagged images to Cloud Run.
   - Preserve the runtime service account and Secret Manager bindings.

5. Verify production automatically.
   - Run `npm run test:prod:hushh-ai` and `npm run test:prod:one` when dashboard behavior changes.
   - Also check `https://metrics.hushh.ai/api/health` and `https://metrics.hushh.ai/api/analytics/all`.
   - Verify DNS/domain mapping when routing or certificate behavior changes.

6. Publish skill or dashboard changes through GitHub.
   - Use a branch, PR against `main`, and merge after validation.
   - If adding or updating skills, commit repo-local copies under `.codex/skills` and keep global copies in `~/.codex/skills` aligned.

## References

- Read [references/production-context.md](references/production-context.md) for exact deployment, DNS, domain mapping, and verification commands.
- Read [references/development-context.md](references/development-context.md) before adding new dashboard metrics, product sections, APIs, or probes.
