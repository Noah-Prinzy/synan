CREATE TYPE "public"."wizard_step" AS ENUM('basics', 'venue', 'access', 'pass', 'review');--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "venue_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "starts_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "ends_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "wizard_step" "wizard_step" DEFAULT 'basics' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "floors" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "capacity_default" integer;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "layout_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "layout_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "zones" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_updated_idx" ON "events" USING btree ("updated_at");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_scheduled_unless_draft" CHECK ("events"."state" = 'draft' OR ("events"."venue_id" IS NOT NULL AND "events"."starts_at" IS NOT NULL AND "events"."ends_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_geometry_grid_shape" CHECK (public.grid_shape_valid("rooms"."geometry_jsonb"));--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_capacity_default_positive" CHECK ("venues"."capacity_default" IS NULL OR "venues"."capacity_default" >= 1);--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_layout_version_nonneg" CHECK ("venues"."layout_version" >= 0);--> statement-breakpoint
ALTER TABLE "zones" ADD CONSTRAINT "zones_geometry_grid_shape" CHECK (public.grid_shape_valid("zones"."geometry_jsonb"));