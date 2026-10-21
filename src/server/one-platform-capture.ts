type Row = Record<string, unknown>;
export type PlatformCaptureResult = { rows: Row[]; error: string | null };
type QueryOptions = { query: string; location: string; dryRun?: boolean; maximumBytesBilled?: string; jobTimeoutMs?: number };
type Reader = {
  createQueryJob(options: QueryOptions): Promise<unknown>;
  query(options: QueryOptions): Promise<unknown>;
};
export const ANDROID_CAPTURE_ADDITIONAL_BYTES = 100_000_000;

/** Both reports share one scoped source and exact range-wide distinct counts. */
export function onePlatformCaptureQueries({ table, dateFilter, meaningful, androidStartDate, environment }: {
  table: string; dateFilter: string; meaningful: string; androidStartDate: string | null; environment:'production'|'uat';
}) {
  if (!['production','uat'].includes(environment)) throw new Error('Invalid capture environment');
  if (androidStartDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(androidStartDate)) throw new Error('Invalid capture start date');
  const platformRows = (asStruct = false) => `${asStruct ? 'SELECT AS STRUCT' : 'SELECT'} summary.*,
      COALESCE(named_summary.namedRouteVisits, 0) AS namedRouteVisits,
      COALESCE(named_summary.distinctScreens, 0) AS distinctScreens,
      top_routes.topProductScreens
    FROM summary LEFT JOIN named_summary USING (platform) LEFT JOIN top_routes USING (platform)
    ORDER BY users DESC`;
  const scoped = (capture: boolean) => `WITH scoped AS (
      SELECT platform, user_pseudo_id, NULLIF(user_id, '') AS accountId, event_name,
        ${capture ? `event_date, event_timestamp, COALESCE(app_info.version, 'unknown') AS version,
        COALESCE(app_info.install_source, 'unknown') AS installer,` : ''}
        NULLIF((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'route_id'), '') AS routeId
      FROM ${table} WHERE ${dateFilter} AND platform IN ('WEB', 'IOS', 'ANDROID')
    ), named_routes AS (
      SELECT platform, routeId FROM scoped
      WHERE event_name = 'page_view' AND REGEXP_CONTAINS(routeId, r'^[a-z][a-z0-9_]{0,60}$')
        AND NOT REGEXP_CONTAINS(routeId, r'(^unknown$|^logout$|oauth_return$|_legacy_redirect$|^oauth_authorize$)')
    ), route_counts AS (
      SELECT platform, routeId, COUNT(*) AS visits FROM named_routes GROUP BY platform, routeId
    ), top_routes AS (
      SELECT platform, ARRAY_AGG(STRUCT(routeId, visits) ORDER BY visits DESC, routeId LIMIT 5) AS topProductScreens
      FROM route_counts GROUP BY platform
    ), summary AS (
      SELECT platform, COUNT(DISTINCT user_pseudo_id) AS users, COUNT(*) AS events,
        COUNT(DISTINCT IF(${meaningful}, user_pseudo_id, NULL)) AS activeDeviceIds,
        COUNT(DISTINCT IF(${meaningful}, accountId, NULL)) AS activeAccounts,
        COUNTIF(event_name = 'page_view') AS routeVisits
      FROM scoped GROUP BY platform
    ), named_summary AS (
      SELECT platform, COUNT(*) AS namedRouteVisits, COUNT(DISTINCT routeId) AS distinctScreens
      FROM named_routes GROUP BY platform
    )`;
  const baseline = scoped(false) + platformRows();
  if (!androidStartDate) return { baseline, combined: null };
  const combined = `${scoped(true)}, android_scoped AS (
      SELECT * FROM scoped WHERE platform = 'ANDROID' AND event_date >= '${androidStartDate.replaceAll('-', '')}'
    ), android_releases AS (
      SELECT version, installer, '${environment}' AS environment, COUNT(*) AS events FROM android_scoped GROUP BY version, installer
    ), android_capture AS (
      SELECT COUNT(*) AS events,
        COUNT(DISTINCT IF(${meaningful}, user_pseudo_id, NULL)) AS activeAppIds,
        COUNT(DISTINCT IF(${meaningful}, accountId, NULL)) AS identifiedAccounts,
        COUNT(DISTINCT IF(${meaningful} AND accountId IS NOT NULL, user_pseudo_id, NULL)) AS boundAppIds,
        COUNTIF(event_name = 'first_open') AS firstOpens, COUNTIF(event_name = 'page_view') AS routeVisits,
        CAST(MIN(PARSE_DATE('%Y%m%d', event_date)) AS STRING) AS observedSince,
        MAX(TIMESTAMP_MICROS(event_timestamp)) AS latestEventAt FROM android_scoped
    )
    SELECT ARRAY(${platformRows(true)}) AS platforms,
      (SELECT AS STRUCT android_capture.*,
        ARRAY(SELECT AS STRUCT * FROM android_releases ORDER BY events DESC, version, installer LIMIT 20) AS releases
       FROM android_capture) AS androidCapture`;
  return { baseline, combined };
}

