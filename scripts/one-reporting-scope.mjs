import { tsImport } from 'tsx/esm/api';
import { oneSurfaceSql } from '../src/server/one-scope.mjs';

/** Reconciliation must use the dashboard's signed customer population. */
export async function oneReportingSurfaceSql(webHost, environment = 'production') {
  if (!['production', 'uat'].includes(environment)) throw new Error('Unknown One reporting environment.');
  const surface = oneSurfaceSql(webHost, environment);
  if (environment === 'uat') return surface;
  const { readCustomerCohort, customerEventSql } = await tsImport('../src/server/one-customer-cohort.ts', import.meta.url);
  // Missing, partial or expired membership must fail; never compare against
  // unfiltered accounts or infer customer identity from a shared device.
  return `(${surface}) AND (${customerEventSql(await readCustomerCohort())})`;
}

/** Cached dashboard values cannot be compared to a changing intraday table. */
export async function finalizedReportingEnd(reader, project, dataset) {
  if (!/^[a-z0-9-]+$/.test(project) || !/^[A-Za-z0-9_]+$/.test(dataset)) throw new Error('Invalid One export source.');
  try {
    const [rows] = await reader.query({ useLegacySql: false, query: `
      SELECT MAX(SUBSTR(table_name, 8)) AS latest
      FROM \`${project}.${dataset}.INFORMATION_SCHEMA.TABLES\`
      WHERE REGEXP_CONTAINS(table_name, r'^events_[0-9]{8}$')
        AND SUBSTR(table_name, 8) <= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE('UTC'), INTERVAL 1 DAY))` });
    const suffix = rows?.[0]?.latest;
    if (typeof suffix !== 'string' || !/^\d{8}$/.test(suffix)) throw new Error('Missing finalized export');
    return `${suffix.slice(0, 4)}-${suffix.slice(4, 6)}-${suffix.slice(6, 8)}`;
  } catch {
    throw new Error('Finalized One export day could not be verified.');
  }
}
