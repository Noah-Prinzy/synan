CREATE TABLE "carrier_desk_code_failures" (
	"attendee_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_desk_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"carrier_identifier" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" uuid,
	CONSTRAINT "carrier_desk_codes_short_lived" CHECK ("carrier_desk_codes"."expires_at" > "carrier_desk_codes"."created_at" AND "carrier_desk_codes"."expires_at" <= "carrier_desk_codes"."created_at" + interval '15 minutes'),
	CONSTRAINT "carrier_desk_codes_hash_format" CHECK ("carrier_desk_codes"."code_hash" ~ '^[A-Za-z0-9_-]{43}$')
);
--> statement-breakpoint
CREATE TABLE "user_invites" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "user_invites_expiry_order" CHECK ("user_invites"."expires_at" > "user_invites"."created_at"),
	CONSTRAINT "user_invites_token_hash_format" CHECK ("user_invites"."token_hash" ~ '^[A-Za-z0-9_-]{43}$')
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_pending_secret_enc" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_pending_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "carrier_desk_code_failures" ADD CONSTRAINT "carrier_desk_code_failures_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "pii_vault"."attendees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_desk_codes" ADD CONSTRAINT "carrier_desk_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_desk_codes" ADD CONSTRAINT "carrier_desk_codes_used_by_attendees_id_fk" FOREIGN KEY ("used_by") REFERENCES "pii_vault"."attendees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "carrier_desk_code_failures_idx" ON "carrier_desk_code_failures" USING btree ("attendee_id","at");--> statement-breakpoint
CREATE INDEX "carrier_desk_codes_expires_idx" ON "carrier_desk_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "user_invites_user_idx" ON "user_invites" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_invites_expires_idx" ON "user_invites" USING btree ("expires_at");