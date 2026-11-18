/** Pure builder; fragments require independently verified server-side scope. */
export function oneLocationBehaviorQuery({ deviceKeySql, table, dateFilter }: { deviceKeySql:string; table:string; dateFilter:string }) {
  return `
    WITH raw AS (
      SELECT
        CAST(PARSE_DATE('%Y%m%d', event_date) AS STRING) AS eventDate,
        ${deviceKeySql} AS deviceKey,
        COALESCE(platform, 'UNKNOWN') AS platform,
        event_name AS eventName,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') AS actionName,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'result') AS result,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'route_id') AS routeId,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'circle_kind') AS circleKind,
        COALESCE((SELECT value.int_value = 1 FROM UNNEST(event_params) WHERE key = 'copied_to_clipboard'), FALSE) AS copiedToClipboard,
        COALESCE((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'success_count'), 0) AS successCount
      FROM ${table}
      WHERE ${dateFilter}
        AND (
          event_name = 'page_view'
          OR event_name LIKE 'one_location%'
          OR event_name LIKE '%check_in%'
          OR event_name LIKE '%check_out%'
        )
    ),
    classified AS (
      SELECT
        *,
        CASE
          WHEN eventName = 'one_location_share_confirmed' THEN 'live_sharing'
          WHEN eventName = 'one_location_check_in_completed' OR eventName LIKE '%check_in%' THEN 'check_in'
          WHEN eventName LIKE '%check_out%' THEN 'check_out'
          WHEN eventName = 'one_location_journey_action' AND actionName = 'nearby_check_in_result' THEN 'check_in'
          WHEN eventName = 'one_location_sos_triggered' THEN 'sms_safety'
          WHEN eventName = 'one_location_request_sent' THEN 'request_location'
          WHEN eventName = 'one_location_public_link_created' THEN 'public_sharing'
          WHEN eventName = 'one_location_contact_signal_synced' THEN 'contact_sync'
          WHEN eventName = 'one_location_circle_invite_created' THEN 'invitations'
          WHEN eventName = 'one_location_circle_created' THEN 'circle_engagement'
          WHEN eventName = 'one_location_journey_action' AND actionName LIKE 'contact_invitation_%' THEN 'invitations'
          WHEN eventName = 'one_location_journey_action' AND actionName = 'circle_code_shared' THEN 'invitations'
          WHEN eventName = 'one_location_journey_action' AND actionName LIKE 'contact_sync_%' THEN 'contact_sync'
          WHEN eventName = 'one_location_journey_action' AND actionName LIKE 'public_link_%' THEN 'public_sharing'
          WHEN eventName = 'one_location_journey_action' AND actionName LIKE 'location_request_%' THEN 'request_location'
          WHEN eventName = 'one_location_journey_action' AND actionName = 'location_share_viewed' THEN 'location_viewed'
          WHEN eventName = 'one_location_journey_action' AND actionName LIKE 'circle_%' THEN 'circle_engagement'
          ELSE NULL
        END AS featureKey,
        CASE
          WHEN eventName = 'page_view' AND routeId IN ('one_location', 'one_location_map', 'one_location_check_in') THEN 'location_opened'
          WHEN eventName = 'page_view' AND routeId = 'connect' THEN 'connect_opened'
          WHEN eventName = 'one_location_contact_signal_synced' AND result = 'success' THEN 'contact_sync'
          WHEN eventName = 'one_location_circle_invite_created' AND result = 'success' AND copiedToClipboard THEN 'invitation_shared'
          WHEN eventName = 'one_location_journey_action' AND actionName IN ('contact_invitation_handoff', 'circle_code_shared') AND result = 'success' THEN 'invitation_shared'
          WHEN eventName = 'one_location_circle_created' AND result = 'success' THEN 'circle_engaged'
          WHEN eventName = 'one_location_journey_action' AND actionName LIKE 'circle_%' AND result = 'success' THEN 'circle_engaged'
          WHEN eventName = 'one_location_request_sent' AND result = 'success' AND successCount > 0 THEN 'request_sent'
          -- Keep failed attempts in the same aggregate row so the dashboard can
          -- distinguish a confirmed zero-success outcome from no telemetry.
          WHEN eventName = 'one_location_journey_action' AND actionName = 'location_request_fulfilled' THEN 'request_fulfilled'
          WHEN eventName = 'one_location_share_confirmed' AND result = 'success' AND successCount > 0 THEN 'live_shared'
          WHEN eventName = 'one_location_check_in_completed' AND result = 'success' AND successCount > 0 THEN 'check_in'
          WHEN eventName = 'one_location_journey_action' AND actionName = 'nearby_check_in_result' AND result = 'success' THEN 'check_in'
          WHEN eventName = 'page_view' AND (routeId = 'profile' OR STARTS_WITH(routeId, 'profile_')) THEN 'profile_opened'
          ELSE NULL
        END AS journeyKey
      FROM raw
    )
    SELECT
      'feature' AS scope,
      featureKey AS metricKey,
      CAST(NULL AS STRING) AS eventDate,
      CAST(NULL AS STRING) AS dimension,
      COUNT(DISTINCT deviceKey) AS users,
      COUNT(*) AS events,
      COUNTIF(result = 'success') AS successes,
      COUNTIF(result = 'expected_error') AS expectedErrors,
      COUNTIF(result = 'error') AS failures
    FROM classified
    WHERE featureKey IS NOT NULL
    GROUP BY featureKey
    UNION ALL
    SELECT
      'feature_daily', featureKey, eventDate, NULL,
      COUNT(DISTINCT deviceKey), COUNT(*),
      COUNTIF(result = 'success'), COUNTIF(result = 'expected_error'), COUNTIF(result = 'error')
    FROM classified
    WHERE featureKey IS NOT NULL
    GROUP BY featureKey, eventDate
    UNION ALL
    SELECT
      'feature_platform', featureKey, NULL, platform,
      COUNT(DISTINCT deviceKey), COUNT(*),
      COUNTIF(result = 'success'), COUNTIF(result = 'expected_error'), COUNTIF(result = 'error')
    FROM classified
    WHERE featureKey IS NOT NULL
    GROUP BY featureKey, platform
    UNION ALL
    SELECT
      'journey', journeyKey, NULL, NULL,
      COUNT(DISTINCT IF(result = 'success' OR eventName = 'page_view', deviceKey, NULL)),
      COUNTIF(result = 'success' OR eventName = 'page_view'),
      COUNTIF(result = 'success' OR eventName = 'page_view'),
      COUNTIF(result = 'expected_error'),
      COUNTIF(result = 'error')
    FROM classified
    WHERE journeyKey IS NOT NULL
    GROUP BY journeyKey
    UNION ALL
    SELECT
      'circle_kind', COALESCE(NULLIF(circleKind, ''), 'unknown'), NULL, NULL,
      COUNT(DISTINCT deviceKey), COUNT(*),
      COUNTIF(result = 'success'), COUNTIF(result = 'expected_error'), COUNTIF(result = 'error')
    FROM classified
    WHERE eventName = 'one_location_circle_created'
    GROUP BY COALESCE(NULLIF(circleKind, ''), 'unknown')
    UNION ALL
    SELECT
      'instrumentation', 'journey_action', MIN(eventDate), NULL,
      COUNT(DISTINCT deviceKey), COUNT(*),
      COUNTIF(result = 'success'), COUNTIF(result = 'expected_error'), COUNTIF(result = 'error')
    FROM classified
    WHERE eventName = 'one_location_journey_action'
  `;
}
