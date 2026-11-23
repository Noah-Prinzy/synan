CREATE SCHEMA "pii_vault";
--> statement-breakpoint
CREATE TYPE "public"."access_effect" AS ENUM('permit', 'deny');--> statement-breakpoint
CREATE TYPE "public"."access_subject_kind" AS ENUM('tier', 'role');--> statement-breakpoint
CREATE TYPE "public"."alert_kind" AS ENUM('invalid_qr', 'pass_replayed', 'unauthorised_tier', 'impossible_travel', 'capacity_warn', 'capacity_exceeded', 'offline_conflict_pass_reuse', 'offline_conflict_passback', 'offline_conflict_capacity', 'clock_skew', 'gate_offline', 'rogue_scanner', 'stale_allowlist', 'reconciliation_fault');--> statement-breakpoint
CREATE TYPE "public"."alert_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."alert_state" AS ENUM('open', 'acked', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."attendee_tier" AS ENUM('VIP', 'ORDINARY', 'PRIVATE_INVITE', 'PUBLIC');--> statement-breakpoint
CREATE TYPE "public"."capacity_policy" AS ENUM('block', 'admit_with_alert');--> statement-breakpoint
CREATE TYPE "public"."carrier_kind" AS ENUM('qr_portal', 'qr_email', 'nfc');--> statement-breakpoint
CREATE TYPE "public"."carrier_state" AS ENUM('stock', 'assigned', 'bound', 'active', 'retired', 'lost');--> statement-breakpoint
CREATE TYPE "public"."checkpoint_direction" AS ENUM('in', 'out', 'both');--> statement-breakpoint
CREATE TYPE "public"."chip_profile" AS ENUM('ntag_uid', 'ntag424_dna', 'desfire_ev3');--> statement-breakpoint
CREATE TYPE "public"."credential_state" AS ENUM('issued', 'active', 'suspended_review', 'revoked', 'replaced');--> statement-breakpoint
CREATE TYPE "public"."event_state" AS ENUM('draft', 'published', 'live', 'closed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."invitation_state" AS ENUM('sent', 'redeemed', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."occupancy_adjustment_reason" AS ENUM('session_end', 'recount', 'sync_conflict');--> statement-breakpoint
CREATE TYPE "public"."registration_state" AS ENUM('pending_approval', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."report_kind" AS ENUM('attendance', 'dwell_flow', 'peak_occupancy', 'breach_compliance', 'gate_throughput');--> statement-breakpoint
CREATE TYPE "public"."report_state" AS ENUM('queued', 'running', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."scan_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."scan_result" AS ENUM('admitted', 'already_inside', 'duplicate_read', 'denied_room', 'capacity_block', 'revoked', 'suspended', 'unknown_token', 'wristband_required', 'pass_spent', 'implied_exit', 'offline_queued');--> statement-breakpoint
CREATE TYPE "public"."signing_key_purpose" AS ENUM('qr', 'allowlist');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'organiser', 'security_staff', 'speaker', 'crew');--> statement-breakpoint
CREATE TABLE "checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"room_id" uuid,
	"direction" "checkpoint_direction" NOT NULL,
	"perimeter_bool" boolean DEFAULT false NOT NULL,
	"hardware_id" text,
	"label" text NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"last_clock_offset_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkpoints_id_venue_uq" UNIQUE("id","venue_id")
);
--> statement-breakpoint
CREATE TABLE "event_rooms" (
	"event_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"capacity_override" integer,
	CONSTRAINT "event_rooms_pk" PRIMARY KEY("event_id","room_id"),
	CONSTRAINT "event_rooms_capacity_nonneg" CHECK ("event_rooms"."capacity_override" IS NULL OR "event_rooms"."capacity_override" >= 0)
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"state" "event_state" DEFAULT 'draft' NOT NULL,
	"listed_bool" boolean DEFAULT true NOT NULL,
	"grace_buffer" interval DEFAULT '72 hours' NOT NULL,
	"profile_schema_jsonb" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pass_template_jsonb" jsonb,
	"access_rules_version" integer DEFAULT 0 NOT NULL,
	"revocation_epoch" integer DEFAULT 0 NOT NULL,
	"closed_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_time_order" CHECK ("events"."ends_at" > "events"."starts_at"),
	CONSTRAINT "events_grace_nonneg" CHECK ("events"."grace_buffer" >= interval '0')
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"support_email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" integer NOT NULL,
	"warn_at_pct" smallint DEFAULT 85 NOT NULL,
	"block_at_pct" smallint DEFAULT 100 NOT NULL,
	"capacity_policy" "capacity_policy" DEFAULT 'block' NOT NULL,
	"continuous_bool" boolean DEFAULT false NOT NULL,
	"geometry_jsonb" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_id_venue_uq" UNIQUE("id","venue_id"),
	CONSTRAINT "rooms_capacity_nonneg" CHECK ("rooms"."capacity" >= 0),
	CONSTRAINT "rooms_thresholds" CHECK ("rooms"."warn_at_pct" > 0 AND "rooms"."block_at_pct" >= "rooms"."warn_at_pct" AND "rooms"."block_at_pct" <= 1000)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_time_order" CHECK ("sessions"."ends_at" > "sessions"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "transit_times" (
	"venue_id" uuid NOT NULL,
	"from_checkpoint_id" uuid NOT NULL,
	"to_checkpoint_id" uuid NOT NULL,
	"min_seconds" integer NOT NULL,
	CONSTRAINT "transit_times_pk" PRIMARY KEY("from_checkpoint_id","to_checkpoint_id"),
	CONSTRAINT "transit_times_distinct" CHECK ("transit_times"."from_checkpoint_id" <> "transit_times"."to_checkpoint_id"),
	CONSTRAINT "transit_times_positive" CHECK ("transit_times"."min_seconds" > 0)
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"timezone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"name" text NOT NULL,
	"floor" text,
	"geometry_jsonb" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zones_id_venue_uq" UNIQUE("id","venue_id")
);
--> statement-breakpoint
CREATE TABLE "staff_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"checkpoint_id" uuid NOT NULL,
	"event_id" uuid,
	"shift_start" timestamp with time zone NOT NULL,
	"shift_end" timestamp with time zone NOT NULL,
	"handed_over_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_assignments_shift_order" CHECK ("staff_assignments"."shift_end" > "staff_assignments"."shift_start")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"email" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"password_hash" text,
	"role" "user_role" NOT NULL,
	"mfa_enrolled_at" timestamp with time zone,
	"mfa_secret_enc" text,
	"last_login_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pii_vault"."attendees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"email" text,
	"email_hash" text,
	"full_name" text,
	"profile_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"erased_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "access_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"subject_kind" "access_subject_kind" NOT NULL,
	"subject" text NOT NULL,
	"room_id" uuid NOT NULL,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"effect" "access_effect" NOT NULL,
	CONSTRAINT "access_rules_subject_valid" CHECK (("access_rules"."subject_kind" = 'tier' AND "access_rules"."subject" IN ('VIP','ORDINARY','PRIVATE_INVITE','PUBLIC'))
       OR ("access_rules"."subject_kind" = 'role' AND "access_rules"."subject" IN ('admin','organiser','security_staff','speaker','crew'))),
	CONSTRAINT "access_rules_window_order" CHECK ("access_rules"."window_start" IS NULL OR "access_rules"."window_end" IS NULL OR "access_rules"."window_end" > "access_rules"."window_start")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"email_hash" text NOT NULL,
	"token_hash" text NOT NULL,
	"state" "invitation_state" DEFAULT 'sent' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_redeemed_consistent" CHECK (("invitations"."state" = 'redeemed') = ("invitations"."redeemed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"attendee_id" uuid NOT NULL,
	"tier" "attendee_tier" NOT NULL,
	"state" "registration_state" NOT NULL,
	"zone_presence_consent_at" timestamp with time zone,
	"invitation_id" uuid,
	"checked_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registrations_event_attendee_uq" UNIQUE("event_id","attendee_id")
);
--> statement-breakpoint
CREATE TABLE "carriers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credential_id" uuid,
	"kind" "carrier_kind" NOT NULL,
	"identifier" text,
	"chip_profile" "chip_profile",
	"state" "carrier_state" NOT NULL,
	"bound_at" timestamp with time zone,
	"redeemed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carriers_stock_unassigned" CHECK (("carriers"."state" = 'stock' AND "carriers"."credential_id" IS NULL) OR ("carriers"."state" <> 'stock' AND ("carriers"."credential_id" IS NOT NULL OR "carriers"."state" IN ('retired','lost')))),
	CONSTRAINT "carriers_identifier_required" CHECK ("carriers"."kind" = 'qr_portal' OR "carriers"."identifier" IS NOT NULL),
	CONSTRAINT "carriers_chip_profile_nfc_only" CHECK ("carriers"."chip_profile" IS NULL OR "carriers"."kind" = 'nfc'),
	CONSTRAINT "carriers_redeemed_email_only" CHECK ("carriers"."redeemed_at" IS NULL OR "carriers"."kind" = 'qr_email')
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid,
	"staff_user_id" uuid,
	"token_hash" text NOT NULL,
	"state" "credential_state" DEFAULT 'issued' NOT NULL,
	"zone_state" text DEFAULT 'OUTSIDE' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" uuid,
	CONSTRAINT "credentials_exactly_one_holder" CHECK (num_nonnulls("credentials"."registration_id", "credentials"."staff_user_id") = 1),
	CONSTRAINT "credentials_zone_state_format" CHECK ("credentials"."zone_state" = 'OUTSIDE' OR "credentials"."zone_state" ~ '^INSIDE_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "credentials_revoked_at" CHECK (("credentials"."state" = 'revoked') = ("credentials"."revoked_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "signing_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" "signing_key_purpose" NOT NULL,
	"algorithm" text DEFAULT 'EdDSA' NOT NULL,
	"public_key" text NOT NULL,
	"private_key_enc" text NOT NULL,
	"active_from" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signing_keys_retire_order" CHECK ("signing_keys"."retired_at" IS NULL OR "signing_keys"."retired_at" > "signing_keys"."active_from")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"meta_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"prev_hash" text DEFAULT '' NOT NULL,
	"hash" text DEFAULT '' NOT NULL,
	CONSTRAINT "audit_log_hash_len" CHECK (length("audit_log"."hash") = 64 AND length("audit_log"."prev_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "breach_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"severity" "alert_severity" NOT NULL,
	"kind" "alert_kind" NOT NULL,
	"checkpoint_id" uuid,
	"room_id" uuid,
	"credential_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"state" "alert_state" DEFAULT 'open' NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"scan_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"assignee_id" uuid,
	"acked_by" uuid,
	"acked_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "breach_alerts_ack_consistent" CHECK ("breach_alerts"."state" = 'open' OR ("breach_alerts"."acked_at" IS NOT NULL AND "breach_alerts"."acked_by" IS NOT NULL)),
	CONSTRAINT "breach_alerts_resolve_consistent" CHECK ("breach_alerts"."state" <> 'resolved' OR ("breach_alerts"."resolved_at" IS NOT NULL AND "breach_alerts"."resolution_note" IS NOT NULL AND length(btrim("breach_alerts"."resolution_note")) > 0))
);
--> statement-breakpoint
CREATE TABLE "pii_vault"."ephemeral_ids" (
	"event_id" uuid NOT NULL,
	"credential_id" uuid NOT NULL,
	"ephemeral_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ephemeral_ids_pk" PRIMARY KEY("event_id","credential_id")
);
--> statement-breakpoint
CREATE TABLE "occupancy_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"set_to" integer,
	"reason" "occupancy_adjustment_reason" NOT NULL,
	"actor_id" uuid,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "occupancy_adjustments_set_to_nonneg" CHECK ("occupancy_adjustments"."set_to" IS NULL OR "occupancy_adjustments"."set_to" >= 0)
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"checkpoint_id" uuid NOT NULL,
	"ephemeral_id" uuid,
	"carrier_kind" "carrier_kind",
	"result" "scan_result" NOT NULL,
	"direction" "scan_direction",
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"clock_offset_ms" integer DEFAULT 0 NOT NULL,
	"corrected_at" timestamp with time zone GENERATED ALWAYS AS (public.scan_corrected_at(occurred_at, clock_offset_ms)) STORED NOT NULL,
	"idem_key" text NOT NULL,
	"offline_bool" boolean DEFAULT false NOT NULL,
	"local_result" "scan_result",
	"device_id" text,
	"staff_user_id" uuid,
	CONSTRAINT "scans_pk" PRIMARY KEY("event_id","id"),
	CONSTRAINT "scans_idem_key_uq" UNIQUE("event_id","idem_key"),
	CONSTRAINT "scans_result_stored" CHECK ("scans"."result" <> 'offline_queued'),
	CONSTRAINT "scans_idem_key_len" CHECK (length("scans"."idem_key") BETWEEN 8 AND 128)
) PARTITION BY LIST ("event_id"); -- HAND EDIT: Drizzle cannot declare partitioning. One partition per event (see 0002).
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_endpoints_https" CHECK ("webhook_endpoints"."url" ~ '^https://')
);
--> statement-breakpoint
CREATE TABLE "attendance_snapshots" (
	"event_id" uuid NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"registered" integer NOT NULL,
	"checked_in" integer NOT NULL,
	"on_site" integer NOT NULL,
	"by_tier_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "attendance_snapshots_pk" PRIMARY KEY("event_id","taken_at")
);
--> statement-breakpoint
CREATE TABLE "event_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" "report_kind" NOT NULL,
	"state" "report_state" DEFAULT 'queued' NOT NULL,
	"object_key" text,
	"requested_by" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "gate_rate_rollups" (
	"event_id" uuid NOT NULL,
	"checkpoint_id" uuid NOT NULL,
	"minute_start" timestamp with time zone NOT NULL,
	"scans" integer DEFAULT 0 NOT NULL,
	"admitted" integer DEFAULT 0 NOT NULL,
	"denied" integer DEFAULT 0 NOT NULL,
	"by_tier_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "gate_rate_rollups_pk" PRIMARY KEY("event_id","checkpoint_id","minute_start"),
	CONSTRAINT "gate_rate_rollups_minute_aligned" CHECK (date_trunc('minute', "gate_rate_rollups"."minute_start") = "gate_rate_rollups"."minute_start")
);
--> statement-breakpoint
CREATE TABLE "occupancy_rollups" (
	"event_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"in_count" integer DEFAULT 0 NOT NULL,
	"out_count" integer DEFAULT 0 NOT NULL,
	"peak" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "occupancy_rollups_pk" PRIMARY KEY("event_id","room_id","bucket_start"),
	CONSTRAINT "occupancy_rollups_nonneg" CHECK ("occupancy_rollups"."in_count" >= 0 AND "occupancy_rollups"."out_count" >= 0 AND "occupancy_rollups"."peak" >= 0)
);
--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_zone_same_venue_fk" FOREIGN KEY ("zone_id","venue_id") REFERENCES "public"."zones"("id","venue_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_room_same_venue_fk" FOREIGN KEY ("room_id","venue_id") REFERENCES "public"."rooms"("id","venue_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rooms" ADD CONSTRAINT "event_rooms_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rooms" ADD CONSTRAINT "event_rooms_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_zone_same_venue_fk" FOREIGN KEY ("zone_id","venue_id") REFERENCES "public"."zones"("id","venue_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_event_room_fk" FOREIGN KEY ("event_id","room_id") REFERENCES "public"."event_rooms"("event_id","room_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transit_times" ADD CONSTRAINT "transit_times_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transit_times" ADD CONSTRAINT "transit_times_from_fk" FOREIGN KEY ("from_checkpoint_id","venue_id") REFERENCES "public"."checkpoints"("id","venue_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transit_times" ADD CONSTRAINT "transit_times_to_fk" FOREIGN KEY ("to_checkpoint_id","venue_id") REFERENCES "public"."checkpoints"("id","venue_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zones" ADD CONSTRAINT "zones_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_checkpoint_id_checkpoints_id_fk" FOREIGN KEY ("checkpoint_id") REFERENCES "public"."checkpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pii_vault"."attendees" ADD CONSTRAINT "attendees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_rules" ADD CONSTRAINT "access_rules_event_room_fk" FOREIGN KEY ("event_id","room_id") REFERENCES "public"."event_rooms"("event_id","room_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "pii_vault"."attendees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carriers" ADD CONSTRAINT "carriers_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_replaced_by_id_credentials_id_fk" FOREIGN KEY ("replaced_by_id") REFERENCES "public"."credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_alerts" ADD CONSTRAINT "breach_alerts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_alerts" ADD CONSTRAINT "breach_alerts_checkpoint_id_checkpoints_id_fk" FOREIGN KEY ("checkpoint_id") REFERENCES "public"."checkpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_alerts" ADD CONSTRAINT "breach_alerts_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_alerts" ADD CONSTRAINT "breach_alerts_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_alerts" ADD CONSTRAINT "breach_alerts_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_alerts" ADD CONSTRAINT "breach_alerts_acked_by_users_id_fk" FOREIGN KEY ("acked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_alerts" ADD CONSTRAINT "breach_alerts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pii_vault"."ephemeral_ids" ADD CONSTRAINT "ephemeral_ids_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pii_vault"."ephemeral_ids" ADD CONSTRAINT "ephemeral_ids_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occupancy_adjustments" ADD CONSTRAINT "occupancy_adjustments_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occupancy_adjustments" ADD CONSTRAINT "occupancy_adjustments_event_room_fk" FOREIGN KEY ("event_id","room_id") REFERENCES "public"."event_rooms"("event_id","room_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_checkpoint_id_checkpoints_id_fk" FOREIGN KEY ("checkpoint_id") REFERENCES "public"."checkpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_snapshots" ADD CONSTRAINT "attendance_snapshots_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_reports" ADD CONSTRAINT "event_reports_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_reports" ADD CONSTRAINT "event_reports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_rate_rollups" ADD CONSTRAINT "gate_rate_rollups_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_rate_rollups" ADD CONSTRAINT "gate_rate_rollups_checkpoint_id_checkpoints_id_fk" FOREIGN KEY ("checkpoint_id") REFERENCES "public"."checkpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occupancy_rollups" ADD CONSTRAINT "occupancy_rollups_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occupancy_rollups" ADD CONSTRAINT "occupancy_rollups_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkpoints_hardware_id_uq" ON "checkpoints" USING btree ("hardware_id") WHERE "checkpoints"."hardware_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "checkpoints_venue_idx" ON "checkpoints" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "checkpoints_room_idx" ON "checkpoints" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "event_rooms_room_idx" ON "event_rooms" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_slug_uq" ON "events" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "events_venue_idx" ON "events" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "events_state_idx" ON "events" USING btree ("state","starts_at");--> statement-breakpoint
CREATE INDEX "rooms_venue_idx" ON "rooms" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "rooms_zone_idx" ON "rooms" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "sessions_event_idx" ON "sessions" USING btree ("event_id","starts_at");--> statement-breakpoint
CREATE INDEX "venues_org_idx" ON "venues" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "zones_venue_idx" ON "zones" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "staff_assignments_checkpoint_idx" ON "staff_assignments" USING btree ("checkpoint_id","shift_start");--> statement-breakpoint
CREATE INDEX "staff_assignments_user_idx" ON "staff_assignments" USING btree ("user_id","shift_start");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "attendees_email_hash_uq" ON "pii_vault"."attendees" USING btree ("email_hash") WHERE "pii_vault"."attendees"."email_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "attendees_user_idx" ON "pii_vault"."attendees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "access_rules_lookup_idx" ON "access_rules" USING btree ("event_id","room_id","subject_kind","subject");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_uq" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_open_per_recipient_uq" ON "invitations" USING btree ("event_id","email_hash") WHERE "invitations"."state" = 'sent';--> statement-breakpoint
CREATE INDEX "registrations_event_tier_idx" ON "registrations" USING btree ("event_id","tier");--> statement-breakpoint
CREATE INDEX "registrations_attendee_idx" ON "registrations" USING btree ("attendee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_invitation_uq" ON "registrations" USING btree ("invitation_id") WHERE "registrations"."invitation_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "carriers_identifier_uq" ON "carriers" USING btree ("kind","identifier") WHERE "carriers"."identifier" IS NOT NULL AND "carriers"."state" <> 'retired';--> statement-breakpoint
CREATE UNIQUE INDEX "carriers_one_live_per_kind_uq" ON "carriers" USING btree ("credential_id","kind") WHERE "carriers"."state" IN ('assigned','bound','active');--> statement-breakpoint
CREATE INDEX "carriers_credential_idx" ON "carriers" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "carriers_state_idx" ON "carriers" USING btree ("kind","state");--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_token_hash_uq" ON "credentials" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_one_live_per_registration_uq" ON "credentials" USING btree ("registration_id") WHERE "credentials"."registration_id" IS NOT NULL AND "credentials"."state" IN ('issued','active','suspended_review');--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_one_live_per_staff_uq" ON "credentials" USING btree ("staff_user_id") WHERE "credentials"."staff_user_id" IS NOT NULL AND "credentials"."state" IN ('issued','active','suspended_review');--> statement-breakpoint
CREATE INDEX "credentials_registration_idx" ON "credentials" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "credentials_staff_idx" ON "credentials" USING btree ("staff_user_id");--> statement-breakpoint
CREATE INDEX "signing_keys_purpose_idx" ON "signing_keys" USING btree ("purpose","active_from");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "breach_alerts_event_state_idx" ON "breach_alerts" USING btree ("event_id","state","occurred_at");--> statement-breakpoint
CREATE INDEX "breach_alerts_credential_idx" ON "breach_alerts" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "breach_alerts_occurred_idx" ON "breach_alerts" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ephemeral_ids_ephemeral_uq" ON "pii_vault"."ephemeral_ids" USING btree ("ephemeral_id");--> statement-breakpoint
CREATE INDEX "occupancy_adjustments_room_time_idx" ON "occupancy_adjustments" USING btree ("event_id","room_id","at");--> statement-breakpoint
CREATE INDEX "scans_checkpoint_time_idx" ON "scans" USING btree ("checkpoint_id","corrected_at");--> statement-breakpoint
CREATE INDEX "scans_ephemeral_time_idx" ON "scans" USING btree ("ephemeral_id","corrected_at");--> statement-breakpoint
CREATE INDEX "scans_time_idx" ON "scans" USING btree ("corrected_at");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_org_idx" ON "webhook_endpoints" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "event_reports_event_idx" ON "event_reports" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE INDEX "gate_rate_rollups_minute_idx" ON "gate_rate_rollups" USING btree ("event_id","minute_start");--> statement-breakpoint
CREATE INDEX "occupancy_rollups_bucket_idx" ON "occupancy_rollups" USING btree ("event_id","bucket_start");