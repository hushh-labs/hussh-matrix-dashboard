# Gcloud Secret Manager Patterns

Use these patterns to store and wire secrets without exposing values.

## Create Or Update A Secret

Prefer interactive secret input when a human is present:

```bash
PROJECT="hushh-ai-prod"
SECRET_NAME="example-runtime-secret"

read -rsp "Secret value: " SECRET_VALUE
printf '\n'

if gcloud secrets describe "$SECRET_NAME" --project="$PROJECT" >/dev/null 2>&1; then
  printf '%s' "$SECRET_VALUE" | gcloud secrets versions add "$SECRET_NAME" \
    --project="$PROJECT" \
    --data-file=-
else
  printf '%s' "$SECRET_VALUE" | gcloud secrets create "$SECRET_NAME" \
    --project="$PROJECT" \
    --replication-policy=automatic \
    --data-file=-
fi

unset SECRET_VALUE
```

If the value is already in a local environment variable, pipe it directly:

```bash
printf '%s' "$LOCAL_SECRET_VALUE" | gcloud secrets versions add "$SECRET_NAME" \
  --project="$PROJECT" \
  --data-file=-
```

Do not put the raw secret value into shell commands, docs, PR bodies, or commit messages.

## Grant Runtime Access

```bash
gcloud secrets add-iam-policy-binding "$SECRET_NAME" \
  --project="$PROJECT" \
  --member="serviceAccount:$RUNTIME_SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor"
```

Grant access to the runtime service account, not to broad users or default principals.

## Wire Cloud Run Env Vars

For an existing service:

```bash
gcloud run services update "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --update-secrets="ENV_NAME=$SECRET_NAME:latest"
```

For a deploy:

```bash
gcloud run deploy "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --image="$IMAGE" \
  --service-account="$RUNTIME_SERVICE_ACCOUNT" \
  --set-secrets="ENV_NAME=$SECRET_NAME:latest"
```

Use `--update-secrets` when preserving the rest of the service configuration. Use `--set-secrets` in full deterministic deploy commands that define the complete runtime contract.

## Verify

```bash
gcloud secrets versions list "$SECRET_NAME" \
  --project="$PROJECT" \
  --filter='state=ENABLED' \
  --limit=1

gcloud run services describe "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --format='yaml(spec.template.spec.containers[0].env)'
```

Look for `valueFrom.secretKeyRef`; do not print the secret value.
