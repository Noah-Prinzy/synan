ALTER TABLE "users" ADD COLUMN "invited_at" timestamp with time zone;--> statement-breakpoint

-- Backfill: an account with an invitation on record was invited, at its first invitation. Accounts
-- whose invitations were already cleaned up (short_code_cleanup, 30 days) read as never invited:
-- an admin then creates the account again rather than re-inviting it.
UPDATE public.users u SET invited_at = f.first_at
  FROM (SELECT i.user_id, min(i.created_at) AS first_at FROM public.user_invites i GROUP BY i.user_id) f
 WHERE f.user_id = u.id AND u.invited_at IS NULL;
--> statement-breakpoint

-- Activates a staff account with an invite, in one step: the password is set only on an account that
-- has none, and the invite is spent only then. Locks the user row before the invite row (the order a
-- re-invite takes), so an activation and a re-invite of the same account serialise without deadlock.
-- Status: activated | invalid | expired | already_used | revoked | account_active (a password is set
-- already: nothing is written, the invite stays as it was).
CREATE OR REPLACE FUNCTION public.user_invite_activate(p_token_hash text, p_password_hash text, p_now timestamptz DEFAULT now())
RETURNS TABLE (status text, user_id uuid)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  v_user uuid;
  i public.user_invites%ROWTYPE;
  n integer;
BEGIN
  SELECT x.user_id INTO v_user FROM public.user_invites x WHERE x.token_hash = p_token_hash;
  IF NOT FOUND THEN status := 'invalid'; RETURN NEXT; RETURN; END IF;
  PERFORM 1 FROM public.users u WHERE u.id = v_user FOR UPDATE;
  SELECT * INTO i FROM public.user_invites x WHERE x.token_hash = p_token_hash FOR UPDATE;
  user_id := i.user_id;
  IF i.used_at IS NOT NULL THEN status := 'already_used'; RETURN NEXT; RETURN; END IF;
  IF i.revoked_at IS NOT NULL THEN status := 'revoked'; RETURN NEXT; RETURN; END IF;
  IF i.expires_at <= p_now THEN status := 'expired'; RETURN NEXT; RETURN; END IF;
  UPDATE public.users u SET password_hash = p_password_hash, updated_at = p_now
   WHERE u.id = i.user_id AND coalesce(u.password_hash, '') = '';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN status := 'account_active'; RETURN NEXT; RETURN; END IF;
  UPDATE public.user_invites x SET used_at = p_now WHERE x.token_hash = p_token_hash;
  status := 'activated';
  RETURN NEXT;
END;
$$;
