#!/usr/bin/env node

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  if (flag === '--base-url') return args.find((arg) => /^https?:\/\//.test(arg)) || fallback;
  return fallback;
};

const baseUrl = valueAfter('--base-url', process.env.METRICS_DASHBOARD_URL || 'https://metrics.hushh.ai').replace(/\/$/, '');
const timeoutMs = Number(valueAfter('--timeout-ms', process.env.METRICS_CONTRACT_TIMEOUT_MS || '120000'));
const days = Math.max(1, Number(valueAfter('--days', '7')) || 7);
const maxOneBytes = Number(valueAfter('--max-one-bytes', '750000'));
const maxAllBytes = Number(valueAfter('--max-all-bytes', '2500000'));

const end = new Date();
end.setUTCHours(0, 0, 0, 0);
const start = new Date(end);
start.setUTCDate(start.getUTCDate() - (days - 1));
const date = (value) => value.toISOString().slice(0, 10);
const query = new URLSearchParams({ start_date: date(start), end_date: date(end) });

const forbiddenKeys = new Set([
  'identities',
  'featureuseridentities',
  'userpseudoid',
  'user_pseudo_id',
  'userid',
  'user_id',
  'displayname',
  'boundemail',
  'email',
  'phonenumber',
  'phone',
  'paramname',
  'paramphone',
  'humanusers',
  'humanevents',
]);
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const phonePattern = /(?:^|\s)\+\d[\d\s().-]{8,}\d(?:$|\s)/;
const rawConfigPattern = /GCP_SERVER_ACTOR_UID|[A-Z][A-Z0-9_]{3,}\s+is required/i;

function inspect(value, path, findings) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspect(item, `${path}[${index}]`, findings));
    return;
  }
  if (typeof value === 'string') {
    if (emailPattern.test(value)) findings.push(`${path}: email-like value`);
    if (phonePattern.test(value)) findings.push(`${path}: phone-like value`);
    if (value.startsWith('reg_')) findings.push(`${path}: synthetic registered identity`);
    if (rawConfigPattern.test(value)) findings.push(`${path}: raw configuration detail`);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (forbiddenKeys.has(key.toLowerCase())) findings.push(`${childPath}: forbidden person-level field`);
    inspect(child, childPath, findings);
  }
}

