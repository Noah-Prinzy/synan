-- 0009 — switch operator-email enforcement on (hand-written).
--
-- Adds and validates users_email_encrypted (envelope) and users_email_hash_required (64 hex).
-- On a database that still holds a plaintext address or a missing blind index this fails and
-- changes nothing: run reencryptSecrets({ …, includeUserEmail: true }) first, then migrate again.
-- The next migration (0010, generated) makes email_hash NOT NULL, makes its unique index cover every
-- row, and drops users_email_lower_uq, which only ever constrained plaintext.

SELECT public.enforce_encrypted_user_email();
