CREATE TYPE "public"."auth_link_purpose" AS ENUM('sign_in', 'verify_email');--> statement-breakpoint
CREATE TYPE "public"."auth_revoke_reason" AS ENUM('logout', 'reuse_detected', 'mfa_step_up', 'operator', 'credential_change', 'erasure');--> statement-breakpoint
CREATE TYPE "public"."ws_channel" AS ENUM('/stream/scans', '/stream/telemetry', '/stream/alerts', '/stream/me');--> statement-breakpoint
CREATE TABLE "auth_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"attendee_id" uuid,
	"email_hash" text,
	"purpose" "auth_link_purpose" DEFAULT 'sign_in' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	CONSTRAINT "auth_links_recipient" CHECK (num_nonnulls("auth_links"."attendee_id", "auth_links"."email_hash") >= 1),
	CONSTRAINT "auth_links_expiry_order" CHECK ("auth_links"."expires_at" > "auth_links"."created_at")
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"parent_id" uuid,
	"user_id" uuid,
	"attendee_id" uuid,
	"token_hash" text NOT NULL,
	"mfa_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" "auth_revoke_reason",
	"user_agent" text,
	"ip_prefix" "cidr",
	CONSTRAINT "auth_sessions_one_holder" CHECK (num_nonnulls("auth_sessions"."user_id", "auth_sessions"."attendee_id") = 1),
	CONSTRAINT "auth_sessions_revoke_reason" CHECK (("auth_sessions"."revoked_at" IS NULL) = ("auth_sessions"."revoke_reason" IS NULL)),
	CONSTRAINT "auth_sessions_expiry_order" CHECK ("auth_sessions"."expires_at" > "auth_sessions"."created_at"),
	CONSTRAINT "auth_sessions_user_agent_len" CHECK ("auth_sessions"."user_agent" IS NULL OR length("auth_sessions"."user_agent") <= 200),
	CONSTRAINT "auth_sessions_ip_truncated" CHECK ("auth_sessions"."ip_prefix" IS NULL OR masklen("auth_sessions"."ip_prefix") <= CASE family("auth_sessions"."ip_prefix") WHEN 4 THEN 24 ELSE 48 END)
);
--> statement-breakpoint
CREATE TABLE "ws_tickets" (
	"ticket_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"attendee_id" uuid,
	"session_family_id" uuid,
	"channel" "ws_channel" NOT NULL,
	"event_id" uuid,
	"checkpoint_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "ws_tickets_one_holder" CHECK (num_nonnulls("ws_tickets"."user_id", "ws_tickets"."attendee_id") = 1),
	CONSTRAINT "ws_tickets_short_lived" CHECK ("ws_tickets"."expires_at" > "ws_tickets"."created_at" AND "ws_tickets"."expires_at" <= "ws_tickets"."created_at" + interval '5 minutes')
);
--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "signing_keys" ADD COLUMN "qr_kid" text;--> statement-breakpoint
ALTER TABLE "auth_links" ADD CONSTRAINT "auth_links_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "pii_vault"."attendees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_parent_id_auth_sessions_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."auth_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "pii_vault"."attendees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ws_tickets" ADD CONSTRAINT "ws_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ws_tickets" ADD CONSTRAINT "ws_tickets_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "pii_vault"."attendees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ws_tickets" ADD CONSTRAINT "ws_tickets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ws_tickets" ADD CONSTRAINT "ws_tickets_checkpoint_id_checkpoints_id_fk" FOREIGN KEY ("checkpoint_id") REFERENCES "public"."checkpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_links_token_hash_uq" ON "auth_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_links_attendee_idx" ON "auth_links" USING btree ("attendee_id");--> statement-breakpoint
CREATE INDEX "auth_links_expires_idx" ON "auth_links" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_hash_uq" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_family_idx" ON "auth_sessions" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id") WHERE "auth_sessions"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "auth_sessions_attendee_idx" ON "auth_sessions" USING btree ("attendee_id") WHERE "auth_sessions"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "auth_sessions_expires_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ws_tickets_expires_idx" ON "ws_tickets" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "signing_keys_qr_kid_uq" ON "signing_keys" USING btree ("qr_kid") WHERE "signing_keys"."qr_kid" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "signing_keys" ADD CONSTRAINT "signing_keys_qr_kid_format" CHECK ("signing_keys"."qr_kid" IS NULL OR "signing_keys"."qr_kid" ~ '^[0-9a-f]{8}$');