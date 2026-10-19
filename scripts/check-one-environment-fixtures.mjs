#!/usr/bin/env node
/** Executes real scope SQL against synthetic rows only. No customer tables read. */
import assert from 'node:assert/strict';
import { BigQuery } from '@google-cloud/bigquery';
import { oneSurfaceSql } from '../src/server/one-scope.mjs';

const rows = [];
function event(id, platform, stream, app, env, extra = {}) {
  rows.push({ id, platform, stream, app, user: 'synthetic-account-a', pseudo: id,
    params: [{ key: 'env', text: env }, ...(platform === 'WEB' ? [{ key: 'page_location', text: env === 'uat' ? 'https://uat.one.hushh.ai/one' : 'https://one.hushh.ai/one' }] : [])], ...extra });
}
event('prod-web', 'WEB', '13695004816', '', 'production');
event('prod-ios', 'IOS', '13695001361', 'com.hushh.app', 'production');
event('prod-android', 'ANDROID', '15395548050', 'com.hussh.app', 'production');
event('uat-web', 'WEB', '14383500973', '', 'uat');
event('uat-ios', 'IOS', '14383415557', 'com.hushh.app', 'uat');
event('uat-android', 'ANDROID', '15395713075', 'com.hussh.app', 'uat');
event('legacy-public-uat', 'IOS', '13695001361', 'com.hushh.app', 'uat');
event('foreign-ios', 'IOS', '13702689760', 'com.hushh.app', 'production');
event('legacy-android', 'ANDROID', '13694989021', 'com.hushh.app', 'production');
event('untagged-ios', 'IOS', '13695001361', 'com.hushh.app', null);
for (const [platform, stream, app] of [['WEB','13695004816',''], ['IOS','13695001361','com.hushh.app'], ['ANDROID','15395548050','com.hussh.app']]) {
  event(`debug-${platform}`, platform, stream, app, 'production');
  rows.at(-1).params.push({ key: 'debug_mode', text: platform === 'IOS' ? 'TRUE' : null, integer: platform === 'IOS' ? null : 1 });
}
const bq = new BigQuery({ projectId: process.env.BQ_JOB_PROJECT || 'hushh-ai-prod' });
for (const environment of ['production', 'uat']) {
  const query = `WITH fixture AS (
    SELECT JSON_VALUE(j,'$.id') AS id, JSON_VALUE(j,'$.platform') AS platform,
      JSON_VALUE(j,'$.stream') AS stream_id, STRUCT(JSON_VALUE(j,'$.app') AS id) AS app_info,
      JSON_VALUE(j,'$.user') AS user_id,
      ARRAY(SELECT AS STRUCT JSON_VALUE(p,'$.key') AS key,
        STRUCT(JSON_VALUE(p,'$.text') AS string_value, SAFE_CAST(JSON_VALUE(p,'$.integer') AS INT64) AS int_value) AS value
        FROM UNNEST(JSON_QUERY_ARRAY(j,'$.params')) p) AS event_params
    FROM UNNEST(JSON_QUERY_ARRAY(@fixtures)) j)
    SELECT ARRAY_AGG(id ORDER BY id) AS retained, COUNT(DISTINCT user_id) AS accounts
    FROM fixture WHERE ${oneSurfaceSql(environment === 'production' ? 'one.hushh.ai' : 'uat.one.hushh.ai', environment)}`;
  const [result] = await bq.query({ query, params: { fixtures: JSON.stringify(rows) }, location: 'US', maximumBytesBilled: '10000000', jobTimeoutMs: 30000 });
  const expected = environment === 'production' ? ['prod-android','prod-ios','prod-web'] : ['uat-android','uat-ios','uat-web'];
  assert.deepEqual(result[0].retained, expected);
  assert.equal(Number(result[0].accounts), 1);
  console.log(JSON.stringify({ environment, retainedSyntheticEvents: expected.length, distinctAccounts: 1, passed: true }));
}
