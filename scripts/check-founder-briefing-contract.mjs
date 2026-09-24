#!/usr/bin/env node

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const baseUrl = option('--base-url', process.env.METRICS_DASHBOARD_URL || 'https://metrics.hushh.ai').replace(/\/$/, '');
const timeoutMs = Number(option('--timeout-ms', '120000'));
const startDate = option('--start-date', '');
const endDate = option('--end-date', '');
const params = new URLSearchParams();
if (startDate) params.set('start_date', startDate);
if (endDate) params.set('end_date', endDate);
const path = `/api/analytics/founder${params.size ? `?${params}` : ''}`;
const checks = [];
const check = (name, ok) => checks.push({ name, ok: Boolean(ok) });
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const date = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const dayCount = (start, end) => (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;
const validMeasure = (value, currentAvailable, comparisonAvailable) => currentAvailable
  ? integer(value?.current) && (comparisonAvailable ? integer(value?.previous) : value?.previous === null)
  : value?.current === null && value?.previous === null;

try {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
  });
  check('authenticated_api_200', response.status === 200);
  check('no_store', /no-store/i.test(response.headers.get('cache-control') || ''));
  const body = await response.json();
  check('one_only_shape', Boolean(body.one && body.search && !body.hushhTech && !body.hushhAi));
  check('no_person_records', !/user_pseudo_id|"user_id"\s*:|"email"\s*:|"phone"\s*:/i.test(JSON.stringify(body)));
  const current = body.period ?? {};
  const previous = body.previousPeriod ?? {};
  check('periods_equal_contiguous', date(current.startDate) && date(current.endDate)
    && date(previous.startDate) && date(previous.endDate)
    && dayCount(current.startDate, current.endDate) === current.days
    && dayCount(previous.startDate, previous.endDate) === current.days
    && current.days >= 1 && current.days <= 90
    && Date.parse(`${previous.endDate}T00:00:00Z`) + 86_400_000 === Date.parse(`${current.startDate}T00:00:00Z`));
  check('requested_range_exact', (!startDate || startDate === current.startDate) && (!endDate || endDate === current.endDate));
  const one = body.one ?? {};
  check('one_source_available', one.available === true);
  check('identity_comparison_flag', typeof one.comparisonReady === 'boolean');
  check('interaction_comparison_flag', typeof one.interactionComparisonReady === 'boolean');
  check('interaction_history_guard', one.interactionComparisonReady === (one.available && previous.startDate >= '2026-05-01'));
  for (const name of ['activeAccounts', 'firstObservedAccounts', 'activatedAccounts', 'agentEngagedAccounts']) {
    check(`one_${name}`, validMeasure(one[name], one.available, one.comparisonReady));
  }
  check('account_bounds', !one.available || (one.firstObservedAccounts.current <= one.activeAccounts.current
    && one.activatedAccounts.current <= one.activeAccounts.current
    && one.agentEngagedAccounts.current <= one.activeAccounts.current));
  check('coverage_bounded', one.accountCoverage === null
    || (typeof one.accountCoverage === 'number' && one.accountCoverage >= 0 && one.accountCoverage <= 1));
  check('source_date', one.latestEventDate === null || date(one.latestEventDate));

  const platforms = Array.isArray(one.platforms) ? one.platforms : [];
  check('ios_and_web_only', platforms.length === 2
    && platforms.some((item) => item.key === 'IOS') && platforms.some((item) => item.key === 'WEB'));
  for (const platform of platforms) {
    check(`${platform.key}_accounts`, validMeasure(platform.identifiedAccounts, one.available, one.comparisonReady));
    check(`${platform.key}_coverage`, platform.identityCoverage === null
      || (typeof platform.identityCoverage === 'number' && platform.identityCoverage >= 0 && platform.identityCoverage <= 1));
    check(`${platform.key}_identity_diagnostics`, !one.available
      || (integer(platform.trackedIdentifiers) && integer(platform.boundIdentifiers)
        && integer(platform.signInIdentifiers) && integer(platform.signedInBoundIdentifiers)
        && integer(platform.previousTrackedIdentifiers) && integer(platform.previousBoundIdentifiers)
        && integer(platform.previousSignInIdentifiers) && integer(platform.previousSignedInBoundIdentifiers)
        && platform.boundIdentifiers <= platform.trackedIdentifiers
        && platform.signInIdentifiers <= platform.trackedIdentifiers
        && platform.signedInBoundIdentifiers <= platform.signInIdentifiers
        && platform.signedInBoundIdentifiers <= platform.boundIdentifiers
        && platform.previousBoundIdentifiers <= platform.previousTrackedIdentifiers
        && platform.previousSignInIdentifiers <= platform.previousTrackedIdentifiers
        && platform.previousSignedInBoundIdentifiers <= platform.previousSignInIdentifiers
        && platform.previousSignedInBoundIdentifiers <= platform.previousBoundIdentifiers
        && (platform.trackedIdentifiers === 0 ? platform.identityCoverage === null
          : Math.abs(platform.identityCoverage - platform.boundIdentifiers / platform.trackedIdentifiers) < 0.000001)));
    check(`${platform.key}_bounded`, !one.available || platform.identifiedAccounts.current <= one.activeAccounts.current);
  }
  check('cross_platform_unique_bound', !one.available || one.activeAccounts.current <= platforms.reduce(
    (sum, item) => sum + (item.identifiedAccounts.current ?? 0), 0,
  ));

  const agents = Array.isArray(one.agents) ? one.agents : [];
  check('agent_catalog_complete', agents.length === 11 && !agents.some((item) => item.key === 'onboarding'));
  for (const agent of agents) {
    check(`agent_${agent.key}_accounts`, validMeasure(agent.identifiedAccounts,
      one.available && agent.instrumented, one.comparisonReady));
    check(`agent_${agent.key}_interactions`, validMeasure(agent.interactions,
      one.available && agent.instrumented, one.interactionComparisonReady));
    check(`agent_${agent.key}_platform_reconciles`, !agent.instrumented || !one.available
      || (integer(agent.iosInteractions) && integer(agent.webInteractions)
        && agent.iosInteractions + agent.webInteractions === agent.interactions.current));
    check(`agent_${agent.key}_bounded`, !agent.instrumented || !one.available
      || agent.identifiedAccounts.current <= one.activeAccounts.current);
  }

  const daily = Array.isArray(one.daily) ? one.daily : [];
  check('daily_complete_spine', daily.length === current.days
    && daily.every((item) => date(item.day) && integer(item.activeAccounts) && integer(item.agentInteractions)));
  check('daily_agent_actions_reconcile', !one.available || daily.reduce((sum, item) => sum + item.agentInteractions, 0)
    === agents.reduce((sum, item) => sum + (item.interactions.current ?? 0), 0));
  check('daily_comparison_guarded', one.comparisonReady || daily.every((item) => item.previousActiveAccounts === null));
  check('daily_interaction_comparison_guarded', one.interactionComparisonReady
    || daily.every((item) => item.previousAgentInteractions === null));

  const search = body.search ?? {};
  check('search_explicit_availability', typeof search.available === 'boolean');
  check('search_counts', search.available
    ? integer(search.clicks?.current) && integer(search.impressions?.current)
      && search.clicks.current <= search.impressions.current
    : search.clicks?.current === null && search.impressions?.current === null);
} catch (error) {
  check('fetch_or_parse', false);
  console.error(error instanceof Error ? error.message : String(error));
}

const result = { ok: checks.every((item) => item.ok), checkedAt: new Date().toISOString(), target: baseUrl, range: { startDate, endDate }, checks };
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
