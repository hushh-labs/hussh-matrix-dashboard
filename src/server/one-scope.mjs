/** Verified One application scope. Stream IDs are strings, not package aliases. */
export const ONE_ANDROID_PACKAGE = 'com.hussh.app';
export const ONE_ANDROID_STREAMS = { production: '15395548050', uat: '15395713075' };
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

const literal = (value) => `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

export function oneAndroidSql(environment = 'production') {
  if (!Object.hasOwn(ONE_ANDROID_STREAMS, environment)) throw new Error('Invalid One reporting environment');
  return `(platform = 'ANDROID' AND app_info.id = '${ONE_ANDROID_PACKAGE}'
    AND stream_id = '${ONE_ANDROID_STREAMS[environment]}'
    AND COALESCE((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'debug_mode'), 0) != 1
    AND COALESCE((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'debug_mode'), '') NOT IN ('1', 'true'))`;
}

export function oneSurfaceSql(webHost, environment = webHost === 'uat.one.hushh.ai' ? 'uat' : 'production') {
  return `((platform = 'IOS' AND app_info.id = 'com.hushh.app')
    OR ${oneAndroidSql(environment)}
    OR (platform = 'WEB' AND NET.HOST((SELECT value.string_value FROM UNNEST(event_params)
      WHERE key = 'page_location')) = ${literal(webHost)}))`;
}

/** Founder customers require a production backend tag; automatic untagged events cannot establish it. */
export function oneFounderSurfaceSql(webHost) {
  return `(${oneSurfaceSql(webHost)} AND (platform != 'ANDROID'
    OR (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'env') = 'production'))`;
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
    firstOpens: num('firstOpens'), routeVisits: num('routeVisits'),
    releases: observed && Array.isArray(row.releases) ? row.releases.slice(0,20).map(release=>({
      version: /^\d+\.\d+[\w.+-]{0,40}$/.test(release.version ?? '') ? release.version : 'unknown',
      installer: release.installer === 'com.android.vending' ? 'com.android.vending' : release.installer === 'unknown' ? 'unknown' : 'other',
      environment: ['production','uat','development','test','unlabeled'].includes(release.environment) ? release.environment : 'unknown',
      events: Number.isSafeInteger(Number(release.events)) && Number(release.events)>=0 ? Number(release.events) : null,
    })) : [],
    note: !available ? 'Android export query unavailable; no zero is inferred.'
      : observed ? `New Android package only. ${environment === 'production' ? 'Raw production export history starts on 7 October 2026 (a partial day); earlier dates are not backfilled. ' : ''}App IDs are not people. Backend environment and installer are shown separately; first opens are not store downloads.`
        : `No new Android app events were exported for these dates. ${environment === 'production' ? 'Export membership was repaired on 7 October 2026; ' : ''}Earlier raw events cannot be assumed recoverable.`,
  };
}
