-- 0022 — email claim lease, due emails, gate positions in gate health, alert retention (hand-written).
--
--   A. Email outbox: a claim is a lease. email_claim() also takes a `sending` row whose claim is
--      older than the lease (default 120 seconds), so an email left `sending` by a crashed worker
--      is retried; email_due() lists claimable ids for a sweep; delivery_cleanup() fails rows
--      abandoned in `sending` for a day, so they reach the 7-day deletion.
--   B. gate_health() also returns checkpoints.position_jsonb (column and check from 0021).
--   C. alerts_prune(): breach alerts are kept 12 months (D-03, O-11), then deleted.

------------------------------------------------------------------------------------------------
-- A. Email outbox
------------------------------------------------------------------------------------------------

-- Rows already `sending` (claimed before this migration, so without claimed_at) get a claim time
-- now: they are retried once the lease runs out, never immediately.
UPDATE public.email_outbox SET claimed_at = now() WHERE state = 'sending' AND claimed_at IS NULL;
--> statement-breakpoint

-- The lease is a new trailing argument, so callers of the three-argument form keep working.
DROP FUNCTION IF EXISTS public.email_claim(uuid, integer, timestamptz);
--> statement-breakpoint

-- Claims one email for sending: queued, failed with attempts left, or `sending` with a claim older
-- than p_lease (its worker died; the lost try counts as an attempt). Null when already sent, in
-- flight under a live lease, or out of attempts. One UPDATE: under concurrent claimers the row lock
-- serialises them and the loser re-checks the WHERE against the winner's row (state `sending`,
-- claimed_at = now), so exactly one wins. The worker must finish (or give up) well within the lease:
-- set the mail provider's timeout below it.
CREATE FUNCTION public.email_claim(
  p_id uuid, p_max_attempts integer DEFAULT 5, p_now timestamptz DEFAULT now(), p_lease interval DEFAULT '120 seconds'
) RETURNS SETOF public.email_outbox
LANGUAGE sql AS $$
  UPDATE public.email_outbox SET state = 'sending', attempts = attempts + 1, claimed_at = p_now
   WHERE id = p_id
     AND attempts < p_max_attempts
     AND (state IN ('queued', 'failed')
          OR (state = 'sending' AND (claimed_at IS NULL OR claimed_at <= p_now - p_lease)))
  RETURNING *
$$;
--> statement-breakpoint

-- Ids a sweep should claim, oldest first: queued, failed with attempts left, and `sending` rows
-- whose lease has run out. Reads ids, states, attempts and times only — never address or content.
CREATE FUNCTION public.email_due(
  p_max_attempts integer DEFAULT 5, p_limit integer DEFAULT 100, p_lease interval DEFAULT '120 seconds', p_now timestamptz DEFAULT now()
) RETURNS SETOF uuid
LANGUAGE sql STABLE AS $$
  SELECT o.id FROM public.email_outbox o
   WHERE o.attempts < p_max_attempts
     AND (o.state IN ('queued', 'failed')
          OR (o.state = 'sending' AND (o.claimed_at IS NULL OR o.claimed_at <= p_now - p_lease)))
   ORDER BY o.created_at, o.id
   LIMIT p_limit
$$;
--> statement-breakpoint

-- Cleanup also fails email abandoned in `sending` for over a day (e.g. out of attempts, so never
-- reclaimed), so its encrypted recipient and content still reach the 7-day deletion.
CREATE OR REPLACE FUNCTION public.delivery_cleanup(p_now timestamptz DEFAULT now(), p_batch integer DEFAULT 10000)
RETURNS TABLE (emails bigint, notifications bigint, schedules bigint)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
BEGIN
  UPDATE public.email_outbox SET state = 'failed', last_error = 'abandoned: claim lease expired'
   WHERE id IN (SELECT id FROM public.email_outbox
                 WHERE state = 'sending' AND coalesce(claimed_at, created_at) < p_now - interval '1 day' LIMIT p_batch);
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
-- B. Gate health with the gate's position on the grid
------------------------------------------------------------------------------------------------

-- The result gains a column, so the function is recreated (same arguments, EXECUTE stays PUBLIC).
DROP FUNCTION IF EXISTS public.gate_health(uuid, uuid, timestamptz);
--> statement-breakpoint
CREATE FUNCTION public.gate_health(p_venue_id uuid, p_event_id uuid DEFAULT NULL, p_now timestamptz DEFAULT now())
RETURNS TABLE (
  checkpoint_id uuid, label text, direction text, perimeter boolean, hardware_id text,
  link_state text, last_heartbeat_at timestamptz, heartbeat_age_s integer, clock_offset_ms integer, clock_fault boolean,
  queue_depth integer, last_scan_at timestamptz, scans_last_15m bigint, staff_on_duty bigint, "position" jsonb
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
         (SELECT count(*) FROM public.staff_on_duty(c.id, p_now)),
         c.position_jsonb
    FROM public.checkpoints c
   WHERE c.venue_id = p_venue_id
   ORDER BY (c.last_heartbeat_at IS NULL OR p_now - c.last_heartbeat_at > interval '60 seconds') DESC, c.label
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- C. Breach-alert retention (D-03: 12 months; O-11: the credential reference lives as long)
------------------------------------------------------------------------------------------------

-- Deletes breach alerts that occurred more than p_months months before p_now (never fewer than
-- 12), with their finished webhook deliveries (whose payload copies the alert). An alert with a
-- delivery still pending or in flight waits for a later run. Reports and the live summary lose
-- those alerts; the frozen post-event summary (event_summaries) keeps its counts. One audit entry
-- per run that deleted anything. Returns the number of alerts deleted.
CREATE FUNCTION public.alerts_prune(p_months integer DEFAULT 12, p_now timestamptz DEFAULT now())
RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_cutoff timestamptz;
  v_ids uuid[];
  v_deliveries bigint;
BEGIN
  IF p_months IS NULL OR p_months < 12 THEN
    RAISE EXCEPTION 'breach alerts are kept at least 12 months (got %)', p_months USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_cutoff := p_now - make_interval(months => p_months);
  SELECT coalesce(array_agg(a.id), '{}') INTO v_ids
    FROM public.breach_alerts a
   WHERE a.occurred_at < v_cutoff
     AND NOT EXISTS (SELECT 1 FROM public.webhook_deliveries w
                      WHERE w.alert_id = a.id AND w.state IN ('pending', 'in_flight'));
  IF cardinality(v_ids) = 0 THEN
    RETURN 0;
  END IF;
  DELETE FROM public.webhook_deliveries WHERE alert_id = ANY (v_ids);
  GET DIAGNOSTICS v_deliveries = ROW_COUNT;
  DELETE FROM public.breach_alerts WHERE id = ANY (v_ids);
  INSERT INTO public.audit_log (actor_id, action, target, meta_jsonb)
  VALUES (NULL, 'retention.alerts_pruned', 'breach_alerts',
          jsonb_build_object('deleted', cardinality(v_ids), 'webhook_deliveries', v_deliveries,
                             'occurred_before', v_cutoff, 'months', p_months));
  RETURN cardinality(v_ids);
END;
$$;
--> statement-breakpoint
ALTER FUNCTION public.alerts_prune(integer, timestamptz) SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
-- Like audit_prune: only the application role, which the job workers log in as.
REVOKE EXECUTE ON FUNCTION public.alerts_prune(integer, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.alerts_prune(integer, timestamptz) TO app_api;
