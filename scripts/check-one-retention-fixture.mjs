/** Read-only BigQuery SQL fixture. No production event or table is created. */
import assert from 'node:assert/strict';
import { BigQuery } from '@google-cloud/bigquery';
import { oneRetentionSql, oneRetentionCohort } from '../src/server/one-retention.mjs';

const events = [
  ['WEB','a','first_visit','20260920'], ['WEB','b','first_visit','20260920'],
  ['WEB','b','page_view','20260921'], ['WEB','b','page_view','20260921'],
  ['WEB','old','page_view','20260920'], // Only surviving activity; no observed acquisition.
  ['IOS','d','first_open','20260921'], ['IOS','d','page_view','20260921'],
  ['IOS','e','first_open','20260926'], ['IOS','e','page_view','20260928'],
  ['WEB','f','first_visit','20260928'], ['WEB','f','page_view','20260929'],
  ['ANDROID','a','first_open','20261007'], ['ANDROID','a','page_view','20261009'],
];

async function main() {
  const query = oneRetentionSql({
    table: 'fixture_events', tables: 'fixture_tables', suffixFilter: 'TRUE', surfaceFilter: 'TRUE',
    meaningful: "event_name = 'page_view'", deviceKeySql: "CONCAT(platform, ':', user_pseudo_id)",
    startDate: '2026-09-20', endDate: '2026-10-10', androidCompleteFrom: '2026-10-08',
  });
  const fixture = `WITH fixture_events AS (${events.map(([platform,id,event,date]) =>
    `SELECT '${platform}' platform, '${id}' user_pseudo_id, '${event}' event_name, '${date}' event_date`).join(' UNION ALL ')}),
    fixture_tables AS (SELECT CONCAT('events_',FORMAT_DATE('%Y%m%d',day)) table_name
      FROM UNNEST(GENERATE_DATE_ARRAY(DATE '2026-09-20',DATE '2026-10-10')) day
      WHERE day != DATE '2026-10-08' UNION ALL SELECT 'events_intraday_20261008'),
    ${query.replace(/^\s*WITH /, '')}`;
  const [raw] = await new BigQuery({projectId: process.env.BQ_JOB_PROJECT || 'hushh-ai-prod'}).query({
    query: fixture, location: 'US', maximumBytesBilled: '100000000', jobTimeoutMs: 30_000,
  });
  const rows = raw.map(oneRetentionCohort);
  assert.deepEqual(rows.find(row => row.cohortWeek === '2026-09-20'), {
    cohortWeek: '2026-09-20', cohortSize: 4, returnedW1: 2, rateW1: 0.5,
    windowComplete: true, state: 'available', dataThrough: '2026-10-10',
  });
  for (const week of ['2026-09-27','2026-10-04']) {
    assert.equal(rows.find(row => row.cohortWeek === week)?.rateW1, null);
  }
  console.log(JSON.stringify({ok: true, fixture: 'literal rows only', checks: [
    'never-returning denominator', 'old surviving activity excluded', 'same-day excluded',
    'duplicate returns deduplicated', 'missing finalized date', 'intraday not finalized', 'partial Android coverage',
  ]}));
}
main().catch(error => {
  console.error(JSON.stringify({ok: false, reason: error instanceof assert.AssertionError
    ? error.message : 'BigQuery retention fixture could not complete'}));
  process.exitCode = 1;
});
