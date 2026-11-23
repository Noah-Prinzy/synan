CREATE TYPE "public"."export_format" AS ENUM('xlsx', 'csv', 'pdf');--> statement-breakpoint
CREATE TYPE "public"."email_state" AS ENUM('queued', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('pass', 'session', 'capacity', 'event', 'security');--> statement-breakpoint
CREATE TYPE "public"."report_cadence" AS ENUM('on_close', 'daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."report_schedule_state" AS ENUM('active', 'paused', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template" text NOT NULL,
	"to_enc" text NOT NULL,
	"content_enc" text NOT NULL,
	"state" "email_state" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"provider_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "email_outbox_to_encrypted" CHECK (to_enc ~ '^ev1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$'),
	CONSTRAINT "email_outbox_content_encrypted" CHECK (content_enc ~ '^ev1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$')
);
--> statement-breakpoint
CREATE TABLE "exported_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid,
	"data_request_id" uuid,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint,
	"contains_identity" boolean NOT NULL,
	"key_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "exported_files_owner" CHECK (num_nonnulls("exported_files"."report_id", "exported_files"."data_request_id") = 1),
	CONSTRAINT "exported_files_expiry_order" CHECK ("exported_files"."expires_at" > "exported_files"."created_at")
);
--> statement-breakpoint
CREATE TABLE "notification_reads" (
	"notification_id" uuid NOT NULL,
	"attendee_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_reads_pk" PRIMARY KEY("notification_id","attendee_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attendee_id" uuid,
	"event_id" uuid,
	"audience_tier" text,
	"kind" "notification_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "notifications_audience" CHECK ("notifications"."attendee_id" IS NOT NULL OR "notifications"."event_id" IS NOT NULL),
	CONSTRAINT "notifications_tier" CHECK ("notifications"."audience_tier" IS NULL OR "notifications"."audience_tier" IN ('VIP','ORDINARY','PRIVATE_INVITE','PUBLIC')),
	CONSTRAINT "notifications_length" CHECK (length("notifications"."title") <= 200 AND length("notifications"."body") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"format" "export_format" DEFAULT 'xlsx' NOT NULL,
	"kind" "report_kind",
	"include_identity" boolean DEFAULT false NOT NULL,
	"recipients_enc" text NOT NULL,
	"cadence" "report_cadence" NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"state" "report_schedule_state" DEFAULT 'active' NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"lease_until" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_schedules_recipients_encrypted" CHECK (recipients_enc ~ '^ev1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$'),
	CONSTRAINT "report_schedules_csv_kind" CHECK ("report_schedules"."format" <> 'csv' OR "report_schedules"."kind" IS NOT NULL),
	CONSTRAINT "report_schedules_next_run" CHECK ("report_schedules"."cadence" = 'on_close' OR "report_schedules"."next_run_at" IS NOT NULL OR "report_schedules"."state" <> 'active')
);
--> statement-breakpoint
ALTER TABLE "event_reports" ALTER COLUMN "kind" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "event_reports" ADD COLUMN "format" "export_format" DEFAULT 'csv' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_reports" ADD COLUMN "include_identity" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "token_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "exported_files" ADD CONSTRAINT "exported_files_report_id_event_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."event_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exported_files" ADD CONSTRAINT "exported_files_data_request_id_data_requests_id_fk" FOREIGN KEY ("data_request_id") REFERENCES "public"."data_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "pii_vault"."attendees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "pii_vault"."attendees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_outbox_state_idx" ON "email_outbox" USING btree ("state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "exported_files_object_key_uq" ON "exported_files" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "exported_files_due_idx" ON "exported_files" USING btree ("expires_at") WHERE "exported_files"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "exported_files_report_idx" ON "exported_files" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "notifications_attendee_idx" ON "notifications" USING btree ("attendee_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_event_idx" ON "notifications" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_expiry_idx" ON "notifications" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "report_schedules_event_idx" ON "report_schedules" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "report_schedules_due_idx" ON "report_schedules" USING btree ("next_run_at") WHERE "report_schedules"."state" = 'active';--> statement-breakpoint
ALTER TABLE "event_reports" ADD CONSTRAINT "event_reports_csv_kind" CHECK ("event_reports"."format" <> 'csv' OR "event_reports"."kind" IS NOT NULL);