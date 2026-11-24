-- 0023 — the grid-shape check (hand-written), needed before 0024 adds the constraints that use it.
--
-- Room and zone shapes are the contracts' GridShape (packages/contracts/src/rest/venue.ts):
--   { "kind": "rect", "x": X, "y": Y, "w": W, "h": H }       whole grid units 0–10 000, w and h ≥ 1
--   { "kind": "polygon", "points": [[X, Y], …] }               3–64 points, whole grid units 0–10 000
-- with no other keys. NULL (not drawn) is valid. CASE fixes the evaluation order, so a malformed value
-- fails the check instead of raising a cast or type error.

-- One grid unit: a JSON number that is a whole number between p_min and 10 000.
CREATE OR REPLACE FUNCTION public.grid_unit_valid(p_value jsonb, p_min integer) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN p_value IS NULL OR jsonb_typeof(p_value) <> 'number' THEN false
    ELSE (p_value::text)::numeric BETWEEN p_min AND 10000
     AND (p_value::text)::numeric = trunc((p_value::text)::numeric)
  END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.grid_shape_valid(p_shape jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN p_shape IS NULL THEN true
    WHEN jsonb_typeof(p_shape) <> 'object' THEN false
    WHEN coalesce(jsonb_typeof(p_shape -> 'kind'), '') <> 'string' THEN false
    WHEN p_shape ->> 'kind' = 'rect' THEN
      CASE
        WHEN (p_shape - 'kind' - 'x' - 'y' - 'w' - 'h') <> '{}'::jsonb THEN false
        ELSE public.grid_unit_valid(p_shape -> 'x', 0) AND public.grid_unit_valid(p_shape -> 'y', 0)
         AND public.grid_unit_valid(p_shape -> 'w', 1) AND public.grid_unit_valid(p_shape -> 'h', 1)
      END
    WHEN p_shape ->> 'kind' = 'polygon' THEN
      CASE
        WHEN (p_shape - 'kind' - 'points') <> '{}'::jsonb THEN false
        WHEN coalesce(jsonb_typeof(p_shape -> 'points'), '') <> 'array' THEN false
        WHEN jsonb_array_length(p_shape -> 'points') NOT BETWEEN 3 AND 64 THEN false
        ELSE NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_shape -> 'points') AS p(pt)
           WHERE CASE
                   WHEN jsonb_typeof(p.pt) <> 'array' THEN true
                   WHEN jsonb_array_length(p.pt) <> 2 THEN true
                   ELSE NOT (public.grid_unit_valid(p.pt -> 0, 0) AND public.grid_unit_valid(p.pt -> 1, 0))
                 END)
      END
    ELSE false
  END
$$;
