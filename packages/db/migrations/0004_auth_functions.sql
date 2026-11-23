-- 0004 — sign-in state: atomic operations (hand-written).
--
-- Every function takes `p_now` (default now()) so a caller with a controllable clock can test
-- expiry deterministically. They are SECURITY INVOKER: the caller's own table privileges apply.
-- Statuses are returned, never raised, so that a reuse detection's family revocation commits.

-- Coarse network context for session review: /24 for IPv4, /48 for IPv6. Never a full address.
CREATE OR REPLACE FUNCTION public.auth_ip_prefix(p_ip inet) RETURNS cidr
LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN CASE WHEN p_ip IS NULL THEN NULL
            ELSE network(set_masklen(p_ip, CASE family(p_ip) WHEN 4 THEN 24 ELSE 48 END)) END;
--> statement-breakpoint

-- Starts a session family (login, email-link sign-in, MFA step-up).
CREATE OR REPLACE FUNCTION public.auth_start_session(
  p_family_id uuid, p_user_id uuid, p_attendee_id uuid, p_token_hash text, p_expires_at timestamptz,
  p_mfa_at timestamptz DEFAULT NULL, p_user_agent text DEFAULT NULL, p_ip inet DEFAULT NULL,
  p_now timestamptz DEFAULT now()
) RETURNS public.auth_sessions
LANGUAGE sql AS $$
  INSERT INTO public.auth_sessions
    (family_id, user_id, attendee_id, token_hash, mfa_at, created_at, expires_at, user_agent, ip_prefix)
  VALUES
    (p_family_id, p_user_id, p_attendee_id, p_token_hash, p_mfa_at, p_now, p_expires_at,
     left(p_user_agent, 200), public.auth_ip_prefix(p_ip))
  RETURNING *
$$;
--> statement-breakpoint

-- Exchanges a refresh token for a new one in the same family.
--   rotated         ok: session_id is the new row
--   invalid         no such token
--   revoked         the family (or this row) is revoked
--   expired         this token has expired (family untouched)
--   reuse_detected  this token was already exchanged: every live row of the family is revoked
-- The row is locked (FOR UPDATE), so two concurrent exchanges of one token cannot both succeed:
-- the second sees rotated_at and is treated as reuse.
CREATE OR REPLACE FUNCTION public.auth_rotate_session(
  p_token_hash text, p_new_token_hash text, p_expires_at timestamptz,
  p_user_agent text DEFAULT NULL, p_ip inet DEFAULT NULL, p_now timestamptz DEFAULT now()
) RETURNS TABLE (
  status text, session_id uuid, family_id uuid, user_id uuid, attendee_id uuid,
  mfa_at timestamptz, expires_at timestamptz
)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  s public.auth_sessions%ROWTYPE;
  v_new uuid;
BEGIN
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

