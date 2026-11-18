/** Pure SQL builder; callers must provide trusted, validated server-side
 * fragments. This does not execute a query or authorize source access. */
export function oneFeatureUsageQuery({ deviceKeySql, table, dateFilter }: { deviceKeySql:string; table:string; dateFilter:string }) {
  return `
    WITH classified_base AS (
      SELECT
        event_name AS eventName,
        ${deviceKeySql} AS deviceKey,
        NULLIF(user_id, '') AS accountKey,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'result') AS result,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') AS action,
        CASE
          WHEN event_name = 'one_location_share_confirmed' THEN 'live_sharing'
          WHEN event_name = 'one_location_check_in_completed' OR event_name LIKE '%check_in%' THEN 'check_in'
          WHEN event_name LIKE '%check_out%' THEN 'check_out'
          WHEN event_name = 'one_location_journey_action' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') = 'nearby_check_in_result' THEN 'check_in'
          WHEN event_name = 'one_location_sms_contact_add_result' THEN 'sms_contact_add'
          WHEN event_name = 'one_location_sms_contact_remove_result' THEN 'sms_contact_remove'
          WHEN event_name = 'one_location_sos_triggered' THEN 'sms_safety'
          WHEN event_name = 'one_location_request_sent' THEN 'request_location'
          WHEN event_name = 'one_location_public_link_created' THEN 'public_sharing'
          WHEN event_name = 'one_location_contact_signal_synced' THEN 'contact_sync'
          WHEN event_name = 'one_location_circle_invite_created' THEN 'invitations'
          WHEN event_name = 'one_location_circle_created' THEN 'circle_engagement'
          WHEN event_name = 'one_location_journey_action' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') LIKE 'contact_invitation_%' THEN 'invitations'
          WHEN event_name = 'one_location_journey_action' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') = 'circle_code_shared' THEN 'invitations'
          WHEN event_name = 'one_location_journey_action' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') LIKE 'contact_sync_%' THEN 'contact_sync'
          WHEN event_name = 'one_location_journey_action' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') LIKE 'public_link_%' THEN 'public_sharing'
          WHEN event_name = 'one_location_journey_action' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') LIKE 'location_request_%' THEN 'request_location'
          WHEN event_name = 'one_location_journey_action' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') = 'location_share_viewed' THEN 'location_viewed'
          WHEN event_name = 'one_location_journey_action' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') LIKE 'circle_%' THEN 'circle_engagement'
          WHEN event_name IN ('auth_started', 'one_auth_started') THEN 'auth_started'
          WHEN event_name IN ('auth_completed', 'one_auth_login_completed', 'auth_succeeded') THEN 'daily_signin'
          WHEN event_name IN ('phone_verification_started', 'phone_verification_completed', 'one_auth_phone_verified', 'one_phone_verified') THEN 'phone_verified'
          WHEN event_name IN ('google_sign_in_started', 'google_sign_in_completed', 'one_auth_google_signed_in') THEN 'google_signin'
          WHEN event_name IN ('profile_created', 'one_auth_profile_created') THEN 'profile_created'
          WHEN event_name IN ('onboarding_completed', 'one_auth_onboarding_completed', 'one_onboarding_completed') THEN 'onboarding_completed'
          WHEN event_name IN ('portfolio_viewed', 'one_finance_portfolio_viewed') THEN 'portfolio_view'
          WHEN event_name IN ('recommendation_viewed', 'one_finance_recommendation_viewed') THEN 'ai_recommendation'
          WHEN event_name IN ('analysis_stream_started', 'one_finance_analysis_started') THEN 'analysis_stream'
          WHEN event_name = 'import_parse_completed' THEN 'receipt_parsed'
          WHEN event_name = 'import_save_completed' THEN 'import_saved'
          WHEN event_name = 'one_consent_preferences_updated' THEN 'preferences_updated'
          WHEN event_name = 'consent_action_submitted' THEN 'consent_action_submitted'
          WHEN event_name = 'consent_pending_loaded' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'load_surface') = 'screen' THEN 'consent_screen_viewed'
          WHEN event_name = 'consent_action_result' THEN 'consent_action_outcome'
          WHEN event_name IN ('one_consent_data_unlocked', 'data_unlocked', 'one_consent_data_unlock_requested') THEN 'data_unlock'
          WHEN event_name IN ('permission_granted', 'one_consent_permission_granted') THEN 'permission_granted'
          WHEN event_name = 'gmail_connect_started' THEN 'account_connect_started'
          WHEN event_name = 'gmail_connect_result' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') = 'complete' THEN 'account_connected'
          WHEN event_name = 'one_gmail_connected' THEN 'account_connected'
          WHEN event_name = 'gmail_sync_requested' THEN 'receipt_sync_requested'
          WHEN event_name = 'gmail_sync_result' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') = 'queue' THEN 'receipt_sync'
          WHEN event_name = 'gmail_sync_result' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') = 'complete' THEN 'receipt_sync_completed'
          WHEN event_name = 'one_gmail_receipt_synced' THEN 'receipt_sync_completed'
          WHEN event_name = 'hushh_mail_signin_screen_view' THEN 'mail_signin_screen_view'
          WHEN event_name = 'mail_receipts_workspace_viewed' THEN 'receipts_workspace_viewed'
          WHEN event_name = 'one_gmail_inbox_viewed' THEN 'inbox_viewed'
          WHEN event_name IN ('autocategory_applied', 'receipt_categorized', 'one_gmail_receipt_categorized') THEN 'autocategory_applied'
          WHEN event_name IN ('ria_verification_status_changed', 'one_ria_verification_checked') THEN 'verification_checked'
          WHEN event_name IN ('ria_workspace_opened', 'one_ria_workspace_visited') THEN 'workspace_visited'
          WHEN event_name IN ('ria_request_created', 'one_ria_strategy_requested') THEN 'strategy_requested'
          WHEN event_name IN ('marketplace_browsed', 'one_marketplace_browsed') THEN 'marketplace_browsed'
          WHEN event_name IN ('marketplace_profile_viewed', 'one_marketplace_profile_viewed') THEN 'profile_viewed'
          WHEN event_name IN ('agent_pkm_context_resolved', 'one_memory_context_resolved') THEN 'context_resolved'
          WHEN event_name = 'one_memory_action' THEN CONCAT('memory_', (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action'))
          WHEN event_name = 'one_wallet_action' THEN CONCAT('wallet_', (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action'))
          WHEN event_name = 'one_calendar_action' THEN CONCAT('calendar_', (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action'))
          WHEN event_name = 'one_kyc_action' THEN CONCAT('kyc_', (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action'))
          WHEN event_name = 'one_crm_action' THEN CONCAT('crm_', (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action'))
          ELSE NULL
        END AS feature_key
      FROM ${table}
      WHERE ${dateFilter}
    ), classified AS (
      SELECT * FROM classified_base
      UNION ALL
      -- Provider steps overlap general auth starts/sign-ins. Preserve both
      -- rows instead of moving Google events out of the general auth totals.
      SELECT * REPLACE ('google_signin' AS feature_key) FROM classified_base
      WHERE eventName IN ('auth_started', 'auth_succeeded', 'auth_failed') AND action = 'google'
      UNION ALL
      -- A withdrawal result remains part of general consent outcomes too.
      SELECT * REPLACE ('revocation_submitted' AS feature_key) FROM classified_base
      WHERE eventName = 'consent_action_result' AND action = 'revoke'
    ), feature_totals AS (
    SELECT
      feature_key AS featureKey,
      COUNT(DISTINCT accountKey) AS accounts,
      COUNT(DISTINCT deviceKey) AS devices,
      COUNT(*) AS signals,
      COUNTIF(result = 'success') AS successes,
      COUNTIF(result = 'expected_error') AS expectedErrors,
      COUNTIF(result = 'error') AS failures,
      COUNTIF(result IN ('success', 'expected_error', 'error')) AS outcomeSignals
    FROM classified
    WHERE feature_key IS NOT NULL
    GROUP BY feature_key
    ), event_counts AS (
      SELECT feature_key AS featureKey, eventName,
        COUNT(*) AS signals,
        COUNTIF(result = 'success') AS successes,
        COUNTIF(result = 'expected_error') AS expectedErrors,
        COUNTIF(result = 'error') AS failures
      FROM classified
      WHERE feature_key IS NOT NULL
      GROUP BY feature_key, eventName
    ), breakdowns AS (
      SELECT featureKey,
        ARRAY_AGG(STRUCT(eventName, signals, successes, expectedErrors, failures)
          ORDER BY signals DESC, eventName) AS eventBreakdown
      FROM event_counts GROUP BY featureKey
    )
    SELECT feature_totals.*, breakdowns.eventBreakdown
    FROM feature_totals LEFT JOIN breakdowns USING (featureKey)
  `;
}
