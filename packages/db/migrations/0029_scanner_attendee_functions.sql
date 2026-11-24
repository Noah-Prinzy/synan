-- 0029 — scanner and attendee gaps: functions, row-level security, grants (hand-written).
--
--   A. Refresh rotation with a reuse grace window. A refresh token presented again shortly after it
--      was exchanged, by the same client (user agent and IP prefix of the exchange), while the token
--      it was exchanged for is still unused, is a lost response, not theft: the unused child is
--      superseded (marked rotated, so presenting it later is reuse) and a fresh sibling is issued.
--      Outside the window, from another client, or once the child has been used, it is reuse as
--      before and the whole family is revoked. Never two live tokens in a family at once.
--   B. Heartbeats carry the `issued_at` of the allowlist the device holds; gate health reports the
--      oldest among the gate's devices heard from in the last 15 minutes, and whether it is stale.
--   C. pii_vault.pending_registrations: forced row-level security, system scope only; app_vault may
--      read, create and delete (never update) rows.
--   D. scan_voids is append-only (rows go only with the event's scans at the purge).

------------------------------------------------------------------------------------------------
-- A. Refresh rotation with a grace window
------------------------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.auth_rotate_session_by_kind(text, text, interval, interval, text, inet, timestamptz);
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.auth_rotate_session(text, text, timestamptz, text, inet, timestamptz);
--> statement-breakpoint

-- Statuses as in 0004; `reissued` is true when a rotated token was exchanged again inside the grace window.
CREATE FUNCTION public.auth_rotate_session(
  p_token_hash text, p_new_token_hash text, p_expires_at timestamptz,
  p_user_agent text DEFAULT NULL, p_ip inet DEFAULT NULL, p_now timestamptz DEFAULT now(),
  p_grace interval DEFAULT '0 seconds'
) RETURNS TABLE (
  status text, session_id uuid, family_id uuid, user_id uuid, attendee_id uuid,
  mfa_at timestamptz, expires_at timestamptz, reissued boolean
)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  s public.auth_sessions%ROWTYPE;
  c public.auth_sessions%ROWTYPE;
  v_new uuid;
BEGIN
  reissued := false;
  SELECT * INTO s FROM public.auth_sessions a WHERE a.token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN
    status := 'invalid'; RETURN NEXT; RETURN;
  END IF;
  session_id := s.id; family_id := s.family_id; user_id := s.user_id; attendee_id := s.attendee_id;
  mfa_at := s.mfa_at; expires_at := s.expires_at;

  IF s.revoked_at IS NOT NULL THEN
    status := 'revoked'; RETURN NEXT; RETURN;
  END IF;
  IF s.rotated_at IS NOT NULL THEN
    IF p_grace > interval '0 seconds' AND s.rotated_at > p_now - p_grace THEN
      SELECT * INTO c FROM public.auth_sessions a
       WHERE a.parent_id = s.id AND a.rotated_at IS NULL AND a.revoked_at IS NULL AND a.expires_at > p_now
       ORDER BY a.created_at DESC LIMIT 1
       FOR UPDATE;
      IF FOUND
         AND c.user_agent IS NOT DISTINCT FROM left(p_user_agent, 200)
         AND c.ip_prefix IS NOT DISTINCT FROM public.auth_ip_prefix(p_ip) THEN
        -- The unused child is superseded: presenting it later counts as reuse.
        UPDATE public.auth_sessions a SET rotated_at = p_now WHERE a.id = c.id;
        INSERT INTO public.auth_sessions
          (family_id, parent_id, user_id, attendee_id, token_hash, mfa_at, created_at, expires_at, user_agent, ip_prefix)
        VALUES
          (s.family_id, s.id, s.user_id, s.attendee_id, p_new_token_hash, s.mfa_at, p_now, p_expires_at,
           left(p_user_agent, 200), public.auth_ip_prefix(p_ip))
        RETURNING id INTO v_new;
        status := 'rotated'; session_id := v_new; expires_at := p_expires_at; reissued := true;
        RETURN NEXT; RETURN;
      END IF;
    END IF;
    UPDATE public.auth_sessions a SET revoked_at = p_now, revoke_reason = 'reuse_detected'
     WHERE a.family_id = s.family_id AND a.revoked_at IS NULL;
    status := 'reuse_detected'; RETURN NEXT; RETURN;
  END IF;
  IF s.expires_at <= p_now THEN
    status := 'expired'; RETURN NEXT; RETURN;
  END IF;

  UPDATE public.auth_sessions a SET rotated_at = p_now WHERE a.id = s.id;
  INSERT INTO public.auth_sessions
    (family_id, parent_id, user_id, attendee_id, token_hash, mfa_at, created_at, expires_at, user_agent, ip_prefix)
  VALUES
    (s.family_id, s.id, s.user_id, s.attendee_id, p_new_token_hash, s.mfa_at, p_now, p_expires_at,
     left(p_user_agent, 200), public.auth_ip_prefix(p_ip))
  RETURNING id INTO v_new;
  status := 'rotated'; session_id := v_new; expires_at := p_expires_at;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION public.auth_rotate_session_by_kind(
  p_token_hash text, p_new_token_hash text, p_user_ttl interval, p_attendee_ttl interval,
  p_user_agent text DEFAULT NULL, p_ip inet DEFAULT NULL, p_now timestamptz DEFAULT now(),
  p_grace interval DEFAULT '0 seconds'
) RETURNS TABLE (
  status text, session_id uuid, family_id uuid, user_id uuid, attendee_id uuid,
  mfa_at timestamptz, expires_at timestamptz, reissued boolean
)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  v_user uuid;
  v_found boolean;
BEGIN
  -- Lock first, so the lifetime and the exchange are decided on the same row state.
  SELECT a.user_id, true INTO v_user, v_found
    FROM public.auth_sessions a WHERE a.token_hash = p_token_hash FOR UPDATE;
  RETURN QUERY
    SELECT * FROM public.auth_rotate_session(
      p_token_hash, p_new_token_hash,
      p_now + CASE WHEN v_found AND v_user IS NULL THEN p_attendee_ttl ELSE p_user_ttl END,
      p_user_agent, p_ip, p_now, p_grace);
END;
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- B. Allowlist age on heartbeats and in gate health
------------------------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.device_heartbeat(uuid, uuid, integer, integer, text, inet, timestamptz);
--> statement-breakpoint
-- As in 0014, plus the allowlist the device holds (null keeps the last one reported).
CREATE FUNCTION public.device_heartbeat(
  p_device_id uuid, p_checkpoint_id uuid DEFAULT NULL, p_clock_offset_ms integer DEFAULT NULL, p_queue_depth integer DEFAULT NULL,
  p_app_version text DEFAULT NULL, p_ip inet DEFAULT NULL, p_now timestamptz DEFAULT now(),
  p_allowlist_issued_at timestamptz DEFAULT NULL
) RETURNS TABLE (status text)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  d public.devices%ROWTYPE;
BEGIN
  SELECT * INTO d FROM public.devices x WHERE x.id = p_device_id;
  IF NOT FOUND THEN status := 'unknown_device'; RETURN NEXT; RETURN; END IF;
  IF d.state NOT IN ('active', 'maintenance') THEN status := 'not_active'; RETURN NEXT; RETURN; END IF;
  UPDATE public.devices x SET last_heartbeat_at = p_now, last_clock_offset_ms = p_clock_offset_ms,
         last_queue_depth = p_queue_depth, app_version = coalesce(p_app_version, x.app_version),
         last_ip_prefix = coalesce(public.auth_ip_prefix(p_ip), x.last_ip_prefix),
         allowlist_issued_at = coalesce(p_allowlist_issued_at, x.allowlist_issued_at)
   WHERE x.id = p_device_id;
  IF coalesce(p_checkpoint_id, d.checkpoint_id) IS NOT NULL THEN
    UPDATE public.checkpoints c SET last_heartbeat_at = p_now, last_clock_offset_ms = p_clock_offset_ms
     WHERE c.id = coalesce(p_checkpoint_id, d.checkpoint_id);
  END IF;
  status := 'ok';
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

DROP FUNCTION IF EXISTS public.gate_health(uuid, uuid, timestamptz);
--> statement-breakpoint
-- As in 0022, plus the oldest allowlist among the gate's active devices heard from in the last 15
-- minutes, and whether it is older than 15 minutes (the offline fail-open window, O-05).
CREATE FUNCTION public.gate_health(p_venue_id uuid, p_event_id uuid DEFAULT NULL, p_now timestamptz DEFAULT now())
RETURNS TABLE (
  checkpoint_id uuid, label text, direction text, perimeter boolean, hardware_id text,
  link_state text, last_heartbeat_at timestamptz, heartbeat_age_s integer, clock_offset_ms integer, clock_fault boolean,
  queue_depth integer, last_scan_at timestamptz, scans_last_15m bigint, staff_on_duty bigint, "position" jsonb,
  allowlist_issued_at timestamptz, allowlist_stale boolean
)
LANGUAGE sql STABLE AS $$
  SELECT g.*, g.allowlist_issued_at IS NOT NULL AND g.allowlist_issued_at < p_now - interval '15 minutes'
    FROM (
      SELECT c.id AS cp_id, c.label AS label, c.direction::text AS dir, c.perimeter_bool AS perimeter, c.hardware_id AS hw,
             CASE WHEN c.last_heartbeat_at IS NULL THEN 'unknown'
                  WHEN p_now - c.last_heartbeat_at > interval '60 seconds' THEN 'offline' ELSE 'online' END AS link,
             c.last_heartbeat_at AS last_heartbeat_at,
             CASE WHEN c.last_heartbeat_at IS NULL THEN NULL ELSE floor(extract(epoch FROM (p_now - c.last_heartbeat_at)))::integer END AS age_s,
             c.last_clock_offset_ms AS offset_ms,
             coalesce(abs(c.last_clock_offset_ms) > 120000, false) AS fault,
             (SELECT max(d.last_queue_depth) FROM public.devices d WHERE d.checkpoint_id = c.id AND d.state = 'active') AS depth,
             (SELECT max(s.corrected_at) FROM public.scans s WHERE p_event_id IS NOT NULL AND s.event_id = p_event_id AND s.checkpoint_id = c.id) AS last_scan,
             (SELECT count(*) FROM public.scans s WHERE p_event_id IS NOT NULL AND s.event_id = p_event_id AND s.checkpoint_id = c.id
                 AND s.corrected_at > p_now - interval '15 minutes' AND s.corrected_at <= p_now AND s.result <> 'implied_exit') AS recent,
             (SELECT count(*) FROM public.staff_on_duty(c.id, p_now)) AS on_duty,
             c.position_jsonb AS pos,
             (SELECT min(d.allowlist_issued_at) FROM public.devices d
               WHERE d.checkpoint_id = c.id AND d.state = 'active' AND d.allowlist_issued_at IS NOT NULL
                 AND d.last_heartbeat_at > p_now - interval '15 minutes') AS allowlist_issued_at
        FROM public.checkpoints c
       WHERE c.venue_id = p_venue_id
    ) g
   ORDER BY (g.last_heartbeat_at IS NULL OR p_now - g.last_heartbeat_at > interval '60 seconds') DESC, g.label
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- C. Pending registrations in the identity vault
------------------------------------------------------------------------------------------------

ALTER TABLE pii_vault.pending_registrations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE pii_vault.pending_registrations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY pending_registrations_select ON pii_vault.pending_registrations FOR SELECT
  USING (pii_vault.current_scope() = 'system');
--> statement-breakpoint
CREATE POLICY pending_registrations_insert ON pii_vault.pending_registrations FOR INSERT
  WITH CHECK (pii_vault.current_scope() = 'system');
--> statement-breakpoint
CREATE POLICY pending_registrations_delete ON pii_vault.pending_registrations FOR DELETE
  USING (pii_vault.current_scope() = 'system');
--> statement-breakpoint
REVOKE ALL ON pii_vault.pending_registrations FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON pii_vault.pending_registrations TO app_vault;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- D. scan_voids is append-only
------------------------------------------------------------------------------------------------

CREATE FUNCTION public.scan_voids_no_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'scan_voids is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER scan_voids_no_update BEFORE UPDATE ON public.scan_voids
  FOR EACH ROW EXECUTE FUNCTION public.scan_voids_no_update();
