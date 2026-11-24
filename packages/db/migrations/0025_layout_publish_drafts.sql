-- 0025 — venue layouts and event drafts (hand-written). Columns and checks are in 0024.
--
--   A. Backfill: zone order, venue floors and layout version, wizard step and publish time of events
--      that are already past draft.
--   B. The layout version: every change to a zone or a room raises venues.layout_version (and stamps
--      layout_published_at); a zone with a new floor label appends it to venues.floors.
--   C. venue_layout_publish(): a whole layout (floors, zones, rooms) replaces the venue's in one
--      step, refused when the version moved on (optimistic concurrency) or when it would remove a
--      zone or room that is still in use.
--   D. event_delete_draft(): a draft, with nothing that happened under it, is deleted.
--   E. event_duplicate(): a copy may leave the dates unset (the wizard asks for them).

------------------------------------------------------------------------------------------------
-- A. Backfill (before the triggers in B exist, so it does not count as layout changes)
------------------------------------------------------------------------------------------------

UPDATE public.zones z SET sort_order = o.n
  FROM (SELECT id, (row_number() OVER (PARTITION BY venue_id ORDER BY floor NULLS FIRST, name, id) - 1)::integer AS n
          FROM public.zones) o
 WHERE o.id = z.id;
--> statement-breakpoint
UPDATE public.venues v
   SET floors = coalesce((SELECT array_agg(f ORDER BY f) FROM (SELECT DISTINCT z.floor AS f FROM public.zones z
                                                                WHERE z.venue_id = v.id AND z.floor IS NOT NULL AND btrim(z.floor) <> '') d), '{}'),
       layout_version = 1,
       layout_published_at = v.updated_at
 WHERE EXISTS (SELECT 1 FROM public.zones z WHERE z.venue_id = v.id)
    OR EXISTS (SELECT 1 FROM public.rooms r WHERE r.venue_id = v.id);
--> statement-breakpoint
UPDATE public.events SET wizard_step = 'review', published_at = coalesce(published_at, created_at) WHERE state <> 'draft';
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- B. The layout version
------------------------------------------------------------------------------------------------

