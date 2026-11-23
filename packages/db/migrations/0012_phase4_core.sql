-- 0012 — Phase 4 database support, part 1 (hand-written):
--   A. Rollups: gate rates gain a result breakdown and count `already_inside` as let-through (matching
--      the API's live counter); dwell and flow per zone are rolled up before the purge.
--   B. Reports (01 §10), built only from data that survives the purge.
--   C. Event and dashboard summaries.
--   D. Offline allowlist, and the revocation epoch kept by triggers.
--   E. Access rules: versioned atomic replace, diff, entitlement resolution.
--   F. Carriers and credentials: state machines, bulk import, bind / rebind / lost-and-replace.

------------------------------------------------------------------------------------------------
-- A. Rollups
------------------------------------------------------------------------------------------------

-- Same signature as 0002 (privileges are kept by CREATE OR REPLACE). Now also rebuilds
-- zone_dwell_rollups and zone_flow_rollups, and gate_rate_rollups.by_result_jsonb.
-- gate_rate_rollups.admitted counts scans that let someone through: admitted and already_inside.
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

  -- Dwell and flow (no identity needed: ephemeral ids only, and only aggregates are kept).
  -- A person's zone is the zone of their last admitted inbound scan; an outbound scan at a
  -- perimeter gate means they left the venue; an outbound scan at an interior door keeps the zone.
  DELETE FROM public.zone_dwell_rollups WHERE event_id = p_event_id;
  DELETE FROM public.zone_flow_rollups WHERE event_id = p_event_id;
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
  )
  INSERT INTO public.zone_flow_rollups (event_id, bucket_start, from_zone_id, to_zone_id, moves)
  SELECT p_event_id, date_trunc('hour', t), prev, zone, count(*)
    FROM changes
   GROUP BY 2, 3, 4;

  occupancy_rows := v_occ;
  gate_rate_rows := v_gate;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- B. Reports. Every report reads only rollups, snapshots, registrations, alerts and the venue —
-- never scans — so it returns the same figures before and after the purge (once the rollups are
-- current: the purge rebuilds them; during an event, run rebuild_event_rollups() on a schedule).
-- Time ranges are half-open [p_from, p_to); null means unbounded. List reports return total_count.
------------------------------------------------------------------------------------------------

-- Attendance by tier. checked_in honours the time range; no_shows are confirmed registrations
-- that never checked in (during the event: not yet arrived).
CREATE OR REPLACE FUNCTION public.report_attendance(
  p_event_id uuid, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL
) RETURNS TABLE (tier text, registered bigint, pending bigint, cancelled bigint, checked_in bigint, no_shows bigint)
LANGUAGE sql STABLE AS $$
  SELECT t.tier::text,
         count(r.id) FILTER (WHERE r.state = 'confirmed'),
         count(r.id) FILTER (WHERE r.state = 'pending_approval'),
         count(r.id) FILTER (WHERE r.state = 'cancelled'),
         count(r.id) FILTER (WHERE r.checked_in_at IS NOT NULL
                               AND (p_from IS NULL OR r.checked_in_at >= p_from)
                               AND (p_to IS NULL OR r.checked_in_at < p_to)),
         count(r.id) FILTER (WHERE r.state = 'confirmed' AND r.checked_in_at IS NULL)
    FROM unnest(enum_range(NULL::public.attendee_tier)) AS t(tier)
    LEFT JOIN public.registrations r ON r.event_id = p_event_id AND r.tier = t.tier
   GROUP BY t.tier
   ORDER BY t.tier
$$;
--> statement-breakpoint

-- Arrivals (first check-in) over time, by tier.
CREATE OR REPLACE FUNCTION public.report_arrivals(
  p_event_id uuid, p_bucket interval DEFAULT '15 minutes', p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL
) RETURNS TABLE (bucket_start timestamptz, tier text, arrivals bigint)
LANGUAGE sql STABLE AS $$
  SELECT date_bin(p_bucket, r.checked_in_at, timestamptz '2000-01-01 00:00:00+00'), r.tier::text, count(*)
    FROM public.registrations r
   WHERE r.event_id = p_event_id AND r.checked_in_at IS NOT NULL
     AND (p_from IS NULL OR r.checked_in_at >= p_from) AND (p_to IS NULL OR r.checked_in_at < p_to)
   GROUP BY 1, 2
   ORDER BY 1, 2
$$;
--> statement-breakpoint

-- Dwell per zone for the whole event. Zones with fewer than p_min_count visits are suppressed
-- (O-08, k-anonymity): the row is returned with suppressed = true and no figures.
CREATE OR REPLACE FUNCTION public.report_dwell(p_event_id uuid, p_min_count integer DEFAULT 5)
RETURNS TABLE (
  zone_id uuid, zone_name text, floor text, visits integer, open_visits integer,
  avg_minutes numeric, dwell_histogram integer[], suppressed boolean
)
LANGUAGE sql STABLE AS $$
  SELECT z.id, z.name, z.floor,
         CASE WHEN d.visits >= p_min_count THEN d.visits END,
         CASE WHEN d.visits >= p_min_count THEN d.open_visits END,
         CASE WHEN d.visits >= p_min_count THEN round(d.total_seconds / 60.0 / d.visits, 1) END,
         CASE WHEN d.visits >= p_min_count THEN d.dwell_histogram END,
         d.visits < p_min_count
    FROM public.zone_dwell_rollups d
    JOIN public.zones z ON z.id = d.zone_id
   WHERE d.event_id = p_event_id
   ORDER BY z.floor NULLS LAST, z.name
$$;
--> statement-breakpoint

-- Movement between zones. from_zone_id null = arrived from outside; to_zone_id null = left the
-- venue. p_bucket null = totals over the range; otherwise per bucket (a multiple of one hour).
CREATE OR REPLACE FUNCTION public.report_flow(
  p_event_id uuid, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL, p_bucket interval DEFAULT NULL,
  p_min_count integer DEFAULT 5, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0
) RETURNS TABLE (
  bucket_start timestamptz, from_zone_id uuid, to_zone_id uuid, moves bigint, suppressed boolean, total_count bigint
)
LANGUAGE sql STABLE AS $$
  WITH agg AS (
    SELECT CASE WHEN p_bucket IS NULL THEN NULL
                ELSE date_bin(p_bucket, f.bucket_start, timestamptz '2000-01-01 00:00:00+00') END AS b,
           f.from_zone_id, f.to_zone_id, sum(f.moves) AS moves
      FROM public.zone_flow_rollups f
     WHERE f.event_id = p_event_id
       AND (p_from IS NULL OR f.bucket_start >= p_from) AND (p_to IS NULL OR f.bucket_start < p_to)
     GROUP BY 1, 2, 3
  )
  SELECT b, from_zone_id, to_zone_id,
         CASE WHEN moves >= p_min_count THEN moves END, moves < p_min_count, count(*) OVER ()
    FROM agg
   ORDER BY b NULLS FIRST, moves DESC, from_zone_id NULLS FIRST, to_zone_id NULLS FIRST
   LIMIT p_limit OFFSET p_offset
