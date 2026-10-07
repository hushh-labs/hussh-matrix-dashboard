#!/usr/bin/env node
/**
 * Read-only contract probe for the One Location analytics API.
 *
 * Run the dashboard server, then execute:
 *   npm run test:api:one-location -- --base-url http://127.0.0.1:3001 --days 7
 *
 * This checks the public aggregate payload only. It never prints event rows or
 * identifiers, and exits non-zero when the dashboard contract is incomplete.
 */

const FEATURE_KEYS = [
  'live_sharing',
  'location_viewed',
  'check_in',
  'check_out',
  'sms_safety',
  'request_location',
  'public_sharing',
  'contact_sync',
  'invitations',
  'circle_engagement',
];

const JOURNEY_KEYS = [
  'location_opened',
  'connect_opened',
  'contact_sync',
  'invitation_shared',
  'circle_engaged',
  'request_sent',
  'request_fulfilled',
  'live_shared',
  'check_in',
  'profile_opened',
];

const CIRCLE_KINDS = ['family', 'friends', 'other'];
const FORBIDDEN_KEY = /(?:user_?id|email|phone|latitude|longitude|coordinates?|token|circle_?name|member_?id|request_?id|invite_?code|message_?text)/i;

function parseArgs(argv) {
  const options = { baseUrl: 'http://127.0.0.1:3001', days: 7 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base-url' && argv[index + 1]) options.baseUrl = argv[++index].replace(/\/$/, '');
    else if (argv[index] === '--days' && argv[index + 1]) {
      const parsed = Number(argv[++index]);
      if (Number.isFinite(parsed) && parsed > 0) options.days = Math.floor(parsed);
    }
  }
  const positionalUrl = argv.find((value) => /^https?:\/\//.test(value));
  if (positionalUrl && options.baseUrl === 'http://127.0.0.1:3001') options.baseUrl = positionalUrl.replace(/\/$/, '');
  return options;
}

function sameMembers(actual, expected) {
  return actual.length === expected.length && expected.every((value) => actual.includes(value));
}

function forbiddenKeys(value, path = '$', found = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => forbiddenKeys(entry, `${path}[${index}]`, found));
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  for (const [key, entry] of Object.entries(value)) {
    const next = `${path}.${key}`;
    if (FORBIDDEN_KEY.test(key)) found.push(next);
    forbiddenKeys(entry, next, found);
  }
  return found;
}