/** The optional capture adds at most 100 MB over the existing platform scan. */
export async function readPlatformCapture(reader: Reader, queries: ReturnType<typeof onePlatformCaptureQueries>): Promise<PlatformCaptureResult> {
  const deadline = Date.now() + 40_000;
  const bounded = async (operation: () => Promise<unknown>) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Aggregate deadline reached');
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([operation(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Aggregate deadline reached')), remaining);
      })]);
    } finally { clearTimeout(timer!); }
  };
  const execute = async (query: string, maximumBytesBilled?: number): Promise<Row[]> => {
    const response = await bounded(() => reader.query({query, location:'US',
      ...(maximumBytesBilled === undefined ? {} : {maximumBytesBilled:String(maximumBytesBilled)}),
      jobTimeoutMs:Math.max(1, Math.min(30_000, deadline-Date.now()))}));
    if (!Array.isArray(response) || !Array.isArray(response[0])) throw new Error('Invalid aggregate response');
    return response[0];
  };
  const baselineOnly = async (limit?: number, unavailable = false): Promise<PlatformCaptureResult> => ({
    rows:[{platforms:await execute(queries.baseline,limit), androidCapture:unavailable ? null : {events:0}}], error:null,
  });
  try {
    if (!queries.combined) return await baselineOnly();
    const estimate = async (query: string) => {
      const response = await bounded(() => reader.createQueryJob({query, location:'US', dryRun:true}));
      const job = Array.isArray(response) ? response[0] : null;
      const bytes = job?.metadata?.statistics?.totalBytesProcessed;
      if (!isCount(bytes)) throw new Error('Invalid scan estimate');
      return Number(bytes);
    };
    const baselineBytes = await estimate(queries.baseline);
    const limit = baselineBytes + ANDROID_CAPTURE_ADDITIONAL_BYTES;
    if (!Number.isSafeInteger(limit)) throw new Error('Invalid scan limit');
    let combinedBytes: number;
    try { combinedBytes = await estimate(queries.combined); }
    catch { return await baselineOnly(limit,true); }
    if (combinedBytes > limit) return await baselineOnly(limit,true);
    // Never add a second paid scan following an execution failure.
    return {rows:await execute(queries.combined,limit), error:null};
  } catch {
    return {rows:[], error:'One platform and Android aggregate query unavailable'};
  }
}

const record = (value:unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = (value:unknown): value is number|string =>
  (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) &&
  Number.isSafeInteger(Number(value)) && Number(value) >= 0;
const platformCounts = ['users','events','activeDeviceIds','activeAccounts','routeVisits','namedRouteVisits','distinctScreens'];
const captureCounts = ['events','activeAppIds','identifiedAccounts','boundAppIds','firstOpens','routeVisits'];

/** Strict envelopes prevent missing/failed aggregates from becoming apparent zeros. */
export function unpackPlatformCapture(result:unknown): {platforms:PlatformCaptureResult; androidCapture:PlatformCaptureResult} {
  const fail = (error:string) => ({platforms:{rows:[],error},androidCapture:{rows:[],error}});
  if (!record(result) || result.error || !Array.isArray(result.rows) || result.rows.length !== 1 || !record(result.rows[0]))
    return fail('One platform aggregate envelope unavailable');
  const row = result.rows[0];
  const seen = new Set();
  if (!Array.isArray(row.platforms) || row.platforms.length > 3) return fail('One platform aggregate envelope invalid');
  const platforms: Row[] = [];
  for (const item of row.platforms) {
    if (!record(item) || !['WEB','IOS','ANDROID'].includes(String(item.platform)) || seen.has(item.platform) ||
        platformCounts.some(key => !isCount(item[key])) ||
        (item.topProductScreens !== null && (!Array.isArray(item.topProductScreens) || item.topProductScreens.length > 5)))
      return fail('One platform aggregate envelope invalid');
    const screens:Row[] = [];
    for (const screen of (item.topProductScreens ?? []) as unknown[]) {
      if (!record(screen) || typeof screen.routeId !== 'string' || !/^[a-z][a-z0-9_]{0,60}$/.test(screen.routeId) || !isCount(screen.visits))
        return fail('One platform aggregate envelope invalid');
      screens.push({routeId:screen.routeId,visits:Number(screen.visits)});
    }
    seen.add(item.platform);
    platforms.push({platform:item.platform, ...Object.fromEntries(platformCounts.map(key=>[key,Number(item[key])])), topProductScreens:screens});
  }
  const unavailable = () => ({platforms:{rows:platforms,error:null}, androidCapture:{rows:[],error:'Android aggregate unavailable'}});
  const capture = row.androidCapture;
  if (!record(capture) || !isCount(capture.events)) return unavailable();
  if (Number(capture.events) === 0) return {platforms:{rows:platforms,error:null},androidCapture:{rows:[{events:0}],error:null}};
  if (captureCounts.some(key=>!isCount(capture[key])) || typeof capture.observedSince !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(capture.observedSince) ||
      !(typeof capture.latestEventAt === 'string' || (record(capture.latestEventAt) && typeof capture.latestEventAt.value === 'string')) ||
      !Array.isArray(capture.releases) || capture.releases.length > 20) return unavailable();
  const releases:Row[] = [];
  for (const release of capture.releases) {
    if (!record(release) || !isCount(release.events) || typeof release.version !== 'string' ||
        typeof release.installer !== 'string' || !['production','uat'].includes(String(release.environment))) return unavailable();
    releases.push({version:release.version,installer:release.installer,environment:release.environment,events:Number(release.events)});
  }
  return {platforms:{rows:platforms,error:null},androidCapture:{rows:[{
    ...Object.fromEntries(captureCounts.map(key=>[key,Number(capture[key])])),
    observedSince:capture.observedSince,
    latestEventAt:typeof capture.latestEventAt === 'string' ? capture.latestEventAt : capture.latestEventAt.value,
    releases,
  }],error:null}};
}
