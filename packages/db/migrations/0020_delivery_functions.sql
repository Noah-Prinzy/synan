-- 0020 — report schedules, exported files, email outbox, notifications (hand-written).

------------------------------------------------------------------------------------------------
-- Report schedules
------------------------------------------------------------------------------------------------

-- Claims due schedules (leased; concurrent workers never claim the same one): active ones whose
-- next_run_at has come, or on_close ones whose event has closed and that have not run yet.
CREATE OR REPLACE FUNCTION public.report_schedule_claim(p_limit integer DEFAULT 10, p_lease interval DEFAULT '15 minutes', p_now timestamptz DEFAULT now())
RETURNS SETOF public.report_schedules
LANGUAGE sql AS $$
  WITH due AS (
    SELECT s.id FROM public.report_schedules s JOIN public.events e ON e.id = s.event_id
     WHERE s.state = 'active'
       AND (s.lease_until IS NULL OR s.lease_until <= p_now)
       AND ((s.cadence <> 'on_close' AND s.next_run_at <= p_now)
            OR (s.cadence = 'on_close' AND s.last_run_at IS NULL AND e.closed_at IS NOT NULL AND e.closed_at <= p_now))
     ORDER BY coalesce(s.next_run_at, e.closed_at)
     FOR UPDATE OF s SKIP LOCKED
     LIMIT p_limit
  )
  UPDATE public.report_schedules s SET lease_until = p_now + p_lease
    FROM due WHERE s.id = due.id
  RETURNING s.*
$$;
--> statement-breakpoint

-- Records a run. Success: last_run_at, failures reset, next_run_at advanced past p_now (missed
-- periods are skipped, not replayed); on_close becomes done. Failure: failures + 1, the lease is
-- kept until it lapses (retry later); three in a row → failed.
CREATE OR REPLACE FUNCTION public.report_schedule_finish(p_id uuid, p_ok boolean, p_error text DEFAULT NULL, p_now timestamptz DEFAULT now())
RETURNS TABLE (state text, next_run_at timestamptz)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  s public.report_schedules%ROWTYPE;
  step interval;
  nxt timestamptz;
BEGIN
  SELECT * INTO s FROM public.report_schedules x WHERE x.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report schedule % does not exist', p_id USING ERRCODE = 'no_data_found';
  END IF;
  IF p_ok THEN
    step := CASE s.cadence WHEN 'daily' THEN interval '1 day' WHEN 'weekly' THEN interval '7 days' WHEN 'monthly' THEN interval '1 month' END;
    nxt := s.next_run_at;
    IF step IS NOT NULL THEN
      WHILE nxt <= p_now LOOP nxt := nxt + step; END LOOP;
    END IF;
    UPDATE public.report_schedules x SET last_run_at = p_now, failures = 0, last_error = NULL, lease_until = NULL,
           next_run_at = nxt, state = CASE WHEN s.cadence = 'on_close' THEN 'done'::public.report_schedule_state ELSE x.state END,
           updated_at = p_now
     WHERE x.id = p_id
    RETURNING x.state::text, x.next_run_at INTO state, next_run_at;
  ELSE
    UPDATE public.report_schedules x SET failures = x.failures + 1, last_error = left(p_error, 500), updated_at = p_now,
           state = CASE WHEN x.failures + 1 >= 3 THEN 'failed'::public.report_schedule_state ELSE x.state END
     WHERE x.id = p_id
    RETURNING x.state::text, x.next_run_at INTO state, next_run_at;
  END IF;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- Exported files
------------------------------------------------------------------------------------------------