function assertOneSummary(summary, label, expectedWebHost, findings) {
  if (!summary || typeof summary !== 'object' || summary.available === false) return;
  if (summary.sourceWebHost !== expectedWebHost) findings.push(`${label}.sourceWebHost: expected ${expectedWebHost}`);
  if (summary.surfaceScope?.webHost !== expectedWebHost || summary.surfaceScope?.strictWebHost !== true) {
    findings.push(`${label}.surfaceScope: exact web-host isolation is not declared`);
  }
  const active = summary.activeUsers;
  if (!active || active.countingUnit !== 'device') findings.push(`${label}.activeUsers.countingUnit: expected device`);
  if (!active?.identityScope || !/device|browser/i.test(active.identityScope)) findings.push(`${label}.activeUsers.identityScope: missing device scope`);
  const dau = Number(active?.dau ?? 0);
  const wau = Number(active?.wau ?? 0);
  const mau = Number(active?.mau ?? 0);
  if (!(dau <= wau && wau <= mau)) findings.push(`${label}.activeUsers: expected DAU <= WAU <= MAU, got ${dau}/${wau}/${mau}`);
  const registered = summary.registeredAccounts;
  if (!registered || registered.countingUnit !== 'account') {
    findings.push(`${label}.registeredAccounts.countingUnit: expected account`);
  }
  if (registered?.available !== true) {
    findings.push(`${label}.registeredAccounts: authoritative Firebase aggregate unavailable`);
  } else {
    const totalAccounts = Number(registered.totalAccounts ?? -1);
    const newAccounts = Number(registered.newAccounts ?? -1);
    const throughEnd = Number(registered.accountsCreatedByRangeEnd ?? -1);
    const disabledAccounts = Number(registered.disabledAccounts ?? -1);
    const dailyNew = (registered.daily || []).reduce((total, row) => total + Number(row?.newAccounts ?? 0), 0);
    if (totalAccounts < 0 || newAccounts < 0 || disabledAccounts < 0) {
      findings.push(`${label}.registeredAccounts: counts must be non-negative`);
    }
    if (!(newAccounts <= throughEnd && throughEnd <= totalAccounts)) {
      findings.push(`${label}.registeredAccounts: expected new <= created-through-end <= current total`);
    }
    if (dailyNew !== newAccounts) {
      findings.push(`${label}.registeredAccounts.daily: ${dailyNew} does not equal newAccounts ${newAccounts}`);
    }
    if (registered.sharedAcrossEnvironments !== true || !/firebase authentication/i.test(registered.sourceLabel || '')) {
      findings.push(`${label}.registeredAccounts: shared Firebase identity scope is not declared`);
    }
  }
  const identified = summary.identifiedUsers;
  if (!identified || identified.countingUnit !== 'account') findings.push(`${label}.identifiedUsers.countingUnit: expected account`);
  if (!identified?.identityScope || !/distinct|account|user_id/i.test(identified.identityScope)) {
    findings.push(`${label}.identifiedUsers.identityScope: missing stable-account scope`);
  }
  const identifiedDau = Number(identified?.dau ?? 0);
  const identifiedWau = Number(identified?.wau ?? 0);
  const identifiedMau = Number(identified?.mau ?? 0);
  const selectedUsers = identified?.selectedRange;
  if (typeof selectedUsers?.available !== 'boolean') {
    findings.push(`${label}.identifiedUsers.selectedRange.available: expected explicit source state`);
  }
  if (selectedUsers?.available === false) {
    if (selectedUsers.totalUsers !== null || selectedUsers.newUsers !== null || selectedUsers.returningUsers !== null) {
      findings.push(`${label}.identifiedUsers.selectedRange: unavailable counts must be null, not zero`);
    }
  } else if (selectedUsers?.available === true) {
    const totalUsers = selectedUsers.totalUsers;
    const newUsers = selectedUsers.newUsers;
    const returningUsers = selectedUsers.returningUsers;
    if (![totalUsers, newUsers, returningUsers].every((value) => Number.isSafeInteger(value) && value >= 0)) {
      findings.push(`${label}.identifiedUsers.selectedRange: total/new/returning users must be non-negative integers`);
    } else if (newUsers + returningUsers !== totalUsers) {
      findings.push(`${label}.identifiedUsers.selectedRange: new + returning must equal total, got ${newUsers} + ${returningUsers} != ${totalUsers}`);
    }
  }
  if (!selectedUsers?.newUserDefinition || !/first observed/i.test(selectedUsers.newUserDefinition)) {
    findings.push(`${label}.identifiedUsers.selectedRange.newUserDefinition: missing first-observed definition`);
  }
  if (!(identifiedDau <= identifiedWau && identifiedWau <= identifiedMau)) {
    findings.push(`${label}.identifiedUsers: expected DAU <= WAU <= MAU, got ${identifiedDau}/${identifiedWau}/${identifiedMau}`);
  }
  if (typeof summary.activeByPlatformAvailable !== 'boolean') {
    findings.push(`${label}.activeByPlatformAvailable: expected explicit source availability`);
  }
  if (summary.activeByPlatformAvailable === false && summary.activeByPlatform?.length) {
    findings.push(`${label}.activeByPlatform: unavailable query must not publish partial or fabricated rows`);
  }
  if (typeof summary.platformsAvailable !== 'boolean') {
    findings.push(`${label}.platformsAvailable: expected explicit source availability`);
  }
  if (summary.platformsAvailable === false && summary.platforms?.length) {
    findings.push(`${label}.platforms: unavailable query must not publish fabricated platform rows`);
  }
  for (const row of summary.platforms || []) {
    if (!['WEB', 'IOS', 'ANDROID'].includes(row.platform)) findings.push(`${label}.platforms: unexpected One platform`);
    const values = [row.users, row.events, row.activeDeviceIds, row.activeAccounts,
      row.routeVisits, row.namedRouteVisits];
    if (!values.every((value) => Number.isSafeInteger(value) && value >= 0)
      || row.activeDeviceIds > row.users
      || (selectedUsers?.available === true && row.activeAccounts > selectedUsers.totalUsers)
      || row.routeVisits > row.events || row.namedRouteVisits > row.routeVisits) {
      findings.push(`${label}.platforms.${row.platform}: invalid selected-range counts`);
    }
    if (row.namedRouteVisits === 0 ? row.distinctScreens !== null
      : !Number.isSafeInteger(row.distinctScreens) || row.distinctScreens < 1 || row.distinctScreens > row.namedRouteVisits) {
      findings.push(`${label}.platforms.${row.platform}: distinct screens must match named-route availability`);
    }
    if (!Array.isArray(row.topProductScreens) || row.topProductScreens.length > 5
      || row.topProductScreens.some((screen) => !/^[a-z][a-z0-9_]{0,60}$/.test(screen.routeId)
        || /(^unknown$|^logout$|oauth_return$|_legacy_redirect$|^oauth_authorize$)/.test(screen.routeId)
        || !Number.isSafeInteger(screen.visits) || screen.visits < 1)
      || row.topProductScreens.reduce((sum, screen) => sum + screen.visits, 0) > row.namedRouteVisits) {
      findings.push(`${label}.platforms.${row.platform}: top routes must be safe aggregates`);
    }
  }
  // Optional during the dashboard rollout; once present it must never turn a
  // missing iOS export into fabricated zero-account KPIs.
  const ios = summary.iosIdentifiedUsers;
  if (ios) {
    if (ios.countingUnit !== 'account' || ios.bundleId !== 'com.hushh.app') {
      findings.push(`${label}.iosIdentifiedUsers: expected One iOS account scope`);
    }
    if (ios.available) {
      const total = Number(ios.totalUsers);
      const first = Number(ios.firstObservedUsers);
      const previous = Number(ios.previouslyObservedUsers);
      if (![total, first, previous].every((value) => Number.isSafeInteger(value) && value >= 0) || first + previous !== total) {
        findings.push(`${label}.iosIdentifiedUsers: first + previous must equal distinct active iOS accounts`);
      }
    } else if (ios.totalUsers !== null || ios.firstObservedUsers !== null || ios.previouslyObservedUsers !== null) {
      findings.push(`${label}.iosIdentifiedUsers: unavailable counts must be null, not zero`);
    }
  }
  const iosUsage = summary.iosUsage;
  if (iosUsage) {
    if (iosUsage.bundleId !== 'com.hushh.app') findings.push(`${label}.iosUsage: expected One iOS bundle`);
    if (iosUsage.available) {
      const counts = [iosUsage.activeInstallIds, iosUsage.screenViews, iosUsage.namedScreenViews,
        iosUsage.productScreenVisits, iosUsage.namedProductScreenVisits];
      if (!counts.every((value) => Number.isSafeInteger(value) && value >= 0)) {
        findings.push(`${label}.iosUsage: counts must be non-negative integers`);
      }
      if (iosUsage.namedScreenViews > iosUsage.screenViews) findings.push(`${label}.iosUsage: named screen views exceed all screen views`);
      if (iosUsage.namedProductScreenVisits > iosUsage.productScreenVisits) {
        findings.push(`${label}.iosUsage: named One screen visits exceed all route visits`);
      }
      if (iosUsage.namedProductScreenVisits === 0 && iosUsage.distinctProductScreens !== null) {
        findings.push(`${label}.iosUsage: distinct One screens must be unavailable when route names are absent`);
      }
      if (!Array.isArray(iosUsage.topProductScreens) || iosUsage.topProductScreens.length > 5
        || iosUsage.topProductScreens.some((row) => !/^[a-z][a-z0-9_]{0,60}$/.test(row.routeId)
          || /(^unknown$|^logout$|oauth_return$|_legacy_redirect$|^oauth_authorize$)/.test(row.routeId)
          || !Number.isSafeInteger(row.visits) || row.visits < 0)) {
        findings.push(`${label}.iosUsage: top screens must be safe aggregate route rows`);
      } else if (iosUsage.topProductScreens.reduce((sum, row) => sum + row.visits, 0) > iosUsage.namedProductScreenVisits
        || (iosUsage.distinctProductScreens !== null && iosUsage.topProductScreens.length > iosUsage.distinctProductScreens)) {
        findings.push(`${label}.iosUsage: top screen rows exceed named route totals`);
      }
      if (iosUsage.namedScreenViews === 0 && iosUsage.distinctScreenNames !== null) {
        findings.push(`${label}.iosUsage: distinct screens must be unavailable when names are absent`);
      }
    } else if (iosUsage.activeInstallIds !== null || iosUsage.screenViews !== null || iosUsage.distinctScreenNames !== null
      || iosUsage.productScreenVisits !== null || iosUsage.distinctProductScreens !== null
      || iosUsage.topProductScreens?.length) {
      findings.push(`${label}.iosUsage: unavailable export must not publish zero counts`);
    }
  }
  const iosPlatform = summary.platforms?.find((row) => row.platform === 'IOS');
  if (iosUsage?.available && iosPlatform && (
    iosPlatform.activeDeviceIds !== iosUsage.activeInstallIds
    || iosPlatform.routeVisits !== iosUsage.productScreenVisits
    || iosPlatform.namedRouteVisits !== iosUsage.namedProductScreenVisits
    || iosPlatform.distinctScreens !== iosUsage.distinctProductScreens
  )) findings.push(`${label}.platforms.IOS: selected-range counts differ from dedicated iOS diagnostics`);
  for (const window of ['dau', 'wau', 'mau']) {
    const devices = Number(active?.[window] ?? 0);
    const identifiedDevices = Number(identified?.identifiedDevices?.[window] ?? 0);
    const coverage = identified?.deviceCoverage?.[window];
    const expected = devices > 0 ? identifiedDevices / devices : null;
    if (identifiedDevices > devices) findings.push(`${label}.identifiedUsers.${window}: identified devices exceed active devices`);
    if (expected === null ? coverage !== null : Math.abs(Number(coverage) - expected) > 1e-9) {
      findings.push(`${label}.identifiedUsers.${window}: identity coverage is not exact`);
    }
  }
  for (const [index, capability] of (summary.capabilities || []).entries()) {
    if (!Object.hasOwn(capability, 'devices')) findings.push(`${label}.capabilities[${index}].devices: missing device count`);
    if (!Object.hasOwn(capability, 'deliberateEvents')) findings.push(`${label}.capabilities[${index}].deliberateEvents: missing event count`);
  }
  for (const [funnelIndex, funnel] of (summary.installFunnel || []).entries()) {
    const stages = funnel?.stages || [];
    for (let index = 1; index < stages.length; index += 1) {
      const previous = Number(stages[index - 1]?.users ?? 0);
      const current = Number(stages[index]?.users ?? 0);
      if (current > previous) {
        findings.push(`${label}.installFunnel[${funnelIndex}]: stage ${index} rises from ${previous} to ${current}`);
      }
    }
  }
}