-- Inside venue_layout_publish() the setting synan.layout_publish is 'on' for the transaction and the
-- function sets the version itself (one publish = one version).
CREATE OR REPLACE FUNCTION public.venue_layout_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_venue uuid;
BEGIN
  IF coalesce(current_setting('synan.layout_publish', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  v_venue := CASE WHEN TG_OP = 'DELETE' THEN OLD.venue_id ELSE NEW.venue_id END;
  -- Nested: NEW.floor exists only on zones, and PL/pgSQL does not short-circuit AND.
  IF TG_TABLE_NAME = 'zones' AND TG_OP <> 'DELETE' THEN
    IF NEW.floor IS NOT NULL AND btrim(NEW.floor) <> '' THEN
      UPDATE public.venues SET floors = array_append(floors, NEW.floor)
       WHERE id = v_venue AND NOT (NEW.floor = ANY (floors));
    END IF;
  END IF;
  UPDATE public.venues SET layout_version = layout_version + 1, layout_published_at = now() WHERE id = v_venue;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER zones_layout_touch AFTER INSERT OR UPDATE OR DELETE ON public.zones
FOR EACH ROW EXECUTE FUNCTION public.venue_layout_touch();
--> statement-breakpoint
CREATE TRIGGER rooms_layout_touch AFTER INSERT OR UPDATE OR DELETE ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.venue_layout_touch();
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- C. Whole-layout publish
------------------------------------------------------------------------------------------------

-- p_zones: [{ id, name, floor, geometry }] in list order; p_rooms: [{ id, zone_id, name, capacity,
-- warn_at_pct, block_at_pct, capacity_policy, continuous, geometry }]. Ids not yet stored are
-- created; stored zones and rooms of the venue that are not in the lists are removed; the rest are
-- updated. Statuses:
--   ok                the layout is stored; layout_version is the new version
--   version_conflict  the stored version is not p_expected_version (layout_version: the stored one)
--   foreign_id        an id in the lists belongs to another venue
--   blocked           something would be removed or moved that may not be; `blocking` lists
--                     { kind: zone|room, id, reason: in_use|has_checkpoints|doors_in_other_zone }
-- A room used by a draft event leaves that draft (with the draft's sessions and rules in it). A room
-- used by any event past draft, or with recorded history, cannot be removed; nor can a zone or room
-- that still has checkpoints. The caller validates names, floors, thresholds and shapes first; the
-- table constraints hold regardless.
CREATE OR REPLACE FUNCTION public.venue_layout_publish(
  p_venue_id uuid, p_expected_version integer, p_floors text[], p_zones jsonb, p_rooms jsonb, p_now timestamptz DEFAULT now()
) RETURNS TABLE (
  status text, layout_version integer, zones_added integer, zones_removed integer, rooms_added integer, rooms_removed integer, blocking jsonb
)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  v public.venues%ROWTYPE;
  v_zone_ids uuid[];
  v_room_ids uuid[];
  v_blocking jsonb;
BEGIN
  SELECT * INTO v FROM public.venues WHERE id = p_venue_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue % does not exist', p_venue_id USING ERRCODE = 'no_data_found';
  END IF;
  zones_added := 0; zones_removed := 0; rooms_added := 0; rooms_removed := 0; blocking := '[]'::jsonb;
  IF v.layout_version <> p_expected_version THEN
    status := 'version_conflict'; layout_version := v.layout_version;
    RETURN NEXT; RETURN;
  END IF;

  SELECT coalesce(array_agg((z ->> 'id')::uuid), '{}') INTO v_zone_ids FROM jsonb_array_elements(p_zones) AS z;
  SELECT coalesce(array_agg((r ->> 'id')::uuid), '{}') INTO v_room_ids FROM jsonb_array_elements(p_rooms) AS r;
  IF EXISTS (SELECT 1 FROM public.zones WHERE id = ANY (v_zone_ids) AND venue_id <> p_venue_id)
     OR EXISTS (SELECT 1 FROM public.rooms WHERE id = ANY (v_room_ids) AND venue_id <> p_venue_id) THEN
    status := 'foreign_id'; layout_version := v.layout_version;
    RETURN NEXT; RETURN;
  END IF;

  SELECT coalesce(jsonb_agg(x ORDER BY x::text), '[]'::jsonb) INTO v_blocking FROM (
    SELECT jsonb_build_object('kind', 'room', 'id', r.id, 'reason', 'in_use') AS x
      FROM public.rooms r
     WHERE r.venue_id = p_venue_id AND NOT (r.id = ANY (v_room_ids))
       AND (EXISTS (SELECT 1 FROM public.event_rooms er JOIN public.events e ON e.id = er.event_id
                     WHERE er.room_id = r.id AND e.state <> 'draft')
            OR EXISTS (SELECT 1 FROM public.occupancy_rollups o WHERE o.room_id = r.id)
            OR EXISTS (SELECT 1 FROM public.occupancy_adjustments a WHERE a.room_id = r.id)
            OR EXISTS (SELECT 1 FROM public.breach_alerts b WHERE b.room_id = r.id))
    UNION ALL
    SELECT jsonb_build_object('kind', 'room', 'id', r.id, 'reason', 'has_checkpoints')
      FROM public.rooms r
     WHERE r.venue_id = p_venue_id AND NOT (r.id = ANY (v_room_ids))
       AND EXISTS (SELECT 1 FROM public.checkpoints c WHERE c.room_id = r.id)
    UNION ALL
    SELECT jsonb_build_object('kind', 'zone', 'id', z.id, 'reason', 'has_checkpoints')
      FROM public.zones z
     WHERE z.venue_id = p_venue_id AND NOT (z.id = ANY (v_zone_ids))
       AND EXISTS (SELECT 1 FROM public.checkpoints c WHERE c.zone_id = z.id)
    UNION ALL
    SELECT jsonb_build_object('kind', 'zone', 'id', z.id, 'reason', 'in_use')
      FROM public.zones z
     WHERE z.venue_id = p_venue_id AND NOT (z.id = ANY (v_zone_ids))
       AND (EXISTS (SELECT 1 FROM public.zone_dwell_rollups d WHERE d.zone_id = z.id)
            OR EXISTS (SELECT 1 FROM public.zone_flow_rollups f WHERE f.from_zone_id = z.id OR f.to_zone_id = z.id))
    UNION ALL
    SELECT jsonb_build_object('kind', 'room', 'id', (r ->> 'id')::uuid, 'reason', 'doors_in_other_zone')
      FROM jsonb_array_elements(p_rooms) AS r
     WHERE EXISTS (SELECT 1 FROM public.checkpoints c WHERE c.room_id = (r ->> 'id')::uuid AND c.zone_id <> (r ->> 'zone_id')::uuid)
  ) q;
  IF jsonb_array_length(v_blocking) > 0 THEN
    status := 'blocked'; layout_version := v.layout_version; blocking := v_blocking;
    RETURN NEXT; RETURN;
  END IF;

  PERFORM set_config('synan.layout_publish', 'on', true);

  SELECT count(*)::integer INTO zones_added FROM unnest(v_zone_ids) AS i(id) WHERE NOT EXISTS (SELECT 1 FROM public.zones z WHERE z.id = i.id);
  SELECT count(*)::integer INTO rooms_added FROM unnest(v_room_ids) AS i(id) WHERE NOT EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = i.id);

  INSERT INTO public.zones (id, venue_id, name, floor, geometry_jsonb, sort_order)
  SELECT (z ->> 'id')::uuid, p_venue_id, z ->> 'name', nullif(btrim(coalesce(z ->> 'floor', '')), ''),
         CASE WHEN jsonb_typeof(z -> 'geometry') = 'object' THEN z -> 'geometry' END, (o - 1)::integer
    FROM jsonb_array_elements(p_zones) WITH ORDINALITY AS t(z, o)
  ON CONFLICT (id) DO UPDATE
     SET name = EXCLUDED.name, floor = EXCLUDED.floor, geometry_jsonb = EXCLUDED.geometry_jsonb, sort_order = EXCLUDED.sort_order;

  INSERT INTO public.rooms (id, venue_id, zone_id, name, capacity, warn_at_pct, block_at_pct, capacity_policy, continuous_bool, geometry_jsonb)
  SELECT (r ->> 'id')::uuid, p_venue_id, (r ->> 'zone_id')::uuid, r ->> 'name', (r ->> 'capacity')::integer,
         coalesce((r ->> 'warn_at_pct')::smallint, 85), coalesce((r ->> 'block_at_pct')::smallint, 100),
         coalesce(r ->> 'capacity_policy', 'block')::public.capacity_policy, coalesce((r ->> 'continuous')::boolean, false),
         CASE WHEN jsonb_typeof(r -> 'geometry') = 'object' THEN r -> 'geometry' END
    FROM jsonb_array_elements(p_rooms) AS r
  ON CONFLICT (id) DO UPDATE
     SET zone_id = EXCLUDED.zone_id, name = EXCLUDED.name, capacity = EXCLUDED.capacity, warn_at_pct = EXCLUDED.warn_at_pct,
         block_at_pct = EXCLUDED.block_at_pct, capacity_policy = EXCLUDED.capacity_policy,
         continuous_bool = EXCLUDED.continuous_bool, geometry_jsonb = EXCLUDED.geometry_jsonb;

  -- Drafts let go of the rooms that leave the layout (their sessions and access rules go with them).
  DELETE FROM public.event_rooms er USING public.events e
   WHERE er.event_id = e.id AND e.state = 'draft'
     AND er.room_id IN (SELECT r.id FROM public.rooms r WHERE r.venue_id = p_venue_id AND NOT (r.id = ANY (v_room_ids)));
  DELETE FROM public.rooms r WHERE r.venue_id = p_venue_id AND NOT (r.id = ANY (v_room_ids));
  GET DIAGNOSTICS rooms_removed = ROW_COUNT;
  DELETE FROM public.zones z WHERE z.venue_id = p_venue_id AND NOT (z.id = ANY (v_zone_ids));
  GET DIAGNOSTICS zones_removed = ROW_COUNT;

  UPDATE public.venues
     SET floors = coalesce(p_floors, '{}'), layout_version = v.layout_version + 1, layout_published_at = p_now
   WHERE id = p_venue_id;
  PERFORM set_config('synan.layout_publish', 'off', true);

  status := 'ok'; layout_version := v.layout_version + 1;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- D. Deleting a draft
------------------------------------------------------------------------------------------------

-- Statuses: deleted | not_found | not_draft | has_registrations | has_history (exports, alerts or
-- occupancy corrections were recorded under it). The draft's rooms, sessions, access rules and their
-- versions go by cascade; invitations, shifts tied to it, report schedules, notifications and
-- stream tickets are deleted first; its (empty) scan partition is dropped by the events trigger.
-- The caller writes the audit entry.
CREATE OR REPLACE FUNCTION public.event_delete_draft(p_event_id uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  e public.events%ROWTYPE;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF e.state <> 'draft' THEN
    RETURN 'not_draft';
  END IF;
  IF EXISTS (SELECT 1 FROM public.registrations WHERE event_id = p_event_id) THEN
    RETURN 'has_registrations';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_reports WHERE event_id = p_event_id)
     OR EXISTS (SELECT 1 FROM public.breach_alerts WHERE event_id = p_event_id)
     OR EXISTS (SELECT 1 FROM public.occupancy_adjustments WHERE event_id = p_event_id) THEN
    RETURN 'has_history';
  END IF;
  DELETE FROM public.invitations WHERE event_id = p_event_id;
  DELETE FROM public.staff_assignments WHERE event_id = p_event_id;
  DELETE FROM public.report_schedules WHERE event_id = p_event_id;
  DELETE FROM public.notifications WHERE event_id = p_event_id;
  DELETE FROM public.ws_tickets WHERE event_id = p_event_id;
  DELETE FROM public.occupancy_rollups WHERE event_id = p_event_id;
  DELETE FROM public.gate_rate_rollups WHERE event_id = p_event_id;
  DELETE FROM public.zone_dwell_rollups WHERE event_id = p_event_id;
  DELETE FROM public.zone_flow_rollups WHERE event_id = p_event_id;
  DELETE FROM public.onsite_rollups WHERE event_id = p_event_id;
  DELETE FROM public.attendance_snapshots WHERE event_id = p_event_id;
  DELETE FROM public.event_summaries WHERE event_id = p_event_id;
  DELETE FROM public.events WHERE id = p_event_id;
  RETURN 'deleted';
END;
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- E. Duplicating an event
------------------------------------------------------------------------------------------------

-- As 0014, plus: with p_starts_at null (or a source without dates) the copy has no dates, no
-- sessions, and only the access rules without a time window (a window is a time on the old dates;
-- dropping it can only narrow access, never widen it). The copy is a draft at the wizard's first
-- step, last changed by p_actor_id.
CREATE OR REPLACE FUNCTION public.event_duplicate(
  p_event_id uuid, p_slug text, p_title text, p_starts_at timestamptz, p_actor_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  e public.events%ROWTYPE;
  v_new uuid;
  v_shift interval;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event % does not exist', p_event_id USING ERRCODE = 'no_data_found';
  END IF;
  v_shift := CASE WHEN p_starts_at IS NULL OR e.starts_at IS NULL THEN NULL ELSE p_starts_at - e.starts_at END;
  INSERT INTO public.events (org_id, venue_id, slug, title, description, starts_at, ends_at, timezone, state, listed_bool,
                             grace_buffer, profile_schema_jsonb, pass_template_jsonb, wizard_step, updated_by)
  VALUES (e.org_id, e.venue_id, p_slug, p_title, e.description, e.starts_at + v_shift, e.ends_at + v_shift, e.timezone, 'draft',
          e.listed_bool, e.grace_buffer, e.profile_schema_jsonb, e.pass_template_jsonb, 'basics', p_actor_id)
  RETURNING id INTO v_new;
  INSERT INTO public.event_rooms (event_id, room_id, capacity_override)
  SELECT v_new, room_id, capacity_override FROM public.event_rooms WHERE event_id = p_event_id;
  INSERT INTO public.sessions (event_id, room_id, title, description, starts_at, ends_at)
  SELECT v_new, room_id, title, description, starts_at + v_shift, ends_at + v_shift
    FROM public.sessions WHERE event_id = p_event_id AND v_shift IS NOT NULL;
  INSERT INTO public.access_rules (event_id, subject_kind, subject, room_id, window_start, window_end, effect)
  SELECT v_new, subject_kind, subject, room_id, window_start + v_shift, window_end + v_shift, effect
    FROM public.access_rules
   WHERE event_id = p_event_id AND (v_shift IS NOT NULL OR (window_start IS NULL AND window_end IS NULL));
  INSERT INTO public.audit_log (actor_id, action, target, meta_jsonb)
  VALUES (p_actor_id, 'event.duplicate', 'event:' || v_new, jsonb_build_object('from', p_event_id, 'dates', v_shift IS NOT NULL));
  RETURN v_new;
END;
$$;