-- Records an exported file; a file containing identity is audited when created.
CREATE OR REPLACE FUNCTION public.exported_file_record(
  p_report_id uuid, p_data_request_id uuid, p_object_key text, p_content_type text, p_size_bytes bigint,
  p_contains_identity boolean, p_key_id text, p_ttl interval DEFAULT '7 days', p_actor_id uuid DEFAULT NULL, p_now timestamptz DEFAULT now()
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.exported_files (report_id, data_request_id, object_key, content_type, size_bytes, contains_identity, key_id, created_at, expires_at)
  VALUES (p_report_id, p_data_request_id, p_object_key, p_content_type, p_size_bytes, p_contains_identity, p_key_id, p_now, p_now + p_ttl)
  RETURNING id INTO v_id;
  IF p_contains_identity THEN
    INSERT INTO public.audit_log (actor_id, action, target, meta_jsonb)
    VALUES (p_actor_id, 'export.create', 'exported_file:' || v_id,
            jsonb_build_object('report_id', p_report_id, 'data_request_id', p_data_request_id, 'expires_at', p_now + p_ttl));
  END IF;
  RETURN v_id;
END;
$$;
--> statement-breakpoint

-- Files whose retention has ended and that are not deleted yet (the job deletes the objects first).
CREATE OR REPLACE FUNCTION public.exported_files_due(p_now timestamptz DEFAULT now(), p_limit integer DEFAULT 100)
RETURNS SETOF public.exported_files
LANGUAGE sql STABLE AS $$
  SELECT * FROM public.exported_files WHERE deleted_at IS NULL AND expires_at <= p_now ORDER BY expires_at LIMIT p_limit
$$;
--> statement-breakpoint

-- Marks files deleted (after their objects were removed) and audits each one.
CREATE OR REPLACE FUNCTION public.exported_files_mark_deleted(p_ids uuid[], p_actor_id uuid DEFAULT NULL, p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN UPDATE public.exported_files SET deleted_at = p_now WHERE id = ANY (p_ids) AND deleted_at IS NULL
           RETURNING id, contains_identity, report_id, data_request_id, expires_at LOOP
    INSERT INTO public.audit_log (actor_id, action, target, meta_jsonb)
    VALUES (p_actor_id, 'export.delete', 'exported_file:' || r.id,
            jsonb_build_object('contains_identity', r.contains_identity, 'report_id', r.report_id,
                               'data_request_id', r.data_request_id, 'expired_at', r.expires_at));
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- Email outbox
------------------------------------------------------------------------------------------------

-- Claims one email for sending (queued, or failed with attempts left). Null when already sent,
-- in flight, or out of attempts — a duplicate job never sends twice.
CREATE OR REPLACE FUNCTION public.email_claim(p_id uuid, p_max_attempts integer DEFAULT 5, p_now timestamptz DEFAULT now())
RETURNS SETOF public.email_outbox
LANGUAGE sql AS $$
  UPDATE public.email_outbox SET state = 'sending', attempts = attempts + 1
   WHERE id = p_id AND state IN ('queued', 'failed') AND attempts < p_max_attempts
  RETURNING *
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.email_finish(
  p_id uuid, p_ok boolean, p_error text DEFAULT NULL, p_provider_id text DEFAULT NULL, p_now timestamptz DEFAULT now()
) RETURNS text
LANGUAGE sql AS $$
  UPDATE public.email_outbox SET state = CASE WHEN p_ok THEN 'sent'::public.email_state ELSE 'failed'::public.email_state END,
         sent_at = CASE WHEN p_ok THEN p_now END, last_error = CASE WHEN p_ok THEN NULL ELSE left(p_error, 500) END,
         provider_id = coalesce(p_provider_id, provider_id)
   WHERE id = p_id AND state = 'sending'
  RETURNING state::text
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- Notifications
------------------------------------------------------------------------------------------------

-- An attendee's notifications: personal ones, and broadcasts for events they hold a confirmed
-- registration for (matching tier when the broadcast names one), newest first, with read state.
CREATE OR REPLACE FUNCTION public.notifications_for_attendee(p_attendee_id uuid, p_now timestamptz DEFAULT now(), p_limit integer DEFAULT 50)
RETURNS TABLE (id uuid, kind text, at timestamptz, title text, body text, read boolean, event_id uuid)
LANGUAGE sql STABLE AS $$
  SELECT n.id, n.kind::text, n.created_at, n.title, n.body,
         EXISTS (SELECT 1 FROM public.notification_reads r WHERE r.notification_id = n.id AND r.attendee_id = p_attendee_id),
         n.event_id
    FROM public.notifications n
   WHERE n.expires_at > p_now
     AND (n.attendee_id = p_attendee_id
          OR (n.attendee_id IS NULL AND EXISTS (
                SELECT 1 FROM public.registrations g
                 WHERE g.event_id = n.event_id AND g.attendee_id = p_attendee_id AND g.state = 'confirmed'
                   AND (n.audience_tier IS NULL OR g.tier::text = n.audience_tier))))
   ORDER BY n.created_at DESC
   LIMIT p_limit
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- Cleanup and erasure
------------------------------------------------------------------------------------------------

-- Deletes delivered state past its use: sent or failed emails after 7 days (their encrypted
-- recipients and content), expired notifications, finished schedules after 30 days (recipient
-- lists). Exported files go through exported_files_due / _mark_deleted (objects first).
CREATE OR REPLACE FUNCTION public.delivery_cleanup(p_now timestamptz DEFAULT now(), p_batch integer DEFAULT 10000)
RETURNS TABLE (emails bigint, notifications bigint, schedules bigint)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
BEGIN
  DELETE FROM public.email_outbox WHERE id IN (
    SELECT id FROM public.email_outbox
     WHERE (state = 'sent' AND sent_at < p_now - interval '7 days')
        OR (state = 'failed' AND created_at < p_now - interval '7 days')
     LIMIT p_batch);
  GET DIAGNOSTICS emails = ROW_COUNT;
  DELETE FROM public.notifications WHERE id IN (SELECT id FROM public.notifications WHERE expires_at <= p_now LIMIT p_batch);
  GET DIAGNOSTICS notifications = ROW_COUNT;
  DELETE FROM public.report_schedules WHERE id IN (
    SELECT id FROM public.report_schedules WHERE state IN ('done', 'failed') AND updated_at < p_now - interval '30 days' LIMIT p_batch);
  GET DIAGNOSTICS schedules = ROW_COUNT;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- Device token version
------------------------------------------------------------------------------------------------

-- Any token change, and any move out of `active`, bumps token_version, so access tokens minted
-- from an earlier version (which carry it) stop working on their next request — whoever made the
-- change. A device issued a token at registration starts at 1.
CREATE OR REPLACE FUNCTION public.devices_token_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.token_version := CASE WHEN NEW.token_hash IS NULL THEN 0 ELSE 1 END;
  ELSIF NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR (OLD.state = 'active' AND NEW.state <> 'active') THEN
    NEW.token_version := OLD.token_version + 1;
  ELSE
    NEW.token_version := OLD.token_version;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER devices_token_version BEFORE INSERT OR UPDATE ON public.devices
  FOR EACH ROW EXECUTE FUNCTION public.devices_token_version();
--> statement-breakpoint

-- Erasure also removes the attendee's notifications and read receipts (same signature; privileges kept).
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
    DELETE FROM public.notification_reads WHERE attendee_id = d.attendee_id;
    DELETE FROM public.notifications WHERE attendee_id = d.attendee_id;
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target, meta_jsonb)
  VALUES (p_actor_id, 'data_request.' || p_state::text, 'data_request:' || d.id, jsonb_build_object('kind', d.kind));
  status := p_state::text;
  RETURN NEXT;
END;
$$;
