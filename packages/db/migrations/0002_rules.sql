-- 0002 — rules (hand-written). Everything Drizzle cannot declare:
--   A. Generic triggers (updated_at), venue consistency, event state machine
--   B. Per-event scan partitions + append-only scans
--   C. Staff-assignment overlap exclusion
--   D. Hash-chained, append-only audit log
--   E. Identity vault row-level security
--   F. Occupancy derivation (series, current occupancy, last counted room)
--   G. Rollups, attendance snapshot, and the post-event purge
--
-- Every statement is separated by a breakpoint because some drivers (PGlite) run one statement
-- per call.

------------------------------------------------------------------------------------------------
-- A. Generic triggers, venue consistency, event lifecycle
------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER organizations_touch BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER venues_touch BEFORE UPDATE ON public.venues FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER rooms_touch BEFORE UPDATE ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER events_touch BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER users_touch BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER registrations_touch BEFORE UPDATE ON public.registrations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER attendees_touch BEFORE UPDATE ON pii_vault.attendees FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
--> statement-breakpoint

-- An event may only use rooms of its own venue.
CREATE OR REPLACE FUNCTION public.event_rooms_same_venue() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e JOIN public.rooms r ON r.venue_id = e.venue_id
    WHERE e.id = NEW.event_id AND r.id = NEW.room_id
  ) THEN
    RAISE EXCEPTION 'room % is not in the venue of event %', NEW.room_id, NEW.event_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER event_rooms_same_venue BEFORE INSERT OR UPDATE ON public.event_rooms
FOR EACH ROW EXECUTE FUNCTION public.event_rooms_same_venue();
--> statement-breakpoint

-- Event lifecycle (01 §9): draft → published → live → closed → archived, plus
-- published → draft (unpublish) and published → closed (cancel before going live).
-- Publishing requires at least one room with capacity and a pass template.
-- Closing stamps closed_at, which starts the retention clock (03 §6).
-- Rows may be INSERTed in any state (imports, seeds); only transitions are guarded.
CREATE OR REPLACE FUNCTION public.events_guard_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NOT ((OLD.state, NEW.state) IN (
      ('draft'::event_state, 'published'::event_state),
      ('published', 'draft'),
      ('published', 'live'),
      ('published', 'closed'),
      ('live', 'closed'),
      ('closed', 'archived')
    )) THEN
      RAISE EXCEPTION 'event % cannot move from % to %', OLD.id, OLD.state, NEW.state
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.state = 'published' AND OLD.state = 'draft' THEN
      IF NEW.pass_template_jsonb IS NULL THEN
        RAISE EXCEPTION 'event % cannot be published without a pass template', OLD.id
          USING ERRCODE = 'check_violation';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.event_rooms er JOIN public.rooms r ON r.id = er.room_id
        WHERE er.event_id = NEW.id AND coalesce(er.capacity_override, r.capacity) > 0
      ) THEN
        RAISE EXCEPTION 'event % cannot be published without at least one room with capacity', OLD.id
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF NEW.state = 'closed' THEN
      NEW.closed_at := coalesce(NEW.closed_at, now());
    END IF;
  END IF;

  IF OLD.purged_at IS NOT NULL AND NEW.purged_at IS DISTINCT FROM OLD.purged_at THEN
    RAISE EXCEPTION 'event % purged_at cannot be changed once set', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER events_guard_transition BEFORE UPDATE ON public.events
FOR EACH ROW EXECUTE FUNCTION public.events_guard_transition();
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- B. Scan partitions (one per event) and append-only scans
------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.scan_partition_name(p_event_id uuid) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN 'scans_' || replace(p_event_id::text, '-', '');
--> statement-breakpoint