$$;
--> statement-breakpoint

-- Highest occupancy per room within the range, and the first 5-minute bucket that reached it.
CREATE OR REPLACE FUNCTION public.report_peak_occupancy(
  p_event_id uuid, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 500, p_offset integer DEFAULT 0
) RETURNS TABLE (
  room_id uuid, room_name text, zone_id uuid, capacity integer, peak integer, peak_at timestamptz,
  pct numeric, admissions bigint, total_count bigint
)
LANGUAGE sql STABLE AS $$
  WITH b AS (
    SELECT o.room_id, max(o.peak) AS peak,
           (array_agg(o.bucket_start ORDER BY o.peak DESC, o.bucket_start))[1] AS peak_at,
           sum(o.in_count) AS admissions
      FROM public.occupancy_rollups o
     WHERE o.event_id = p_event_id
       AND (p_from IS NULL OR o.bucket_start >= p_from) AND (p_to IS NULL OR o.bucket_start < p_to)
     GROUP BY o.room_id
  )
  SELECT r.id, r.name, r.zone_id, coalesce(er.capacity_override, r.capacity),
         coalesce(b.peak, 0), CASE WHEN coalesce(b.peak, 0) > 0 THEN b.peak_at END,
         CASE WHEN coalesce(er.capacity_override, r.capacity) > 0
              THEN round(100.0 * coalesce(b.peak, 0) / coalesce(er.capacity_override, r.capacity), 1) END,
         coalesce(b.admissions, 0), count(*) OVER ()
    FROM public.event_rooms er
    JOIN public.rooms r ON r.id = er.room_id
    LEFT JOIN b ON b.room_id = er.room_id
   WHERE er.event_id = p_event_id
   ORDER BY coalesce(b.peak, 0) DESC, r.name
   LIMIT p_limit OFFSET p_offset
$$;
--> statement-breakpoint

-- Alerts by kind and severity, with time to acknowledge and to resolve (seconds). The row with
-- kind and severity null is the total over the range.
CREATE OR REPLACE FUNCTION public.report_breach(
  p_event_id uuid, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL
) RETURNS TABLE (
  kind text, severity text, total bigint, open bigint, acked bigint, resolved bigint,
  ack_avg_s numeric, ack_p50_s numeric, ack_p90_s numeric,
  resolve_avg_s numeric, resolve_p50_s numeric, resolve_p90_s numeric
)
LANGUAGE sql STABLE AS $$
  WITH a AS (
    SELECT kind::text AS kind, severity::text AS severity, state,
           extract(epoch FROM (acked_at - occurred_at)) AS ack_s,
           extract(epoch FROM (resolved_at - occurred_at)) AS res_s
      FROM public.breach_alerts
     WHERE event_id = p_event_id
       AND (p_from IS NULL OR occurred_at >= p_from) AND (p_to IS NULL OR occurred_at < p_to)
  )
  SELECT kind, severity, count(*),
         count(*) FILTER (WHERE state = 'open'), count(*) FILTER (WHERE state = 'acked'),
         count(*) FILTER (WHERE state = 'resolved'),
         round(avg(ack_s)::numeric, 1),
         round((percentile_cont(0.5) WITHIN GROUP (ORDER BY ack_s))::numeric, 1),
         round((percentile_cont(0.9) WITHIN GROUP (ORDER BY ack_s))::numeric, 1),
         round(avg(res_s)::numeric, 1),
         round((percentile_cont(0.5) WITHIN GROUP (ORDER BY res_s))::numeric, 1),
         round((percentile_cont(0.9) WITHIN GROUP (ORDER BY res_s))::numeric, 1)
    FROM a
   GROUP BY GROUPING SETS ((kind, severity), ())
   ORDER BY kind NULLS LAST, severity
$$;
--> statement-breakpoint

