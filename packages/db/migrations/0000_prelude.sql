-- 0000 — prelude (hand-written; runs before the generated schema).
--
-- 1. btree_gist: needed for the staff_assignments overlap exclusion constraint (uuid "=" in GiST).
-- 2. scan_corrected_at(): the ordering key for scans (D-14). It must exist before `scans` is
--    created because scans.corrected_at is a STORED generated column over it.
--    timestamptz + interval is only STABLE in general (month/day units depend on the time zone);
--    with a pure-milliseconds interval the result is time-zone independent, so IMMUTABLE is truthful.

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.scan_corrected_at(occurred_at timestamptz, clock_offset_ms integer)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURN occurred_at + make_interval(secs => clock_offset_ms::double precision / 1000.0);
