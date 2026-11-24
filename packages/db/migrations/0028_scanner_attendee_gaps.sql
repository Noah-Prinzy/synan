ALTER TYPE "public"."occupancy_adjustment_reason" ADD VALUE 'scan_undo';--> statement-breakpoint
CREATE TABLE "pii_vault"."pending_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_token_hash" text NOT NULL,
	"attendee_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"zone_presence_consent" boolean NOT NULL,
	"answers_enc" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_registrations_link_hash" CHECK ("pii_vault"."pending_registrations"."link_token_hash" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "pending_registrations_answers_encrypted" CHECK ("pii_vault"."pending_registrations"."answers_enc" ~ '^ev1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$')
);
--> statement-breakpoint
CREATE TABLE "scan_voids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"scan_id" uuid NOT NULL,
	"voided_by" uuid,
	"reason" text,
	"voided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_voids_scan_uq" UNIQUE("event_id","scan_id"),
	CONSTRAINT "scan_voids_reason_len" CHECK ("scan_voids"."reason" IS NULL OR length("scan_voids"."reason") <= 200)
);
--> statement-breakpoint
ALTER TABLE "staff_assignments" ADD COLUMN "scanner_device_hashes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "allowlist_issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pii_vault"."pending_registrations" ADD CONSTRAINT "pending_registrations_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "pii_vault"."attendees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_voids" ADD CONSTRAINT "scan_voids_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_voids" ADD CONSTRAINT "scan_voids_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pending_registrations_link_uq" ON "pii_vault"."pending_registrations" USING btree ("link_token_hash");--> statement-breakpoint
CREATE INDEX "pending_registrations_expiry_idx" ON "pii_vault"."pending_registrations" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_device_hashes" CHECK (cardinality("staff_assignments"."scanner_device_hashes") <= 8);