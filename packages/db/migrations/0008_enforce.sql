-- 0008 — switch enforcement on (hand-written).
--
-- 1. Refresh rotation that picks the new lifetime by holder kind (operators/staff vs attendees).
-- 2. Prepared, NOT called: enforcement for users.email (encrypted) and users.email_hash (format),
--    to be switched on once the API writes operator emails through insertUser()/setUserEmail().
-- 3. Runs enforce_encrypted_secrets() and enforce_hash_formats() (created in 0006). On a database
--    still holding plaintext or malformed values this migration fails and changes nothing: run
--    reencryptSecrets() and fix the formats first, then migrate again.

CREATE OR REPLACE FUNCTION public.auth_rotate_session_by_kind(
  p_token_hash text, p_new_token_hash text, p_user_ttl interval, p_attendee_ttl interval,
  p_user_agent text DEFAULT NULL, p_ip inet DEFAULT NULL, p_now timestamptz DEFAULT now()
) RETURNS TABLE (
  status text, session_id uuid, family_id uuid, user_id uuid, attendee_id uuid,
  mfa_at timestamptz, expires_at timestamptz
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
      p_user_agent, p_ip, p_now);
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.enforce_encrypted_user_email() RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('users_email_encrypted', 'email ~ ''^ev1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$'''),
    ('users_email_hash_required', 'email_hash IS NOT NULL AND email_hash ~ ''^[0-9a-f]{64}$''')
  ) AS t(name, expr) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name AND conrelid = 'public.users'::regclass) THEN
      EXECUTE format('ALTER TABLE public.users ADD CONSTRAINT %I CHECK (%s) NOT VALID', c.name, c.expr);
    END IF;
    EXECUTE format('ALTER TABLE public.users VALIDATE CONSTRAINT %I', c.name);
  END LOOP;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.enforce_encrypted_user_email() FROM PUBLIC;
--> statement-breakpoint

SELECT public.enforce_encrypted_secrets();
--> statement-breakpoint
SELECT public.enforce_hash_formats();
