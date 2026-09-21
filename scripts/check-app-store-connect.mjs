#!/usr/bin/env node
/**
 * Read-only contract probe for the App Store Connect analytics API.
 *
 * Run the dashboard server, then execute:
 *   npm run test:api:app-store-connect -- --base-url http://127.0.0.1:3001
 *
 * Works with or without real App Store Connect credentials configured: with
 * no credentials it asserts the "not connected" shape; with credentials it
 * asserts the metric contract for both Production (Analytics Reports API)
 * and TestFlight (beta tester roster + feedback REST resources) -- two
 * different Apple APIs with two different metric shapes, checked separately.
 */

function parseArgs(argv) {
  const options = { baseUrl: 'http://127.0.0.1:3001' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base-url' && argv[index + 1]) options.baseUrl = argv[++index].replace(/\/$/, '');
  }
  const positionalUrl = argv.find((value) => /^https?:\/\//.test(value));
  if (positionalUrl && options.baseUrl === 'http://127.0.0.1:3001') options.baseUrl = positionalUrl.replace(/\/$/, '');
  return options;
}

const PRODUCTION_METRIC_KEYS = [
  'impressions',
  'productPageViews',
  'firstTimeDownloads',
  'redownloads',
  'totalDownloads',
  'conversionRate',
  'sessions',
  'activeDevices',
  'installations',
  'crashes',
  'deletions',
];

const TESTFLIGHT_METRIC_KEYS = ['testerCount', 'testersByState', 'invites', 'installs', 'sessions', 'crashes', 'feedback'];
const TESTFLIGHT_STATE_KEYS = ['notInvited', 'invited', 'accepted', 'installed', 'revoked'];

function finiteOrNull(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const endpoint = `${options.baseUrl}/api/analytics/app-store-connect`;
  const response = await fetch(endpoint, { headers: { accept: 'application/json' } });
  const payload = await response.json();
  const data = payload?.data;
  const production = data?.production;
  const testflight = data?.testflight;
  const checks = [];
  const record = (name, ok, detail) => checks.push({ name, ok, detail });

  record('http_ok', response.ok, `HTTP ${response.status}`);
  record('app_id_present', typeof data?.appAppleId === 'string' && data.appAppleId.length > 0,
    `appAppleId=${String(data?.appAppleId)}`);
  record('no_credentials_leaked', !JSON.stringify(payload).match(/-----BEGIN [A-Z ]+PRIVATE KEY-----/),
    'response contains no private key material');

  record('testflight_always_has_note', typeof testflight?.note === 'string' && testflight.note.length > 0,
    `testflight.note=${JSON.stringify(testflight?.note)}`);

  if (testflight?.available === false) {
    record('testflight_metrics_null_when_unavailable', testflight?.metrics === null,
      `testflight.metrics=${JSON.stringify(testflight?.metrics)}`);
  } else {
    // Real data came back -- the note must still say sessions/crashes/feedback
    // are a trailing-period rollup and invites/installs are per-build, never
    // silently dropped just because the numbers came back.
    record('testflight_note_names_the_rollup_caveat', /install|session/i.test(String(testflight?.note ?? '')),
      'when available, note must explain the trailing-period rollup and per-build invites/installs sourcing');
    const metrics = testflight?.metrics ?? {};
    const scalarKeys = TESTFLIGHT_METRIC_KEYS.filter((key) => key !== 'testersByState');
    const invalidScalars = scalarKeys.filter((key) => !(key in metrics) || !finiteOrNull(metrics[key]));
    record('testflight_scalar_metric_contract_valid', invalidScalars.length === 0,
      invalidScalars.length ? `invalid or missing=${invalidScalars.join(',')}` : `${scalarKeys.length} scalar metric keys present and numeric-or-null`);

    const states = metrics.testersByState;
    const statesValid = states === null || (
      typeof states === 'object' && states !== null &&
      TESTFLIGHT_STATE_KEYS.every((key) => Number.isInteger(states[key]))
    );
    record('testflight_tester_state_breakdown_valid', statesValid,
      `testersByState=${JSON.stringify(states)} -- BetaTester.attributes.state is a documented enum (NOT_INVITED/INVITED/ACCEPTED/INSTALLED/REVOKED)`);
  }

  if (production?.available === false) {
    record('production_not_connected_has_reason', typeof production?.note === 'string' && production.note.length > 0,
      `production.note=${JSON.stringify(production?.note)}`);
    record('production_metrics_null_when_unavailable', production?.metrics === null,
      `production.metrics=${JSON.stringify(production?.metrics)}`);
  } else {
    const metrics = production?.metrics ?? {};
    const invalid = PRODUCTION_METRIC_KEYS.filter((key) => !(key in metrics) || !finiteOrNull(metrics[key]));
    record('production_metric_contract_valid', invalid.length === 0,
      invalid.length ? `invalid or missing=${invalid.join(',')}` : `${PRODUCTION_METRIC_KEYS.length} metric keys present and numeric-or-null`);
    record('production_range_present', Boolean(production?.range?.startDate && production?.range?.endDate),
      `range=${JSON.stringify(production?.range)}`);
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
