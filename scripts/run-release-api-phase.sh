#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in core|customers|contracts) ;; *) echo 'Choose a release verification phase.' >&2; exit 2 ;; esac
: "${PROJECT_ID:?Cloud project is required}"
: "${CANDIDATE_URL:?Zero-traffic candidate URL is required}"

# Re-authenticate in the workflow immediately before each bounded group. Never
# save these short-lived probe credentials in GITHUB_ENV or a workspace file.
trap 'unset SESSION_SECRET METRICS_AUTH_COOKIE NODE_OPTIONS PLG_ONE_AUDIENCE_SECRET' EXIT
SESSION_SECRET="$(gcloud secrets versions access latest --secret=metrics-dashboard-session-secret --project="${PROJECT_ID}")"
export SESSION_SECRET
METRICS_AUTH_COOKIE="$(node scripts/create-release-session.mjs)"
export METRICS_AUTH_COOKIE
unset SESSION_SECRET
export BQ_JOB_PROJECT="${PROJECT_ID}"
export METRICS_DASHBOARD_URL="${CANDIDATE_URL}"
export HUSHH_AI_PRODUCTION_URL="${CANDIDATE_URL}"
export PLG_ONE_AUDIENCE_URL=https://api.hushh.ai/api/one/plg/audience
PLG_ONE_AUDIENCE_SECRET="$(gcloud secrets versions access latest --secret=metrics-one-plg-audience-secret --project="${PROJECT_ID}")"
export PLG_ONE_AUDIENCE_SECRET
export NODE_OPTIONS="--import=$(pwd)/scripts/release-auth-fetch.mjs"

case "$1" in
  core)
    node scripts/check-metrics-flow.mjs --dashboard-url "${CANDIDATE_URL}" --timeout-ms 120000
    node scripts/check-hushh-ai-production.mjs --base-url "${CANDIDATE_URL}" --timeout-ms 120000
    node scripts/check-one-production.mjs --dashboard-url "${CANDIDATE_URL}" --timeout-ms 120000
    node scripts/check-one-location-analytics-contract.mjs --base-url "${CANDIDATE_URL}" --days 7
    ;;
  customers)
    node scripts/check-one-metrics-reconciliation.mjs --dashboard-url "${CANDIDATE_URL}"
    node scripts/check-one-ios-account-kpis.mjs --dashboard-url "${CANDIDATE_URL}"
    node scripts/check-one-ios-usage-kpis.mjs --dashboard-url "${CANDIDATE_URL}"
    node scripts/check-one-platform-kpis.mjs --dashboard-url "${CANDIDATE_URL}"
    node scripts/check-one-registered-accounts-reconciliation.mjs --dashboard-url "${CANDIDATE_URL}" --days 30 --require-global
    ;;
  contracts)
    node scripts/check-dashboard-kpi-invariants.mjs --base-url "${CANDIDATE_URL}" --timeout-ms 120000
    node scripts/check-public-analytics-contract.mjs --base-url "${CANDIDATE_URL}" --days 7 --timeout-ms 120000
    node scripts/check-founder-briefing-contract.mjs --base-url "${CANDIDATE_URL}" --timeout-ms 120000
    node scripts/check-founder-briefing-contract.mjs --base-url "${CANDIDATE_URL}" --timeout-ms 120000 --start-date 2026-08-01 --end-date 2026-08-31
    node scripts/check-founder-briefing-contract.mjs --base-url "${CANDIDATE_URL}" --timeout-ms 120000 --start-date 2026-06-24 --end-date 2026-09-21
    ;;
esac
