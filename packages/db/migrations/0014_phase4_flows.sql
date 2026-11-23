-- 0014 — Phase 4 database support, part 2 (hand-written):
--   A. Registration: invitations (create, single-use redeem, expiry), attendee lookup by blind index
--      for the general role, credential issue, tier change, registration state.
--   B. Attendee data requests (export / erasure queue).
--   C. Webhooks: fan-out, claim with lease, attempt recording with backoff; secret encrypted.
--   D. Report jobs (event_reports lifecycle).
--   E. Occupancy session-end resets; events due for purge.
--   F. Staff: on duty, current assignments, handover summary and handover.
--   G. Devices: heartbeat, gate health, device-token authentication (fixed readers, O-17).
--   H. Events: duplication and the publish readiness checklist.
--   I. Background jobs (pg-boss): owner role app_jobs and grants.

------------------------------------------------------------------------------------------------
-- A. Registration
------------------------------------------------------------------------------------------------

-- The id of the attendee with this email blind index, or null. No identity is returned, so the
-- general role (which cannot read pii_vault.attendees) may call it to link a registration to an
-- existing person. Every configured blind-index key's value may be passed.
CREATE OR REPLACE FUNCTION pii_vault.attendee_id_by_email_hash(p_email_hashes text[]) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pii_vault, pg_temp AS $$
  SELECT a.id FROM pii_vault.attendees a WHERE a.email_hash = ANY (p_email_hashes) AND a.erased_at IS NULL LIMIT 1
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION pii_vault.attendee_id_by_email_hash(text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION pii_vault.attendee_id_by_email_hash(text[]) TO app_api, app_vault;
--> statement-breakpoint

-- Creates a Private Invitation unless one is already outstanding for this recipient.
-- Status: created | already_open.
CREATE OR REPLACE FUNCTION public.invitation_create(
  p_event_id uuid, p_email_hash text, p_token_hash text, p_expires_at timestamptz,
  p_actor_id uuid DEFAULT NULL, p_now timestamptz DEFAULT now()
) RETURNS TABLE (status text, invitation_id uuid)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
BEGIN
  INSERT INTO public.invitations (event_id, email_hash, token_hash, state, expires_at, created_at)
  VALUES (p_event_id, p_email_hash, p_token_hash, 'sent', p_expires_at, p_now)
  ON CONFLICT (event_id, email_hash) WHERE state = 'sent' DO NOTHING
  RETURNING id INTO invitation_id;
  IF invitation_id IS NULL THEN
    SELECT i.id INTO invitation_id FROM public.invitations i
     WHERE i.event_id = p_event_id AND i.email_hash = p_email_hash AND i.state = 'sent';
    status := 'already_open';
  ELSE
    status := 'created';
    INSERT INTO public.audit_log (actor_id, action, target, meta_jsonb)
    VALUES (p_actor_id, 'invitation.create', 'invitation:' || invitation_id, jsonb_build_object('event_id', p_event_id));
  END IF;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

-- Redeems an invitation exactly once, only for the address it was sent to (p_email_hashes: the
-- blind index of the address the RSVP gives, under every configured key).
-- Status: redeemed | invalid | wrong_recipient | expired | already_redeemed | revoked.
CREATE OR REPLACE FUNCTION public.invitation_redeem(p_token_hash text, p_email_hashes text[], p_now timestamptz DEFAULT now())
RETURNS TABLE (status text, invitation_id uuid, event_id uuid, email_hash text)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  i public.invitations%ROWTYPE;
BEGIN
  UPDATE public.invitations x SET state = 'redeemed', redeemed_at = p_now
   WHERE x.token_hash = p_token_hash AND x.state = 'sent' AND x.expires_at > p_now AND x.email_hash = ANY (p_email_hashes)
  RETURNING x.* INTO i;
  IF FOUND THEN
    status := 'redeemed';
  ELSE
    SELECT * INTO i FROM public.invitations x WHERE x.token_hash = p_token_hash;
    IF NOT FOUND THEN status := 'invalid'; RETURN NEXT; RETURN; END IF;
    status := CASE
      WHEN i.state = 'redeemed' THEN 'already_redeemed'
      WHEN i.state = 'revoked' THEN 'revoked'
      WHEN i.state = 'expired' OR i.expires_at <= p_now THEN 'expired'
      ELSE 'wrong_recipient' END;
  END IF;
  invitation_id := i.id; event_id := i.event_id; email_hash := i.email_hash;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

-- Marks outstanding invitations past their expiry as expired (scheduled job). Returns the count.
CREATE OR REPLACE FUNCTION public.invitations_expire(p_now timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  UPDATE public.invitations SET state = 'expired' WHERE state = 'sent' AND expires_at <= p_now;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
--> statement-breakpoint

-- Issues a credential (reference p_ref, 22 base64url) with its portal-QR carrier, for a
-- registration or a staff user. Status: issued | already_has_credential.
CREATE OR REPLACE FUNCTION public.credential_issue(
  p_registration_id uuid, p_staff_user_id uuid, p_ref text, p_now timestamptz DEFAULT now()
) RETURNS TABLE (status text, credential_id uuid)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
BEGIN
  SELECT c.id INTO credential_id FROM public.credentials c
   WHERE (c.registration_id = p_registration_id OR c.staff_user_id = p_staff_user_id)
     AND c.state IN ('issued', 'active', 'suspended_review');
  IF credential_id IS NOT NULL THEN status := 'already_has_credential'; RETURN NEXT; RETURN; END IF;
  INSERT INTO public.credentials (registration_id, staff_user_id, token_hash, state, issued_at)
  VALUES (p_registration_id, p_staff_user_id, p_ref, 'issued', p_now) RETURNING id INTO credential_id;
  INSERT INTO public.carriers (credential_id, kind, state, bound_at) VALUES (credential_id, 'qr_portal', 'active', p_now);
  status := 'issued';
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

-- Operator tier change (privileged, MFA checked by the API): audited with the reason; the
-- revocation epoch advances through the registrations trigger. Status: changed | unchanged | not_found.
CREATE OR REPLACE FUNCTION public.registration_change_tier(
  p_registration_id uuid, p_tier public.attendee_tier, p_actor_id uuid, p_reason text, p_mfa_at timestamptz DEFAULT NULL
) RETURNS TABLE (status text, from_tier text, audit_id bigint)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  r public.registrations%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'a tier change needs an actor and a reason' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO r FROM public.registrations x WHERE x.id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN status := 'not_found'; RETURN NEXT; RETURN; END IF;
  from_tier := r.tier::text;
  IF r.tier = p_tier THEN status := 'unchanged'; RETURN NEXT; RETURN; END IF;
  UPDATE public.registrations x SET tier = p_tier WHERE x.id = p_registration_id;
  INSERT INTO public.audit_log (actor_id, action, target, meta_jsonb)
  VALUES (p_actor_id, 'registration.tier_change', 'registration:' || p_registration_id,
          jsonb_build_object('from', r.tier, 'to', p_tier, 'reason', p_reason, 'mfa_at', p_mfa_at))
  RETURNING id INTO audit_id;
  status := 'changed';
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

-- Registration state changes: pending_approval → confirmed (VIP approval) | cancelled;
-- confirmed → cancelled. Cancelling revokes the live credential. Audited.
-- Status: changed | unchanged | not_found | not_allowed.
CREATE OR REPLACE FUNCTION public.registration_set_state(
  p_registration_id uuid, p_state public.registration_state, p_actor_id uuid DEFAULT NULL, p_now timestamptz DEFAULT now()
) RETURNS TABLE (status text, from_state text, audit_id bigint)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  r public.registrations%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.registrations x WHERE x.id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN status := 'not_found'; RETURN NEXT; RETURN; END IF;
  from_state := r.state::text;
  IF r.state = p_state THEN status := 'unchanged'; RETURN NEXT; RETURN; END IF;
  IF NOT ((r.state, p_state) IN (('pending_approval'::public.registration_state, 'confirmed'::public.registration_state),
                                 ('pending_approval', 'cancelled'), ('confirmed', 'cancelled'))) THEN
    status := 'not_allowed'; RETURN NEXT; RETURN;
  END IF;
  UPDATE public.registrations x SET state = p_state WHERE x.id = p_registration_id;
  IF p_state = 'cancelled' THEN
    UPDATE public.credentials c SET state = 'revoked', revoked_at = p_now
     WHERE c.registration_id = p_registration_id AND c.state IN ('issued', 'active', 'suspended_review');
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target, meta_jsonb)
  VALUES (p_actor_id, 'registration.state', 'registration:' || p_registration_id, jsonb_build_object('from', r.state, 'to', p_state))
  RETURNING id INTO audit_id;
  status := 'changed';
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- B. Data requests
------------------------------------------------------------------------------------------------

-- Opens a request, or returns the one already open of that kind. Status: opened | already_open.
CREATE OR REPLACE FUNCTION public.data_request_open(p_attendee_id uuid, p_kind public.data_request_kind, p_now timestamptz DEFAULT now())
RETURNS TABLE (status text, request_id uuid)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
BEGIN
  INSERT INTO public.data_requests (attendee_id, kind, requested_at) VALUES (p_attendee_id, p_kind, p_now)
  ON CONFLICT (attendee_id, kind) WHERE state IN ('requested', 'in_progress') DO NOTHING
  RETURNING id INTO request_id;
  IF request_id IS NULL THEN
    SELECT d.id INTO request_id FROM public.data_requests d
     WHERE d.attendee_id = p_attendee_id AND d.kind = p_kind AND d.state IN ('requested', 'in_progress');
    status := 'already_open';
  ELSE
    status := 'opened';
  END IF;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

-- Claims the oldest requested item (optionally of one kind) for processing; concurrent workers
-- never get the same row.
CREATE OR REPLACE FUNCTION public.data_request_claim(
  p_kind public.data_request_kind DEFAULT NULL, p_handler uuid DEFAULT NULL, p_now timestamptz DEFAULT now()
) RETURNS SETOF public.data_requests
LANGUAGE sql AS $$
  UPDATE public.data_requests d SET state = 'in_progress', started_at = p_now, handled_by = coalesce(p_handler, d.handled_by)
   WHERE d.id = (SELECT x.id FROM public.data_requests x
                  WHERE x.state = 'requested' AND (p_kind IS NULL OR x.kind = p_kind)
                  ORDER BY x.requested_at FOR UPDATE SKIP LOCKED LIMIT 1)
  RETURNING d.*
$$;
--> statement-breakpoint

-- Finishes a request: completed (with the export's object key) or rejected (with a note).
-- An erasure also revokes the attendee's sign-in sessions and writes an audit entry.
CREATE OR REPLACE FUNCTION public.data_request_finish(
  p_request_id uuid, p_state public.data_request_state, p_object_key text DEFAULT NULL, p_note text DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL, p_now timestamptz DEFAULT now()
) RETURNS TABLE (status text)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  d public.data_requests%ROWTYPE;
BEGIN
  IF p_state NOT IN ('completed', 'rejected') THEN
    RAISE EXCEPTION 'finish with completed or rejected' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE public.data_requests x SET state = p_state, completed_at = p_now, object_key = coalesce(p_object_key, x.object_key),
         note = coalesce(p_note, x.note), handled_by = coalesce(p_actor_id, x.handled_by)
   WHERE x.id = p_request_id AND x.state IN ('requested', 'in_progress')
  RETURNING x.* INTO d;
  IF NOT FOUND THEN status := 'not_open'; RETURN NEXT; RETURN; END IF;
  IF d.kind = 'erasure' AND p_state = 'completed' THEN
    PERFORM public.auth_revoke_holder(NULL, d.attendee_id, 'erasure', p_now);
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target, meta_jsonb)
  VALUES (p_actor_id, 'data_request.' || p_state::text, 'data_request:' || d.id, jsonb_build_object('kind', d.kind));
  status := p_state::text;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- C. Webhooks
------------------------------------------------------------------------------------------------

-- The signing secret is an encrypted envelope (bound to the endpoint row). Enforced now: nothing
-- writes plaintext secrets.
ALTER TABLE public.webhook_endpoints ADD CONSTRAINT webhook_endpoints_secret_encrypted
  CHECK (secret ~ '^ev1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$') NOT VALID;
--> statement-breakpoint
ALTER TABLE public.webhook_endpoints VALIDATE CONSTRAINT webhook_endpoints_secret_encrypted;
--> statement-breakpoint

-- Fans one event out to every active endpoint of the organisation subscribed to it ('*' = all).
CREATE OR REPLACE FUNCTION public.webhook_enqueue(
  p_org_id uuid, p_event text, p_payload jsonb, p_alert_id uuid DEFAULT NULL, p_now timestamptz DEFAULT now()
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  INSERT INTO public.webhook_deliveries (endpoint_id, event, payload, alert_id, next_attempt_at, created_at)
  SELECT w.id, p_event, p_payload, p_alert_id, p_now, p_now
    FROM public.webhook_endpoints w
   WHERE w.org_id = p_org_id AND w.active AND (p_event = ANY (w.events) OR '*' = ANY (w.events));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
--> statement-breakpoint

-- Claims due deliveries for sending: pending and due, or in flight with a lapsed lease (a worker
-- died). Concurrent workers never claim the same row.
CREATE OR REPLACE FUNCTION public.webhook_claim(p_limit integer DEFAULT 20, p_lease interval DEFAULT '2 minutes', p_now timestamptz DEFAULT now())
RETURNS TABLE (delivery_id uuid, endpoint_id uuid, url text, secret text, event text, payload jsonb, attempt integer)
LANGUAGE sql AS $$
  WITH c AS (
    SELECT d.id FROM public.webhook_deliveries d
     WHERE (d.state = 'pending' AND d.next_attempt_at <= p_now)
        OR (d.state = 'in_flight' AND d.lease_until <= p_now)
     ORDER BY d.next_attempt_at
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  ),
  u AS (
    UPDATE public.webhook_deliveries d SET state = 'in_flight', lease_until = p_now + p_lease
      FROM c WHERE d.id = c.id
    RETURNING d.id, d.endpoint_id, d.event, d.payload, d.attempt
  )
  SELECT u.id, u.endpoint_id, w.url, w.secret, u.event, u.payload, u.attempt
    FROM u JOIN public.webhook_endpoints w ON w.id = u.endpoint_id
$$;
--> statement-breakpoint

-- Records one attempt. Success → succeeded. Failure → retried with exponential backoff
-- (30 s × 2^(attempt−1), at most 1 h) until p_max_attempts, then dead.
CREATE OR REPLACE FUNCTION public.webhook_record_attempt(
  p_delivery_id uuid, p_ok boolean, p_response_code integer DEFAULT NULL, p_error text DEFAULT NULL,
  p_duration_ms integer DEFAULT NULL, p_max_attempts integer DEFAULT 8, p_now timestamptz DEFAULT now()
) RETURNS TABLE (state text, attempt integer, next_attempt_at timestamptz)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  d public.webhook_deliveries%ROWTYPE;
  n integer;
BEGIN
  SELECT * INTO d FROM public.webhook_deliveries x WHERE x.id = p_delivery_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'webhook delivery % does not exist', p_delivery_id USING ERRCODE = 'no_data_found';
  END IF;
  n := d.attempt + 1;
  UPDATE public.webhook_deliveries x SET
    attempt = n,
    response_code = p_response_code,
    last_error = CASE WHEN p_ok THEN NULL ELSE left(p_error, 500) END,
    last_attempt_at = p_now,
    lease_until = NULL,
    attempts_jsonb = x.attempts_jsonb || jsonb_build_array(jsonb_build_object(
      'at', p_now, 'response_code', p_response_code, 'error', left(p_error, 500), 'ms', p_duration_ms)),
    state = (CASE WHEN p_ok THEN 'succeeded' WHEN n >= p_max_attempts THEN 'dead' ELSE 'pending' END)::public.webhook_delivery_state,
    delivered_at = CASE WHEN p_ok THEN p_now END,
    next_attempt_at = CASE WHEN p_ok OR n >= p_max_attempts THEN x.next_attempt_at
                           ELSE p_now + least(interval '1 hour', interval '30 seconds' * power(2, n - 1)) END
   WHERE x.id = p_delivery_id
  RETURNING x.state::text, x.attempt, x.next_attempt_at INTO state, attempt, next_attempt_at;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- D. Report jobs
------------------------------------------------------------------------------------------------

-- Claims the oldest queued report for building (queued → running).
CREATE OR REPLACE FUNCTION public.report_claim(p_now timestamptz DEFAULT now()) RETURNS SETOF public.event_reports
LANGUAGE sql AS $$
  UPDATE public.event_reports r SET state = 'running', started_at = p_now
   WHERE r.id = (SELECT x.id FROM public.event_reports x WHERE x.state = 'queued'
                  ORDER BY x.created_at FOR UPDATE SKIP LOCKED LIMIT 1)
  RETURNING r.*
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- E. Occupancy session-end resets; events due for purge
------------------------------------------------------------------------------------------------

-- Applies the session-end reset (D-10) for every session of the event that has ended by p_now in
-- a room that is not continuously occupied: an anchor adjustment (set_to 0, reason session_end) at
-- the session's end, recording the change it made. Idempotent: a room and end time already reset
-- are skipped. Returns the resets written.
CREATE OR REPLACE FUNCTION public.occupancy_apply_session_resets(p_event_id uuid, p_now timestamptz DEFAULT now())
RETURNS TABLE (room_id uuid, at timestamptz, delta integer)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  r record;
  lvl integer;
BEGIN
  FOR r IN
    SELECT DISTINCT s.room_id AS rid, s.ends_at AS t
      FROM public.sessions s JOIN public.rooms rm ON rm.id = s.room_id
     WHERE s.event_id = p_event_id AND s.ends_at <= p_now AND NOT rm.continuous_bool
       AND NOT EXISTS (SELECT 1 FROM public.occupancy_adjustments a
                        WHERE a.event_id = p_event_id AND a.room_id = s.room_id AND a.reason = 'session_end' AND a.at = s.ends_at)
     ORDER BY 2, 1
  LOOP
    SELECT o.occupancy INTO lvl FROM public.room_occupancy(p_event_id, r.t - interval '1 microsecond') o WHERE o.room_id = r.rid;
    INSERT INTO public.occupancy_adjustments (event_id, room_id, delta, set_to, reason, at, note)
    VALUES (p_event_id, r.rid, -coalesce(lvl, 0), 0, 'session_end', r.t, 'session ended');
    room_id := r.rid; at := r.t; delta := -coalesce(lvl, 0);
    RETURN NEXT;
  END LOOP;
END;
$$;
--> statement-breakpoint

-- Closed or archived events whose grace period has run out and that are not purged yet
-- (p_due_only false: every closed, unpurged event with its due time — the Settings screen).
CREATE OR REPLACE FUNCTION public.events_due_for_purge(
  p_now timestamptz DEFAULT now(), p_org_id uuid DEFAULT NULL, p_due_only boolean DEFAULT true
) RETURNS TABLE (event_id uuid, org_id uuid, slug text, closed_at timestamptz, due_at timestamptz, due boolean)
LANGUAGE sql STABLE AS $$
  SELECT e.id, e.org_id, e.slug, e.closed_at, e.closed_at + e.grace_buffer, e.closed_at + e.grace_buffer <= p_now
    FROM public.events e
   WHERE e.state IN ('closed', 'archived') AND e.purged_at IS NULL AND e.closed_at IS NOT NULL
     AND (p_org_id IS NULL OR e.org_id = p_org_id)
     AND (NOT p_due_only OR e.closed_at + e.grace_buffer <= p_now)
   ORDER BY e.closed_at + e.grace_buffer
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- F. Staff
------------------------------------------------------------------------------------------------

-- Who is assigned to a gate at a time (excluding shifts already handed over).
CREATE OR REPLACE FUNCTION public.staff_on_duty(p_checkpoint_id uuid, p_at timestamptz DEFAULT now())
RETURNS TABLE (assignment_id uuid, user_id uuid, display_name text, role text, event_id uuid, shift_start timestamptz, shift_end timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT a.id, u.id, u.display_name, u.role::text, a.event_id, a.shift_start, a.shift_end
    FROM public.staff_assignments a JOIN public.users u ON u.id = a.user_id
   WHERE a.checkpoint_id = p_checkpoint_id
     AND a.shift_start <= p_at AND p_at < a.shift_end
     AND (a.handed_over_at IS NULL OR a.handed_over_at > p_at)
   ORDER BY a.shift_start
$$;
--> statement-breakpoint

-- A user's assignments that are current at p_at or start within p_horizon (the scanner pairs with
-- the current one and caches the next one's allowlist).
CREATE OR REPLACE FUNCTION public.current_assignments(p_user_id uuid, p_at timestamptz DEFAULT now(), p_horizon interval DEFAULT '12 hours')
RETURNS TABLE (assignment_id uuid, checkpoint_id uuid, checkpoint_label text, event_id uuid, shift_start timestamptz, shift_end timestamptz, current boolean)
LANGUAGE sql STABLE AS $$
  SELECT a.id, a.checkpoint_id, c.label, a.event_id, a.shift_start, a.shift_end,
         a.shift_start <= p_at AND p_at < a.shift_end
    FROM public.staff_assignments a JOIN public.checkpoints c ON c.id = a.checkpoint_id
   WHERE a.user_id = p_user_id
     AND tstzrange(a.shift_start, a.shift_end, '[)') && tstzrange(p_at, p_at + p_horizon, '[)')
     AND (a.handed_over_at IS NULL OR a.handed_over_at > p_at)
   ORDER BY a.shift_start
$$;
--> statement-breakpoint

-- What happened at the gate during a shift, for the handover (06 D11): scans recorded by the
-- assigned user at that checkpoint between shift start and handover (or shift end).
--   let_through: admitted + already_inside; refused: red results; offline: decided on the device
--   while offline; late_synced: received after the shift ended (queued on the device).
CREATE OR REPLACE FUNCTION public.shift_handover_summary(p_assignment_id uuid)
RETURNS TABLE (
  assignment_id uuid, checkpoint_id uuid, user_id uuid, period_start timestamptz, period_end timestamptz,
  scans bigint, let_through bigint, refused bigint, duplicates bigint, offline bigint, late_synced bigint,
  by_result jsonb, first_scan_at timestamptz, last_scan_at timestamptz
)
LANGUAGE sql STABLE AS $$
  WITH a AS (
    SELECT x.*, coalesce(least(x.handed_over_at, x.shift_end), x.shift_end) AS pend
      FROM public.staff_assignments x WHERE x.id = p_assignment_id
  ),
  s AS (
    SELECT sc.result, sc.offline_bool, sc.received_at, sc.corrected_at
      FROM public.scans sc, a
     WHERE sc.checkpoint_id = a.checkpoint_id AND sc.staff_user_id = a.user_id
       AND (a.event_id IS NULL OR sc.event_id = a.event_id)
       AND sc.corrected_at >= a.shift_start AND sc.corrected_at < a.pend
       AND sc.result <> 'implied_exit'
  )
  SELECT a.id, a.checkpoint_id, a.user_id, a.shift_start, a.pend,
         (SELECT count(*) FROM s),
         (SELECT count(*) FROM s WHERE result IN ('admitted', 'already_inside')),
         (SELECT count(*) FROM s WHERE result IN ('denied_room', 'capacity_block', 'revoked', 'suspended', 'unknown_token', 'wristband_required', 'pass_spent')),
         (SELECT count(*) FROM s WHERE result = 'duplicate_read'),
         (SELECT count(*) FROM s WHERE offline_bool),
         (SELECT count(*) FROM s WHERE received_at >= a.pend),
         coalesce((SELECT jsonb_object_agg(result, n) FROM (SELECT result::text AS result, count(*) AS n FROM s GROUP BY 1) g), '{}'::jsonb),
         (SELECT min(corrected_at) FROM s), (SELECT max(corrected_at) FROM s)
    FROM a
$$;
--> statement-breakpoint

-- Ends a shift (explicit handover): stamps handed_over_at, audits, returns the summary.
CREATE OR REPLACE FUNCTION public.shift_handover(p_assignment_id uuid, p_actor_id uuid DEFAULT NULL, p_now timestamptz DEFAULT now())
RETURNS SETOF jsonb
LANGUAGE plpgsql AS $$
DECLARE
  summary jsonb;
BEGIN
  UPDATE public.staff_assignments SET handed_over_at = p_now WHERE id = p_assignment_id AND handed_over_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assignment % does not exist or was already handed over', p_assignment_id USING ERRCODE = 'no_data_found';
  END IF;
  SELECT to_jsonb(x) INTO summary FROM public.shift_handover_summary(p_assignment_id) x;
  INSERT INTO public.audit_log (actor_id, action, target, meta_jsonb)
  VALUES (p_actor_id, 'staff.handover', 'staff_assignment:' || p_assignment_id,
          summary - 'assignment_id' - 'checkpoint_id' - 'user_id' - 'by_result');
  RETURN NEXT summary;
END;
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- G. Devices and gate health
------------------------------------------------------------------------------------------------

-- Records a device heartbeat, and the checkpoint's gate-health fields. Status: ok | unknown_device | not_active.
CREATE OR REPLACE FUNCTION public.device_heartbeat(
  p_device_id uuid, p_checkpoint_id uuid DEFAULT NULL, p_clock_offset_ms integer DEFAULT NULL, p_queue_depth integer DEFAULT NULL,
  p_app_version text DEFAULT NULL, p_ip inet DEFAULT NULL, p_now timestamptz DEFAULT now()
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
         last_ip_prefix = coalesce(public.auth_ip_prefix(p_ip), x.last_ip_prefix)
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

-- A fixed reader or kiosk authenticates with its device token (O-17); the token is stored only as
-- its hash. Returns the device when active.
CREATE OR REPLACE FUNCTION public.device_authenticate(p_token_hash text) RETURNS SETOF public.devices
LANGUAGE sql STABLE AS $$
  SELECT * FROM public.devices WHERE token_hash = p_token_hash AND state = 'active'
$$;
--> statement-breakpoint

-- Gate health for a venue (06 D12): link state (offline after 60 s without a heartbeat), clock
-- fault (|offset| > 2 min), queue depth, last scan and the last 15 minutes' scans for the event.
CREATE OR REPLACE FUNCTION public.gate_health(p_venue_id uuid, p_event_id uuid DEFAULT NULL, p_now timestamptz DEFAULT now())
RETURNS TABLE (
  checkpoint_id uuid, label text, direction text, perimeter boolean, hardware_id text,
  link_state text, last_heartbeat_at timestamptz, heartbeat_age_s integer, clock_offset_ms integer, clock_fault boolean,
  queue_depth integer, last_scan_at timestamptz, scans_last_15m bigint, staff_on_duty bigint
)
LANGUAGE sql STABLE AS $$
  SELECT c.id, c.label, c.direction::text, c.perimeter_bool, c.hardware_id,
         CASE WHEN c.last_heartbeat_at IS NULL THEN 'unknown'
              WHEN p_now - c.last_heartbeat_at > interval '60 seconds' THEN 'offline' ELSE 'online' END,
         c.last_heartbeat_at,
         CASE WHEN c.last_heartbeat_at IS NULL THEN NULL ELSE floor(extract(epoch FROM (p_now - c.last_heartbeat_at)))::integer END,
         c.last_clock_offset_ms,
         coalesce(abs(c.last_clock_offset_ms) > 120000, false),
         (SELECT max(d.last_queue_depth) FROM public.devices d WHERE d.checkpoint_id = c.id AND d.state = 'active'),
         (SELECT max(s.corrected_at) FROM public.scans s WHERE p_event_id IS NOT NULL AND s.event_id = p_event_id AND s.checkpoint_id = c.id),
         (SELECT count(*) FROM public.scans s WHERE p_event_id IS NOT NULL AND s.event_id = p_event_id AND s.checkpoint_id = c.id
             AND s.corrected_at > p_now - interval '15 minutes' AND s.corrected_at <= p_now AND s.result <> 'implied_exit'),
         (SELECT count(*) FROM public.staff_on_duty(c.id, p_now))
    FROM public.checkpoints c
   WHERE c.venue_id = p_venue_id
   ORDER BY (c.last_heartbeat_at IS NULL OR p_now - c.last_heartbeat_at > interval '60 seconds') DESC, c.label
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- H. Events: duplication and readiness
------------------------------------------------------------------------------------------------

-- Duplicates an event as a new draft at the same venue, shifted so it starts at p_starts_at:
-- rooms and capacity overrides, sessions, access rules (windows shifted), pass template, profile
-- schema, listing and grace period. Never registrations, credentials or any scan data.
CREATE OR REPLACE FUNCTION public.event_duplicate(
  p_event_id uuid, p_slug text, p_title text, p_starts_at timestamptz, p_actor_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  e public.events%ROWTYPE;
  v_new uuid;
  v_shift interval;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event % does not exist', p_event_id USING ERRCODE = 'no_data_found';
  END IF;
  v_shift := p_starts_at - e.starts_at;
  INSERT INTO public.events (org_id, venue_id, slug, title, description, starts_at, ends_at, timezone, state, listed_bool,
                             grace_buffer, profile_schema_jsonb, pass_template_jsonb)
  VALUES (e.org_id, e.venue_id, p_slug, p_title, e.description, e.starts_at + v_shift, e.ends_at + v_shift, e.timezone, 'draft',
          e.listed_bool, e.grace_buffer, e.profile_schema_jsonb, e.pass_template_jsonb)
  RETURNING id INTO v_new;
  INSERT INTO public.event_rooms (event_id, room_id, capacity_override)
  SELECT v_new, room_id, capacity_override FROM public.event_rooms WHERE event_id = p_event_id;
  INSERT INTO public.sessions (event_id, room_id, title, description, starts_at, ends_at)
  SELECT v_new, room_id, title, description, starts_at + v_shift, ends_at + v_shift FROM public.sessions WHERE event_id = p_event_id;
  INSERT INTO public.access_rules (event_id, subject_kind, subject, room_id, window_start, window_end, effect)
  SELECT v_new, subject_kind, subject, room_id, window_start + v_shift, window_end + v_shift, effect
    FROM public.access_rules WHERE event_id = p_event_id;
  INSERT INTO public.audit_log (actor_id, action, target, meta_jsonb)
  VALUES (p_actor_id, 'event.duplicate', 'event:' || v_new, jsonb_build_object('from', p_event_id));
  RETURN v_new;
END;
$$;
--> statement-breakpoint

-- The publish readiness checklist (06 D5/D6). `blocking` checks are the ones publishing enforces;
-- the others are warnings. The email-domain check is the API's (not in the database).
CREATE OR REPLACE FUNCTION public.event_readiness(p_event_id uuid, p_now timestamptz DEFAULT now())
RETURNS TABLE (check_name text, ok boolean, blocking boolean, detail text)
LANGUAGE sql STABLE AS $$
  WITH e AS (SELECT * FROM public.events WHERE id = p_event_id),
  rooms AS (
    SELECT er.room_id, coalesce(er.capacity_override, r.capacity) AS cap,
           EXISTS (SELECT 1 FROM public.checkpoints c WHERE c.room_id = er.room_id) AS has_door
      FROM public.event_rooms er JOIN public.rooms r ON r.id = er.room_id
     WHERE er.event_id = p_event_id
  )
  SELECT 'rooms', EXISTS (SELECT 1 FROM rooms WHERE cap > 0), true,
         (SELECT count(*) FROM rooms) || ' room(s), ' || (SELECT count(*) FROM rooms WHERE cap > 0) || ' with capacity'
  UNION ALL
  SELECT 'pass_template', (SELECT pass_template_jsonb IS NOT NULL FROM e), true, NULL
  UNION ALL
  SELECT 'access_rules', EXISTS (SELECT 1 FROM public.access_rules a WHERE a.event_id = p_event_id AND a.effect = 'permit'), false,
         (SELECT count(*) FROM public.access_rules a WHERE a.event_id = p_event_id) || ' rule(s)'
  UNION ALL
  SELECT 'room_doors', NOT EXISTS (SELECT 1 FROM rooms WHERE NOT has_door), false,
         (SELECT count(*) FROM rooms WHERE NOT has_door) || ' room(s) without a checkpoint'
  UNION ALL
  SELECT 'perimeter_gate', EXISTS (SELECT 1 FROM public.checkpoints c, e WHERE c.venue_id = e.venue_id AND c.perimeter_bool), false, NULL
  UNION ALL
  SELECT 'sessions_in_window',
         NOT EXISTS (SELECT 1 FROM public.sessions s, e WHERE s.event_id = p_event_id AND (s.starts_at < e.starts_at OR s.ends_at > e.ends_at)),
         false, NULL
  UNION ALL
  SELECT 'staff_assigned', EXISTS (SELECT 1 FROM public.staff_assignments a WHERE a.event_id = p_event_id), false,
         (SELECT count(DISTINCT a.user_id) FROM public.staff_assignments a WHERE a.event_id = p_event_id) || ' staff'
  UNION ALL
  SELECT 'signing_key', EXISTS (SELECT 1 FROM public.signing_keys k
                                 WHERE k.purpose = 'qr' AND k.active_from <= p_now AND (k.retired_at IS NULL OR k.retired_at > p_now)), false, NULL
  UNION ALL
  SELECT 'starts_in_future', (SELECT starts_at > p_now FROM e), false, NULL
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- I. Background jobs (pg-boss)
--
-- app_jobs (NOLOGIN) owns the pg-boss schema, so the job maintenance process — which creates
-- pg-boss's daily statistics partitions — runs as a login in app_jobs. app_api may enqueue, fetch,
-- complete and fail jobs (DML only). The schema itself is installed by installJobSchema()
-- (src/jobs.ts), run as the migrating role, which then calls job_schema_grants().
------------------------------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_jobs') THEN CREATE ROLE app_jobs NOLOGIN; END IF;
END
$$;
--> statement-breakpoint
-- The migrating role must be able to transfer ownership to app_jobs.
DO $$
BEGIN
  EXECUTE format('GRANT app_jobs TO %I', current_user);
EXCEPTION WHEN others THEN
  RAISE NOTICE 'could not grant app_jobs to %: %', current_user, SQLERRM;
END
$$;
--> statement-breakpoint

-- Hands the installed pg-boss schema to app_jobs and grants app_api what it needs. Idempotent.
CREATE OR REPLACE FUNCTION public.job_schema_grants(p_schema text DEFAULT 'pgboss') RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  IF to_regnamespace(p_schema) IS NULL THEN
    RAISE EXCEPTION 'schema % is not installed; run installJobSchema() first', p_schema USING ERRCODE = 'invalid_schema_name';
  END IF;
  EXECUTE format('ALTER SCHEMA %I OWNER TO app_jobs', p_schema);
  FOR r IN SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = p_schema AND c.relkind IN ('r', 'p', 'S', 'v') LOOP
    EXECUTE format('ALTER %s %I.%I OWNER TO app_jobs',
                   CASE r.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW' ELSE 'TABLE' END, p_schema, r.relname);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = p_schema LOOP
    EXECUTE format('ALTER ROUTINE %s OWNER TO app_jobs', r.sig);
  END LOOP;
  FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname = p_schema AND t.typtype = 'e' LOOP
    EXECUTE format('ALTER TYPE %I.%I OWNER TO app_jobs', p_schema, r.typname);
  END LOOP;
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO app_api', p_schema);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO app_api', p_schema);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO app_api', p_schema);
  EXECUTE format('GRANT EXECUTE ON ALL ROUTINES IN SCHEMA %I TO app_api', p_schema);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE app_jobs IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_api', p_schema);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE app_jobs IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO app_api', p_schema);
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.job_schema_grants(text) FROM PUBLIC;
