-- 0018 — post-event summary and workbook support (D-21), hand-written:
--   A. rebuild_event_rollups() also rebuilds onsite_rollups and stamps events.rollups_rebuilt_at.
--   B. compute_post_event_summary() / post_event_summary(): the one-page summary as JSON.
--   C. purge_event_movement_data() also freezes the summary into event_summaries.
--   D. Workbook queries: the alert log and the attendee rows (no identity).

------------------------------------------------------------------------------------------------
-- A. Rollups (same signature; privileges are kept by CREATE OR REPLACE)
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rebuild_event_rollups(p_event_id uuid)
RETURNS TABLE (occupancy_rows bigint, gate_rate_rows bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pii_vault, pg_temp AS $$
DECLARE
  v_prev_scope text := current_setting('app.vault_scope', true);
  v_occ bigint;
  v_gate bigint;
  v_end timestamptz;
BEGIN
  SELECT ends_at INTO v_end FROM public.events WHERE id = p_event_id;
  IF EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id AND purged_at IS NOT NULL) THEN
    RAISE EXCEPTION 'event % has been purged; rollups can no longer be rebuilt', p_event_id
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  DELETE FROM public.occupancy_rollups WHERE event_id = p_event_id;
  INSERT INTO public.occupancy_rollups (event_id, room_id, bucket_start, in_count, out_count, peak)
  SELECT p_event_id, s.room_id,
         date_bin(interval '5 minutes', s.t, timestamptz '2000-01-01 00:00:00+00'),
         count(*) FILTER (WHERE s.source = 'scan' AND s.delta = 1),
         count(*) FILTER (WHERE s.source = 'scan' AND s.delta = -1),
         max(s.level)
    FROM public.room_occupancy_series(p_event_id) s
   GROUP BY 1, 2, 3;
  GET DIAGNOSTICS v_occ = ROW_COUNT;

  PERFORM set_config('app.vault_scope', 'system', true);
  DELETE FROM public.gate_rate_rollups WHERE event_id = p_event_id;
  WITH tiered AS (
    SELECT s.checkpoint_id,
           date_trunc('minute', s.corrected_at) AS minute_start,
           s.result,
           CASE
             WHEN cr.staff_user_id IS NOT NULL THEN 'STAFF'
             WHEN rg.tier IS NOT NULL THEN rg.tier::text
             ELSE 'UNKNOWN'
           END AS tier
      FROM public.scans s
      LEFT JOIN pii_vault.ephemeral_ids e ON e.event_id = s.event_id AND e.ephemeral_id = s.ephemeral_id
      LEFT JOIN public.credentials cr ON cr.id = e.credential_id
      LEFT JOIN public.registrations rg ON rg.id = cr.registration_id
     WHERE s.event_id = p_event_id
       AND s.result <> 'implied_exit'
  ),
  tier_json AS (
    SELECT checkpoint_id, minute_start, jsonb_object_agg(tier, n) AS by_tier
      FROM (SELECT checkpoint_id, minute_start, tier, count(*) AS n FROM tiered GROUP BY 1, 2, 3) x
     GROUP BY 1, 2
  ),
  result_json AS (
    SELECT checkpoint_id, minute_start, jsonb_object_agg(result, n) AS by_result
      FROM (SELECT checkpoint_id, minute_start, result::text AS result, count(*) AS n FROM tiered GROUP BY 1, 2, 3) x
     GROUP BY 1, 2
  )
  INSERT INTO public.gate_rate_rollups (event_id, checkpoint_id, minute_start, scans, admitted, denied, by_tier_jsonb, by_result_jsonb)
  SELECT p_event_id, t.checkpoint_id, t.minute_start,
         count(*),
         count(*) FILTER (WHERE t.result IN ('admitted', 'already_inside')),
         count(*) FILTER (WHERE t.result IN ('denied_room', 'capacity_block', 'revoked', 'suspended',
                                             'unknown_token', 'wristband_required', 'pass_spent')),
         tj.by_tier, rj.by_result
    FROM tiered t
    JOIN tier_json tj USING (checkpoint_id, minute_start)
    JOIN result_json rj USING (checkpoint_id, minute_start)
   GROUP BY t.checkpoint_id, t.minute_start, tj.by_tier, rj.by_result;
  GET DIAGNOSTICS v_gate = ROW_COUNT;
  PERFORM set_config('app.vault_scope', coalesce(v_prev_scope, ''), true);

  -- Dwell, flow and on site, from each person's zone changes (ephemeral ids only).
  DELETE FROM public.zone_dwell_rollups WHERE event_id = p_event_id;
  DELETE FROM public.zone_flow_rollups WHERE event_id = p_event_id;
  DELETE FROM public.onsite_rollups WHERE event_id = p_event_id;
  WITH pos AS (
    SELECT s.ephemeral_id AS e, s.corrected_at AS t, s.id AS sid,
           CASE WHEN coalesce(s.direction::text, nullif(c.direction::text, 'both')) = 'out' AND c.perimeter_bool
                THEN NULL ELSE c.zone_id END AS zone
      FROM public.scans s
      JOIN public.checkpoints c ON c.id = s.checkpoint_id
     WHERE s.event_id = p_event_id
       AND s.result = 'admitted'
       AND s.ephemeral_id IS NOT NULL
       AND coalesce(s.direction::text, nullif(c.direction::text, 'both')) IS NOT NULL
  ),
  lagged AS (
    SELECT pos.*, lag(zone) OVER (PARTITION BY e ORDER BY t, sid) AS prev FROM pos
  ),
  changes AS (
    SELECT e, t, sid, zone, prev FROM lagged WHERE zone IS DISTINCT FROM prev
  ),
  stays AS (
    SELECT zone,
           extract(epoch FROM (coalesce(lead(t) OVER (PARTITION BY e ORDER BY t, sid), greatest(v_end, t)) - t)) AS secs,
           lead(t) OVER (PARTITION BY e ORDER BY t, sid) IS NULL AS open
      FROM changes
  ),
  dwell AS (
    INSERT INTO public.zone_dwell_rollups (event_id, zone_id, visits, open_visits, total_seconds, dwell_histogram)
    SELECT p_event_id, zone, count(*), count(*) FILTER (WHERE open), round(sum(secs))::bigint,
           ARRAY[
             count(*) FILTER (WHERE secs < 300),
             count(*) FILTER (WHERE secs >= 300 AND secs < 900),
             count(*) FILTER (WHERE secs >= 900 AND secs < 1800),
             count(*) FILTER (WHERE secs >= 1800 AND secs < 3600),
             count(*) FILTER (WHERE secs >= 3600 AND secs < 7200),
             count(*) FILTER (WHERE secs >= 7200)
           ]::integer[]
      FROM stays WHERE zone IS NOT NULL
     GROUP BY zone
    RETURNING 1
  ),
  onsite_steps AS (
    SELECT t, sid,
           CASE WHEN prev IS NULL AND zone IS NOT NULL THEN 1 WHEN prev IS NOT NULL AND zone IS NULL THEN -1 ELSE 0 END AS d
      FROM changes
  ),
  onsite_levels AS (
    SELECT t, d, sum(d) OVER (ORDER BY t, sid ROWS UNBOUNDED PRECEDING) AS level,
           date_bin(interval '5 minutes', t, timestamptz '2000-01-01 00:00:00+00') AS b
      FROM onsite_steps WHERE d <> 0
  ),
  onsite AS (
    INSERT INTO public.onsite_rollups (event_id, bucket_start, arrivals, departures, peak, peak_at, level_end)
    SELECT p_event_id, b,
           count(*) FILTER (WHERE d = 1), count(*) FILTER (WHERE d = -1),
           max(level),
           (array_agg(t ORDER BY level DESC, t))[1],
           (array_agg(level ORDER BY t DESC))[1]
      FROM onsite_levels
     GROUP BY b
    RETURNING 1
  )
  INSERT INTO public.zone_flow_rollups (event_id, bucket_start, from_zone_id, to_zone_id, moves)
  SELECT p_event_id, date_trunc('hour', t), prev, zone, count(*)
    FROM changes
   GROUP BY 2, 3, 4;

  UPDATE public.events SET rollups_rebuilt_at = now() WHERE id = p_event_id;

  occupancy_rows := v_occ;
  gate_rate_rows := v_gate;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- B. The post-event summary (D-21), from rollups, registrations, alerts and the venue only.