-- Idempotent. Called by the events insert trigger; callable by hand for repair.
CREATE OR REPLACE FUNCTION public.create_scan_partition(p_event_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_name text := public.scan_partition_name(p_event_id);
BEGIN
  IF EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id AND purged_at IS NOT NULL) THEN
    RAISE EXCEPTION 'event % has been purged; its scan partition cannot be recreated', p_event_id
      USING ERRCODE = 'check_violation';
  END IF;
  EXECUTE format('CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.scans FOR VALUES IN (%L)',
                 v_name, p_event_id);
  RETURN v_name;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.events_scan_partition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.create_scan_partition(NEW.id);
    RETURN NEW;
  ELSE
    EXECUTE format('DROP TABLE IF EXISTS public.%I', public.scan_partition_name(OLD.id));
    RETURN OLD;
  END IF;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER events_scan_partition_ins AFTER INSERT ON public.events
FOR EACH ROW EXECUTE FUNCTION public.events_scan_partition();
--> statement-breakpoint
CREATE TRIGGER events_scan_partition_del AFTER DELETE ON public.events
FOR EACH ROW EXECUTE FUNCTION public.events_scan_partition();
--> statement-breakpoint

-- scans is append-only (02 §4.4). Row triggers on a partitioned table are cloned to every partition.
-- Removal happens only by dropping a whole partition in purge_event_movement_data().
CREATE OR REPLACE FUNCTION public.reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % rejected', TG_TABLE_NAME, TG_OP USING ERRCODE = 'object_not_in_prerequisite_state';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER scans_append_only BEFORE UPDATE OR DELETE ON public.scans
FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();
--> statement-breakpoint
CREATE TRIGGER scans_no_truncate BEFORE TRUNCATE ON public.scans
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_mutation();
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- C. Staff assignments: no overlapping shifts per user (01 §3)
------------------------------------------------------------------------------------------------

ALTER TABLE public.staff_assignments
  ADD CONSTRAINT staff_assignments_no_overlap
  EXCLUDE USING gist (user_id WITH =, tstzrange(shift_start, shift_end, '[)') WITH &&);
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- D. Audit log: hash chain + append-only (03 §7)
------------------------------------------------------------------------------------------------

-- Single-row chain head. Inserting into audit_log locks this row, which serialises appends:
-- under READ COMMITTED the next writer waits and then reads the new head; under REPEATABLE READ /
-- SERIALIZABLE a concurrent append fails with a serialization error (retry) instead of forking
-- the chain.
CREATE TABLE public.audit_chain_head (
  id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_id             bigint,
  last_hash           text NOT NULL,
  pruned_through_id   bigint,
  pruned_anchor_hash  text
);
--> statement-breakpoint
INSERT INTO public.audit_chain_head (id, last_id, last_hash) VALUES (true, NULL, repeat('0', 64));
--> statement-breakpoint

-- hash = sha256(prev_hash || canonical JSON of the entry). jsonb text output is canonical
-- (sorted keys, normalised spacing), and `at` is hashed as integer microseconds since the epoch.
CREATE OR REPLACE FUNCTION public.audit_entry_hash(
  p_prev_hash text, p_id bigint, p_actor_id uuid, p_action text, p_target text, p_meta jsonb, p_at timestamptz
) RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
RETURN encode(
  sha256(convert_to(
    p_prev_hash || jsonb_build_array(
      p_id, p_actor_id, p_action, p_target, p_meta,
      (extract(epoch FROM p_at) * 1000000)::bigint
    )::text,
    'UTF8')),
  'hex');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.audit_log_chain() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_prev text;
BEGIN
  SELECT last_hash INTO v_prev FROM public.audit_chain_head WHERE id FOR UPDATE;
  NEW.id        := nextval(pg_get_serial_sequence('public.audit_log', 'id'));
  NEW.at        := now();          -- the database, not the caller, says when
  NEW.meta_jsonb := coalesce(NEW.meta_jsonb, '{}'::jsonb);
  NEW.prev_hash := v_prev;
  NEW.hash      := public.audit_entry_hash(v_prev, NEW.id, NEW.actor_id, NEW.action, NEW.target, NEW.meta_jsonb, NEW.at);
  UPDATE public.audit_chain_head SET last_id = NEW.id, last_hash = NEW.hash WHERE id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_chain BEFORE INSERT ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION public.audit_log_chain();
