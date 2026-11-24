-- 0034 — handover counts without undone admissions; per-user phone rows retired (hand-written).
--
--   A. shift_handover_summary: a scan with a correction record (scan_voids, a scanner's undo) no
--      longer counts as let through, nor in by_result; it is counted in the new `undone` column.
--      `scans` still counts every scan recorded. shift_handover returns (and audits) the same summary.
--   B. Staff phones' device rows were keyed by user and install (one row per person per phone); from
--      0033 they are keyed by the venue and the install alone. The old per-user rows (scanner, no
--      token, `phone:` + 40 hex, no last user) are retired so they stop counting in gate health; each
--      phone registers its install row again at its next heartbeat.

------------------------------------------------------------------------------------------------
-- A. Handover summary
------------------------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.shift_handover_summary(uuid);
--> statement-breakpoint
-- As in 0014, plus `undone`: scans in the period that a scanner undid (scan_voids). They are left out
-- of let_through and by_result.
CREATE FUNCTION public.shift_handover_summary(p_assignment_id uuid)
RETURNS TABLE (
  assignment_id uuid, checkpoint_id uuid, user_id uuid, period_start timestamptz, period_end timestamptz,
  scans bigint, let_through bigint, refused bigint, duplicates bigint, offline bigint, late_synced bigint,
  by_result jsonb, first_scan_at timestamptz, last_scan_at timestamptz, undone bigint
)
LANGUAGE sql STABLE AS $$
  WITH a AS (
    SELECT x.*, coalesce(least(x.handed_over_at, x.shift_end), x.shift_end) AS pend
      FROM public.staff_assignments x WHERE x.id = p_assignment_id
  ),
  s AS (
    SELECT sc.result, sc.offline_bool, sc.received_at, sc.corrected_at,
           EXISTS (SELECT 1 FROM public.scan_voids v WHERE v.event_id = sc.event_id AND v.scan_id = sc.id) AS voided
      FROM public.scans sc, a
     WHERE sc.checkpoint_id = a.checkpoint_id AND sc.staff_user_id = a.user_id
       AND (a.event_id IS NULL OR sc.event_id = a.event_id)
       AND sc.corrected_at >= a.shift_start AND sc.corrected_at < a.pend
       AND sc.result <> 'implied_exit'
  )
  SELECT a.id, a.checkpoint_id, a.user_id, a.shift_start, a.pend,
         (SELECT count(*) FROM s),
         (SELECT count(*) FROM s WHERE result IN ('admitted', 'already_inside') AND NOT voided),
         (SELECT count(*) FROM s WHERE result IN ('denied_room', 'capacity_block', 'revoked', 'suspended', 'unknown_token', 'wristband_required', 'pass_spent')),
         (SELECT count(*) FROM s WHERE result = 'duplicate_read'),
         (SELECT count(*) FROM s WHERE offline_bool),
         (SELECT count(*) FROM s WHERE received_at >= a.pend),
         coalesce((SELECT jsonb_object_agg(result, n) FROM (SELECT result::text AS result, count(*) AS n FROM s WHERE NOT voided GROUP BY 1) g), '{}'::jsonb),
         (SELECT min(corrected_at) FROM s), (SELECT max(corrected_at) FROM s),
         (SELECT count(*) FROM s WHERE voided)
    FROM a
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- B. Per-user phone rows
------------------------------------------------------------------------------------------------

UPDATE public.devices
   SET state = 'retired', retired_at = now()
 WHERE kind = 'scanner' AND token_hash IS NULL AND last_user_id IS NULL AND state = 'active'
   AND hardware_id ~ '^phone:[0-9a-f]{40}$';