-- Scans per gate over time, with the result and tier breakdowns. p_bucket null = totals per gate
-- over the range (the failure breakdown).
CREATE OR REPLACE FUNCTION public.report_gate_throughput(
  p_event_id uuid, p_bucket interval DEFAULT '5 minutes', p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL, p_checkpoint_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 1000, p_offset integer DEFAULT 0
) RETURNS TABLE (
  checkpoint_id uuid, label text, bucket_start timestamptz, scans bigint, admitted bigint, denied bigint,
  by_result jsonb, by_tier jsonb, total_count bigint
)
LANGUAGE sql STABLE AS $$
  WITH g AS (
    SELECT r.checkpoint_id,
           CASE WHEN p_bucket IS NULL THEN NULL
                ELSE date_bin(p_bucket, r.minute_start, timestamptz '2000-01-01 00:00:00+00') END AS b,
           r.scans, r.admitted, r.denied, r.by_result_jsonb, r.by_tier_jsonb
      FROM public.gate_rate_rollups r
     WHERE r.event_id = p_event_id
       AND (p_checkpoint_id IS NULL OR r.checkpoint_id = p_checkpoint_id)
       AND (p_from IS NULL OR r.minute_start >= p_from) AND (p_to IS NULL OR r.minute_start < p_to)
  ),
  tot AS (
    SELECT checkpoint_id, b, sum(scans) AS scans, sum(admitted) AS admitted, sum(denied) AS denied
      FROM g GROUP BY 1, 2
  ),
  res AS (
    SELECT checkpoint_id, b, jsonb_object_agg(k, n) AS j
      FROM (SELECT checkpoint_id, b, e.key AS k, sum(e.value::bigint) AS n
              FROM g, jsonb_each_text(g.by_result_jsonb) e GROUP BY 1, 2, 3) x
     GROUP BY 1, 2
  ),
  tie AS (
    SELECT checkpoint_id, b, jsonb_object_agg(k, n) AS j
      FROM (SELECT checkpoint_id, b, e.key AS k, sum(e.value::bigint) AS n
              FROM g, jsonb_each_text(g.by_tier_jsonb) e GROUP BY 1, 2, 3) x
     GROUP BY 1, 2
  )
  SELECT t.checkpoint_id, c.label, t.b, t.scans, t.admitted, t.denied,
         coalesce(res.j, '{}'::jsonb), coalesce(tie.j, '{}'::jsonb), count(*) OVER ()
    FROM tot t
    JOIN public.checkpoints c ON c.id = t.checkpoint_id
    LEFT JOIN res ON res.checkpoint_id = t.checkpoint_id AND res.b IS NOT DISTINCT FROM t.b
    LEFT JOIN tie ON tie.checkpoint_id = t.checkpoint_id AND tie.b IS NOT DISTINCT FROM t.b
   ORDER BY c.label, t.b NULLS FIRST
   LIMIT p_limit OFFSET p_offset
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- C. Event and dashboard summaries (live figures; on-site uses credentials.zone_state, rooms over
-- warn use room_occupancy()).
------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.event_summary(p_event_id uuid)
RETURNS TABLE (
  event_id uuid, registered bigint, checked_in bigint, on_site bigint, rooms_over_warn bigint,
  rooms_at_block bigint, open_alerts bigint, acked_alerts bigint, critical_open_alerts bigint,
  by_tier jsonb, as_of timestamptz
)
LANGUAGE sql STABLE AS $$
  WITH regs AS (
    SELECT r.tier::text AS tier, r.state, r.checked_in_at,
           EXISTS (SELECT 1 FROM public.credentials c
                    WHERE c.registration_id = r.id
                      AND c.state IN ('issued', 'active', 'suspended_review')
                      AND c.zone_state <> 'OUTSIDE') AS on_site
      FROM public.registrations r
     WHERE r.event_id = p_event_id
  ),
  t AS (
    SELECT tier,
           count(*) FILTER (WHERE state = 'confirmed') AS registered,
           count(*) FILTER (WHERE checked_in_at IS NOT NULL) AS checked_in,
           count(*) FILTER (WHERE on_site) AS on_site
      FROM regs GROUP BY tier
  ),
  occ AS (SELECT status FROM public.room_occupancy(p_event_id, now())),
  al AS (SELECT state, severity FROM public.breach_alerts WHERE event_id = p_event_id)
  SELECT p_event_id,
         coalesce((SELECT sum(registered) FROM t), 0)::bigint,
         coalesce((SELECT sum(checked_in) FROM t), 0)::bigint,
         coalesce((SELECT sum(on_site) FROM t), 0)::bigint,
         (SELECT count(*) FROM occ WHERE status IN ('warn', 'block')),
         (SELECT count(*) FROM occ WHERE status = 'block'),
         (SELECT count(*) FROM al WHERE state = 'open'),
         (SELECT count(*) FROM al WHERE state = 'acked'),
         (SELECT count(*) FROM al WHERE state = 'open' AND severity = 'critical'),
         coalesce((SELECT jsonb_object_agg(tier, jsonb_build_object('registered', registered, 'checked_in', checked_in, 'on_site', on_site)) FROM t), '{}'::jsonb),
         now()
$$;
--> statement-breakpoint