--> statement-breakpoint

-- Append-only. The single exception is retention pruning (D-03: 12 months) through audit_prune(),
-- which may delete only entries older than 12 months.
CREATE OR REPLACE FUNCTION public.audit_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.audit_prune', true) = 'on'
     AND OLD.at < now() - interval '12 months' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_log is append-only: % rejected', TG_OP USING ERRCODE = 'object_not_in_prerequisite_state';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION public.audit_log_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON public.audit_log
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_mutation();
--> statement-breakpoint

-- Walks the chain. Returns one row per problem; no rows = intact.
CREATE OR REPLACE FUNCTION public.audit_verify()
RETURNS TABLE (entry_id bigint, problem text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r       public.audit_log%ROWTYPE;
  h       public.audit_chain_head%ROWTYPE;
  v_prev  text;
  v_last  bigint;
BEGIN
  SELECT * INTO h FROM public.audit_chain_head WHERE id;
  v_prev := coalesce(h.pruned_anchor_hash, repeat('0', 64));
  FOR r IN SELECT * FROM public.audit_log ORDER BY id LOOP
    IF r.prev_hash <> v_prev THEN
      entry_id := r.id; problem := 'prev_hash does not match the previous entry (entry removed, inserted or reordered)';
      RETURN NEXT;
    END IF;
    IF r.hash <> public.audit_entry_hash(r.prev_hash, r.id, r.actor_id, r.action, r.target, r.meta_jsonb, r.at) THEN
      entry_id := r.id; problem := 'hash does not match the entry contents (entry altered)';
      RETURN NEXT;
    END IF;
    v_prev := r.hash;
    v_last := r.id;
  END LOOP;
  IF v_prev <> h.last_hash THEN
    entry_id := v_last; problem := 'last entry does not match the chain head (trailing entries removed)';
    RETURN NEXT;
  END IF;
END;
$$;
--> statement-breakpoint

-- Retention (D-03). Deletes the oldest contiguous run of entries older than 12 months and records
-- the hash they ended on, so audit_verify() still anchors the remaining chain.
CREATE OR REPLACE FUNCTION public.audit_prune() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cutoff_id bigint;
  v_anchor    text;
  v_deleted   bigint;
BEGIN
  PERFORM 1 FROM public.audit_chain_head WHERE id FOR UPDATE;
  SELECT coalesce(min(id) - 1, (SELECT max(id) FROM public.audit_log))
    INTO v_cutoff_id
    FROM public.audit_log WHERE at >= now() - interval '12 months';
  IF v_cutoff_id IS NULL THEN
    RETURN 0;
  END IF;
  SELECT hash INTO v_anchor FROM public.audit_log WHERE id <= v_cutoff_id ORDER BY id DESC LIMIT 1;
  IF v_anchor IS NULL THEN
    RETURN 0;
  END IF;
  PERFORM set_config('app.audit_prune', 'on', true);
  DELETE FROM public.audit_log WHERE id <= v_cutoff_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  PERFORM set_config('app.audit_prune', 'off', true);
  UPDATE public.audit_chain_head SET pruned_through_id = v_cutoff_id, pruned_anchor_hash = v_anchor WHERE id;
  RETURN v_deleted;
END;
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- E. Identity vault: row-level security (03 §5)
--
-- RLS is ENABLED and FORCED, so it applies to the table owner too (only superusers and roles with
-- BYPASSRLS skip it). Access is granted per transaction by `app.vault_scope`:
--   system    background jobs, purge, erasure, seed: everything
--   operator  Admin Command: read/insert/update attendees; no ephemeral mapping
--   attendee  one attendee (app.attendee_id): own attendee row only
--   scan      scan ingest: read/insert the ephemeral mapping; no attendee rows
-- Unset scope → no rows visible, every write rejected.
------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pii_vault.current_scope() RETURNS text
LANGUAGE sql STABLE
RETURN coalesce(nullif(current_setting('app.vault_scope', true), ''), 'none');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pii_vault.current_attendee() RETURNS uuid
LANGUAGE sql STABLE
RETURN nullif(current_setting('app.attendee_id', true), '')::uuid;
--> statement-breakpoint
ALTER TABLE pii_vault.attendees ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE pii_vault.attendees FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY attendees_select ON pii_vault.attendees FOR SELECT
  USING (pii_vault.current_scope() IN ('system', 'operator')
         OR (pii_vault.current_scope() = 'attendee' AND id = pii_vault.current_attendee()));
--> statement-breakpoint
CREATE POLICY attendees_insert ON pii_vault.attendees FOR INSERT
  WITH CHECK (pii_vault.current_scope() IN ('system', 'operator')
              OR (pii_vault.current_scope() = 'attendee' AND id = pii_vault.current_attendee()));
--> statement-breakpoint
CREATE POLICY attendees_update ON pii_vault.attendees FOR UPDATE
  USING (pii_vault.current_scope() IN ('system', 'operator')
         OR (pii_vault.current_scope() = 'attendee' AND id = pii_vault.current_attendee()))
  WITH CHECK (pii_vault.current_scope() IN ('system', 'operator')
              OR (pii_vault.current_scope() = 'attendee' AND id = pii_vault.current_attendee()));
--> statement-breakpoint
CREATE POLICY attendees_delete ON pii_vault.attendees FOR DELETE
  USING (pii_vault.current_scope() = 'system');
--> statement-breakpoint
ALTER TABLE pii_vault.ephemeral_ids ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE pii_vault.ephemeral_ids FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ephemeral_ids_select ON pii_vault.ephemeral_ids FOR SELECT
  USING (pii_vault.current_scope() IN ('system', 'scan'));
--> statement-breakpoint
CREATE POLICY ephemeral_ids_insert ON pii_vault.ephemeral_ids FOR INSERT
  WITH CHECK (pii_vault.current_scope() IN ('system', 'scan'));
--> statement-breakpoint
CREATE POLICY ephemeral_ids_delete ON pii_vault.ephemeral_ids FOR DELETE
  USING (pii_vault.current_scope() = 'system');
--> statement-breakpoint
-- No UPDATE policy on ephemeral_ids: the mapping is never rewritten.

-- Erasure (03 §5 attendee rights): scrub identifying columns; keep the row so registrations and
-- aggregates keep referential integrity. Audited.
CREATE OR REPLACE FUNCTION pii_vault.erase_attendee(p_attendee_id uuid, p_actor_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pii_vault, pg_temp AS $$
DECLARE
  v_prev_scope text := current_setting('app.vault_scope', true);
  v_found boolean;
BEGIN
  PERFORM set_config('app.vault_scope', 'system', true);
  UPDATE pii_vault.attendees
     SET email = NULL, email_hash = NULL, full_name = NULL, profile_jsonb = '{}'::jsonb,
         erased_at = coalesce(erased_at, now())
   WHERE id = p_attendee_id;
  v_found := FOUND;
  PERFORM set_config('app.vault_scope', coalesce(v_prev_scope, ''), true);
  IF v_found THEN
    INSERT INTO public.audit_log (actor_id, action, target, meta_jsonb)
    VALUES (p_actor_id, 'attendee.erase', 'attendee:' || p_attendee_id, '{}'::jsonb);
  END IF;
  RETURN v_found;
END;
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- F. Occupancy (01 §7, D-10). Always derived from scans + occupancy_adjustments.
--
-- Effect of each scan on the room of its checkpoint (checkpoints without room_id affect no room):
--   admitted, direction in   +1      direction = coalesce(scans.direction, checkpoint direction);
--   admitted, direction out  −1      an admitted scan at a `both` checkpoint with no scan
--   implied_exit             −1      direction affects nothing (the API must send direction there).
--   anything else             0
-- Adjustments: set_to NOT NULL is an anchor (count := set_to at `at`); otherwise count += delta.
-- Order: scans by corrected_at (D-14), adjustments by at; at equal times scans first, then delta
-- adjustments, then anchors. The running count is clamped at zero at every step (01 §7: never
-- negative); a clamp is reported as a reconciliation fault.
------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.room_occupancy_series(p_event_id uuid, p_as_of timestamptz DEFAULT 'infinity')
RETURNS TABLE (
  room_id      uuid,
  seq          bigint,
  t            timestamptz,
  source       text,      -- 'scan' | 'adjustment'
  source_id    uuid,
  delta        integer,
  set_to       integer,
  level        integer,   -- occupancy after this step, clamped
  raw_level    integer    -- unclamped running value within the segment (< 0 ⇒ a clamp happened)
)
LANGUAGE sql STABLE AS $$
  WITH fx AS (
    SELECT c.room_id,
           s.corrected_at AS t,
           0 AS prio,
           s.id AS source_id,
           'scan'::text AS source,
           CASE
             WHEN s.result = 'implied_exit' THEN -1
             WHEN coalesce(s.direction::text, nullif(c.direction::text, 'both')) = 'in'  THEN 1
             WHEN coalesce(s.direction::text, nullif(c.direction::text, 'both')) = 'out' THEN -1
             ELSE 0
           END AS d,
           NULL::integer AS set_to
      FROM public.scans s
      JOIN public.checkpoints c ON c.id = s.checkpoint_id
     WHERE s.event_id = p_event_id
       AND c.room_id IS NOT NULL
       AND s.result IN ('admitted', 'implied_exit')
       AND s.corrected_at <= p_as_of
    UNION ALL
    SELECT a.room_id,
           a.at,
           CASE WHEN a.set_to IS NULL THEN 1 ELSE 2 END,
           a.id,
           'adjustment',
           CASE WHEN a.set_to IS NULL THEN a.delta ELSE 0 END,
           a.set_to
      FROM public.occupancy_adjustments a
     WHERE a.event_id = p_event_id
       AND a.at <= p_as_of
  ),
  ordered AS (
    SELECT fx.*, row_number() OVER (PARTITION BY fx.room_id ORDER BY fx.t, fx.prio, fx.source_id) AS rn
      FROM fx
  ),
  segmented AS (
    SELECT o.*, count(o.set_to) OVER (PARTITION BY o.room_id ORDER BY o.rn) AS seg
      FROM ordered o
  ),
  running AS (
    SELECT sg.*,
           first_value(coalesce(sg.set_to, 0)) OVER (PARTITION BY sg.room_id, sg.seg ORDER BY sg.rn)
             + sum(sg.d) OVER (PARTITION BY sg.room_id, sg.seg ORDER BY sg.rn) AS s
      FROM segmented sg
  )
  SELECT r.room_id, r.rn, r.t, r.source, r.source_id, r.d, r.set_to,
         (r.s - least(0, min(r.s) OVER (PARTITION BY r.room_id, r.seg ORDER BY r.rn)))::integer,
         r.s::integer
    FROM running r
$$;
--> statement-breakpoint

-- Current (or as-of) occupancy of every room of an event, with its capacity status.
CREATE OR REPLACE FUNCTION public.room_occupancy(p_event_id uuid, p_as_of timestamptz DEFAULT now())
RETURNS TABLE (
  room_id               uuid,
  occupancy             integer,
  capacity              integer,
  warn_at_pct           smallint,
  block_at_pct          smallint,
  pct                   numeric,
  status                text,      -- 'ok' | 'warn' | 'block'
  reconciliation_fault  boolean,   -- the count was clamped at zero at least once
  last_change_at        timestamptz
)
LANGUAGE sql STABLE AS $$
  WITH series AS (
    SELECT * FROM public.room_occupancy_series(p_event_id, p_as_of)
  ),
  last_step AS (
    SELECT DISTINCT ON (s.room_id) s.room_id, s.level, s.t
      FROM series s
     ORDER BY s.room_id, s.seq DESC
  ),
  faults AS (
    SELECT s.room_id, bool_or(s.raw_level < 0) AS fault FROM series s GROUP BY s.room_id
  )
  SELECT er.room_id,
         coalesce(ls.level, 0),
         coalesce(er.capacity_override, r.capacity),
         r.warn_at_pct,
         r.block_at_pct,
         CASE WHEN coalesce(er.capacity_override, r.capacity) > 0
              THEN round(100.0 * coalesce(ls.level, 0) / coalesce(er.capacity_override, r.capacity), 1) END,
         CASE
           WHEN coalesce(er.capacity_override, r.capacity) = 0 THEN
             CASE WHEN coalesce(ls.level, 0) > 0 THEN 'block' ELSE 'ok' END
           WHEN 100.0 * coalesce(ls.level, 0) / coalesce(er.capacity_override, r.capacity) >= r.block_at_pct THEN 'block'
           WHEN 100.0 * coalesce(ls.level, 0) / coalesce(er.capacity_override, r.capacity) >= r.warn_at_pct THEN 'warn'
           ELSE 'ok'
         END,
         coalesce(f.fault, false),
         ls.t
    FROM public.event_rooms er
    JOIN public.rooms r ON r.id = er.room_id
    LEFT JOIN last_step ls ON ls.room_id = er.room_id
    LEFT JOIN faults f ON f.room_id = er.room_id
   WHERE er.event_id = p_event_id
$$;
--> statement-breakpoint

-- Live occupancy for every live event.
CREATE OR REPLACE VIEW public.current_room_occupancy AS
SELECT e.id AS event_id, o.*
  FROM public.events e
  CROSS JOIN LATERAL public.room_occupancy(e.id, now()) o
 WHERE e.state = 'live';
--> statement-breakpoint

-- The room a person is currently counted in (for writing an `implied_exit`, D-10), or no row.
-- They are counted in room R if their latest room-affecting scan is an inbound admission to R and
-- R has not been emptied since: a session-end reset, or any anchor that set the count to 0.
-- A recount to a non-zero headcount does not un-count them: they are part of that headcount.
-- Returns the checkpoint of that admission: write the implied_exit row against it.
CREATE OR REPLACE FUNCTION public.last_counted_room(p_event_id uuid, p_ephemeral_id uuid, p_as_of timestamptz DEFAULT now())
RETURNS TABLE (room_id uuid, checkpoint_id uuid, entered_at timestamptz)
LANGUAGE sql STABLE AS $$
  WITH latest AS (
    SELECT c.room_id, s.checkpoint_id, s.corrected_at, s.result,
           coalesce(s.direction::text, nullif(c.direction::text, 'both')) AS dir
      FROM public.scans s
      JOIN public.checkpoints c ON c.id = s.checkpoint_id
     WHERE s.event_id = p_event_id
       AND s.ephemeral_id = p_ephemeral_id
       AND c.room_id IS NOT NULL
       AND s.result IN ('admitted', 'implied_exit')
       AND s.corrected_at <= p_as_of
     -- On a tie, the admission wins: an implied exit is written at the same instant as the
     -- admission that caused it.
     ORDER BY s.corrected_at DESC, (s.result = 'admitted') DESC
     LIMIT 1
  )
  SELECT l.room_id, l.checkpoint_id, l.corrected_at
    FROM latest l
   WHERE l.result = 'admitted' AND l.dir = 'in'
     AND NOT EXISTS (
       SELECT 1 FROM public.occupancy_adjustments a
        WHERE a.event_id = p_event_id AND a.room_id = l.room_id
          AND a.set_to IS NOT NULL AND (a.reason = 'session_end' OR a.set_to = 0)
          AND a.at >= l.corrected_at AND a.at <= p_as_of
     )
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- G. Rollups, attendance snapshot, purge
------------------------------------------------------------------------------------------------

-- Recomputes occupancy_rollups (5-minute buckets) and gate_rate_rollups (per minute) for one event
-- from its scans. Idempotent. Called by the purge before the partition is dropped.
CREATE OR REPLACE FUNCTION public.rebuild_event_rollups(p_event_id uuid)
RETURNS TABLE (occupancy_rows bigint, gate_rate_rows bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pii_vault, pg_temp AS $$
DECLARE
  v_prev_scope text := current_setting('app.vault_scope', true);
  v_occ bigint;
  v_gate bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id AND purged_at IS NOT NULL) THEN
    RAISE EXCEPTION 'event % has been purged; rollups can no longer be rebuilt', p_event_id
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  DELETE FROM public.occupancy_rollups WHERE event_id = p_event_id;
  INSERT INTO public.occupancy_rollups (event_id, room_id, bucket_start, in_count, out_count, peak)
  SELECT p_event_id,
         s.room_id,
         date_bin(interval '5 minutes', s.t, timestamptz '2000-01-01 00:00:00+00'),
         count(*) FILTER (WHERE s.source = 'scan' AND s.delta = 1),
         count(*) FILTER (WHERE s.source = 'scan' AND s.delta = -1),
         max(s.level)
    FROM public.room_occupancy_series(p_event_id) s
   GROUP BY 1, 2, 3;
  GET DIAGNOSTICS v_occ = ROW_COUNT;

  -- Tier lookup crosses the vault (ephemeral → credential → registration). Counts only leave it.
  PERFORM set_config('app.vault_scope', 'system', true);
  DELETE FROM public.gate_rate_rollups WHERE event_id = p_event_id;
  WITH tiered AS (
    SELECT s.checkpoint_id,
           date_trunc('minute', s.corrected_at) AS minute_start,
           s.result,
           CASE
             WHEN cr.staff_user_id IS NOT NULL THEN 'STAFF'
             WHEN rg.tier IS NOT NULL THEN rg.tier::text
             ELSE 'UNKNOWN'
           END AS tier
      FROM public.scans s
      LEFT JOIN pii_vault.ephemeral_ids e ON e.event_id = s.event_id AND e.ephemeral_id = s.ephemeral_id
      LEFT JOIN public.credentials cr ON cr.id = e.credential_id
      LEFT JOIN public.registrations rg ON rg.id = cr.registration_id
     WHERE s.event_id = p_event_id
       AND s.result <> 'implied_exit'
  ),
  per_tier AS (
    SELECT checkpoint_id, minute_start, tier, count(*) AS n
      FROM tiered GROUP BY 1, 2, 3
  ),
  tier_json AS (
    SELECT checkpoint_id, minute_start, jsonb_object_agg(tier, n) AS by_tier
      FROM per_tier GROUP BY 1, 2
  )
  INSERT INTO public.gate_rate_rollups (event_id, checkpoint_id, minute_start, scans, admitted, denied, by_tier_jsonb)
  SELECT p_event_id, t.checkpoint_id, t.minute_start,
         count(*),
         count(*) FILTER (WHERE t.result = 'admitted'),
         count(*) FILTER (WHERE t.result IN ('denied_room', 'capacity_block', 'revoked', 'suspended',
                                             'unknown_token', 'wristband_required', 'pass_spent')),
         tj.by_tier
    FROM tiered t
    JOIN tier_json tj USING (checkpoint_id, minute_start)
   GROUP BY t.checkpoint_id, t.minute_start, tj.by_tier;
  GET DIAGNOSTICS v_gate = ROW_COUNT;
  PERFORM set_config('app.vault_scope', coalesce(v_prev_scope, ''), true);

  occupancy_rows := v_occ;
  gate_rate_rows := v_gate;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

-- Writes one attendance_snapshots row (registered / checked in / on site, by tier). on_site counts
-- live attendee credentials whose zone_state is INSIDE_*. Uses no personal data.
CREATE OR REPLACE FUNCTION public.take_attendance_snapshot(p_event_id uuid, p_at timestamptz DEFAULT now())
RETURNS public.attendance_snapshots
LANGUAGE sql AS $$
  WITH per_reg AS (
    SELECT r.tier::text AS tier,
           r.checked_in_at IS NOT NULL AS checked_in,
           EXISTS (SELECT 1 FROM public.credentials c
                    WHERE c.registration_id = r.id
                      AND c.state IN ('issued', 'active', 'suspended_review')
                      AND c.zone_state <> 'OUTSIDE') AS on_site
      FROM public.registrations r
     WHERE r.event_id = p_event_id AND r.state = 'confirmed'
  ),
  by_tier AS (
    SELECT tier, count(*) AS registered, count(*) FILTER (WHERE checked_in) AS checked_in,
           count(*) FILTER (WHERE on_site) AS on_site
      FROM per_reg GROUP BY tier
  )
  INSERT INTO public.attendance_snapshots (event_id, taken_at, registered, checked_in, on_site, by_tier_jsonb)
  SELECT p_event_id, p_at,
         coalesce(sum(registered), 0), coalesce(sum(checked_in), 0), coalesce(sum(on_site), 0),
         coalesce(jsonb_object_agg(tier, jsonb_build_object('registered', registered, 'checked_in', checked_in, 'on_site', on_site))
                  FILTER (WHERE tier IS NOT NULL), '{}'::jsonb)
    FROM by_tier
  RETURNING *
$$;
--> statement-breakpoint

-- The post-event purge (03 §6, D-03). For one event:
--   1. refuses unless the event is closed/archived and closed_at + grace_buffer has passed
--      (p_force skips only the grace check — for tests and an operator-approved early purge);
--   2. rebuilds occupancy and gate-rate rollups from the scans;
--   3. drops the event's scan partition (a partition drop, not row deletes);
--   4. deletes the event's ephemeral ID mapping;
--   5. stamps events.purged_at and writes an audit entry.
-- Keeps: rollups, attendance snapshots, breach alerts (with credential_id, O-11), audit log,
-- registrations and credentials. Idempotent: a second call on a purged event returns zeros.
CREATE OR REPLACE FUNCTION public.purge_event_movement_data(p_event_id uuid, p_force boolean DEFAULT false, p_actor_id uuid DEFAULT NULL)
RETURNS TABLE (scans_dropped bigint, ephemeral_ids_deleted bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pii_vault, pg_temp AS $$
DECLARE
  ev           public.events%ROWTYPE;
  v_prev_scope text := current_setting('app.vault_scope', true);
  v_scans      bigint := 0;
  v_eph        bigint := 0;
  v_part       text := public.scan_partition_name(p_event_id);
BEGIN
  SELECT * INTO ev FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event % does not exist', p_event_id USING ERRCODE = 'no_data_found';
  END IF;
  IF ev.purged_at IS NOT NULL THEN
    scans_dropped := 0; ephemeral_ids_deleted := 0; RETURN NEXT; RETURN;
  END IF;
  IF ev.state NOT IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'event % is %; only closed or archived events can be purged', p_event_id, ev.state
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF NOT p_force AND now() < coalesce(ev.closed_at, now()) + ev.grace_buffer THEN
    RAISE EXCEPTION 'event % is inside its grace period until %', p_event_id, coalesce(ev.closed_at, now()) + ev.grace_buffer
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  PERFORM public.rebuild_event_rollups(p_event_id);

  IF to_regclass('public.' || quote_ident(v_part)) IS NOT NULL THEN
    EXECUTE format('SELECT count(*) FROM public.%I', v_part) INTO v_scans;
    EXECUTE format('DROP TABLE public.%I', v_part);
  END IF;

  PERFORM set_config('app.vault_scope', 'system', true);
  DELETE FROM pii_vault.ephemeral_ids WHERE event_id = p_event_id;
  GET DIAGNOSTICS v_eph = ROW_COUNT;
  PERFORM set_config('app.vault_scope', coalesce(v_prev_scope, ''), true);

  UPDATE public.events SET purged_at = now() WHERE id = p_event_id;

  INSERT INTO public.audit_log (actor_id, action, target, meta_jsonb)
  VALUES (p_actor_id, 'event.purge', 'event:' || p_event_id,
          jsonb_build_object('scans_dropped', v_scans, 'ephemeral_ids_deleted', v_eph, 'forced', p_force));

  scans_dropped := v_scans;
  ephemeral_ids_deleted := v_eph;
  RETURN NEXT;
END;
$$;
