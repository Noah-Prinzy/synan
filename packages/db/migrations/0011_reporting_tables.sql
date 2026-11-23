CREATE TABLE "access_rule_versions" (
	"event_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"rules_jsonb" jsonb NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_rule_versions_pk" PRIMARY KEY("event_id","version")
);
--> statement-breakpoint
CREATE TABLE "zone_dwell_rollups" (
	"event_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"visits" integer NOT NULL,
	"open_visits" integer NOT NULL,
	"total_seconds" bigint NOT NULL,
	"dwell_histogram" integer[] NOT NULL,
	CONSTRAINT "zone_dwell_rollups_pk" PRIMARY KEY("event_id","zone_id"),
	CONSTRAINT "zone_dwell_rollups_histogram" CHECK (cardinality("zone_dwell_rollups"."dwell_histogram") = 6)
);
--> statement-breakpoint
CREATE TABLE "zone_flow_rollups" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"from_zone_id" uuid,
	"to_zone_id" uuid,
	"moves" integer NOT NULL,
	CONSTRAINT "zone_flow_rollups_distinct" CHECK ("zone_flow_rollups"."from_zone_id" IS DISTINCT FROM "zone_flow_rollups"."to_zone_id")
);
--> statement-breakpoint
ALTER TABLE "gate_rate_rollups" ADD COLUMN "by_result_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "access_rule_versions" ADD CONSTRAINT "access_rule_versions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_dwell_rollups" ADD CONSTRAINT "zone_dwell_rollups_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_dwell_rollups" ADD CONSTRAINT "zone_dwell_rollups_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_flow_rollups" ADD CONSTRAINT "zone_flow_rollups_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_flow_rollups" ADD CONSTRAINT "zone_flow_rollups_from_zone_id_zones_id_fk" FOREIGN KEY ("from_zone_id") REFERENCES "public"."zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_flow_rollups" ADD CONSTRAINT "zone_flow_rollups_to_zone_id_zones_id_fk" FOREIGN KEY ("to_zone_id") REFERENCES "public"."zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "zone_flow_rollups_event_idx" ON "zone_flow_rollups" USING btree ("event_id","bucket_start");