function finiteOrNull(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const endpoint = `${options.baseUrl}/api/analytics/one/app?one_window_days=${options.days}`;
  const response = await fetch(endpoint, { headers: { accept: 'application/json' } });
  const payload = await response.json();
  const production = payload?.data?.production;
  const uat = payload?.data?.uat;
  const checks = [];
  const record = (name, ok, detail) => checks.push({ name, ok, detail });

  record('http_ok', response.ok, `HTTP ${response.status}`);
  record('not_cached', response.headers.get('cache-control')?.includes('no-store') === true,
    `cache-control=${response.headers.get('cache-control') || 'missing'}`);
  record('production_available', production?.available === true, `available=${String(production?.available)}`);
  record('uat_available', uat?.available === true, `available=${String(uat?.available)}`);
  record('environment_windows_match', production?.windowDays === options.days && uat?.windowDays === options.days,
    `production=${String(production?.windowDays)}d; uat=${String(uat?.windowDays)}d; requested=${options.days}d`);
  const productionNote = String(production?.locationAnalytics?.instrumentationNote ?? '').toLowerCase();
  const uatNote = String(uat?.locationAnalytics?.instrumentationNote ?? '').toLowerCase();
  record('environment_notes_isolated', !productionNote.includes('uat') && !uatNote.includes('production'),
    'production and UAT instrumentation messages name only their own environment');

  for (const [environment, summary] of [['production', production], ['uat', uat]]) {
    const location = summary?.locationAnalytics;
    const expectedWebHost = environment === 'production' ? 'one.hushh.ai' : 'uat.one.hushh.ai';
    record(`${environment}_location_contract_present`, Boolean(location), location ? 'locationAnalytics object present' : 'locationAnalytics missing');
    record(`${environment}_web_host_correct`, summary?.sourceWebHost === expectedWebHost,
      `sourceWebHost=${String(summary?.sourceWebHost)}; expected=${expectedWebHost}`);
    record(`${environment}_streaming_export_enabled`, summary?.realtimeMode === 'streaming_export',
      `realtimeMode=${String(summary?.realtimeMode)}`);
    record(`${environment}_streaming_lag_declared`, Number(summary?.expectedLagSeconds) <= 300,
      `expectedLagSeconds=${String(summary?.expectedLagSeconds)}`);

    const featureKeys = (location?.features ?? []).map((row) => row.key);
    const journeyKeys = (location?.journey ?? []).map((row) => row.key);
    const circleKinds = (location?.circleKinds ?? []).map((row) => row.kind);
    record(`${environment}_feature_catalogue_complete`, sameMembers(featureKeys, FEATURE_KEYS), `${featureKeys.length}/${FEATURE_KEYS.length} feature groups`);
    record(`${environment}_journey_catalogue_complete`, sameMembers(journeyKeys, JOURNEY_KEYS), `${journeyKeys.length}/${JOURNEY_KEYS.length} journey reach steps`);
    record(`${environment}_circle_mix_complete`, sameMembers(circleKinds, CIRCLE_KINDS), `kinds=${circleKinds.join(',') || 'none'}`);

    const metricRows = [
      ...(location?.features ?? []),
      ...(location?.journey ?? []),
      ...(location?.circleKinds ?? []),
      ...(location?.platforms ?? []),
    ];
    const numericFields = ['users', 'events', 'successes', 'expectedErrors', 'failures', 'creators', 'circlesCreated'];
    const invalidNumbers = metricRows.flatMap((row) => numericFields
      .filter((field) => field in row && !finiteOrNull(row[field]))
      .map((field) => `${row.key ?? row.kind ?? row.platform}.${field}`));
    record(`${environment}_aggregate_numbers_valid`, invalidNumbers.length === 0,
      invalidNumbers.length ? `invalid=${invalidNumbers.join(',')}` : `${metricRows.length} aggregate rows validated`);

    for (const [key, feature] of Object.entries(summary?.featureUsage ?? {})) {
      const breakdown = feature.eventBreakdown;
      record(`${environment}_${key}_result_partition`, feature.outcomeSignals === feature.successes + feature.expectedErrors + feature.failures && feature.outcomeSignals <= feature.signals, 'classified outcomes fit inside recorded events');
      record(`${environment}_${key}_source_events_reconcile`, Array.isArray(breakdown) && ['signals', 'successes', 'expectedErrors', 'failures'].every((field) => breakdown.reduce((sum, row) => sum + Number(row[field]), 0) === feature[field]), 'source-event subtotals equal feature totals');
    }

    const fulfilled = (location?.journey ?? []).find((row) => row.key === 'request_fulfilled');
    record(`${environment}_request_fulfilment_semantics_explicit`,
      typeof fulfilled?.observed === 'boolean'
        && finiteOrNull(fulfilled?.successes)
        && finiteOrNull(fulfilled?.failures)
        && (!fulfilled.observed || Number(fulfilled.successes) + Number(fulfilled.failures) > 0),
    `observed=${String(fulfilled?.observed)}; successes=${String(fulfilled?.successes)}; failures=${String(fulfilled?.failures)}`);

    const piiKeys = forbiddenKeys(location);
    record(`${environment}_no_sensitive_dimensions`, piiKeys.length === 0,
      piiKeys.length ? `forbidden keys=${piiKeys.join(',')}` : 'no identifier, contact, coordinate, token or free-text keys');

    const platforms = new Set((location?.platforms ?? []).map((row) => String(row.platform).toUpperCase()));
    const supportedPlatforms = new Set(['WEB', 'IOS', 'ANDROID']);
    record(`${environment}_platform_dimensions_safe`, [...platforms].every((platform) => supportedPlatforms.has(platform)),
      `observed source rows=${[...platforms].sort().join(',') || 'none'}; missing sources remain explicit and totals stay environment-scoped`);
  }

  const failures = checks.filter((check) => !check.ok);
  console.log(JSON.stringify({
    ok: failures.length === 0,
    checkedAt: new Date().toISOString(),
    endpoint,
    checks,
    failed: failures.length,
  }, null, 2));
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exit(2);
});
