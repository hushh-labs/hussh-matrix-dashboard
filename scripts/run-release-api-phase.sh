#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == 'bigquery-off' ]] || { echo 'Choose the bigquery-off release phase.' >&2; exit 2; }
: "${PROJECT_ID:?Cloud project is required}"
: "${CANDIDATE_URL:?Zero-traffic candidate URL is required}"

# Re-authenticate in the workflow immediately before each bounded group. Never
# save these short-lived probe credentials in GITHUB_ENV or a workspace file.
trap 'unset SESSION_SECRET METRICS_AUTH_COOKIE' EXIT
SESSION_SECRET="$(gcloud secrets versions access latest --secret=metrics-dashboard-session-secret --project="${PROJECT_ID}")"
export SESSION_SECRET
METRICS_AUTH_COOKIE="$(node scripts/create-release-session.mjs)"
export METRICS_AUTH_COOKIE
unset SESSION_SECRET
export METRICS_DASHBOARD_URL="${CANDIDATE_URL}"
node --import ./scripts/release-auth-fetch.mjs scripts/check-public-analytics-contract.mjs --bigquery-off
