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
  ['viewing_has_its_own_feature', "= 'location_share_viewed' THEN 'location_viewed'"],
  ['consent_screen_loads_separate', "= 'screen' THEN 'consent_screen_viewed'"],
  ['exact_event_composition_is_returned', 'ARRAY_AGG(STRUCT(eventName, signals, successes, expectedErrors, failures)'],
];
const results = cases.map(([name, fragment]) => ({ name, ok: query.includes(fragment) }));
const finance = source.match(/key: 'finance',[\s\S]*?key: 'consent'/)?.[0] || '';
const gmail = source.match(/key: 'gmail',[\s\S]*?key: 'ria'/)?.[0] || '';
const memory = source.match(/key: 'memory',[\s\S]*?key: 'wallet'/)?.[0] || '';
const founderAgentQuery = [...source.matchAll(/const agentQuery = `([\s\S]*?)`;/g)]
  .map((match) => match[1])
  .find((candidate) => candidate.includes('AS successful_accounts')) || '';
results.push({ name: 'finance_import_outcomes_not_double_counted', ok: /background: \[[\s\S]*?'import_parse_completed', 'import_save_completed'/.test(finance) });
results.push({ name: 'gmail_results_not_double_counted', ok: /background: \[[\s\S]*?'gmail_connect_result', 'gmail_sync_result'/.test(gmail) });
results.push({
  name: 'memory_background_diagnostics_are_not_outcomes',
  ok: !/outcomes:\s*\[[\s\S]*?agent_pkm_/.test(memory),
});
results.push({
  name: 'founder_outcomes_use_explicit_gate',
  ok: founderAgentQuery.includes('${capabilitySql.isOutcome}')
    && founderAgentQuery.includes("COUNTIF(is_outcome AND result = 'success') AS successes")
    && founderAgentQuery.includes("COUNTIF(is_outcome AND result IN ('success', 'expected_error', 'error')) AS outcome_signals"),
});
const locationQuery = source.match(/const locationBehaviorQuery = `([\s\S]*?)`;/)?.[1] || '';
results.push({ name: 'location_expected_outcomes_are_separate', ok: locationQuery.includes("COUNTIF(result = 'expected_error') AS expectedErrors") });
results.push({ name: 'location_failures_are_true_errors', ok: locationQuery.includes("COUNTIF(result = 'error') AS failures") });
results.push({ name: 'location_source_availability_is_explicit', ok: source.includes('locationBehaviorAvailable: !locationBehavior.error') });
results.push({ name: 'location_views_not_counted_as_shares', ok: locationQuery.includes("actionName = 'location_share_viewed' THEN 'location_viewed'") && !locationQuery.includes("actionName LIKE 'location_share_%' THEN 'live_sharing'") });
results.push({ name: 'feature_views_not_counted_as_shares', ok: !query.includes("LIKE 'location_share_%' THEN 'live_sharing'") });
results.push({ name: 'sign_in_does_not_swallow_phone_or_google_steps', ok: query.includes("WHEN event_name IN ('auth_completed', 'one_auth_login_completed', 'auth_succeeded') THEN 'daily_signin'") });
results.push({ name: 'consent_prefetches_not_counted_as_preference_changes', ok: query.includes("WHEN event_name = 'one_consent_preferences_updated' THEN 'preferences_updated'") });
results.push({ name: 'consent_submissions_and_outcomes_are_separate', ok: query.includes("WHEN event_name = 'consent_action_submitted' THEN 'consent_action_submitted'") && query.includes("WHEN event_name = 'consent_action_result' THEN 'consent_action_outcome'") });
const ok = results.every((result) => result.ok);
console.log(JSON.stringify({ ok, checkedAt: new Date().toISOString(), target: 'One agent feature classification', checks: results }, null, 2));
if (!ok) process.exitCode = 1;
