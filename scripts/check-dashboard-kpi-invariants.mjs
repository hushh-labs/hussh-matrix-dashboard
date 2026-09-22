#!/usr/bin/env node

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

// npm on the deployment runner strips unknown option names after `--` and
// forwards only their values. Support both named and positional invocation so
// the gate cannot silently probe localhost in CI.
const positionalBaseUrl = args.find((arg) => /^https?:\/\//.test(arg));
const positionalTimeout = args.find((arg) => /^\d+$/.test(arg));
const baseUrl = option('--base-url', positionalBaseUrl || process.env.METRICS_DASHBOARD_URL || 'http://localhost:3000').replace(/\/$/, '');
const timeoutMs = Number(option('--timeout-ms', positionalTimeout || '120000'));
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });
const number = (value) => typeof value === 'number' && Number.isFinite(value);
const close = (actual, expected, tolerance = 1e-9) =>
  number(actual) && number(expected) && Math.abs(actual - expected) <= tolerance;
const sum = (rows, key) => rows.reduce((total, row) => total + Number(row?.[key] ?? 0), 0);

function checkOneEnvironment(label, one) {
  check(`${label}_available`, one?.available === true, `available=${String(one?.available)}`);
  if (!one?.available) return;

  const active = one.activeUsers ?? {};
  check(
    `${label}_active_windows_nested`,
    number(active.dau) && active.dau <= active.wau && active.wau <= active.mau,
    `DAU/WAU/MAU=${active.dau}/${active.wau}/${active.mau}`,
  );
  check(
    `${label}_stickiness_exact`,
    active.mau === 0 ? active.stickiness == null : close(active.stickiness, active.dau / active.mau),
    `reported=${active.stickiness}; calculated=${active.mau ? active.dau / active.mau : 'null'}`,
  );

  const identified = one.identifiedUsers ?? {};
  const selectedUsers = identified.selectedRange ?? {};
  check(
    `${label}_identified_total_partitions_exactly`,
    Number(selectedUsers.newUsers ?? -1) >= 0
      && Number(selectedUsers.returningUsers ?? -1) >= 0
      && Number(selectedUsers.newUsers) + Number(selectedUsers.returningUsers) === Number(selectedUsers.totalUsers),
    `new=${selectedUsers.newUsers}; returning=${selectedUsers.returningUsers}; total=${selectedUsers.totalUsers}`,
  );
  check(
    `${label}_identified_user_windows_nested`,
    number(identified.dau) && identified.dau <= identified.wau && identified.wau <= identified.mau,
    `DAU/WAU/MAU=${identified.dau}/${identified.wau}/${identified.mau}`,
  );
  for (const key of ['dau', 'wau', 'mau']) {
    const activeDevices = Number(active[key] ?? 0);
    const identifiedDevices = Number(identified.identifiedDevices?.[key] ?? 0);
    const expectedCoverage = activeDevices > 0 ? identifiedDevices / activeDevices : null;
    check(
      `${label}_${key}_identity_coverage_exact`,
      identifiedDevices <= activeDevices
        && (expectedCoverage === null
          ? identified.deviceCoverage?.[key] == null
          : close(identified.deviceCoverage?.[key], expectedCoverage)),
      `reported=${identified.deviceCoverage?.[key]}; identified devices=${identifiedDevices}; active devices=${activeDevices}`,
    );
  }
  check(
    `${label}_identity_completeness_exact`,
    identified.complete === (Number(active.mau ?? 0) > 0
      && Number(identified.identifiedDevices?.mau ?? 0) === Number(active.mau ?? 0)),
    `complete=${String(identified.complete)}`,
  );

  const platforms = Array.isArray(one.activeByPlatform) ? one.activeByPlatform : [];
  for (const [key, field] of [['dau', 'dauDevices'], ['wau', 'wauDevices'], ['mau', 'mauDevices']]) {
    const platformTotal = sum(platforms, field);
    check(
      `${label}_${key}_equals_platform_total`,
      platformTotal === Number(active[key] ?? 0),
      `headline=${active[key]}; platform total=${platformTotal}`,
    );
  }
  check(
    `${label}_platform_windows_nested`,
    platforms.every((row) => row.dauDevices <= row.wauDevices && row.wauDevices <= row.mauDevices),
    `${platforms.length} platform row(s)`,
  );

  const stages = Array.isArray(one.activationStages) ? one.activationStages : [];
  check(
    `${label}_activation_stages_nested`,
    stages.every((row, index) => index === 0 || row.users <= stages[index - 1].users),
    stages.map((row) => `${row.key}=${row.users}`).join(', '),
  );
  const classified = Number(one.growth?.newUsers ?? 0)
    + Number(one.growth?.returningUsers ?? 0)
    + Number(one.growth?.unknownUsers ?? 0);
  const reached = Number(stages[0]?.users ?? 0);
  check(
    `${label}_growth_buckets_partition_devices`,
    classified === reached,
    `new+returning+unknown=${classified}; meaningful devices=${reached}`,
  );

  const installs = Array.isArray(one.installFunnel) ? one.installFunnel : [];
  check(
    `${label}_install_funnels_nested`,
    installs.every((funnel) => (funnel.stages ?? []).every((stage, index) =>
      index === 0 || stage.users <= funnel.stages[index - 1].users)),
    installs.map((funnel) => `${funnel.platform}:${(funnel.stages ?? []).map((stage) => stage.users).join('>')}`).join('; ') || 'no native installs',
  );
  check(
    `${label}_install_shares_exact`,
    installs.every((funnel) => (funnel.stages ?? []).every((stage) =>
      funnel.installed === 0 ? stage.shareOfInstalls === 0 : close(stage.shareOfInstalls, stage.users / funnel.installed))),
    `${installs.length} native funnel(s)`,
  );

  const retention = Array.isArray(one.retention) ? one.retention : [];
  check(
    `${label}_retention_exact`,
    retention.every((row) => row.returnedW1 <= row.cohortSize
      && (row.cohortSize === 0 ? row.rateW1 == null : close(row.rateW1, row.returnedW1 / row.cohortSize))),
    `${retention.length} cohort(s)`,
  );
}

