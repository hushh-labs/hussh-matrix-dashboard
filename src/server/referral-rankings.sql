-- Read-only projection of the One app's published leaderboard, fixed at 20 rows.
-- Install under the application schema owner; grant only EXECUTE to the reader.
-- Public, opted-in handles are the only identity source. Never join identity caches.
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
