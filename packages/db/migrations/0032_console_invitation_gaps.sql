-- 0032 — console and invitation gaps (generated).
-- A holder's own lost-band report raises a low-severity `band_reported_lost` alert for the event, and
-- an event may name an organiser contact (a display name and an address chosen for the event) that
-- the invitation read shows to invitees. Neither column holds an attendee's identity.
ALTER TYPE "public"."alert_kind" ADD VALUE 'band_reported_lost';--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "contact_name" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_contact_name_len" CHECK (char_length("events"."contact_name") BETWEEN 1 AND 200);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_contact_email_shape" CHECK (char_length("events"."contact_email") <= 254 AND "events"."contact_email" LIKE '%_@_%');