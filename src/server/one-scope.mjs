/** One collection scope. Verify live stream mappings before declaring cutover. */
export const ONE_ANDROID_PACKAGE = 'com.hussh.app';
export const ONE_ANDROID_STREAMS = { production: '15395548050', uat: '15395713075' };
export const ONE_IOS_STREAMS = { production: '13695001361', uat: '14383415557' };
export const ONE_WEB_STREAMS = { production: '13695004816', uat: '14383500973' };
export const ONE_REPORTING_SCOPE_VERSION = 'one-environment-v1';

/** Private customer evidence must never be read from a UAT or arbitrary backend. */
export function oneProductionEndpoint(value, pathname) {
  try {
    const url = new URL(value);
    return url.origin === 'https://api.hushh.ai' && url.pathname === pathname
      && !url.username && !url.password && !url.search && !url.hash ? url : null;
  } catch { return null; }
}
export const ONE_ANDROID_TIMEZONE = 'Etc/GMT+8';
export const ONE_ANDROID_EXPORT_FROM = '2026-10-07';
// Export membership changed during October 7; October 8 is the first full day.
export const ONE_ANDROID_COMPLETE_FROM = '2026-10-08';
/** Do not scan unavailable production history or imply it was backfilled. */
export function androidCaptureQueryRange(range, environment = 'production') {
  if (environment !== 'production') return range;
  if (range.endDate < ONE_ANDROID_EXPORT_FROM) return null;
  return {...range, startDate: range.startDate < ONE_ANDROID_EXPORT_FROM ? ONE_ANDROID_EXPORT_FROM : range.startDate};
}
export function androidComparisonCoverage(currentEvents, previousEvents, previousStartDate) {
  return (Number(currentEvents ?? 0) === 0 && Number(previousEvents ?? 0) === 0)
    || previousStartDate >= ONE_ANDROID_COMPLETE_FROM;
}

/** A return rate needs seven complete reporting days after the last first open. */
export function nativeRetentionWindowComplete(latestFirstOpen, completeThrough, incompleteWindows) {
  if (!Number.isSafeInteger(incompleteWindows) || incompleteWindows !== 0) return false;
  const date = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const time = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0,10) === value ? time : null;
  };
  const first = date(latestFirstOpen), through = date(completeThrough);
  return first !== null && through !== null && through >= first + 7 * 86_400_000;
}