-- Organisation dashboard: totals over the organisation's live events.
CREATE OR REPLACE FUNCTION public.dashboard_summary(p_org_id uuid)
RETURNS TABLE (
  live_events bigint, published_events bigint, registered bigint, checked_in bigint, on_site bigint,
  rooms_over_warn bigint, open_alerts bigint, critical_open_alerts bigint, as_of timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT (SELECT count(*) FROM public.events WHERE org_id = p_org_id AND state = 'live'),
         (SELECT count(*) FROM public.events WHERE org_id = p_org_id AND state = 'published'),
         coalesce(sum(s.registered), 0)::bigint, coalesce(sum(s.checked_in), 0)::bigint,
         coalesce(sum(s.on_site), 0)::bigint, coalesce(sum(s.rooms_over_warn), 0)::bigint,
         coalesce(sum(s.open_alerts), 0)::bigint, coalesce(sum(s.critical_open_alerts), 0)::bigint, now()
    FROM public.events e
    CROSS JOIN LATERAL public.event_summary(e.id) s
   WHERE e.org_id = p_org_id AND e.state = 'live'
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- D. Offline allowlist (01 §8) and the revocation epoch.
--
-- The allowlist is two sets: subjects (tier or role → room → permitted time windows inside the
-- requested window, computed once per subject), and entries (one per credential: reference,
-- subject, effective state, live NFC hashes). No identity. The scanner joins them.
------------------------------------------------------------------------------------------------

-- Permitted windows per subject and room within [p_from, p_to): permits minus denies (deny wins),
-- clipped to the window. Rooms limited to those behind p_checkpoint_ids when given.
CREATE OR REPLACE FUNCTION public.allowlist_rooms(
  p_event_id uuid, p_from timestamptz, p_to timestamptz, p_checkpoint_ids uuid[] DEFAULT NULL
) RETURNS TABLE (subject_kind text, subject text, room_id uuid, windows jsonb)
LANGUAGE sql STABLE AS $$
  WITH rooms AS (
    SELECT er.room_id FROM public.event_rooms er
     WHERE er.event_id = p_event_id
       AND (p_checkpoint_ids IS NULL OR er.room_id IN (
             SELECT c.room_id FROM public.checkpoints c WHERE c.id = ANY (p_checkpoint_ids) AND c.room_id IS NOT NULL))
  ),
  rr AS (
    SELECT a.subject_kind::text AS subject_kind, a.subject, a.room_id, a.effect,
           tstzrange(coalesce(a.window_start, '-infinity'), coalesce(a.window_end, 'infinity'), '[)') AS r
      FROM public.access_rules a
     WHERE a.event_id = p_event_id AND a.room_id IN (SELECT room_id FROM rooms)
  ),
  agg AS (
    SELECT subject_kind, subject, room_id,
           (coalesce(range_agg(r) FILTER (WHERE effect = 'permit'), '{}'::tstzmultirange)
            - coalesce(range_agg(r) FILTER (WHERE effect = 'deny'), '{}'::tstzmultirange))
           * tstzmultirange(tstzrange(p_from, p_to, '[)')) AS allowed
      FROM rr GROUP BY 1, 2, 3
  )
  SELECT subject_kind, subject, room_id,
         (SELECT jsonb_agg(jsonb_build_array(lower(x), upper(x)) ORDER BY lower(x)) FROM unnest(allowed) AS x)
    FROM agg
   WHERE NOT isempty(allowed)
   ORDER BY 1, 2, 3
$$;
--> statement-breakpoint

-- One row per credential that may present itself at this event. effective_state is the
-- credential state, except 'revoked' when the registration is not confirmed. Staff credentials
-- are included when their role has a rule in the event or they are assigned to it.
-- dead_nfc_hashes are lost or retired bands, which a gate must answer as revoked.
CREATE OR REPLACE FUNCTION public.allowlist_credentials(p_event_id uuid)
RETURNS TABLE (
  credential_ref text, subject_kind text, subject text, effective_state text,
  nfc_hashes text[], dead_nfc_hashes text[], qr_email_spent boolean
)
LANGUAGE sql STABLE AS $$
  WITH creds AS (
    SELECT c.id, c.token_hash, 'tier'::text AS subject_kind, r.tier::text AS subject,
           CASE WHEN r.state <> 'confirmed' THEN 'revoked' ELSE c.state::text END AS effective_state
      FROM public.registrations r
      JOIN public.credentials c ON c.registration_id = r.id
     WHERE r.event_id = p_event_id
    UNION ALL
    SELECT c.id, c.token_hash, 'role', u.role::text,
           CASE WHEN u.disabled_at IS NOT NULL THEN 'revoked' ELSE c.state::text END
      FROM public.credentials c
      JOIN public.users u ON u.id = c.staff_user_id
     WHERE EXISTS (SELECT 1 FROM public.access_rules a
                    WHERE a.event_id = p_event_id AND a.subject_kind = 'role' AND a.subject = u.role::text AND a.effect = 'permit')
        OR EXISTS (SELECT 1 FROM public.staff_assignments s WHERE s.user_id = u.id AND s.event_id = p_event_id)
  ),
  bands AS (
    SELECT k.credential_id,
           array_agg(k.identifier ORDER BY k.identifier) FILTER (WHERE k.state IN ('assigned', 'bound', 'active')) AS live,
           array_agg(k.identifier ORDER BY k.identifier) FILTER (WHERE k.state IN ('lost', 'retired')) AS dead
      FROM public.carriers k
     WHERE k.kind = 'nfc' AND k.credential_id IN (SELECT id FROM creds)
     GROUP BY k.credential_id
  ),
  mail AS (
    SELECT k.credential_id, bool_or(k.redeemed_at IS NOT NULL) AS spent
      FROM public.carriers k
     WHERE k.kind = 'qr_email' AND k.credential_id IN (SELECT id FROM creds)
     GROUP BY k.credential_id
  )
  SELECT c.token_hash, c.subject_kind, c.subject, c.effective_state,
         coalesce(b.live, '{}'), coalesce(b.dead, '{}'), coalesce(m.spent, false)
    FROM creds c
    LEFT JOIN bands b ON b.credential_id = c.id
    LEFT JOIN mail m ON m.credential_id = c.id
   ORDER BY c.token_hash
$$;
--> statement-breakpoint

-- Revocation epoch: bumped by the database whenever access shrinks or a supervisor clears a
-- review, so a scanner can tell its cached allowlist is out of date.
--   credentials:   → revoked / suspended_review / replaced, and suspended_review → active (clear)
--   carriers:      a live band → lost / retired
--   registrations: tier changed, or no longer confirmed
--   access_rules:  any change (republish)
-- A staff credential's or band's change bumps every published or live event.
-- Row triggers with WHEN conditions on the state columns: the scan hot path (zone_state updates,
-- first activation issued → active) never fires them.
CREATE OR REPLACE FUNCTION public.bump_epoch_for_credential(p_registration_id uuid) RETURNS void
LANGUAGE sql AS $$
  UPDATE public.events e SET revocation_epoch = e.revocation_epoch + 1
   WHERE (p_registration_id IS NOT NULL AND e.id = (SELECT r.event_id FROM public.registrations r WHERE r.id = p_registration_id))
      OR (p_registration_id IS NULL AND e.state IN ('published', 'live'))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.credentials_bump_epoch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.bump_epoch_for_credential(NEW.registration_id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER credentials_bump_epoch AFTER UPDATE OF state ON public.credentials
FOR EACH ROW
WHEN (OLD.state IS DISTINCT FROM NEW.state
      AND (NEW.state IN ('revoked', 'suspended_review', 'replaced') OR (OLD.state = 'suspended_review' AND NEW.state = 'active')))
EXECUTE FUNCTION public.credentials_bump_epoch();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.carriers_bump_epoch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.bump_epoch_for_credential((SELECT c.registration_id FROM public.credentials c WHERE c.id = NEW.credential_id));
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER carriers_bump_epoch AFTER UPDATE OF state ON public.carriers
FOR EACH ROW
WHEN (NEW.credential_id IS NOT NULL AND OLD.state IN ('assigned', 'bound', 'active') AND NEW.state IN ('lost', 'retired'))
EXECUTE FUNCTION public.carriers_bump_epoch();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.registrations_bump_epoch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.events e SET revocation_epoch = e.revocation_epoch + 1 WHERE e.id = NEW.event_id;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER registrations_bump_epoch AFTER UPDATE OF tier, state ON public.registrations
FOR EACH ROW
WHEN (OLD.tier IS DISTINCT FROM NEW.tier OR (OLD.state = 'confirmed' AND NEW.state <> 'confirmed'))
EXECUTE FUNCTION public.registrations_bump_epoch();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.access_rules_bump_epoch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.events e SET revocation_epoch = e.revocation_epoch + 1 WHERE e.id IN (SELECT event_id FROM new_rows);
  ELSE
    UPDATE public.events e SET revocation_epoch = e.revocation_epoch + 1 WHERE e.id IN (SELECT event_id FROM old_rows);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER access_rules_bump_epoch_ins AFTER INSERT ON public.access_rules
REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.access_rules_bump_epoch();
--> statement-breakpoint
CREATE TRIGGER access_rules_bump_epoch_upd AFTER UPDATE ON public.access_rules
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.access_rules_bump_epoch();
--> statement-breakpoint
CREATE TRIGGER access_rules_bump_epoch_del AFTER DELETE ON public.access_rules
REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.access_rules_bump_epoch();
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- E. Access rules
------------------------------------------------------------------------------------------------

-- Canonical JSON for one rule (UTC timestamps, so snapshots compare across sessions).
CREATE OR REPLACE FUNCTION public.access_rule_json(
  p_subject_kind text, p_subject text, p_room_id uuid, p_window_start timestamptz, p_window_end timestamptz, p_effect text
) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'subject_kind', p_subject_kind, 'subject', p_subject, 'room_id', p_room_id,
    'window_start', to_char(p_window_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'window_end', to_char(p_window_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'effect', p_effect)
$$;
--> statement-breakpoint

-- The current rule set of an event as a sorted JSON array.
CREATE OR REPLACE FUNCTION public.access_rules_snapshot(p_event_id uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(j ORDER BY j::text), '[]'::jsonb)
    FROM (SELECT public.access_rule_json(subject_kind::text, subject, room_id, window_start, window_end, effect::text) AS j
            FROM public.access_rules WHERE event_id = p_event_id) x
$$;
--> statement-breakpoint

-- A proposed rule list (as sent by the API) in the same canonical form.
CREATE OR REPLACE FUNCTION public.access_rules_canonical(p_rules jsonb) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(j ORDER BY j::text), '[]'::jsonb)
    FROM (SELECT DISTINCT public.access_rule_json(x.subject_kind, x.subject, x.room_id, x.window_start, x.window_end, x.effect) AS j
            FROM jsonb_to_recordset(p_rules) AS x(subject_kind text, subject text, room_id uuid,
                                                  window_start timestamptz, window_end timestamptz, effect text)) y
$$;
--> statement-breakpoint

-- Elements in a but not in b, as rule rows.
CREATE OR REPLACE FUNCTION public.access_rules_minus(a jsonb, b jsonb)
RETURNS TABLE (subject_kind text, subject text, room_id uuid, window_start timestamptz, window_end timestamptz, effect text)
LANGUAGE sql IMMUTABLE AS $$
  SELECT x->>'subject_kind', x->>'subject', (x->>'room_id')::uuid,
         (x->>'window_start')::timestamptz, (x->>'window_end')::timestamptz, x->>'effect'
    FROM (SELECT jsonb_array_elements(a) EXCEPT SELECT jsonb_array_elements(b)) AS d(x)
$$;
--> statement-breakpoint

-- Replaces the whole rule set atomically when p_expected_version matches (optimistic concurrency):
-- snapshots the previous set (as its version, if not yet stored) and the new one, bumps
-- events.access_rules_version (and, through the trigger, revocation_epoch), and writes one audit
-- entry. Status: 'ok' | 'version_conflict'. Invalid rules raise (constraint names say why).
CREATE OR REPLACE FUNCTION public.access_rules_replace(
  p_event_id uuid, p_expected_version integer, p_rules jsonb, p_actor_id uuid DEFAULT NULL, p_now timestamptz DEFAULT now()
) RETURNS TABLE (status text, version integer, added integer, removed integer, audit_id bigint)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  ev public.events%ROWTYPE;
  v_prev jsonb;
  v_next jsonb;
  v_new integer;
BEGIN
  SELECT * INTO ev FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event % does not exist', p_event_id USING ERRCODE = 'no_data_found';
  END IF;
  IF ev.access_rules_version <> p_expected_version THEN
    status := 'version_conflict'; version := ev.access_rules_version; added := 0; removed := 0;
    RETURN NEXT; RETURN;
  END IF;
  v_prev := public.access_rules_snapshot(p_event_id);
  INSERT INTO public.access_rule_versions (event_id, version, rules_jsonb, published_by, published_at)
  VALUES (p_event_id, ev.access_rules_version, v_prev, NULL, p_now)
  ON CONFLICT DO NOTHING;

  DELETE FROM public.access_rules WHERE event_id = p_event_id;
  INSERT INTO public.access_rules (event_id, subject_kind, subject, room_id, window_start, window_end, effect)
  SELECT DISTINCT p_event_id, x.subject_kind, x.subject, x.room_id, x.window_start, x.window_end, x.effect
    FROM jsonb_to_recordset(p_rules) AS x(subject_kind public.access_subject_kind, subject text, room_id uuid,
                                          window_start timestamptz, window_end timestamptz, effect public.access_effect);

  v_new := ev.access_rules_version + 1;
  UPDATE public.events SET access_rules_version = v_new WHERE id = p_event_id;
  v_next := public.access_rules_snapshot(p_event_id);
  INSERT INTO public.access_rule_versions (event_id, version, rules_jsonb, published_by, published_at)
  VALUES (p_event_id, v_new, v_next, p_actor_id, p_now);

  status := 'ok'; version := v_new;
  SELECT count(*) INTO added FROM public.access_rules_minus(v_next, v_prev);
  SELECT count(*) INTO removed FROM public.access_rules_minus(v_prev, v_next);
  INSERT INTO public.audit_log (actor_id, action, target, meta_jsonb)
  VALUES (p_actor_id, 'access_rules.republish', 'event:' || p_event_id,
          jsonb_build_object('from_version', ev.access_rules_version, 'to_version', v_new, 'added', added, 'removed', removed))
  RETURNING id INTO audit_id;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

-- Differences between two stored versions (p_to_version null = the current rules).
CREATE OR REPLACE FUNCTION public.access_rules_diff(p_event_id uuid, p_from_version integer, p_to_version integer DEFAULT NULL)
RETURNS TABLE (change text, subject_kind text, subject text, room_id uuid, window_start timestamptz, window_end timestamptz, effect text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  a jsonb;
  b jsonb;
BEGIN
  SELECT v.rules_jsonb INTO a FROM public.access_rule_versions v WHERE v.event_id = p_event_id AND v.version = p_from_version;
  IF a IS NULL THEN
    RAISE EXCEPTION 'access-rule version % of event % is not stored', p_from_version, p_event_id USING ERRCODE = 'no_data_found';
  END IF;
  IF p_to_version IS NULL THEN
    b := public.access_rules_snapshot(p_event_id);
  ELSE
    SELECT v.rules_jsonb INTO b FROM public.access_rule_versions v WHERE v.event_id = p_event_id AND v.version = p_to_version;
    IF b IS NULL THEN
      RAISE EXCEPTION 'access-rule version % of event % is not stored', p_to_version, p_event_id USING ERRCODE = 'no_data_found';
    END IF;
  END IF;
  RETURN QUERY
    SELECT 'added'::text, m.* FROM public.access_rules_minus(b, a) m
    UNION ALL
    SELECT 'removed'::text, m.* FROM public.access_rules_minus(a, b) m
    ORDER BY 1, 2, 3, 4;
END;
$$;
--> statement-breakpoint

-- Differences between the current rules and a proposed list (before republishing).
CREATE OR REPLACE FUNCTION public.access_rules_diff_proposed(p_event_id uuid, p_rules jsonb)
RETURNS TABLE (change text, subject_kind text, subject text, room_id uuid, window_start timestamptz, window_end timestamptz, effect text)
LANGUAGE sql STABLE AS $$
  SELECT 'added'::text, m.* FROM public.access_rules_minus(public.access_rules_canonical(p_rules), public.access_rules_snapshot(p_event_id)) m
  UNION ALL
  SELECT 'removed'::text, m.* FROM public.access_rules_minus(public.access_rules_snapshot(p_event_id), public.access_rules_canonical(p_rules)) m
  ORDER BY 1, 2, 3, 4
$$;
--> statement-breakpoint

-- Entitlement: a permit covers p_at and no deny does (deny wins; no rule = no entry).
CREATE OR REPLACE FUNCTION public.access_permits(
  p_event_id uuid, p_subject_kind text, p_subject text, p_room_id uuid, p_at timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  WITH cover AS (
    SELECT a.effect FROM public.access_rules a
     WHERE a.event_id = p_event_id AND a.subject_kind::text = p_subject_kind AND a.subject = p_subject
       AND a.room_id = p_room_id
       AND (a.window_start IS NULL OR a.window_start <= p_at)
       AND (a.window_end IS NULL OR p_at < a.window_end)
  )
  SELECT EXISTS (SELECT 1 FROM cover WHERE effect = 'permit') AND NOT EXISTS (SELECT 1 FROM cover WHERE effect = 'deny')
$$;
--> statement-breakpoint

-- Resolves a credential's subject (tier through its registration, or role through its staff
-- user) and checks the rule. Reasons: ok | not_permitted | room_not_in_event | not_in_event |
-- credential_not_usable | unknown_credential.
CREATE OR REPLACE FUNCTION public.credential_may_enter(
  p_event_id uuid, p_credential_id uuid, p_room_id uuid, p_at timestamptz DEFAULT now()
) RETURNS TABLE (allowed boolean, reason text, subject_kind text, subject text)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE
  c public.credentials%ROWTYPE;
  v_event uuid;
BEGIN
  SELECT * INTO c FROM public.credentials WHERE id = p_credential_id;
  IF NOT FOUND THEN
    allowed := false; reason := 'unknown_credential'; RETURN NEXT; RETURN;
  END IF;
  IF c.registration_id IS NOT NULL THEN
    SELECT r.event_id, 'tier', r.tier::text INTO v_event, subject_kind, subject FROM public.registrations r WHERE r.id = c.registration_id;
    IF v_event <> p_event_id THEN
      allowed := false; reason := 'not_in_event'; RETURN NEXT; RETURN;
    END IF;
  ELSE
    SELECT 'role', u.role::text INTO subject_kind, subject FROM public.users u WHERE u.id = c.staff_user_id;
  END IF;
  IF c.state NOT IN ('issued', 'active') THEN
    allowed := false; reason := 'credential_not_usable'; RETURN NEXT; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.event_rooms er WHERE er.event_id = p_event_id AND er.room_id = p_room_id) THEN
    allowed := false; reason := 'room_not_in_event'; RETURN NEXT; RETURN;
  END IF;
  allowed := public.access_permits(p_event_id, subject_kind, subject, p_room_id, p_at);
  reason := CASE WHEN allowed THEN 'ok' ELSE 'not_permitted' END;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- F. Carriers and credentials
------------------------------------------------------------------------------------------------

-- State machines (01 §5.2), enforced on every UPDATE. Inserts may start in any state.
CREATE OR REPLACE FUNCTION public.credentials_guard_state() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT ((OLD.state, NEW.state) IN (
    ('issued'::public.credential_state, 'active'::public.credential_state),
    ('issued', 'suspended_review'), ('issued', 'revoked'), ('issued', 'replaced'),
    ('active', 'suspended_review'), ('active', 'revoked'), ('active', 'replaced'),
    ('suspended_review', 'active'), ('suspended_review', 'revoked'), ('suspended_review', 'replaced')
  )) THEN
    RAISE EXCEPTION 'credential % cannot move from % to %', OLD.id, OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER credentials_guard_state BEFORE UPDATE OF state ON public.credentials
FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state) EXECUTE FUNCTION public.credentials_guard_state();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.carriers_guard_state() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT ((OLD.state, NEW.state) IN (
    ('stock'::public.carrier_state, 'assigned'::public.carrier_state), ('stock', 'retired'),
    ('assigned', 'stock'), ('assigned', 'bound'), ('assigned', 'lost'), ('assigned', 'retired'),
    ('bound', 'active'), ('bound', 'lost'), ('bound', 'retired'),
    ('active', 'lost'), ('active', 'retired')
  )) THEN
    RAISE EXCEPTION 'carrier % cannot move from % to %', OLD.id, OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER carriers_guard_state BEFORE UPDATE OF state ON public.carriers
FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state) EXECUTE FUNCTION public.carriers_guard_state();
--> statement-breakpoint

