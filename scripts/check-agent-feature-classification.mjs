#!/usr/bin/env node
/** Guard the event-to-feature boundaries that must not inflate agent KPIs. */
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const query = source.match(/const featureUsageQuery = `([\s\S]*?)`;/)?.[1] || '';
const cases = [
  ['gmail_attempt_separate', "WHEN event_name = 'gmail_connect_started' THEN 'account_connect_started'"],
  ['gmail_completion_only', "event_name = 'gmail_connect_result' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') = 'complete' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'result') = 'success' THEN 'account_connected'"],
  ['sync_request_separate', "WHEN event_name = 'gmail_sync_requested' THEN 'receipt_sync_requested'"],
  ['sync_queue_acceptance_only', "event_name = 'gmail_sync_result' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') = 'queue' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'result') = 'success' THEN 'receipt_sync'"],
  ['signin_screen_not_inbox', "WHEN event_name = 'hushh_mail_signin_screen_view' THEN 'mail_signin_screen_view'"],
  ['parse_success_only', "event_name = 'import_parse_completed' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'result') = 'success' THEN 'receipt_parsed'"],
  ['save_success_separate', "event_name = 'import_save_completed' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'result') = 'success' THEN 'import_saved'"],
];
const results = cases.map(([name, fragment]) => ({ name, ok: query.includes(fragment) }));
const finance = source.match(/key: 'finance',[\s\S]*?key: 'consent'/)?.[0] || '';
const gmail = source.match(/key: 'gmail',[\s\S]*?key: 'ria'/)?.[0] || '';
results.push({ name: 'finance_import_outcomes_not_double_counted', ok: /background: \[[\s\S]*?'import_parse_completed', 'import_save_completed'/.test(finance) });
results.push({ name: 'gmail_results_not_double_counted', ok: /background: \[[\s\S]*?'gmail_connect_result', 'gmail_sync_result'/.test(gmail) });
const ok = results.every((result) => result.ok);
console.log(JSON.stringify({ ok, checkedAt: new Date().toISOString(), target: 'One agent feature classification', checks: results }, null, 2));
if (!ok) process.exitCode = 1;
