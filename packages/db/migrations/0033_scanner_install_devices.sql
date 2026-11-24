-- 0033 — one device row per scanner install (generated).
-- A staff phone's device row is keyed by the venue and its install id alone (no longer by user), so one
-- phone handed from one person to the next stays one device for gate health and allowlist age. The
-- user signed in at its last heartbeat is recorded here.
ALTER TABLE "devices" ADD COLUMN "last_user_id" uuid;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_last_user_id_users_id_fk" FOREIGN KEY ("last_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
