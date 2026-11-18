import { createHash } from 'node:crypto';
import { oneSurfaceSql, ONE_WEB_HOSTS, ONE_REPORTING_SCOPE_VERSION } from './one-scope.mjs';
import { oneFeatureUsageQuery } from './one-feature-usage-query';
import { reportingTimezone } from './reports/contracts';

/** Disconnected plan builder. Configuration must come from an independently
 * approved, verified UAT source policy; it is never a public request body. */
export function buildUatFeaturePlan(config: { project:string; dataset:string; webHost:string; timezone:string;
  startDate:string; endDate:string; maxPeriodDays:number }) {
  const validDay=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v;
  if (!config || config.project!=='hushh-pda-uat' || !/^analytics_\d+$/.test(config.dataset)
    || !ONE_WEB_HOSTS.uat.includes(config.webHost) || reportingTimezone(config.timezone)!==config.timezone
    || !validDay(config.startDate) || !validDay(config.endDate) || config.startDate>config.endDate
    || !Number.isSafeInteger(config.maxPeriodDays) || config.maxPeriodDays<1 || config.maxPeriodDays>90
    || (Date.parse(config.endDate)-Date.parse(config.startDate))/86_400_000+1>config.maxPeriodDays) throw new Error('UAT feature plan unavailable');
  const suffixes:string[]=[];
  for (let time=Date.parse(config.startDate);time<=Date.parse(config.endDate);time+=86_400_000) {
    const suffix=new Date(time).toISOString().slice(0,10).replaceAll('-',''); suffixes.push(`'${suffix}'`,`'intraday_${suffix}'`);
  }
  const tables=`\`${config.project}.${config.dataset}.INFORMATION_SCHEMA.TABLES\``;
  const dateFilter=`(_TABLE_SUFFIX IN (${suffixes.join(', ')})
    AND (
      NOT STARTS_WITH(_TABLE_SUFFIX, 'intraday_')
      OR REGEXP_REPLACE(_TABLE_SUFFIX, r'^intraday_', '') NOT IN (
        SELECT REGEXP_REPLACE(table_name, r'^events_', '')
        FROM ${tables}
        WHERE STARTS_WITH(table_name, 'events_')
          AND NOT STARTS_WITH(table_name, 'events_intraday_')
      )
    )) AND ${oneSurfaceSql(config.webHost,'uat')}`;
  const query=oneFeatureUsageQuery({deviceKeySql:"CONCAT(COALESCE(platform, 'UNKNOWN'), ':', user_pseudo_id)",
    table:`\`${config.project}.${config.dataset}.events_*\``,dateFilter});
  return Object.freeze({ query, queryHash:createHash('sha256').update(query).digest('hex'), sourceProject:config.project,
    dataset:config.dataset, environment:'uat' as const, reportingScopeVersion:ONE_REPORTING_SCOPE_VERSION,
    startDate:config.startDate,endDate:config.endDate,timezone:config.timezone });
}
