#!/usr/bin/env bash
set -euo pipefail
[[ "${GITHUB_REF:-}" == refs/heads/main && "${SOURCE_SHA:-}" =~ ^[a-f0-9]{40}$ ]] || exit 1
[[ "${TARGET_ENVIRONMENT:-}" == dev || "${TARGET_ENVIRONMENT:-}" == uat ]] || exit 1
[[ "$(git rev-parse HEAD)" == "$SOURCE_SHA" ]] || exit 1
[[ "$PROJECT_ID" == "hushh-pda-$TARGET_ENVIRONMENT" ]] || exit 1
[[ "${MATRIX_OWNER_READ_ENABLED:-false}" == true || "${MATRIX_OWNER_READ_ENABLED:-false}" == false ]] || exit 1
directory="$RUNNER_TEMP/matrix-runtime"
mkdir -p "$directory"

# Fail before image/service mutation if OAuth inputs or referenced versions are absent.
node --input-type=module <<'NODE'
import { writeFileSync } from 'node:fs';
import { environmentService } from './scripts/plg-environment-release.mjs';
const config = { environment: process.env.TARGET_ENVIRONMENT, source: process.env.SOURCE_SHA,
  image: `us-central1-docker.pkg.dev/hushh-pda-dev/matrix-images/hushh-matrix-dashboard@sha256:${'0'.repeat(64)}`,
  clientId: process.env.MATRIX_GOOGLE_CLIENT_ID, versions: JSON.parse(process.env.MATRIX_SECRET_VERSIONS || 'null'),
  readEnabled: process.env.MATRIX_OWNER_READ_ENABLED === 'true' };
environmentService(config); // Schema validation only; this placeholder image is never deployed.
writeFileSync(`${process.env.RUNNER_TEMP}/matrix-runtime/config.json`, JSON.stringify(config));
for (const [secret, version] of Object.entries(config.versions)) process.stdout.write(`${secret} ${version}\n`);
NODE
node --input-type=module <<'NODE' > "$directory/versions.txt"
import { readFileSync } from 'node:fs';
const { versions } = JSON.parse(readFileSync(`${process.env.RUNNER_TEMP}/matrix-runtime/config.json`, 'utf8'));
for (const [secret, version] of Object.entries(versions)) console.log(secret, version);
NODE
while read -r secret version; do
  state="$(gcloud secrets versions describe "$version" --secret="$secret" --project="$PROJECT_ID" --format='value(state)')"
  [[ "$state" == ENABLED ]] || exit 1
done < "$directory/versions.txt"

# Only this named Matrix runtime may be changed; never adopt an unrelated service.
gcloud run services list --project="$PROJECT_ID" --region=us-central1 --format=json > "$directory/services.json"
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const services = JSON.parse(readFileSync(`${process.env.RUNNER_TEMP}/matrix-runtime/services.json`, 'utf8'));
const existing = services.find(s => s.metadata?.name === 'hushh-matrix-dashboard');
if (existing) {
  assert.equal(existing.metadata.labels?.['plg-environment'], process.env.TARGET_ENVIRONMENT);
  assert.equal(existing.spec?.template?.spec?.serviceAccountName, `matrix-runtime@${process.env.PROJECT_ID}.iam.gserviceaccount.com`);
}
NODE

if [[ "$TARGET_ENVIRONMENT" == dev ]]; then
  tag="us-central1-docker.pkg.dev/hushh-pda-dev/matrix-images/hushh-matrix-dashboard:$SOURCE_SHA"
  gcloud auth configure-docker us-central1-docker.pkg.dev --quiet
  docker build --pull --label "org.opencontainers.image.revision=$SOURCE_SHA" --tag "$tag" .
  docker push "$tag"
  digest="$(gcloud artifacts docker images describe "$tag" --project=hushh-pda-dev --format='value(image_summary.digest)')"
  [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 1
  export MATRIX_IMAGE="${tag%:*}@$digest"
else
  [[ "${DEV_RUN_ID:-}" =~ ^[0-9]+$ ]] || exit 1
  gh api "repos/$GITHUB_REPOSITORY/actions/runs/$DEV_RUN_ID" > "$directory/dev-run.json"
  gh run download "$DEV_RUN_ID" --repo "$GITHUB_REPOSITORY" --name matrix-dev-runtime --dir "$directory/dev"
  export MATRIX_IMAGE="$(node --input-type=module <<'NODE'
  import { readFileSync } from 'node:fs';
  import { devRuntimeImage } from './scripts/plg-environment-release.mjs';
  const dir = `${process.env.RUNNER_TEMP}/matrix-runtime`;
  const run = JSON.parse(readFileSync(`${dir}/dev-run.json`, 'utf8'));
  const dev = JSON.parse(readFileSync(`${dir}/dev/result.json`, 'utf8'));
  process.stdout.write(devRuntimeImage(run, dev, process.env.SOURCE_SHA, process.env.DEV_RUN_ID));
NODE
  )"