-- Bulk import of band identifiers (already hashed). Bands enter `stock`. Duplicates — within the
-- list or already present among non-retired carriers — and malformed values are reported, not
-- fatal.
CREATE OR REPLACE FUNCTION public.carriers_import(
  p_identifiers text[], p_kind public.carrier_kind DEFAULT 'nfc', p_chip_profile public.chip_profile DEFAULT NULL
) RETURNS TABLE (inserted integer, duplicates text[], invalid text[])
LANGUAGE plpgsql AS $$
#variable_conflict use_column
BEGIN
  WITH input AS (
    SELECT x, ord, row_number() OVER (PARTITION BY x ORDER BY ord) AS nth
      FROM unnest(p_identifiers) WITH ORDINALITY AS u(x, ord)
  ),
  valid AS (
    SELECT x FROM input WHERE nth = 1 AND x ~ '^[A-Za-z0-9_-]{43}$'
  ),
  ins AS (
    INSERT INTO public.carriers (kind, identifier, chip_profile, state)
    SELECT p_kind, x, p_chip_profile, 'stock' FROM valid
    ON CONFLICT (kind, identifier) WHERE identifier IS NOT NULL AND state <> 'retired' DO NOTHING
    RETURNING identifier
  )
  SELECT (SELECT count(*) FROM ins)::integer,
         coalesce((SELECT array_agg(x ORDER BY x) FROM (
                     SELECT x FROM input WHERE nth > 1 AND x ~ '^[A-Za-z0-9_-]{43}$'
                     UNION ALL
                     SELECT v.x FROM valid v WHERE v.x NOT IN (SELECT identifier FROM ins)) d), '{}'),
         coalesce((SELECT array_agg(x ORDER BY ord) FROM input WHERE nth = 1 AND x !~ '^[A-Za-z0-9_-]{43}$'), '{}')
    INTO inserted, duplicates, invalid;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

