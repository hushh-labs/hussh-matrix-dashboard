/** Observed acquisition cohorts, never cohorts selected by later activity. */
export function oneRetentionSql({ table, tables, suffixFilter, surfaceFilter, meaningful, deviceKeySql, startDate, endDate, androidCompleteFrom = null }) {
  return `
    WITH scoped AS (
      SELECT ${deviceKeySql} AS deviceKey, platform, event_name,
        PARSE_DATE('%Y%m%d', event_date) AS day, ${meaningful} AS meaningful
      FROM ${table} WHERE ${suffixFilter} AND ${surfaceFilter}
        AND user_pseudo_id IS NOT NULL
    ),
    acquisitions AS (
      SELECT deviceKey, platform,
        MIN(IF((platform = 'WEB' AND event_name = 'first_visit')
          OR (platform IN ('IOS', 'ANDROID') AND event_name = 'first_open'), day, NULL)) AS firstDay,
        ARRAY_AGG(DISTINCT IF(meaningful, day, NULL) IGNORE NULLS) AS activeDays
      FROM scoped
      GROUP BY deviceKey, platform
    ),
    finalized_days AS (
      SELECT PARSE_DATE('%Y%m%d', SUBSTR(table_name, 8)) AS day FROM ${tables}
      WHERE REGEXP_CONTAINS(table_name, r'^events_[0-9]{8}$')
        AND table_name BETWEEN 'events_${startDate.replaceAll('-', '')}' AND 'events_${endDate.replaceAll('-', '')}'
    ),
    devices AS (
      SELECT a.deviceKey, a.platform, a.firstDay,
        DATE_TRUNC(a.firstDay, WEEK(SUNDAY)) AS cohortWeek,
        EXISTS(SELECT 1 FROM UNNEST(a.activeDays) day
          WHERE day BETWEEN DATE_ADD(a.firstDay, INTERVAL 1 DAY)
          AND DATE_ADD(a.firstDay, INTERVAL 7 DAY)) AS returned
      FROM acquisitions a
      WHERE DATE_TRUNC(a.firstDay, WEEK(SUNDAY)) >= DATE '${startDate}'
    ),
    cohort_totals AS (
      SELECT cohortWeek, COUNT(*) AS cohortSize, COUNTIF(returned) AS returnedW1,
        ${androidCompleteFrom ? `COUNTIF(platform = 'ANDROID' AND firstDay < DATE '${androidCompleteFrom}')` : '0'} AS incompleteSourceDevices
      FROM devices GROUP BY cohortWeek
    )
    SELECT CAST(c.cohortWeek AS STRING) AS cohortWeek, cohortSize, returnedW1,
      (SELECT COUNT(*) FROM finalized_days d WHERE d.day BETWEEN c.cohortWeek
        AND DATE_ADD(c.cohortWeek, INTERVAL 13 DAY)) AS completeDays,
      incompleteSourceDevices,
      CAST((SELECT MAX(day) FROM finalized_days) AS STRING) AS dataThrough
    FROM cohort_totals c ORDER BY c.cohortWeek DESC LIMIT 8
  `;
}

export function oneRetentionCohort(row) {
  const count = value => value !== null && value !== undefined && value !== ''
    && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const cohortSize = count(row.cohortSize), returned = count(row.returnedW1);
  const complete = count(row.completeDays) === 14 && count(row.incompleteSourceDevices) === 0;
  const valid = cohortSize !== null && returned !== null && returned <= cohortSize;
  return {
    cohortWeek: String(row.cohortWeek), cohortSize, returnedW1: valid && complete ? returned : null,
    rateW1: valid && complete && cohortSize > 0 ? returned / cohortSize : null,
    windowComplete: complete && valid,
    state: !valid ? 'unavailable' : complete ? 'available' : 'pending',
    dataThrough: row.dataThrough ?? null,
  };
}