function checkGrowth(growth) {
  const userSeries = Array.isArray(growth?.users?.series) ? growth.users.series : [];
  let running = 0;
  const cumulativeExact = userSeries.every((row) => {
    running += Number(row.newUsers ?? 0);
    return running === Number(row.cumulative ?? -1);
  });
  check('growth_cumulative_exact', cumulativeExact, `${userSeries.length} weekly point(s); final=${running}`);
  check(
    'growth_total_matches_series',
    running === Number(growth?.users?.totalEverSeen ?? -1),
    `series=${running}; headline=${growth?.users?.totalEverSeen}`,
  );

  const identity = growth?.identity ?? {};
  const byPlatform = Array.isArray(identity.byPlatform) ? identity.byPlatform : [];
  check('growth_identity_devices_sum', sum(byPlatform, 'devices') === identity.devices,
    `platforms=${sum(byPlatform, 'devices')}; headline=${identity.devices}`);
  check('growth_identified_devices_sum', sum(byPlatform, 'identifiedDevices') === identity.identifiedDevices,
    `platforms=${sum(byPlatform, 'identifiedDevices')}; headline=${identity.identifiedDevices}`);
  check(
    'growth_identity_coverage_exact',
    identity.devices === 0 ? identity.coverage == null : close(identity.coverage, identity.identifiedDevices / identity.devices),
    `reported=${identity.coverage}; calculated=${identity.devices ? identity.identifiedDevices / identity.devices : 'null'}`,
  );

  const cross = growth?.crossProduct ?? {};
  check(
    'growth_cross_product_rate_exact',
    cross.siteVisitors === 0 ? cross.conversionRate == null : close(cross.conversionRate, cross.siteThenApp / cross.siteVisitors),
    `reported=${cross.conversionRate}; ${cross.siteThenApp}/${cross.siteVisitors}`,
  );
  check('growth_cross_product_subset', cross.siteThenApp <= cross.siteVisitors && cross.siteThenApp <= cross.appWebVisitors,
    `continued=${cross.siteThenApp}; site=${cross.siteVisitors}; app=${cross.appWebVisitors}`);

  const firstValue = growth?.timeToFirstValue ?? {};
  const distributionTotal = sum(Array.isArray(firstValue.distribution) ? firstValue.distribution : [], 'users');
  check('growth_first_value_distribution_exact', distributionTotal === firstValue.activatedUsers,
    `distribution=${distributionTotal}; activated=${firstValue.activatedUsers}`);

  const cost = growth?.cost ?? {};
  if (cost.available) {
    check('growth_cost_total_exact', close(cost.total, cost.production + cost.nonProduction, 0.011),
      `total=${cost.total}; parts=${cost.production + cost.nonProduction}`);
    check('growth_production_cost_breakdown_exact', close(cost.production, sum(cost.byProduct ?? [], 'production'), 0.011),
      `headline=${cost.production}; products=${sum(cost.byProduct ?? [], 'production')}`);
    check('growth_nonproduction_cost_breakdown_exact', close(cost.nonProduction, sum(cost.byProduct ?? [], 'nonProduction') + cost.unattributed, 0.011),
      `headline=${cost.nonProduction}; products+unattributed=${sum(cost.byProduct ?? [], 'nonProduction') + cost.unattributed}`);
  }

  const search = growth?.organicSearch ?? {};
  if (search.available) {
    check('growth_search_ctr_exact', search.impressions === 0 ? search.ctr == null : close(search.ctr, search.clicks / search.impressions),
      `reported=${search.ctr}; ${search.clicks}/${search.impressions}`);
  }
}

