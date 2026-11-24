-- 0027 — the offline allowlist agrees with the server's online verdicts (hand-written).
--
--   A. A band that is only `assigned` (written at the desk, not yet verified, 01 §5.3) opens no door
--      online; it is no longer in `nfc_hashes`, so an offline gate does not admit it either.
--   B. `qr_email_hashes`: the carrier hashes (base64url SHA-256 of the code's `cid`) of the emailed
--      codes that are still usable — not used, not superseded by a resend. An offline gate answers
--      `pass_spent` for any other emailed code of the pass. `qr_email_spent` is unchanged.
-- The result gains a column, so the function is recreated (same argument, EXECUTE stays PUBLIC).

DROP FUNCTION IF EXISTS public.allowlist_credentials(uuid);
--> statement-breakpoint
CREATE FUNCTION public.allowlist_credentials(p_event_id uuid)
RETURNS TABLE (
  credential_ref text, subject_kind text, subject text, effective_state text,
  nfc_hashes text[], dead_nfc_hashes text[], qr_email_spent boolean, qr_email_hashes text[]
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
           array_agg(k.identifier ORDER BY k.identifier) FILTER (WHERE k.state IN ('bound', 'active')) AS live,
           array_agg(k.identifier ORDER BY k.identifier) FILTER (WHERE k.state IN ('lost', 'retired')) AS dead
      FROM public.carriers k
     WHERE k.kind = 'nfc' AND k.credential_id IN (SELECT id FROM creds)
     GROUP BY k.credential_id
  ),
  mail AS (
    SELECT k.credential_id, bool_or(k.redeemed_at IS NOT NULL) AS spent,
           array_agg(k.identifier ORDER BY k.identifier) FILTER (WHERE k.redeemed_at IS NULL AND k.state <> 'retired' AND k.identifier IS NOT NULL) AS usable
      FROM public.carriers k
     WHERE k.kind = 'qr_email' AND k.credential_id IN (SELECT id FROM creds)
     GROUP BY k.credential_id
  )
  SELECT c.token_hash, c.subject_kind, c.subject, c.effective_state,
         coalesce(b.live, '{}'), coalesce(b.dead, '{}'), coalesce(m.spent, false), coalesce(m.usable, '{}')
    FROM creds c
    LEFT JOIN bands b ON b.credential_id = c.id
    LEFT JOIN mail m ON m.credential_id = c.id
   ORDER BY c.token_hash
$$;