CREATE OR REPLACE FUNCTION public.auth_revoke_family(
  p_family_id uuid, p_reason public.auth_revoke_reason, p_now timestamptz DEFAULT now()
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  UPDATE public.auth_sessions SET revoked_at = p_now, revoke_reason = p_reason
   WHERE family_id = p_family_id AND revoked_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
--> statement-breakpoint

-- Revokes every session of one holder (password change, disabled account, erasure).
CREATE OR REPLACE FUNCTION public.auth_revoke_holder(
  p_user_id uuid, p_attendee_id uuid, p_reason public.auth_revoke_reason, p_now timestamptz DEFAULT now()
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  IF num_nonnulls(p_user_id, p_attendee_id) <> 1 THEN
    RAISE EXCEPTION 'exactly one of p_user_id, p_attendee_id is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE public.auth_sessions SET revoked_at = p_now, revoke_reason = p_reason
   WHERE revoked_at IS NULL
     AND (user_id = p_user_id OR attendee_id = p_attendee_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
--> statement-breakpoint

-- Redeems an email link exactly once.
--   redeemed | invalid | already_redeemed | expired
-- A single conditional UPDATE: under concurrency the second redeemer blocks on the row lock, then
-- re-checks `redeemed_at IS NULL`, finds it set, and updates nothing.
CREATE OR REPLACE FUNCTION public.auth_redeem_link(p_token_hash text, p_now timestamptz DEFAULT now())
RETURNS TABLE (status text, link_id uuid, attendee_id uuid, email_hash text, purpose public.auth_link_purpose)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  l public.auth_links%ROWTYPE;
BEGIN
  UPDATE public.auth_links x SET redeemed_at = p_now
   WHERE x.token_hash = p_token_hash AND x.redeemed_at IS NULL AND x.expires_at > p_now
  RETURNING x.* INTO l;
  IF FOUND THEN
    status := 'redeemed';
  ELSE
    SELECT * INTO l FROM public.auth_links x WHERE x.token_hash = p_token_hash;
    IF NOT FOUND THEN
      status := 'invalid'; RETURN NEXT; RETURN;
    END IF;
    status := CASE WHEN l.redeemed_at IS NOT NULL THEN 'already_redeemed' ELSE 'expired' END;
  END IF;
  link_id := l.id; attendee_id := l.attendee_id; email_hash := l.email_hash; purpose := l.purpose;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

-- Consumes a WebSocket ticket on first presentation, valid or not.
--   valid | invalid | already_consumed | expired | revoked (its session family has been revoked)
CREATE OR REPLACE FUNCTION public.ws_consume_ticket(p_ticket_hash text, p_now timestamptz DEFAULT now())
RETURNS TABLE (
  status text, user_id uuid, attendee_id uuid, session_family_id uuid, channel public.ws_channel,
  event_id uuid, checkpoint_id uuid, expires_at timestamptz
)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  r public.ws_tickets%ROWTYPE;
BEGIN
  UPDATE public.ws_tickets t SET consumed_at = p_now
   WHERE t.ticket_hash = p_ticket_hash AND t.consumed_at IS NULL
  RETURNING t.* INTO r;
  IF NOT FOUND THEN
    status := CASE WHEN EXISTS (SELECT 1 FROM public.ws_tickets t WHERE t.ticket_hash = p_ticket_hash)
                   THEN 'already_consumed' ELSE 'invalid' END;
    RETURN NEXT; RETURN;
  END IF;
  user_id := r.user_id; attendee_id := r.attendee_id; session_family_id := r.session_family_id;
  channel := r.channel; event_id := r.event_id; checkpoint_id := r.checkpoint_id; expires_at := r.expires_at;
  IF r.expires_at <= p_now THEN
    status := 'expired';
  ELSIF r.session_family_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.auth_sessions a
     WHERE a.family_id = r.session_family_id AND a.revoked_at IS NULL AND a.expires_at > p_now
  ) THEN
    status := 'revoked';
  ELSE
    status := 'valid';
  END IF;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

-- Scheduled cleanup (pg-boss, e.g. every 10 minutes). Deletes at most p_batch rows per table per
-- call to keep locks short; call again while any count equals p_batch.
--   sessions: expired or revoked more than p_keep ago (rotated rows of a live family stay, so reuse
--             of a recent token is still detected)
--   links:    expired or redeemed more than p_keep ago
--   tickets:  expired more than 10 minutes ago
CREATE OR REPLACE FUNCTION public.auth_cleanup(
  p_now timestamptz DEFAULT now(), p_keep interval DEFAULT '30 days', p_batch integer DEFAULT 10000
) RETURNS TABLE (sessions bigint, links bigint, tickets bigint)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
BEGIN
  DELETE FROM public.auth_sessions WHERE id IN (
    SELECT id FROM public.auth_sessions
     WHERE expires_at < p_now - p_keep OR revoked_at < p_now - p_keep
     LIMIT p_batch);
  GET DIAGNOSTICS sessions = ROW_COUNT;
  DELETE FROM public.auth_links WHERE id IN (
    SELECT id FROM public.auth_links
     WHERE expires_at < p_now - p_keep OR redeemed_at < p_now - p_keep
     LIMIT p_batch);
  GET DIAGNOSTICS links = ROW_COUNT;
  DELETE FROM public.ws_tickets WHERE ticket_hash IN (
    SELECT ticket_hash FROM public.ws_tickets
     WHERE expires_at < p_now - interval '10 minutes'
     LIMIT p_batch);
  GET DIAGNOSTICS tickets = ROW_COUNT;
  RETURN NEXT;
END;
$$;