async function fetchJson(path, maxBytes) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(`${baseUrl}${path}?${query}`, { signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
    if (Buffer.byteLength(text) > maxBytes) throw new Error(`${path} payload ${Buffer.byteLength(text)} bytes exceeds ${maxBytes}`);
    return { data: JSON.parse(text), bytes: Buffer.byteLength(text), durationMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

const checks = [];
const failures = [];
for (const spec of [
  { path: '/api/analytics/one', maxBytes: maxOneBytes },
  { path: '/api/analytics/one/app', maxBytes: maxOneBytes },
  { path: '/api/analytics/all', maxBytes: maxAllBytes },
]) {
  try {
    const result = await fetchJson(spec.path, spec.maxBytes);
    const findings = [];
    inspect(result.data, '$', findings);
    const one = spec.path === '/api/analytics/all' ? result.data?.one?.data : result.data?.data;
    assertOneSummary(one?.production, `${spec.path}.production`, 'one.hushh.ai', findings);
    assertOneSummary(one?.uat, `${spec.path}.uat`, 'uat.one.hushh.ai', findings);
    if (one?.production?.registeredAccounts?.available && one?.uat?.registeredAccounts?.available) {
      if (one.production.registeredAccounts.totalAccounts !== one.uat.registeredAccounts.totalAccounts
        || one.production.registeredAccounts.newAccounts !== one.uat.registeredAccounts.newAccounts) {
        findings.push(`${spec.path}: production and UAT shared registered-account totals differ`);
      }
    }
    checks.push({
      endpoint: spec.path,
      bytes: result.bytes,
      durationMs: result.durationMs,
      findings: findings.length,
      identifiedUserSource: {
        production: one?.production?.identifiedUsers
          ? (one.production.identifiedUsers.selectedRange?.available === true ? 'available' : 'waiting')
          : 'not_applicable',
        uat: one?.uat?.identifiedUsers
          ? (one.uat.identifiedUsers.selectedRange?.available === true ? 'available' : 'waiting')
          : 'not_applicable',
      },
    });
    failures.push(...findings.map((finding) => `${spec.path} ${finding}`));
  } catch (error) {
    failures.push(`${spec.path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const report = {
  ok: failures.length === 0,
  baseUrl,
  range: { startDate: date(start), endDate: date(end), days },
  checks,
  failures,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