function checkKai(rows) {
  const feedRows = Array.isArray(rows) ? rows : [];
  const find = (group, name) => feedRows.find((row) => row.metric_group === group && row.metric_name === name);
  const value = (group, name) => find(group, name)?.metric_value;
  const dau = value('summary', 'current_dau');
  const wau = value('summary', 'current_wau');
  const mau = value('summary', 'current_mau');
  check('one_feed_active_windows_nested', number(dau) && dau <= wau && wau <= mau, `DAU/WAU/MAU=${dau}/${wau}/${mau}`);
  check('one_feed_stickiness_exact', mau === 0 ? value('summary', 'current_dau_mau_stickiness') == null
    : close(value('summary', 'current_dau_mau_stickiness'), dau / mau),
  `reported=${value('summary', 'current_dau_mau_stickiness')}; calculated=${mau ? dau / mau : 'null'}`);
  const platformMau = feedRows
    .filter((row) => row.metric_group === 'platform_mix' && row.metric_name === 'users')
    .reduce((total, row) => total + Number(row.metric_value ?? 0), 0);
  check('one_feed_mau_equals_platform_total', platformMau === mau, `MAU=${mau}; platform total=${platformMau}`);

  for (const journey of ['investor', 'ria']) {
    const entered = value(`${journey}_funnel`, 'entered');
    const activated = value(`${journey}_funnel`, 'activated');
    const rate = value('activation', `${journey}_activation_rate`);
    check(
      `one_feed_${journey}_activation_denominator_safe`,
      entered > 0 ? close(rate, activated / entered) : rate == null,
      `entered=${entered}; activated=${activated}; rate=${rate}`,
    );
  }
}

try {
  const response = await fetch(`${baseUrl}/api/analytics/all?one_window_days=30`, {
    headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    cache: 'no-store',
    signal: controller.signal,
  });
  check('http_ok', response.ok, `HTTP ${response.status}`);
  const payload = await response.json();

  checkOneEnvironment('one_production', payload.one?.data?.production);
  checkOneEnvironment('one_uat', payload.one?.data?.uat);
  checkGrowth(payload.growth?.data);
  checkKai(payload.kai?.production?.rows);

  const appStore = payload.appStoreConnect?.data;
  for (const key of ['production', 'testflight']) {
    const source = appStore?.[key];
    check(`app_store_${key}_availability_honest`, source?.available ? source.metrics != null : source?.metrics == null,
      `available=${String(source?.available)}; metrics=${source?.metrics == null ? 'null' : 'present'}`);
  }

  const tech = payload.hushhTech?.data;
  if (tech?.businessFunnel?.source === 'unavailable') {
    check('hushhtech_unavailable_funnel_has_no_rates',
      Object.values(tech.businessFunnel.conversionRates ?? {}).every((rate) => rate == null),
      'unavailable source must not publish zero conversion rates');
  }
  if (tech?.traffic?.available === false) {
    check('hushhtech_unavailable_traffic_has_no_rates',
      tech.traffic.overview?.engagementRate == null && tech.traffic.overview?.averageSessionDuration == null,
      'unavailable source must keep derived rates null');
  }

  const failures = checks.filter((entry) => !entry.ok);
  console.log(JSON.stringify({
    ok: failures.length === 0,
    checkedAt: new Date().toISOString(),
    baseUrl,
    checks,
    failed: failures.length,
  }, null, 2));
  process.exitCode = failures.length === 0 ? 0 : 1;
} catch (error) {
  console.error(JSON.stringify({ ok: false, baseUrl, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
