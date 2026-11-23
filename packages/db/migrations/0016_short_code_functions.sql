-- 0016 — desk codes, staff invites, pending MFA enrolment, exact-email attendee lookup (hand-written).

-- Pending MFA secrets are encrypted envelopes, like the active one.
ALTER TABLE public.users ADD CONSTRAINT users_mfa_pending_encrypted
  CHECK (mfa_pending_secret_enc IS NULL OR mfa_pending_secret_enc ~ '^ev1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$');
--> statement-breakpoint
ALTER TABLE public.users ADD CONSTRAINT users_mfa_pending_consistent
  CHECK ((mfa_pending_secret_enc IS NULL) = (mfa_pending_expires_at IS NULL));
--> statement-breakpoint

-- Creates a desk code for a band that is in stock. Status: created | collision (pick another
-- code) | unknown_carrier | not_in_stock.
CREATE OR REPLACE FUNCTION public.desk_code_create(
  p_code_hash text, p_carrier_identifier text, p_created_by uuid DEFAULT NULL,
  p_ttl interval DEFAULT '10 minutes', p_now timestamptz DEFAULT now()
) RETURNS TABLE (status text, expires_at timestamptz)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  k public.carriers%ROWTYPE;
BEGIN
  SELECT * INTO k FROM public.carriers x
   WHERE x.kind = 'nfc' AND x.identifier = p_carrier_identifier AND x.state <> 'retired';
  IF NOT FOUND THEN status := 'unknown_carrier'; RETURN NEXT; RETURN; END IF;
  IF k.state <> 'stock' THEN status := 'not_in_stock'; RETURN NEXT; RETURN; END IF;
  INSERT INTO public.carrier_desk_codes (code_hash, carrier_identifier, created_by, created_at, expires_at)
  VALUES (p_code_hash, p_carrier_identifier, p_created_by, p_now, p_now + p_ttl)
  ON CONFLICT (code_hash) DO NOTHING;
  IF NOT FOUND THEN status := 'collision'; RETURN NEXT; RETURN; END IF;
  status := 'created'; expires_at := p_now + p_ttl;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

-- Consumes a desk code exactly once for an attendee. Refused when the attendee already has
-- p_max_failures failed attempts within p_window; every refusal for a wrong, expired or used code
-- is recorded as a failure. p_code_hashes: the code's HMAC under every configured blind-index key.
-- Status: consumed | too_many_attempts | invalid | expired | already_used.
CREATE OR REPLACE FUNCTION public.desk_code_consume(
  p_code_hashes text[], p_attendee_id uuid, p_max_failures integer DEFAULT 5,
  p_window interval DEFAULT '10 minutes', p_now timestamptz DEFAULT now()
) RETURNS TABLE (status text, carrier_identifier text)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  d public.carrier_desk_codes%ROWTYPE;
BEGIN
  IF (SELECT count(*) FROM public.carrier_desk_code_failures f
       WHERE f.attendee_id = p_attendee_id AND f.at > p_now - p_window) >= p_max_failures THEN
    status := 'too_many_attempts'; RETURN NEXT; RETURN;
  END IF;
  UPDATE public.carrier_desk_codes x SET used_at = p_now, used_by = p_attendee_id
   WHERE x.code_hash = ANY (p_code_hashes) AND x.used_at IS NULL AND x.expires_at > p_now
  RETURNING x.* INTO d;
  IF FOUND THEN
    status := 'consumed'; carrier_identifier := d.carrier_identifier;
    RETURN NEXT; RETURN;
  END IF;
  SELECT * INTO d FROM public.carrier_desk_codes x WHERE x.code_hash = ANY (p_code_hashes) LIMIT 1;
  status := CASE WHEN NOT FOUND THEN 'invalid' WHEN d.used_at IS NOT NULL THEN 'already_used' ELSE 'expired' END;
  INSERT INTO public.carrier_desk_code_failures (attendee_id, at) VALUES (p_attendee_id, p_now);
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