-- Inventory counts per state (D8).
CREATE OR REPLACE FUNCTION public.carrier_inventory(p_kind public.carrier_kind DEFAULT 'nfc')
RETURNS TABLE (state text, count bigint)
LANGUAGE sql STABLE AS $$
  SELECT s.state::text, count(k.id)
    FROM unnest(enum_range(NULL::public.carrier_state)) AS s(state)
    LEFT JOIN public.carriers k ON k.state = s.state AND k.kind = p_kind
   GROUP BY s.state ORDER BY s.state
$$;
--> statement-breakpoint

-- Binds a stock band to a usable credential: stock → assigned, and → bound when p_confirm.
-- Status: bound | assigned | unknown_carrier | not_in_stock | credential_not_usable |
-- credential_has_carrier. Writes the audit entry and returns its id.
CREATE OR REPLACE FUNCTION public.carrier_bind(
  p_identifier text, p_credential_id uuid, p_actor_id uuid DEFAULT NULL, p_confirm boolean DEFAULT true,
  p_kind public.carrier_kind DEFAULT 'nfc', p_now timestamptz DEFAULT now()
) RETURNS TABLE (status text, carrier_id uuid, credential_id uuid, carrier_state text, audit_id bigint)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  k public.carriers%ROWTYPE;
  c public.credentials%ROWTYPE;
