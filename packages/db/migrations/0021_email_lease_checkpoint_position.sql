ALTER TABLE "checkpoints" ADD COLUMN "position_jsonb" jsonb;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_position_grid_point" CHECK (position_jsonb IS NULL OR CASE
  WHEN jsonb_typeof(position_jsonb) <> 'object' THEN false
  WHEN (position_jsonb - 'x' - 'y' - 'side') <> '{}'::jsonb THEN false
  WHEN coalesce(jsonb_typeof(position_jsonb -> 'x'), '') <> 'number' OR coalesce(jsonb_typeof(position_jsonb -> 'y'), '') <> 'number' THEN false
  WHEN coalesce(jsonb_typeof(position_jsonb -> 'side'), '') <> 'string' THEN false
  ELSE (position_jsonb ->> 'side') IN ('n', 'e', 's', 'w')
   AND (position_jsonb ->> 'x')::numeric BETWEEN 0 AND 10000 AND (position_jsonb ->> 'x')::numeric = trunc((position_jsonb ->> 'x')::numeric)
   AND (position_jsonb ->> 'y')::numeric BETWEEN 0 AND 10000 AND (position_jsonb ->> 'y')::numeric = trunc((position_jsonb ->> 'y')::numeric)
END);