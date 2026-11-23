CREATE TABLE "event_summaries" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"frozen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary_jsonb" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onsite_rollups" (
	"event_id" uuid NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"arrivals" integer NOT NULL,
	"departures" integer NOT NULL,
	"peak" integer NOT NULL,
	"peak_at" timestamp with time zone NOT NULL,
	"level_end" integer NOT NULL,
	CONSTRAINT "onsite_rollups_pk" PRIMARY KEY("event_id","bucket_start"),
	CONSTRAINT "onsite_rollups_nonneg" CHECK ("onsite_rollups"."arrivals" >= 0 AND "onsite_rollups"."departures" >= 0 AND "onsite_rollups"."peak" >= 0 AND "onsite_rollups"."level_end" >= 0)
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "rollups_rebuilt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_summaries" ADD CONSTRAINT "event_summaries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onsite_rollups" ADD CONSTRAINT "onsite_rollups_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;