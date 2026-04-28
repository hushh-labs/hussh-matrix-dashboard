---
name: deploy-on-main
description: Set up, review, and operate automatic production deployments that run after PRs merge to main. Use when configuring GitHub Actions, Cloud Build triggers, Cloud Run/Vercel production deploys, branch protection, release gates, postdeploy probes, rollback paths, or when the user says merged PRs should deploy to prod automatically.
---

# Deploy On Main

## Goal

Make `main` the auditable path to production: after a PR is merged, automation builds the exact commit, deploys it, runs postdeploy probes, and leaves clear evidence. A Codex skill is not a background daemon; use this skill to create or maintain the CI/CD workflow that performs the automatic deploy.

## Workflow

1. Discover the production path.
   - Identify the default branch, hosting provider, service name, region, artifact registry, runtime service account, secret store, and existing deployment docs.
   - Verify whether the repo already has GitHub Actions, Cloud Build triggers, Vercel project settings, or another deploy-on-main mechanism.

2. Choose the trigger.
   - Prefer `push` to `main` for automatic production deploy after PR merge.
   - Do not deploy production from `pull_request` events.
   - Add `workflow_dispatch` only as an operator escape hatch.
   - Add a concurrency group for production so overlapping deploys cannot race.

3. Build gates before deploy.
   - Run install, lint/typecheck, tests, build, formatting checks, and secret scan before any production deploy step.
   - Require the same checks in branch protection when possible.
   - Keep deployment blocked if tests fail.

4. Authenticate safely.
   - Prefer GitHub OIDC / Workload Identity Federation for cloud providers.
   - Use minimum IAM roles for the deploy identity.
   - Keep runtime secrets in the cloud secret store, not GitHub Actions plaintext env vars, unless the platform requires a non-secret public build variable.

5. Deploy a traceable artifact.
   - Build or deploy the exact Git commit SHA.
   - Tag container images with `${{ github.sha }}` or the short SHA.
   - Deploy to the documented production service and region only.
   - Preserve existing runtime secret bindings unless deliberately changing them.

6. Verify after deploy.
   - Run the product's production probe, such as `npm run test:prod:<product>`.
   - Verify public domain, health endpoint, core API contract, cache headers, and latest ready revision/image.
   - If postdeploy checks fail, use the documented rollback path or route traffic back to the last known healthy revision.

7. Document and report.
   - Update deployment docs with trigger, required secrets/IAM, commands, rollback, and validation.
   - In the final report, include workflow file path, production service, postdeploy command, and any IAM or secret setup that remains manual.

## GCP Cloud Run Defaults

- Use Artifact Registry and Cloud Run in the repo's existing project/region.
- Use `gcloud run deploy` or Cloud Build only after tests pass.
- Verify deployed env vars that are secrets use `valueFrom.secretKeyRef`.
- Grant deploy-time IAM to the CI identity and runtime IAM to the service account separately.
- Read [references/github-actions-cloud-run.md](references/github-actions-cloud-run.md) before adding a GitHub Actions workflow for Cloud Run.

## Safety Rules

- Do not introduce long-lived service account JSON keys unless the repo has no viable OIDC path and the user accepts that tradeoff.
- Do not print secrets in workflow logs.
- Do not add manual approvals when the user explicitly wants automatic deploy-on-main, unless production policy requires them.
- Do not merge or deploy unrelated changes while setting up the workflow.
