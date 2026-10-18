-- Install with the operations script. The dashboard can execute this bounded,
-- aggregate-only function; it receives no access to underlying account rows.
CREATE SCHEMA IF NOT EXISTS metrics_dashboard;
CREATE OR REPLACE FUNCTION metrics_dashboard.referral_summary(start_day date, end_day date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF start_day IS NULL OR end_day IS NULL OR start_day > end_day
     OR end_day - start_day > 365 OR end_day > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'Invalid reporting period';
  END IF;
  RETURN (
    WITH bounds AS (
      SELECT start_day::timestamp AT TIME ZONE 'UTC' AS lo,
             (end_day + 1)::timestamp AT TIME ZONE 'UTC' AS hi
    ), joined AS (
      -- Matches the One app's JOINED_REFERRAL_PREDICATE. Link opens do not
      -- prove registration, and expired qualification does not undo signup.
      SELECT r.referred_user_id, r.referrer_user_id, r.status, a.bound_at
      FROM public.one_referral_relationships r
      JOIN public.one_referral_attributions a ON a.id = r.attribution_id
        AND a.referrer_user_id = r.referrer_user_id
        AND a.bound_user_id = r.referred_user_id AND a.status = 'bound'
      CROSS JOIN bounds b
      WHERE r.referrer_user_id <> r.referred_user_id
        AND r.status NOT IN ('rejected', 'revoked', 'ineligible')
        AND EXISTS (SELECT 1 FROM public.actor_profiles p WHERE p.user_id = r.referred_user_id)
        AND a.bound_at >= b.lo AND a.bound_at < b.hi
    ), ledger AS (
      SELECT s.user_id, s.event_type, s.points, s.coins, s.created_at
      FROM public.one_referral_score_events s CROSS JOIN bounds b
      WHERE s.created_at >= b.lo AND s.created_at < b.hi
    ), entitlements AS (
      SELECT e.user_id, e.milestone_key, e.reward, e.threshold, e.claimed_at
      FROM public.one_referral_milestone_entitlements e CROSS JOIN bounds b
      WHERE e.earned_at >= b.lo AND e.earned_at < b.hi
    ), awards AS (
      SELECT w.status FROM public.one_referral_weekly_awards w CROSS JOIN bounds b
      WHERE w.created_at >= b.lo AND w.created_at < b.hi
    ), catalogue AS (
      SELECT item->>'milestone_key' AS key, item->>'reward' AS reward, (item->>'threshold')::int AS threshold
      FROM public.one_referral_program_settings s,
      LATERAL jsonb_array_elements(s.milestones) item
      WHERE s.activated_at IS NOT NULL AND s.retired_at IS NULL
    ), rewards AS (
      SELECT c.reward, c.threshold, COUNT(e.milestone_key) AS earned,
        COUNT(e.claimed_at) AS claimed
      FROM catalogue c LEFT JOIN entitlements e ON e.milestone_key = c.key
      GROUP BY c.key, c.reward, c.threshold
      UNION ALL
      SELECT e.reward, e.threshold, COUNT(*), COUNT(e.claimed_at)
      FROM entitlements e WHERE NOT EXISTS (SELECT 1 FROM catalogue c WHERE c.key = e.milestone_key)
      GROUP BY e.milestone_key, e.reward, e.threshold
    )
    SELECT jsonb_build_object(
      'latestRecordAt', (SELECT MAX(t) FROM (
        SELECT MAX(updated_at) AS t FROM public.one_referral_relationships
        UNION ALL SELECT MAX(created_at) FROM public.one_referral_score_events
        UNION ALL SELECT MAX(first_seen_at) FROM public.one_referral_attributions
        UNION ALL SELECT MAX(earned_at) FROM public.one_referral_milestone_entitlements
        UNION ALL SELECT MAX(updated_at) FROM public.one_referral_weekly_awards
      ) changes),
      'totals', jsonb_build_object(
        'referrers', (SELECT COUNT(DISTINCT referrer_user_id) FROM joined),
        'referredAccounts', (SELECT COUNT(DISTINCT referred_user_id) FROM joined),
        'qualified', (SELECT COUNT(DISTINCT referred_user_id) FROM joined WHERE status = 'qualified'),
        'pending', (SELECT COUNT(DISTINCT referred_user_id) FROM joined WHERE status IN ('attributed','signed_up','phone_verified','onboarded','engaging','under_review')),
        'linkOpens', (SELECT COUNT(*) FROM public.one_referral_attributions a CROSS JOIN bounds b WHERE a.first_seen_at >= b.lo AND a.first_seen_at < b.hi),
        'netPoints', (SELECT COALESCE(SUM(points),0) FROM ledger),
        'netCoins', (SELECT COALESCE(SUM(coins),0) FROM ledger),
        'pointEarners', (SELECT COUNT(DISTINCT user_id) FROM ledger WHERE points > 0),
        'milestonesEarned', (SELECT COUNT(*) FROM entitlements),
        'rewardRecipients', (SELECT COUNT(DISTINCT user_id) FROM entitlements),
        'weeklyAwards', (SELECT COUNT(*) FROM awards)
      ),
      'daily', (SELECT COALESCE(jsonb_agg(jsonb_build_object('date',d::date,
        'referredAccounts',(SELECT COUNT(DISTINCT referred_user_id) FROM joined WHERE (bound_at AT TIME ZONE 'UTC')::date = d::date),
        'netPoints',(SELECT COALESCE(SUM(points),0) FROM ledger WHERE (created_at AT TIME ZONE 'UTC')::date = d::date)
      ) ORDER BY d),'[]') FROM generate_series(start_day::timestamp,end_day::timestamp,interval '1 day') d),
      'points', (SELECT COALESCE(jsonb_agg(jsonb_build_object('type',event_type,'points',points,'coins',coins,'events',events) ORDER BY event_type),'[]')
        FROM (SELECT event_type,SUM(points) points,SUM(coins) coins,COUNT(*) events FROM ledger GROUP BY event_type) p),
      'rewards', (SELECT COALESCE(jsonb_agg(jsonb_build_object('reward',reward,'threshold',threshold,'earned',earned,'claimed',claimed) ORDER BY threshold),'[]') FROM rewards),
      'weeklyAwards', (SELECT COALESCE(jsonb_agg(jsonb_build_object('status',status,'awards',n) ORDER BY status),'[]') FROM (SELECT status,COUNT(*) n FROM awards GROUP BY status) w)
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION metrics_dashboard.referral_summary(date,date) FROM PUBLIC;