-- `provisional` is true while the event is draft, published or live (figures so far).
-- The on-site curve has a point every 5 minutes from the event's start (or first arrival) to its
-- end (or, while live, now), carrying the last known level through quiet buckets.
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_post_event_summary(p_event_id uuid, p_now timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH e AS (SELECT * FROM public.events WHERE id = p_event_id),
  att AS (SELECT * FROM public.report_attendance(p_event_id)),
  peaks AS (
    SELECT p.*, r.block_at_pct,
           p.capacity > 0 AND 100.0 * p.peak / p.capacity >= r.block_at_pct AS reached_block
      FROM public.report_peak_occupancy(p_event_id, NULL, NULL, 100000, 0) p
      JOIN public.rooms r ON r.id = p.room_id
  ),
  gates AS (SELECT * FROM public.report_gate_throughput(p_event_id, NULL, NULL, NULL, NULL, 100000, 0)),
  al AS (
    SELECT severity::text AS sev, extract(epoch FROM (acked_at - occurred_at)) AS ack_s,
           extract(epoch FROM (resolved_at - occurred_at)) AS res_s
      FROM public.breach_alerts WHERE event_id = p_event_id
  ),
  os AS (SELECT * FROM public.onsite_rollups WHERE event_id = p_event_id),
  opeak AS (SELECT peak, peak_at FROM os ORDER BY peak DESC, peak_at LIMIT 1),
  bounds AS (
    SELECT date_bin(interval '5 minutes', least(e.starts_at, (SELECT min(bucket_start) FROM os)), timestamptz '2000-01-01 00:00:00+00') AS b0,
           date_bin(interval '5 minutes',
                    CASE WHEN e.state IN ('closed', 'archived') THEN greatest(e.ends_at, (SELECT max(bucket_start) FROM os))
                         ELSE least(p_now, greatest(e.ends_at, (SELECT max(bucket_start) FROM os))) END,
                    timestamptz '2000-01-01 00:00:00+00') AS b1
      FROM e
  ),
  curve AS (
    SELECT g AS t,
           coalesce((SELECT o.level_end FROM os o WHERE o.bucket_start <= g ORDER BY o.bucket_start DESC LIMIT 1), 0) AS on_site,
           coalesce((SELECT o.peak FROM os o WHERE o.bucket_start = g),
                    (SELECT o.level_end FROM os o WHERE o.bucket_start < g ORDER BY o.bucket_start DESC LIMIT 1), 0) AS peak
      FROM bounds, generate_series(bounds.b0, bounds.b1, interval '5 minutes') AS g
  )
  SELECT jsonb_build_object(
    'event', (SELECT jsonb_build_object('id', id, 'slug', slug, 'title', title, 'state', state, 'starts_at', starts_at,
                                        'ends_at', ends_at, 'timezone', timezone, 'closed_at', closed_at) FROM e),
    'provisional', (SELECT state IN ('draft', 'published', 'live') FROM e),
    'computed_at', p_now,
    'rollups_rebuilt_at', (SELECT rollups_rebuilt_at FROM e),
    'headline', jsonb_build_object(
      'registered', (SELECT coalesce(sum(registered), 0) FROM att),
      'checked_in', (SELECT coalesce(sum(checked_in), 0) FROM att),
      'no_shows', (SELECT coalesce(sum(no_shows), 0) FROM att),
      'peak_on_site', coalesce((SELECT peak FROM opeak), 0),
      'peak_on_site_at', (SELECT peak_at FROM opeak),
      'rooms_at_capacity', (SELECT count(*) FROM peaks WHERE reached_block),
      'alerts_total', (SELECT count(*) FROM al),
      'alerts_by_severity', (SELECT jsonb_build_object(
          'low', count(*) FILTER (WHERE sev = 'low'), 'medium', count(*) FILTER (WHERE sev = 'medium'),
          'high', count(*) FILTER (WHERE sev = 'high'), 'critical', count(*) FILTER (WHERE sev = 'critical')) FROM al),
      'ack_median_s', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY ack_s))::numeric, 1) FROM al),
      'resolve_median_s', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY res_s))::numeric, 1) FROM al)
    ),
    'attendance_by_tier', (SELECT jsonb_agg(jsonb_build_object('tier', tier, 'registered', registered, 'checked_in', checked_in,
                                                                 'no_shows', no_shows) ORDER BY tier) FROM att),
    'onsite_curve', jsonb_build_object(
      'bucket_minutes', 5,
      'points', coalesce((SELECT jsonb_agg(jsonb_build_object('t', t, 'on_site', on_site, 'peak', peak) ORDER BY t) FROM curve), '[]'::jsonb)
    ),
    'busiest_rooms', coalesce((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('room_id', room_id, 'name', room_name, 'peak', peak, 'peak_at', peak_at, 'capacity', capacity,
                                  'pct', pct, 'admissions', admissions, 'reached_block', reached_block) AS x
          FROM peaks WHERE peak > 0 ORDER BY peak DESC, admissions DESC, room_name LIMIT 5) r), '[]'::jsonb),
    'busiest_gates', coalesce((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('checkpoint_id', checkpoint_id, 'label', label, 'scans', scans, 'admitted', admitted, 'denied', denied) AS x
          FROM gates ORDER BY scans DESC, label LIMIT 5) g), '[]'::jsonb),
    'purge', (SELECT jsonb_build_object('purged', purged_at IS NOT NULL, 'purged_at', purged_at,
                                        'due_at', CASE WHEN closed_at IS NOT NULL THEN closed_at + grace_buffer END,
                                        'scans_available', purged_at IS NULL) FROM e)
  )
