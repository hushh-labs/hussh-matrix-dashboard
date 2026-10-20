-- Read-only projection of the One app's published leaderboard, fixed at 20 rows.
-- Install under the application schema owner; grant only EXECUTE to the reader.
-- This base projection returns chosen aliases only. The separate viewer-aware
-- projection below supplies directory-eligible profile candidates to the server.
CREATE SCHEMA IF NOT EXISTS metrics_dashboard;
CREATE OR REPLACE FUNCTION metrics_dashboard.referral_rankings(
  after_rank integer DEFAULT 0, requested_snapshot_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  selected_id uuid;
  generated_at timestamptz;
BEGIN
  IF after_rank IS NULL OR after_rank < 0 OR after_rank > 999999999
     OR (after_rank > 0 AND requested_snapshot_id IS NULL) THEN
    RAISE EXCEPTION 'Invalid leaderboard cursor';
  END IF;
  SELECT s.snapshot_id, s.generated_at INTO selected_id, generated_at
  FROM public.one_referral_leaderboard_snapshots s
  WHERE requested_snapshot_id IS NULL OR s.snapshot_id = requested_snapshot_id
  ORDER BY s.generated_at DESC, s.snapshot_id LIMIT 1;
  IF selected_id IS NULL THEN
    RETURN jsonb_build_object('state', CASE WHEN requested_snapshot_id IS NULL THEN 'waiting' ELSE 'expired' END,
      'snapshotId', NULL, 'snapshotGeneratedAt', NULL, 'entryCount', NULL,
      'entries', '[]'::jsonb, 'nextAfterRank', NULL);
  END IF;
  RETURN (
    WITH page AS (
      SELECT e.rank, e.cumulative_points AS points,
        COALESCE(NULLIF(btrim(h.handle), ''), 'Anonymous referrer') AS handle
      FROM public.one_referral_leaderboard_snapshot_entries e
      LEFT JOIN public.one_referral_display_handles h ON h.user_id = e.user_id
      WHERE e.snapshot_id = selected_id AND e.rank > after_rank
      ORDER BY e.rank LIMIT 20
    )
    SELECT jsonb_build_object('state', 'available', 'snapshotId', selected_id,
      'snapshotGeneratedAt', generated_at,
      -- A snapshot header can outlive deleted entries; count stored rows.
      'entryCount', (SELECT count(*) FROM public.one_referral_leaderboard_snapshot_entries WHERE snapshot_id = selected_id),
      'entries', (SELECT COALESCE(jsonb_agg(jsonb_build_object('rank', rank, 'handle', handle, 'points', points) ORDER BY rank), '[]'::jsonb) FROM page),
      'nextAfterRank', CASE WHEN EXISTS (
        SELECT 1 FROM public.one_referral_leaderboard_snapshot_entries
        WHERE snapshot_id = selected_id AND rank > (SELECT max(rank) FROM page)
      ) THEN (SELECT max(rank) FROM page) ELSE NULL END
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION metrics_dashboard.referral_rankings(integer,uuid) FROM PUBLIC;

-- Mirrors One's referral identity projection: aliases first, then names visible
-- to the verified viewer through Connect. Candidate IDs stay server-side, where
-- current Firebase lifecycle is checked before a name reaches the dashboard.
CREATE OR REPLACE FUNCTION metrics_dashboard.referral_rankings_for_viewer(
  after_rank integer, requested_snapshot_id uuid, viewer_user_id text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE base jsonb;
BEGIN
  base := metrics_dashboard.referral_rankings(after_rank, requested_snapshot_id);
  IF base->>'state' <> 'available' OR NULLIF(viewer_user_id, '') IS NULL THEN
    RETURN base;
  END IF;
  RETURN jsonb_set(base, '{entries}', (
    SELECT COALESCE(jsonb_agg(row.item || jsonb_build_object(
      'profileUserId', CASE WHEN row.item->>'handle' = 'Anonymous referrer' AND (
        entry.user_id = viewer_user_id OR eligible.user_id IS NOT NULL
      ) THEN entry.user_id END,
      'profileName', CASE WHEN row.item->>'handle' = 'Anonymous referrer'
        AND entry.user_id <> viewer_user_id THEN label.name END
    ) ORDER BY entry.rank), '[]'::jsonb)
    FROM jsonb_array_elements(base->'entries') row(item)
    JOIN public.one_referral_leaderboard_snapshot_entries entry
      ON entry.snapshot_id = (base->>'snapshotId')::uuid AND entry.rank = (row.item->>'rank')::integer
    LEFT JOIN public.actor_profiles eligible ON eligible.user_id = entry.user_id
      AND row.item->>'handle' = 'Anonymous referrer'
      AND eligible.user_id <> viewer_user_id AND eligible.public_profile_status = 'active'
      AND (
        EXISTS (SELECT 1 FROM public.vault_keys vault WHERE vault.user_id = entry.user_id AND vault.vault_status = 'active')
        OR EXISTS (SELECT 1 FROM public.connections edge WHERE edge.status = 'active' AND (
          (edge.user_a_id = viewer_user_id AND edge.user_b_id = entry.user_id)
          OR (edge.user_b_id = viewer_user_id AND edge.user_a_id = entry.user_id)))
        OR EXISTS (SELECT 1 FROM public.connection_requests pending WHERE pending.status = 'pending' AND (
          (pending.requester_user_id = viewer_user_id AND pending.addressee_user_id = entry.user_id)
          OR (pending.addressee_user_id = viewer_user_id AND pending.requester_user_id = entry.user_id)))
        OR EXISTS (SELECT 1 FROM public.trusted_connections edge WHERE edge.status = 'active' AND (
          (edge.owner_user_id = viewer_user_id AND edge.trusted_user_id = entry.user_id)
          OR (edge.trusted_user_id = viewer_user_id AND edge.owner_user_id = entry.user_id)))
      )
    LEFT JOIN public.actor_identity_cache identity ON identity.user_id = eligible.user_id
    LEFT JOIN public.marketplace_public_profiles marketplace ON marketplace.user_id = eligible.user_id
    LEFT JOIN public.ria_profiles ria ON ria.user_id = eligible.user_id
    LEFT JOIN LATERAL (
      SELECT btrim(candidate.value) AS name
      FROM (VALUES (identity.display_name, 1), (marketplace.display_name, 2), (ria.display_name, 3)) candidate(value, priority)
      WHERE NULLIF(btrim(candidate.value), '') IS NOT NULL
        AND btrim(candidate.value) <> entry.user_id AND lower(btrim(candidate.value)) NOT LIKE 'ria:%'
        AND strpos(candidate.value, '@') = 0
        AND btrim(candidate.value) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND (strpos(btrim(candidate.value), ' ') > 0 OR length(btrim(candidate.value)) < 20)
        AND btrim(candidate.value) !~ '^\+?[0-9[:space:]().-]{6,}$'
      ORDER BY candidate.priority LIMIT 1
    ) label ON true
  ));
END;
$$;
REVOKE ALL ON FUNCTION metrics_dashboard.referral_rankings_for_viewer(integer,uuid,text) FROM PUBLIC;
