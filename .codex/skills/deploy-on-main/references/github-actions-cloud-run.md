# GitHub Actions To Cloud Run Pattern

Use this pattern when adding deploy-on-main automation for a Cloud Run service.

## Required Repository Inputs

- `PROJECT_ID`
- `REGION`
- `SERVICE`
- `ARTIFACT_REGISTRY_REPOSITORY`
- `RUNTIME_SERVICE_ACCOUNT`
- Workload Identity Federation provider and deploy service account, or an existing approved auth method
- Production probe command, for example `npm run test:prod:one`

## Workflow Shape

```yaml
name: Deploy Production

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: production-${{ github.ref }}
  cancel-in-progress: false

permissions:
  contents: read
  id-token: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci
      - run: npm run lint
      - run: npm run build
      - run: git diff --check
      - run: rg "SECRET|TOKEN|PASSWORD|PRIVATE_KEY" . --glob '!node_modules/**' --glob '!dist/**'

      - id: auth
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}
          service_account: ${{ secrets.GCP_DEPLOY_SERVICE_ACCOUNT }}

      - uses: google-github-actions/setup-gcloud@v2

      - run: gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

      - run: |
          IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REGISTRY_REPOSITORY}/${SERVICE}:${GITHUB_SHA}"
          gcloud builds submit --project="${PROJECT_ID}" --tag="${IMAGE}" .
          gcloud run deploy "${SERVICE}" \
            --project="${PROJECT_ID}" \
            --region="${REGION}" \
            --image="${IMAGE}" \
            --service-account="${RUNTIME_SERVICE_ACCOUNT}" \
            --allow-unauthenticated

      - run: npm run test:prod
```

Adapt variable names to the repo. Prefer repository or environment variables for non-secret values and GitHub secrets only for auth identifiers that should not be public.

## Postdeploy Verification

After the deploy step, always check:

- Latest ready revision exists.
- Production URL returns HTTP 200.
- Health endpoint returns valid payload.
- Product-specific probe passes.
- Runtime secret env vars still use cloud secret references.

## Rollback Pattern

If the repo has an existing rollback script, call it on postdeploy failure. Otherwise document the manual fallback:

```bash
gcloud run services update-traffic "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --to-revisions="$LAST_HEALTHY_REVISION=100"
```

Only automate rollback when the workflow can reliably identify the last healthy revision.
