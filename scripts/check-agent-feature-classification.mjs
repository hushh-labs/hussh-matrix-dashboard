#!/usr/bin/env node
/** Guard the event-to-feature boundaries that must not inflate agent KPIs. */
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const query = source.match(/const featureUsageQuery = `([\s\S]*?)`;/)?.[1] || '';
const cases = [
  ['gmail_attempt_separate', "WHEN event_name = 'gmail_connect_started' THEN 'account_connect_started'"],
  ['gmail_completion_is_terminal_stage', "event_name = 'gmail_connect_result' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') = 'complete' THEN 'account_connected'"],
  ['sync_request_separate', "WHEN event_name = 'gmail_sync_requested' THEN 'receipt_sync_requested'"],
  ['sync_queue_is_separate_stage', "event_name = 'gmail_sync_result' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') = 'queue' THEN 'receipt_sync'"],
  ['sync_completion_is_separate_stage', "event_name = 'gmail_sync_result' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') = 'complete' THEN 'receipt_sync_completed'"],
  ['signin_screen_not_inbox', "WHEN event_name = 'hushh_mail_signin_screen_view' THEN 'mail_signin_screen_view'"],
  ['parse_outcomes_stay_together', "event_name = 'import_parse_completed' THEN 'receipt_parsed'"],
  ['save_outcomes_are_separate_stage', "event_name = 'import_save_completed' THEN 'import_saved'"],
  ['identified_accounts_are_distinct', "COUNT(DISTINCT accountKey) AS accounts"],
  ['success_outcomes_are_separate', "COUNTIF(result = 'success') AS successes"],
  ['expected_outcomes_are_separate', "COUNTIF(result = 'expected_error') AS expectedErrors"],
  ['failure_outcomes_are_separate', "COUNTIF(result = 'error') AS failures"],
  ['memory_action_is_classified', "event_name = 'one_memory_action'"],
  ['wallet_action_is_classified', "event_name = 'one_wallet_action'"],
  ['calendar_action_is_classified', "event_name = 'one_calendar_action'"],
  ['kyc_action_is_classified', "event_name = 'one_kyc_action'"],
  ['crm_action_is_classified', "event_name = 'one_crm_action'"],
];
const results = cases.map(([name, fragment]) => ({ name, ok: query.includes(fragment) }));
const finance = source.match(/key: 'finance',[\s\S]*?key: 'consent'/)?.[0] || '';
const gmail = source.match(/key: 'gmail',[\s\S]*?key: 'ria'/)?.[0] || '';
results.push({ name: 'finance_import_outcomes_not_double_counted', ok: /background: \[[\s\S]*?'import_parse_completed', 'import_save_completed'/.test(finance) });
results.push({ name: 'gmail_results_not_double_counted', ok: /background: \[[\s\S]*?'gmail_connect_result', 'gmail_sync_result'/.test(gmail) });
const ok = results.every((result) => result.ok);
console.log(JSON.stringify({ ok, checkedAt: new Date().toISOString(), target: 'One agent feature classification', checks: results }, null, 2));
if (!ok) process.exitCode = 1;