BEGIN
  credential_id := p_credential_id;
  SELECT * INTO k FROM public.carriers x
   WHERE x.kind = p_kind AND x.identifier = p_identifier AND x.state <> 'retired' FOR UPDATE;
  IF NOT FOUND THEN status := 'unknown_carrier'; RETURN NEXT; RETURN; END IF;
  carrier_id := k.id; carrier_state := k.state::text;
  IF k.state <> 'stock' THEN status := 'not_in_stock'; RETURN NEXT; RETURN; END IF;
  SELECT * INTO c FROM public.credentials x WHERE x.id = p_credential_id FOR UPDATE;
  IF NOT FOUND OR c.state NOT IN ('issued', 'active') THEN status := 'credential_not_usable'; RETURN NEXT; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.carriers x WHERE x.credential_id = p_credential_id AND x.kind = p_kind
               AND x.state IN ('assigned', 'bound', 'active')) THEN
    status := 'credential_has_carrier'; RETURN NEXT; RETURN;
  END IF;
  UPDATE public.carriers x SET state = 'assigned', credential_id = p_credential_id WHERE x.id = k.id;
  IF p_confirm THEN
    UPDATE public.carriers x SET state = 'bound', bound_at = p_now WHERE x.id = k.id;
  END IF;
  status := CASE WHEN p_confirm THEN 'bound' ELSE 'assigned' END;
  carrier_state := status;
  INSERT INTO public.audit_log (actor_id, action, target, meta_jsonb)
  VALUES (p_actor_id, CASE WHEN p_confirm THEN 'carrier.bind' ELSE 'carrier.assign' END, 'carrier:' || k.id,
          jsonb_build_object('credential_id', p_credential_id, 'kind', p_kind))
  RETURNING id INTO audit_id;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

-- Confirms an assigned band (assigned → bound).
CREATE OR REPLACE FUNCTION public.carrier_confirm(p_carrier_id uuid, p_actor_id uuid DEFAULT NULL, p_now timestamptz DEFAULT now())
RETURNS TABLE (status text, audit_id bigint)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
BEGIN
  UPDATE public.carriers x SET state = 'bound', bound_at = p_now WHERE x.id = p_carrier_id AND x.state = 'assigned';
  IF NOT FOUND THEN status := 'not_assigned'; RETURN NEXT; RETURN; END IF;
  status := 'bound';
  INSERT INTO public.audit_log (actor_id, action, target, meta_jsonb)
  VALUES (p_actor_id, 'carrier.bind', 'carrier:' || p_carrier_id, '{}'::jsonb) RETURNING id INTO audit_id;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

-- Swaps a credential's band for a stock one (damaged or lost band, credential kept): the current
-- band → p_disposition ('retired' or 'lost'), the new band → bound. If the old band was lost, the
-- credential stays valid only if the caller accepts that; use carrier_replace_lost() to also
-- re-issue the credential. Status: rebound | no_current_carrier | unknown_carrier | not_in_stock |
-- credential_not_usable.
CREATE OR REPLACE FUNCTION public.carrier_rebind(
  p_credential_id uuid, p_new_identifier text, p_disposition public.carrier_state DEFAULT 'retired',
  p_actor_id uuid DEFAULT NULL, p_kind public.carrier_kind DEFAULT 'nfc', p_now timestamptz DEFAULT now()
) RETURNS TABLE (status text, old_carrier_id uuid, new_carrier_id uuid, audit_ids bigint[])
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  old_k public.carriers%ROWTYPE;
  new_k public.carriers%ROWTYPE;
  c public.credentials%ROWTYPE;
  a1 bigint;
  a2 bigint;