const literal = (value) => `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

function validateEnvironment(environment) {
  if (!Object.hasOwn(ONE_ANDROID_STREAMS, environment)) throw new Error('Invalid One reporting environment');
}

/** Shared by all platforms, including web and iOS; handle every debug value. */
export function oneNonDebugSql(alias = '') {
  if (alias && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error('Invalid SQL alias');
  const prefix = alias ? `${alias}.` : '';
  return `NOT EXISTS (SELECT 1 FROM UNNEST(${prefix}event_params) debug_param
    WHERE debug_param.key = 'debug_mode' AND (
      COALESCE(debug_param.value.int_value, 0) = 1
      OR LOWER(COALESCE(debug_param.value.string_value, '')) IN ('1', 'true'))) `;
}

export function oneAndroidSql(environment = 'production', { collectionOnly = false, alias = '' } = {}) {
  validateEnvironment(environment);
  const prefix = alias ? `${alias}.` : '';
  const env = `(SELECT value.string_value FROM UNNEST(${prefix}event_params) WHERE key = 'env')`;
  return `(${prefix}platform = 'ANDROID' AND ${prefix}app_info.id = '${ONE_ANDROID_PACKAGE}'
    AND ${prefix}stream_id = '${ONE_ANDROID_STREAMS[environment]}'
    AND ${oneNonDebugSql(alias)}${collectionOnly ? '' : ` AND ${env} = ${literal(environment)}`})`;
}

/**
 * Backend-scoped product reporting. A production property or store package does
 * not establish production use: legacy store builds can call the UAT backend.
 * collectionOnly is reserved for explicitly labelled SDK collection diagnostics.
 */
export function oneSurfaceSql(webHost, environment = webHost === 'uat.one.hushh.ai' ? 'uat' : 'production', { collectionOnly = false, alias = '' } = {}) {
  validateEnvironment(environment);
  if (typeof webHost !== 'string' || !/^[a-z0-9.-]+$/i.test(webHost)) throw new Error('Invalid One web host');
  const prefix = alias ? `${alias}.` : '';
  const params = `${prefix}event_params`;
  return `(((${prefix}platform = 'IOS' AND ${prefix}app_info.id = 'com.hushh.app'
      AND ${prefix}stream_id = '${ONE_IOS_STREAMS[environment]}')
    OR (${prefix}platform = 'ANDROID' AND ${prefix}app_info.id = '${ONE_ANDROID_PACKAGE}'
      AND ${prefix}stream_id = '${ONE_ANDROID_STREAMS[environment]}')
    OR (${prefix}platform = 'WEB' AND ${prefix}stream_id = '${ONE_WEB_STREAMS[environment]}'
      AND NET.HOST((SELECT value.string_value FROM UNNEST(${params})
        WHERE key = 'page_location')) = ${literal(webHost)}))
    AND ${oneNonDebugSql(alias)}${collectionOnly ? '' : ` AND (SELECT value.string_value FROM UNNEST(${params}) WHERE key = 'env') = ${literal(environment)}`})`;
}

/** Founder and product reports use the same environment boundary. */
export function oneFounderSurfaceSql(webHost) {
  return oneSurfaceSql(webHost, 'production');
}

/** Never serve an old property-wide feed under a new environment-scoped label. */
export function oneFeedEnvironment(requested, sources) {
  if (requested.length !== 3 || requested.some(value => typeof value !== 'string' || !value)) return null;
  const matches = ['production', 'uat'].filter(environment =>
    sources[environment]?.length === 3 && sources[environment].every((value, index) => value === requested[index]));
  return matches.length === 1 ? matches[0] : null;
}

/** Each row must attest the same environment as the uniquely selected source. */
export function validateOneFeedScope(rows, environment) {
  validateEnvironment(environment);
  const markers = rows.filter(row => row.metric_group === 'status' && row.metric_name === 'reporting_scope_version');
  const sources = rows.filter(row => row.metric_group === 'status' && row.metric_name === 'source_environment');
  return markers.length === 1 && sources.length === 1
    && markers[0].metric_string_value === ONE_REPORTING_SCOPE_VERSION
    && sources[0].metric_string_value === environment
    && rows.every(row => row.source_environment === environment);
}

/** Empty telemetry is not evidence of zero customers. */
export function androidCaptureResult(result, range, environment = 'production') {
  const row = result.rows?.[0];
  const available = !result.error && !!row;
  const observed = available && Number(row.events) > 0;
  const num = (key) => observed && row[key] != null ? Number(row[key]) : null;
  return {
    state: !available ? 'unavailable' : observed ? 'observed' : 'waiting',
    packageId: ONE_ANDROID_PACKAGE,
    source: 'Firebase GA4 BigQuery export',
    reportingTimezone: ONE_ANDROID_TIMEZONE,
    startDate: range.startDate, endDate: range.endDate,
    observedSince: observed ? row.observedSince ?? null : null,
    latestEventAt: observed ? row.latestEventAt?.value ?? row.latestEventAt ?? null : null,
    events: num('events'), activeAppIds: num('activeAppIds'),
    identifiedAccounts: num('boundAppIds') > 0 ? num('identifiedAccounts') : null,
    // Automatic SDK first_open historically has no backend environment tag.
    // A zero after filtering cannot prove zero installs/reinstalls.
    firstOpens: null, firstOpenCoverage: 'unverified_backend_environment', routeVisits: num('routeVisits'),
    releases: observed && Array.isArray(row.releases) ? row.releases.slice(0,20).map(release=>({
      version: /^\d+\.\d+[\w.+-]{0,40}$/.test(release.version ?? '') ? release.version : 'unknown',
      installer: release.installer === 'com.android.vending' ? 'com.android.vending' : release.installer === 'unknown' ? 'unknown' : 'other',
      environment: ['production','uat','development','test','unlabeled'].includes(release.environment) ? release.environment : 'unknown',
      events: release.events != null && release.events !== '' && Number.isSafeInteger(Number(release.events)) && Number(release.events)>=0 ? Number(release.events) : null,
    })) : [],
    note: !available ? 'Android export query unavailable; no zero is inferred.'
      : observed ? `New Android package only. ${environment === 'production' ? 'Raw production export history starts on 7 October 2026 (a partial day); earlier dates are not backfilled. ' : ''}App IDs are not people. Backend environment and installer are shown separately; first opens are not store downloads.`
        : `No new Android app events were exported for these dates. ${environment === 'production' ? 'Export membership was repaired on 7 October 2026; ' : ''}Earlier raw events cannot be assumed recoverable.`,
  };
}
