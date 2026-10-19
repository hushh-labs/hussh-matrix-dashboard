import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { oneSurfaceSql, ONE_REPORTING_SCOPE_VERSION } from '../src/server/one-scope.mjs';

const source = new URL('../sql/kai_public_dashboard_feed.production.sql', import.meta.url);
const begin = '    -- BEGIN GENERATED ONE ENVIRONMENT SCOPE';
const end = '    -- END GENERATED ONE ENVIRONMENT SCOPE';

export function renderOneFeedSql(environment = 'production') {
  if (!['production', 'uat'].includes(environment)) throw new Error('Invalid One feed environment');
  let sql = readFileSync(source, 'utf8').replaceAll('\r\n', '\n');
  const start = sql.indexOf(begin), stop = sql.indexOf(end);
  if (start < 0 || stop <= start) throw new Error('One feed scope markers are missing');
  const host = environment === 'production' ? 'one.hushh.ai' : 'uat.one.hushh.ai';
  sql = sql.slice(0, start) + begin + '\n    AND ' + oneSurfaceSql(host, environment, { alias: 'e' }) + '\n' + sql.slice(stop);
  if (!sql.includes(`'${ONE_REPORTING_SCOPE_VERSION}' AS metric_string_value`)) throw new Error('Feed version does not match reporting contract');
  if (environment === 'uat') {
    sql = sql.replaceAll('hushh-pda.analytics_526603671', 'hushh-pda-uat.analytics_533362555')
      .replaceAll('hushh-pda.analytics_public', 'hushh-pda-uat.analytics_public')
      .replaceAll("'hushh-pda'", "'hushh-pda-uat'")
      .replaceAll("'analytics_526603671'", "'analytics_533362555'")
      .replaceAll("'production' AS metric_string_value", "'uat' AS metric_string_value")
      .replaceAll("'production' AS source_environment", "'uat' AS source_environment")
      .replaceAll("plus one.hushh.ai", "plus uat.one.hushh.ai")
      .replaceAll("(production)", "(uat)");
  }
  return sql;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const sql = renderOneFeedSql();
  if (process.argv.includes('--write')) writeFileSync(source, sql);
  else if (sql !== readFileSync(source, 'utf8').replaceAll('\r\n', '\n')) {
    console.error('One feed scope is stale. Run node scripts/render-one-feed-scope.mjs --write');
    process.exitCode = 1;
  } else console.log('One feed scope matches the canonical environment contract.');
}
