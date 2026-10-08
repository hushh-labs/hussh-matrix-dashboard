/**
 * Independent feature audit inventory, checked against hushh-research
 * 8cf525dec on 2026-10-08. A schema declaration alone is not an emitter.
 * Keep legacy names readable: observed records override a current emitter gap.
 */
const event = (name) => `event_name = '${name}'`;
const any = (...names) => `event_name IN (${names.map(name => `'${name}'`).join(', ')})`;
const action = (name, value) => `${event(name)} AND action = '${value}'`;
const entry = (agent, key, predicate, events, gap = null, extraPredicate = null) => ({ agent, key, predicate, events, gap, extraPredicate });
const absent = 'This activity is not tracked yet. Missing records do not mean nobody used it.';
export const AGENT_MEASUREMENTS = [
  entry('location', 'live_sharing', event('one_location_share_confirmed'), ['one_location_share_confirmed']),
  entry('location', 'check_in', `${event('one_location_check_in_completed')} OR event_name LIKE '%check_in%' OR (${action('one_location_journey_action','nearby_check_in_result')})`, ['one_location_check_in_completed','one_location_journey_action']),
  entry('location', 'check_out', "event_name LIKE '%check_out%'", ['one_location_check_out_completed']),
  entry('location', 'sms_safety', event('one_location_sos_triggered'), ['one_location_sos_triggered']),
  entry('location', 'request_location', `${event('one_location_request_sent')} OR (${event('one_location_journey_action')} AND action LIKE 'location_request_%')`, ['one_location_request_sent','one_location_journey_action']),
  entry('location', 'public_sharing', `${event('one_location_public_link_created')} OR (${event('one_location_journey_action')} AND action LIKE 'public_link_%')`, ['one_location_public_link_created','one_location_journey_action']),
  entry('location', 'contact_sync', `${event('one_location_contact_signal_synced')} OR (${event('one_location_journey_action')} AND action LIKE 'contact_sync_%')`, ['one_location_contact_signal_synced','one_location_journey_action']),
  entry('location', 'invitations', `${event('one_location_circle_invite_created')} OR (${event('one_location_journey_action')} AND (action LIKE 'contact_invitation_%' OR action = 'circle_code_shared'))`, ['one_location_circle_invite_created','one_location_journey_action']),
  entry('location', 'circle_engagement', `${event('one_location_circle_created')} OR (${event('one_location_journey_action')} AND action LIKE 'circle_%')`, ['one_location_circle_created','one_location_journey_action']),
  entry('location', 'location_viewed', action('one_location_journey_action','location_share_viewed'), ['one_location_journey_action']),
  entry('onboarding', 'auth_started', any('auth_started','one_auth_started'), ['auth_started','one_auth_started']),
  entry('onboarding', 'daily_signin', any('auth_completed','one_auth_login_completed','auth_succeeded'), ['auth_completed','one_auth_login_completed','auth_succeeded']),
  entry('onboarding', 'phone_verified', any('phone_verification_started','phone_verification_completed','one_auth_phone_verified','one_phone_verified'), ['phone_verification_started','phone_verification_completed','one_auth_phone_verified','one_phone_verified']),
  entry('onboarding', 'google_signin', any('google_sign_in_started','google_sign_in_completed','one_auth_google_signed_in'), ['google_sign_in_started','google_sign_in_completed','one_auth_google_signed_in','auth_started','auth_succeeded','auth_failed'], null, `(${any('auth_started','auth_succeeded','auth_failed')}) AND action = 'google'`),
  entry('onboarding', 'profile_created', any('profile_created','one_auth_profile_created'), ['profile_created','one_auth_profile_created'], 'Profile creation has no separate event emitter in the audited app source. Registered-account totals are measured separately.'),
  entry('onboarding', 'onboarding_completed', any('onboarding_completed','one_auth_onboarding_completed','one_onboarding_completed'), ['onboarding_completed','one_auth_onboarding_completed','one_onboarding_completed']),
  entry('finance', 'portfolio_view', any('portfolio_viewed','one_finance_portfolio_viewed'), ['portfolio_viewed','one_finance_portfolio_viewed']),
  entry('finance', 'ai_recommendation', any('recommendation_viewed','one_finance_recommendation_viewed'), ['recommendation_viewed','one_finance_recommendation_viewed']),
  entry('finance', 'analysis_stream', any('analysis_stream_started','one_finance_analysis_started'), ['analysis_stream_started','one_finance_analysis_started']),
  entry('finance', 'receipt_parsed', event('import_parse_completed'), ['import_parse_completed']),
  entry('finance', 'import_saved', event('import_save_completed'), ['import_save_completed']),
  entry('consent', 'preferences_updated', event('one_consent_preferences_updated'), ['one_consent_preferences_updated'], absent),
  entry('consent', 'consent_action_submitted', event('consent_action_submitted'), ['consent_action_submitted']),
  entry('consent', 'consent_screen_viewed', `${event('consent_pending_loaded')} AND load_surface = 'screen'`, ['consent_pending_loaded']),
  entry('consent', 'consent_action_outcome', event('consent_action_result'), ['consent_action_result']),
  entry('consent', 'data_unlock', any('one_consent_data_unlocked','data_unlocked','one_consent_data_unlock_requested'), ['one_consent_data_unlocked','data_unlocked','one_consent_data_unlock_requested'], absent),
  entry('consent', 'permission_granted', any('permission_granted','one_consent_permission_granted'), ['permission_granted','one_consent_permission_granted'], absent),
  entry('consent', 'revocation_submitted', 'FALSE', [], 'Consent withdrawal has no separate measurement emitter yet.'),
  entry('gmail', 'account_connect_started', event('gmail_connect_started'), ['gmail_connect_started']),
  entry('gmail', 'account_connected', `(${action('gmail_connect_result','complete')}) OR ${event('one_gmail_connected')}`, ['gmail_connect_result','one_gmail_connected']),
  entry('gmail', 'receipt_sync_requested', event('gmail_sync_requested'), ['gmail_sync_requested']),
  entry('gmail', 'receipt_sync', action('gmail_sync_result','queue'), ['gmail_sync_result']),
  entry('gmail', 'receipt_sync_completed', `(${action('gmail_sync_result','complete')}) OR ${event('one_gmail_receipt_synced')}`, ['gmail_sync_result','one_gmail_receipt_synced']),
  entry('gmail', 'mail_signin_screen_view', event('hushh_mail_signin_screen_view'), ['hushh_mail_signin_screen_view'], 'Mail sign-in screen visits are not tracked in One yet.'),
  entry('gmail', 'inbox_viewed', event('one_gmail_inbox_viewed'), ['one_gmail_inbox_viewed'], 'Inbox visits are not separately tracked yet. A receipt-load or sync result does not count as an inbox visit.'),
  entry('gmail', 'autocategory_applied', any('autocategory_applied','receipt_categorized','one_gmail_receipt_categorized'), ['autocategory_applied','receipt_categorized','one_gmail_receipt_categorized'], 'Receipt categorization is not tracked yet. Sync results do not tell us how many receipts were categorized.'),
  entry('ria', 'verification_checked', any('ria_verification_status_changed','one_ria_verification_checked'), ['ria_verification_status_changed','one_ria_verification_checked']),
  entry('ria', 'workspace_visited', any('ria_workspace_opened','one_ria_workspace_visited'), ['ria_workspace_opened','one_ria_workspace_visited']),
  entry('ria', 'strategy_requested', any('ria_request_created','one_ria_strategy_requested'), ['ria_request_created','one_ria_strategy_requested']),
  entry('ria', 'client_handoff', 'FALSE', [], 'Advisor-client handoffs have no separate measurement emitter yet.'),
  entry('marketplace', 'marketplace_browsed', any('marketplace_browsed','one_marketplace_browsed'), ['marketplace_browsed','one_marketplace_browsed'], absent),
  entry('marketplace', 'profile_viewed', any('marketplace_profile_viewed','one_marketplace_profile_viewed'), ['marketplace_profile_viewed','one_marketplace_profile_viewed']),
  entry('marketplace', 'deal_subscribed', 'FALSE', [], 'Marketplace subscriptions have no separate measurement emitter yet.'),
  entry('memory', 'context_resolved', any('agent_pkm_context_resolved','one_memory_context_resolved'), ['agent_pkm_context_resolved','one_memory_context_resolved']),
  ...['capture_prepared','capture_saved','detail_edited','detail_deleted','export_saved','auto_save_changed'].map(value => entry('memory',`memory_${value}`,action('one_memory_action',value),['one_memory_action'])),
  ...['card_added','card_deleted'].map(value => entry('wallet',`wallet_${value}`,action('one_wallet_action',value),['one_wallet_action'])),
  ...['connected','disconnected','chat_opened'].map(value => entry('calendar',`calendar_${value}`,action('one_calendar_action',value),['one_calendar_action'])),
  ...['access_approved','access_denied','redraft_completed','reply_sent','reply_rejected','workflow_refreshed'].map(value => entry('kyc',`kyc_${value}`,action('one_kyc_action',value),['one_kyc_action'], 'These KYC actions are not tracked yet. Workflow usage cannot be measured from this row.')),
  ...['record_created','record_updated','record_deleted'].map(value => entry('connected_systems',`crm_${value}`,action('one_crm_action',value),['one_crm_action'])),
];

export function featureTrackingGap(key) {
  return AGENT_MEASUREMENTS.find(item => item.key === key)?.gap ?? null;
}
