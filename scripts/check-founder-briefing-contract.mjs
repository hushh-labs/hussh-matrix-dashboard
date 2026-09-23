#!/usr/bin/env node

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const baseUrl = option('--base-url', process.env.METRICS_DASHBOARD_URL || 'https://metrics.hushh.ai').replace(/\/$/, '');
const timeoutMs = Number(option('--timeout-ms', '120000'));
const checks = [];
const check = (name, ok) => checks.push({ name, ok: Boolean(ok) });
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const date = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const days = (start, end) => (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;

try {
  const response = await fetch(`${baseUrl}/api/analytics/founder`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  check('authenticated_api_200', response.status === 200);
  check('no_store', /no-store/i.test(response.headers.get('cache-control') || ''));
  const body = await response.json();
  check('production_aggregate_shape', Boolean(body.one && body.hushhTech && body.hushhAi));
  check('no_uat_or_person_records', !/"uat"\s*:|user_pseudo_id|"user_id"\s*:|"email"\s*:/i.test(JSON.stringify(body)));
  check('periods_are_equal_and_complete', date(body.period?.startDate) && date(body.period?.endDate)
    && date(body.previousPeriod?.startDate) && date(body.previousPeriod?.endDate)
    && days(body.period.startDate, body.period.endDate) === 30
    && days(body.previousPeriod.startDate, body.previousPeriod.endDate) === 30
    && Date.parse(`${body.previousPeriod.endDate}T00:00:00Z`) + 86_400_000
      === Date.parse(`${body.period.startDate}T00:00:00Z`));

  for (const [product, pairs] of [
    ['one', ['activeAccounts', 'firstObservedAccounts', 'activatedAccounts']],
    ['hushhTech', ['newAccounts']],
    ['hushhAi', ['organicClicks']],
  ]) {
    const source = body[product];
    check(`${product}_availability`, typeof source?.available === 'boolean');
    for (const pair of pairs) {
      const measure = source?.[pair];
      check(`${product}_${pair}_valid`, source?.available
        ? integer(measure?.current) && integer(measure?.previous)
        : measure?.current === null && measure?.previous === null);
    }
  }
  check('one_first_observed_bounded', !body.one?.available
    || body.one.firstObservedAccounts.current <= body.one.activeAccounts.current);
  check('one_coverage_bounded', body.one?.accountCoverage === null
    || (typeof body.one?.accountCoverage === 'number'
      && body.one.accountCoverage >= 0 && body.one.accountCoverage <= 1));
  check('tech_total_bounded', !body.hushhTech?.available
    || (integer(body.hushhTech.totalAccounts)
      && body.hushhTech.newAccounts.current <= body.hushhTech.totalAccounts));
  check('search_freshness', !body.hushhAi?.available
    || (date(body.hushhAi.latestSearchDay) && body.hushhAi.latestSearchDay >= body.period.endDate));
} catch (error) {
  check('fetch_or_parse', false);
  console.error(error instanceof Error ? error.message : String(error));
}

const result = {
  ok: checks.every((item) => item.ok),
  checkedAt: new Date().toISOString(),
  target: baseUrl,
  checks,
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
