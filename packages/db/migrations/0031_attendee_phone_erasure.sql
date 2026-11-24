-- 0031 — attendee phone and pending registrations under erasure (hand-written).
--
-- Erasure (03 §5) scrubs the new encrypted `phone` column with the other identifying columns, and
-- deletes the attendee's self-service registrations still waiting for their emailed link
-- (pii_vault.pending_registrations, 0028–0029), whose encrypted answers are identity too.
-- As in 0002 otherwise; the search_path is the one 0005 set. Grants are kept by CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION pii_vault.erase_attendee(p_attendee_id uuid, p_actor_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pii_vault, pg_temp AS $$
DECLARE
  v_prev_scope text := current_setting('app.vault_scope', true);
  v_found boolean;
BEGIN
  PERFORM set_config('app.vault_scope', 'system', true);
  UPDATE pii_vault.attendees
     SET email = NULL, email_hash = NULL, full_name = NULL, phone = NULL, profile_jsonb = '{}'::jsonb,
         erased_at = coalesce(erased_at, now())
   WHERE id = p_attendee_id;
  v_found := FOUND;
  DELETE FROM pii_vault.pending_registrations WHERE attendee_id = p_attendee_id;
  PERFORM set_config('app.vault_scope', coalesce(v_prev_scope, ''), true);
  IF v_found THEN
    INSERT INTO public.audit_log (actor_id, action, target, meta_jsonb)
    VALUES (p_actor_id, 'attendee.erase', 'attendee:' || p_attendee_id, '{}'::jsonb);
  END IF;
  RETURN v_found;
END;
$$;