-- Creates a staff activation invite and revokes the user's older open ones. Status: created | unknown_user.
CREATE OR REPLACE FUNCTION public.user_invite_create(
  p_token_hash text, p_user_id uuid, p_expires_at timestamptz, p_created_by uuid DEFAULT NULL, p_now timestamptz DEFAULT now()
) RETURNS TABLE (status text, revoked integer)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id) THEN
    status := 'unknown_user'; revoked := 0; RETURN NEXT; RETURN;
  END IF;
  UPDATE public.user_invites i SET revoked_at = p_now
   WHERE i.user_id = p_user_id AND i.used_at IS NULL AND i.revoked_at IS NULL;
  GET DIAGNOSTICS revoked = ROW_COUNT;
  INSERT INTO public.user_invites (token_hash, user_id, created_by, created_at, expires_at)
  VALUES (p_token_hash, p_user_id, p_created_by, p_now, p_expires_at);
  status := 'created';
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

-- Consumes a staff invite exactly once. Status: consumed | invalid | expired | already_used | revoked.
CREATE OR REPLACE FUNCTION public.user_invite_consume(p_token_hash text, p_now timestamptz DEFAULT now())
RETURNS TABLE (status text, user_id uuid)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  i public.user_invites%ROWTYPE;
BEGIN
  UPDATE public.user_invites x SET used_at = p_now
   WHERE x.token_hash = p_token_hash AND x.used_at IS NULL AND x.revoked_at IS NULL AND x.expires_at > p_now
  RETURNING x.* INTO i;
  IF FOUND THEN status := 'consumed'; user_id := i.user_id; RETURN NEXT; RETURN; END IF;
  SELECT * INTO i FROM public.user_invites x WHERE x.token_hash = p_token_hash;
  IF NOT FOUND THEN status := 'invalid'; RETURN NEXT; RETURN; END IF;
  user_id := i.user_id;
  status := CASE WHEN i.used_at IS NOT NULL THEN 'already_used' WHEN i.revoked_at IS NOT NULL THEN 'revoked' ELSE 'expired' END;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

-- Cleanup for the short codes; cleanupAuthState() calls it with auth_cleanup().
CREATE OR REPLACE FUNCTION public.short_code_cleanup(
  p_now timestamptz DEFAULT now(), p_keep interval DEFAULT '30 days', p_batch integer DEFAULT 10000
) RETURNS TABLE (desk_codes bigint, desk_code_failures bigint, user_invites bigint)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
BEGIN
  DELETE FROM public.carrier_desk_codes WHERE code_hash IN (
    SELECT code_hash FROM public.carrier_desk_codes WHERE expires_at < p_now - interval '1 day' LIMIT p_batch);
  GET DIAGNOSTICS desk_codes = ROW_COUNT;
  DELETE FROM public.carrier_desk_code_failures WHERE ctid IN (
    SELECT ctid FROM public.carrier_desk_code_failures WHERE at < p_now - interval '1 day' LIMIT p_batch);
  GET DIAGNOSTICS desk_code_failures = ROW_COUNT;
  DELETE FROM public.user_invites WHERE token_hash IN (
    SELECT token_hash FROM public.user_invites
     WHERE expires_at < p_now - p_keep OR used_at < p_now - p_keep OR revoked_at < p_now - p_keep LIMIT p_batch);
  GET DIAGNOSTICS user_invites = ROW_COUNT;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

-- Every attendee id whose email blind index matches (exact address, any configured key). Ids only.
CREATE OR REPLACE FUNCTION pii_vault.attendee_ids_by_email_hash(p_email_hashes text[]) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pii_vault, pg_temp AS $$
  SELECT a.id FROM pii_vault.attendees a WHERE a.email_hash = ANY (p_email_hashes) AND a.erased_at IS NULL
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION pii_vault.attendee_ids_by_email_hash(text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION pii_vault.attendee_ids_by_email_hash(text[]) TO app_api, app_vault;