fi

node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { environmentService } from './scripts/plg-environment-release.mjs';
const dir = `${process.env.RUNNER_TEMP}/matrix-runtime`;
const config = JSON.parse(readFileSync(`${dir}/config.json`, 'utf8'));
config.image = process.env.MATRIX_IMAGE;
writeFileSync(`${dir}/service.json`, JSON.stringify(environmentService(config), null, 2));
NODE
# Full owned manifest clears stale mounts; it never merges Production settings.
gcloud run services replace "$directory/service.json" --project="$PROJECT_ID" --region=us-central1 --quiet
gcloud run services add-iam-policy-binding hushh-matrix-dashboard --project="$PROJECT_ID" --region=us-central1 \
  --member=allUsers --role=roles/run.invoker --quiet > /dev/null
gcloud run services describe hushh-matrix-dashboard --project="$PROJECT_ID" --region=us-central1 --format=json > "$directory/service-observed.json"
revision="$(node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const observed = JSON.parse(readFileSync(`${process.env.RUNNER_TEMP}/matrix-runtime/service-observed.json`, 'utf8'));
const revision = observed.status?.latestReadyRevisionName;
assert(/^hushh-matrix-dashboard-[a-z0-9-]+$/.test(revision));
assert.equal(revision, observed.status?.latestCreatedRevisionName);
const traffic = observed.status?.traffic?.filter(t => t.percent > 0);
assert.equal(traffic?.length, 1); assert.equal(traffic[0].revisionName, revision); assert.equal(traffic[0].percent, 100);
process.stdout.write(revision);
NODE
)"
gcloud run revisions describe "$revision" --project="$PROJECT_ID" --region=us-central1 --format=json > "$directory/revision.json"
node scripts/plg-environment-release.mjs revision "$directory/revision.json" "$directory/service.json"
export METRICS_DASHBOARD_URL="$(node --input-type=module -e 'import {environmentTarget} from "./scripts/plg-environment-release.mjs"; process.stdout.write(environmentTarget(process.env.TARGET_ENVIRONMENT).origin)')"
export GOOGLE_CLIENT_ID="$MATRIX_GOOGLE_CLIENT_ID" GOOGLE_REDIRECT_URI="$METRICS_DASHBOARD_URL/auth/callback"
node scripts/check-auth-production.mjs
export MATRIX_REVISION="$revision"
node --input-type=module <<'NODE'
import { writeFileSync } from 'node:fs';
const result = { at: new Date().toISOString(), environment: process.env.TARGET_ENVIRONMENT,
  project: process.env.PROJECT_ID, source: process.env.SOURCE_SHA, image: process.env.MATRIX_IMAGE,
  revision: process.env.MATRIX_REVISION, origin: process.env.METRICS_DASHBOARD_URL,
  ciRun: process.env.CI_RUN_ID, workflowRun: process.env.GITHUB_RUN_ID,
  runtimeVerified: true, ownerReadEnabled: process.env.MATRIX_OWNER_READ_ENABLED === 'true',
  interactiveSignInVerified: false, behaviourVerified: false, emailEnabled: false, inboxVerified: false };
writeFileSync(`${process.env.RUNNER_TEMP}/matrix-runtime/result.json`, JSON.stringify(result, null, 2));
console.log('Native runtime and anonymous auth boundary verified. Owner sign-in, behaviour and email remain unaccepted.');
NODE
