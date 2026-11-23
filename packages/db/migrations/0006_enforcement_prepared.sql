-- 0006 — enforcement, PREPARED ONLY (hand-written).
--
-- This migration creates two functions and calls neither. Switching enforcement on is a separate,
-- final step — a later one-line migration (or an operator, as the owner):
--
--   SELECT public.enforce_encrypted_secrets();   -- after the API writes through src/secrets.ts and
--                                                 -- reencryptSecrets() has encrypted existing rows
--   SELECT public.enforce_hash_formats();         -- after the API writes the settled formats
--
-- Each adds CHECK constraints NOT VALID (instant, applies to new writes), then VALIDATEs them
-- against existing rows; if any existing row violates, the function raises and nothing is changed.
-- Both are idempotent.

CREATE OR REPLACE FUNCTION public.enforce_encrypted_secrets() RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public, pii_vault, pg_temp AS $$
DECLARE
  env constant text := '^ev1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$';
  c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('pii_vault.attendees', 'attendees_email_encrypted', format('email IS NULL OR email ~ %L', env)),
    ('pii_vault.attendees', 'attendees_full_name_encrypted', format('full_name IS NULL OR full_name ~ %L', env)),
    ('pii_vault.attendees', 'attendees_profile_encrypted',
       format('profile_jsonb = ''{}''::jsonb OR (jsonb_typeof(profile_jsonb -> ''$enc'') = ''string'' AND (profile_jsonb ->> ''$enc'') ~ %L AND (profile_jsonb - ''$enc'') = ''{}''::jsonb)', env)),
    ('public.users', 'users_mfa_secret_encrypted', format('mfa_secret_enc IS NULL OR mfa_secret_enc ~ %L', env)),
    ('public.signing_keys', 'signing_keys_private_key_encrypted', format('private_key_enc ~ %L', env))
  ) AS t(tbl, name, expr) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name AND conrelid = c.tbl::regclass) THEN
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I CHECK (%s) NOT VALID', c.tbl, c.name, c.expr);
    END IF;
    EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', c.tbl, c.name);
  END LOOP;
END;
$$;
--> statement-breakpoint

-- Settled formats:
--   credentials.token_hash           128-bit random reference, 22 base64url chars
--   carriers.identifier (nfc,        base64url SHA-256, 43 chars
--                        qr_email)
--   invitations.token_hash,          base64url SHA-256, 43 chars
--   auth_sessions.token_hash,
--   auth_links.token_hash, ws_tickets.ticket_hash
--   *.email_hash                     HMAC-SHA-256 blind index, 64 lowercase hex
--   signing_keys.qr_kid              8 lowercase hex (already enforced by 0003)
CREATE OR REPLACE FUNCTION public.enforce_hash_formats() RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public, pii_vault, pg_temp AS $$
DECLARE
  c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('public.credentials', 'credentials_token_hash_format', 'token_hash ~ ''^[A-Za-z0-9_-]{22}$'''),
    ('public.carriers', 'carriers_identifier_format', 'identifier IS NULL OR identifier ~ ''^[A-Za-z0-9_-]{43}$'''),
    ('public.invitations', 'invitations_token_hash_format', 'token_hash ~ ''^[A-Za-z0-9_-]{43}$'''),
    ('public.invitations', 'invitations_email_hash_format', 'email_hash ~ ''^[0-9a-f]{64}$'''),
    ('public.auth_sessions', 'auth_sessions_token_hash_format', 'token_hash ~ ''^[A-Za-z0-9_-]{43}$'''),
    ('public.auth_links', 'auth_links_token_hash_format', 'token_hash ~ ''^[A-Za-z0-9_-]{43}$'''),
    ('public.auth_links', 'auth_links_email_hash_format', 'email_hash IS NULL OR email_hash ~ ''^[0-9a-f]{64}$'''),
    ('public.ws_tickets', 'ws_tickets_ticket_hash_format', 'ticket_hash ~ ''^[A-Za-z0-9_-]{43}$'''),
    ('pii_vault.attendees', 'attendees_email_hash_format', 'email_hash IS NULL OR email_hash ~ ''^[0-9a-f]{64}$''')
  ) AS t(tbl, name, expr) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name AND conrelid = c.tbl::regclass) THEN
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I CHECK (%s) NOT VALID', c.tbl, c.name, c.expr);
    END IF;
    EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', c.tbl, c.name);
  END LOOP;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.enforce_encrypted_secrets(), public.enforce_hash_formats() FROM PUBLIC;
