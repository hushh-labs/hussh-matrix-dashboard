---
name: gcp-secret-manager
description: Store, rotate, and wire secrets through Google Cloud Secret Manager. Use whenever a user provides or asks to add API keys, access tokens, service-role keys, OAuth secrets, webhook secrets, database credentials, environment secrets, Supabase/Mixpanel/GitHub/GCP credentials, or Cloud Run runtime config that must not be committed or exposed.
---

# GCP Secret Manager

## Goal

Make Secret Manager the default path for sensitive configuration. When a secret appears in the conversation, repo, docs, env files, deployment command, or runtime config, store it in Google Cloud Secret Manager and wire services to the secret reference instead of committing or exposing the value.

## Workflow

1. Classify the value.
   - Treat API keys, service-role keys, access tokens, OAuth secrets, project API secrets, webhook signing secrets, private keys, passwords, database URLs with credentials, and runtime-only env vars as secrets.
   - Treat frontend `NEXT_PUBLIC_*`, analytics project tokens, or publishable keys as public only when the provider explicitly documents them as public-safe.
   - If unsure, handle the value as secret.

2. Stop leakage first.
   - Do not echo, quote, paste, or commit the secret value.
   - If the value was pasted in chat or committed before, recommend rotation before production use.
   - Scan the intended diff for secret prefixes and exact leaked values before committing.

3. Identify the GCP target.
   - Determine `PROJECT`, `SECRET_NAME`, `RUNTIME_SERVICE_ACCOUNT`, service name, and region from repo docs, existing Cloud Run config, or explicit user instructions.
   - Use a descriptive lowercase secret name such as `metrics-dashboard-kai-prod-ga4-dataset` or `hushh-ai-supabase-access-token`.

4. Create or update the secret.
   - Use secure stdin or an environment variable, not inline literals.
   - Create the secret if it does not exist; otherwise add a new version.
   - Never write the raw value to a temp file unless the platform forces it, and delete it immediately if so.

5. Grant least-privilege access.
   - Grant `roles/secretmanager.secretAccessor` only to the runtime service account that needs the secret.
   - Do not grant broad project users, default service accounts, or CI accounts secret access unless deployment requires it.

6. Wire runtime config.
   - For Cloud Run, prefer `--update-secrets` or `--set-secrets` so env vars resolve from `valueFrom.secretKeyRef`.
   - Keep secret values out of frontend bundles and build logs.
   - Preserve existing secret bindings unless deliberately changing them.

7. Verify.
   - Confirm the secret exists and has an enabled latest version.
   - Confirm IAM binding exists for the runtime service account.
   - Confirm the deployed service template references `valueFrom.secretKeyRef`.
   - Run the app's production probe or health/API checks after redeploying.

8. Document without exposing.
   - Document secret names, required env var names, IAM principals, and deploy commands.
   - Never document raw values.

## References

- Read [references/gcloud-secret-manager.md](references/gcloud-secret-manager.md) for safe command patterns.