BEGIN
  IF p_disposition NOT IN ('retired', 'lost') THEN
    RAISE EXCEPTION 'p_disposition must be retired or lost' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO c FROM public.credentials x WHERE x.id = p_credential_id FOR UPDATE;
  IF NOT FOUND OR c.state NOT IN ('issued', 'active') THEN status := 'credential_not_usable'; RETURN NEXT; RETURN; END IF;
  SELECT * INTO old_k FROM public.carriers x
   WHERE x.credential_id = p_credential_id AND x.kind = p_kind AND x.state IN ('assigned', 'bound', 'active') FOR UPDATE;
  IF NOT FOUND THEN status := 'no_current_carrier'; RETURN NEXT; RETURN; END IF;
  old_carrier_id := old_k.id;
  SELECT * INTO new_k FROM public.carriers x
   WHERE x.kind = p_kind AND x.identifier = p_new_identifier AND x.state <> 'retired' FOR UPDATE;
  IF NOT FOUND THEN status := 'unknown_carrier'; RETURN NEXT; RETURN; END IF;
  new_carrier_id := new_k.id;
  IF new_k.state <> 'stock' THEN status := 'not_in_stock'; RETURN NEXT; RETURN; END IF;

  UPDATE public.carriers x SET state = p_disposition WHERE x.id = old_k.id;
  UPDATE public.carriers x SET state = 'assigned', credential_id = p_credential_id WHERE x.id = new_k.id;
  UPDATE public.carriers x SET state = 'bound', bound_at = p_now WHERE x.id = new_k.id;
  INSERT INTO public.audit_log (actor_id, action, target, meta_jsonb)
  VALUES (p_actor_id, 'carrier.mark_' || p_disposition::text, 'carrier:' || old_k.id, jsonb_build_object('credential_id', p_credential_id))
  RETURNING id INTO a1;
  INSERT INTO public.audit_log (actor_id, action, target, meta_jsonb)
  VALUES (p_actor_id, 'carrier.rebind', 'carrier:' || new_k.id, jsonb_build_object('credential_id', p_credential_id, 'replaces', old_k.id))
  RETURNING id INTO a2;
  status := 'rebound'; audit_ids := ARRAY[a1, a2];
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

-- Lost band (01 §5.3): the band → lost, its credential → replaced, a new credential (same holder,
-- new reference p_new_credential_ref, zone state carried over) is issued with a portal-QR carrier,
-- the old credential's other carriers are retired, and a stock band is bound to the new credential.
-- Four audit entries, in order: carrier.mark_lost, credential.replace, credential.reissue,
-- carrier.bind. Status: replaced | unknown_carrier | carrier_not_live | not_in_stock |
-- credential_not_usable.
-- The new credential gets a new ephemeral id at its next scan, so the old one's room presence does
-- not carry over (the person is counted again on their next admission).
CREATE OR REPLACE FUNCTION public.carrier_replace_lost(
  p_lost_identifier text, p_new_identifier text, p_new_credential_ref text,
  p_actor_id uuid DEFAULT NULL, p_now timestamptz DEFAULT now()
) RETURNS TABLE (
  status text, old_carrier_id uuid, new_carrier_id uuid, old_credential_id uuid, new_credential_id uuid, audit_ids bigint[]
)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  lost public.carriers%ROWTYPE;
  band public.carriers%ROWTYPE;
  c public.credentials%ROWTYPE;
  v_new uuid;
  a bigint[] := '{}';
  x bigint;
BEGIN
  SELECT * INTO lost FROM public.carriers k
   WHERE k.kind = 'nfc' AND k.identifier = p_lost_identifier AND k.state <> 'retired' FOR UPDATE;
  IF NOT FOUND THEN status := 'unknown_carrier'; RETURN NEXT; RETURN; END IF;
  old_carrier_id := lost.id;
  IF lost.state NOT IN ('assigned', 'bound', 'active') THEN status := 'carrier_not_live'; RETURN NEXT; RETURN; END IF;
  SELECT * INTO c FROM public.credentials k WHERE k.id = lost.credential_id FOR UPDATE;
  old_credential_id := c.id;
  IF c.state NOT IN ('issued', 'active', 'suspended_review') THEN status := 'credential_not_usable'; RETURN NEXT; RETURN; END IF;
  SELECT * INTO band FROM public.carriers k
   WHERE k.kind = 'nfc' AND k.identifier = p_new_identifier AND k.state <> 'retired' FOR UPDATE;
  IF NOT FOUND THEN status := 'unknown_carrier'; new_carrier_id := NULL; RETURN NEXT; RETURN; END IF;
  new_carrier_id := band.id;
  IF band.state <> 'stock' THEN status := 'not_in_stock'; RETURN NEXT; RETURN; END IF;

  UPDATE public.carriers k SET state = 'lost' WHERE k.id = lost.id;
  INSERT INTO public.audit_log (actor_id, action, target, meta_jsonb)
  VALUES (p_actor_id, 'carrier.mark_lost', 'carrier:' || lost.id, jsonb_build_object('credential_id', c.id)) RETURNING id INTO x;
  a := a || x;

  UPDATE public.credentials k SET state = 'replaced' WHERE k.id = c.id;
  UPDATE public.carriers k SET state = 'retired'
   WHERE k.credential_id = c.id AND k.id <> lost.id AND k.state IN ('assigned', 'bound', 'active');
  INSERT INTO public.credentials (registration_id, staff_user_id, token_hash, state, zone_state, issued_at)
  VALUES (c.registration_id, c.staff_user_id, p_new_credential_ref, 'active', c.zone_state, p_now)
  RETURNING id INTO v_new;
  UPDATE public.credentials k SET replaced_by_id = v_new WHERE k.id = c.id;
  new_credential_id := v_new;
  INSERT INTO public.audit_log (actor_id, action, target, meta_jsonb)
  VALUES (p_actor_id, 'credential.replace', 'credential:' || c.id, jsonb_build_object('replaced_by', v_new)) RETURNING id INTO x;
  a := a || x;
  INSERT INTO public.audit_log (actor_id, action, target, meta_jsonb)
  VALUES (p_actor_id, 'credential.reissue', 'credential:' || v_new, jsonb_build_object('replaces', c.id)) RETURNING id INTO x;
  a := a || x;

  INSERT INTO public.carriers (credential_id, kind, state, bound_at) VALUES (v_new, 'qr_portal', 'active', p_now);
  UPDATE public.carriers k SET state = 'assigned', credential_id = v_new WHERE k.id = band.id;
  UPDATE public.carriers k SET state = 'bound', bound_at = p_now WHERE k.id = band.id;
  INSERT INTO public.audit_log (actor_id, action, target, meta_jsonb)
  VALUES (p_actor_id, 'carrier.bind', 'carrier:' || band.id, jsonb_build_object('credential_id', v_new)) RETURNING id INTO x;
  a := a || x;

  status := 'replaced'; audit_ids := a;
  RETURN NEXT;
END;
$$;