$$;
--> statement-breakpoint

-- The frozen summary once the event is purged; otherwise computed now. `frozen` says which.
CREATE OR REPLACE FUNCTION public.post_event_summary(p_event_id uuid, p_now timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (SELECT s.summary_jsonb || jsonb_build_object('frozen', true, 'frozen_at', s.frozen_at)
       FROM public.event_summaries s WHERE s.event_id = p_event_id),
    (SELECT public.compute_post_event_summary(p_event_id, p_now) || jsonb_build_object('frozen', false, 'frozen_at', NULL)
      WHERE EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id)))
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- C. The purge now freezes the summary (same signature; privileges kept).
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_event_movement_data(p_event_id uuid, p_force boolean DEFAULT false, p_actor_id uuid DEFAULT NULL)
RETURNS TABLE (scans_dropped bigint, ephemeral_ids_deleted bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pii_vault, pg_temp AS $$
DECLARE
  ev           public.events%ROWTYPE;
  v_prev_scope text := current_setting('app.vault_scope', true);
  v_scans      bigint := 0;
  v_eph        bigint := 0;
  v_part       text := public.scan_partition_name(p_event_id);
BEGIN
  SELECT * INTO ev FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event % does not exist', p_event_id USING ERRCODE = 'no_data_found';
  END IF;
  IF ev.purged_at IS NOT NULL THEN
    scans_dropped := 0; ephemeral_ids_deleted := 0; RETURN NEXT; RETURN;
  END IF;
  IF ev.state NOT IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'event % is %; only closed or archived events can be purged', p_event_id, ev.state
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF NOT p_force AND now() < coalesce(ev.closed_at, now()) + ev.grace_buffer THEN
    RAISE EXCEPTION 'event % is inside its grace period until %', p_event_id, coalesce(ev.closed_at, now()) + ev.grace_buffer
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  PERFORM public.rebuild_event_rollups(p_event_id);

  IF to_regclass('public.' || quote_ident(v_part)) IS NOT NULL THEN
    EXECUTE format('SELECT count(*) FROM public.%I', v_part) INTO v_scans;
    EXECUTE format('DROP TABLE public.%I', v_part);
  END IF;

  PERFORM set_config('app.vault_scope', 'system', true);
  DELETE FROM pii_vault.ephemeral_ids WHERE event_id = p_event_id;
  GET DIAGNOSTICS v_eph = ROW_COUNT;
  PERFORM set_config('app.vault_scope', coalesce(v_prev_scope, ''), true);

  UPDATE public.events SET purged_at = now() WHERE id = p_event_id;

  -- D-21: the summary is frozen as it stands now, from the freshly rebuilt rollups.
  INSERT INTO public.event_summaries (event_id, frozen_at, summary_jsonb)
  VALUES (p_event_id, now(), public.compute_post_event_summary(p_event_id, now()))
  ON CONFLICT (event_id) DO UPDATE SET frozen_at = EXCLUDED.frozen_at, summary_jsonb = EXCLUDED.summary_jsonb;

  INSERT INTO public.audit_log (actor_id, action, target, meta_jsonb)
  VALUES (p_actor_id, 'event.purge', 'event:' || p_event_id,
          jsonb_build_object('scans_dropped', v_scans, 'ephemeral_ids_deleted', v_eph, 'forced', p_force));

  scans_dropped := v_scans;
  ephemeral_ids_deleted := v_eph;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- D. Workbook queries (no identity; the attendee sheet's names come from the vault connection).
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workbook_alert_log(p_event_id uuid, p_limit integer DEFAULT 100000, p_offset integer DEFAULT 0)
RETURNS TABLE (
  occurred_at timestamptz, kind text, severity text, state text, room text, checkpoint text, detail text,
  acked_at timestamptz, resolved_at timestamptz, ack_s numeric, resolve_s numeric
)
LANGUAGE sql STABLE AS $$
  SELECT a.occurred_at, a.kind::text, a.severity::text, a.state::text, r.name, c.label, a.detail, a.acked_at, a.resolved_at,
         round(extract(epoch FROM (a.acked_at - a.occurred_at))::numeric, 1),
         round(extract(epoch FROM (a.resolved_at - a.occurred_at))::numeric, 1)
    FROM public.breach_alerts a
    LEFT JOIN public.rooms r ON r.id = a.room_id
    LEFT JOIN public.checkpoints c ON c.id = a.checkpoint_id
   WHERE a.event_id = p_event_id
   ORDER BY a.occurred_at, a.id
   LIMIT p_limit OFFSET p_offset
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.workbook_attendees(p_event_id uuid, p_limit integer DEFAULT 100000, p_offset integer DEFAULT 0)
RETURNS TABLE (registration_id uuid, attendee_id uuid, tier text, state text, checked_in boolean, first_check_in timestamptz, registered_at timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT r.id, r.attendee_id, r.tier::text, r.state::text, r.checked_in_at IS NOT NULL, r.checked_in_at, r.created_at
    FROM public.registrations r
   WHERE r.event_id = p_event_id
   ORDER BY r.created_at, r.id
   LIMIT p_limit OFFSET p_offset
$$;
