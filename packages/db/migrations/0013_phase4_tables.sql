CREATE TYPE "public"."data_request_kind" AS ENUM('export', 'erasure');--> statement-breakpoint
CREATE TYPE "public"."data_request_state" AS ENUM('requested', 'in_progress', 'completed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."device_kind" AS ENUM('scanner', 'fixed_reader', 'kiosk');--> statement-breakpoint
CREATE TYPE "public"."device_state" AS ENUM('active', 'maintenance', 'retired', 'lost');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_state" AS ENUM('pending', 'in_flight', 'succeeded', 'dead');--> statement-breakpoint
CREATE TABLE "data_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attendee_id" uuid NOT NULL,
	"kind" "data_request_kind" NOT NULL,
	"state" "data_request_state" DEFAULT 'requested' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"handled_by" uuid,
	"object_key" text,
	"note" text,
	CONSTRAINT "data_requests_completed_at" CHECK (("data_requests"."state" IN ('completed', 'rejected')) = ("data_requests"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"kind" "device_kind" NOT NULL,
	"label" text NOT NULL,
	"hardware_id" text NOT NULL,
	"checkpoint_id" uuid,
	"token_hash" text,
	"token_rotated_at" timestamp with time zone,
	"state" "device_state" DEFAULT 'active' NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"last_clock_offset_ms" integer,
	"last_queue_depth" integer,
	"last_ip_prefix" "cidr",
	"app_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "devices_token_hash_format" CHECK ("devices"."token_hash" IS NULL OR "devices"."token_hash" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "devices_fixed_reader_checkpoint" CHECK ("devices"."kind" <> 'fixed_reader' OR "devices"."checkpoint_id" IS NOT NULL),
	CONSTRAINT "devices_queue_nonneg" CHECK ("devices"."last_queue_depth" IS NULL OR "devices"."last_queue_depth" >= 0)
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"alert_id" uuid,
	"state" "webhook_delivery_state" DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"response_code" integer,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"attempts_jsonb" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "webhook_deliveries_attempt_nonneg" CHECK ("webhook_deliveries"."attempt" >= 0)
);
--> statement-breakpoint
ALTER TABLE "event_reports" ADD COLUMN "params_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "event_reports" ADD COLUMN "summary_object_key" text;--> statement-breakpoint
ALTER TABLE "event_reports" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "pii_vault"."attendees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_checkpoint_id_checkpoints_id_fk" FOREIGN KEY ("checkpoint_id") REFERENCES "public"."checkpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_alert_id_breach_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."breach_alerts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "data_requests_open_uq" ON "data_requests" USING btree ("attendee_id","kind") WHERE "data_requests"."state" IN ('requested', 'in_progress');--> statement-breakpoint
CREATE INDEX "data_requests_queue_idx" ON "data_requests" USING btree ("state","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_hardware_id_uq" ON "devices" USING btree ("hardware_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_token_hash_uq" ON "devices" USING btree ("token_hash") WHERE "devices"."token_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "devices_checkpoint_idx" ON "devices" USING btree ("checkpoint_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries" USING btree ("next_attempt_at") WHERE "webhook_deliveries"."state" IN ('pending', 'in_flight');--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_idx" ON "webhook_deliveries" USING btree ("endpoint_id","created_at");--> statement-breakpoint
-- HAND EDIT: the unique target must exist before the foreign key that references it.
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_id_zone_uq" UNIQUE("id","zone_id");--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_room_same_zone_fk" FOREIGN KEY ("room_id","zone_id") REFERENCES "public"."rooms"("id","zone_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitations_event_state_idx" ON "invitations" USING btree ("event_id","state");--> statement-breakpoint
CREATE INDEX "invitations_expiry_idx" ON "invitations" USING btree ("expires_at") WHERE "invitations"."state" = 'sent';--> statement-breakpoint
CREATE INDEX "registrations_checked_in_idx" ON "registrations" USING btree ("event_id","checked_in_at") WHERE "registrations"."checked_in_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "breach_alerts_event_time_idx" ON "breach_alerts" USING btree ("event_id","occurred_at");--> statement-breakpoint
CREATE INDEX "event_reports_queue_idx" ON "event_reports" USING btree ("state","created_at") WHERE "event_reports"."state" IN ('queued', 'running');
