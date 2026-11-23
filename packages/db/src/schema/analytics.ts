/**
 * Aggregates — docs/02-architecture.md §4.5 (P-14, D-16). Non-identifying; retained after the purge.
 * `rebuild_event_rollups(event_id)` (migration 0002) recomputes occupancy_rollups and
 * gate_rate_rollups from scans and is called by the purge before the partition is dropped.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { reportKind, reportState } from "./enums";
import { users } from "./people";
import { checkpoints, events, rooms } from "./venue";

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Per room, per 5-minute bucket (bucket_start aligned to 5 minutes UTC). */
export const occupancy_rollups = pgTable(
  "occupancy_rollups",
  {
    event_id: uuid("event_id")
      .notNull()
      .references(() => events.id),
    room_id: uuid("room_id")
      .notNull()
      .references(() => rooms.id),
    bucket_start: tstz("bucket_start").notNull(),
    /** Admissions counted into the room in the bucket. */
    in_count: integer("in_count").notNull().default(0),
    /** Exits out of the room in the bucket: tap-outs plus implied exits. */
    out_count: integer("out_count").notNull().default(0),
    /** Highest derived occupancy reached within the bucket (after corrections and clamping). */
    peak: integer("peak").notNull().default(0),
  },
  (t) => [
    primaryKey({ name: "occupancy_rollups_pk", columns: [t.event_id, t.room_id, t.bucket_start] }),
    index("occupancy_rollups_bucket_idx").on(t.event_id, t.bucket_start),
    check("occupancy_rollups_nonneg", sql`${t.in_count} >= 0 AND ${t.out_count} >= 0 AND ${t.peak} >= 0`),
  ],
);

/**
 * Per gate, per minute scan rates (D-16) — the only history the later forecasting model learns from.
 * `scans` counts physical reads (every result except the system-generated implied_exit).
 * `denied` counts red results. `by_tier_jsonb` maps tier (or "STAFF" / "UNKNOWN") to physical reads.
 */
export const gate_rate_rollups = pgTable(
  "gate_rate_rollups",
  {
    event_id: uuid("event_id")
      .notNull()
      .references(() => events.id),
    checkpoint_id: uuid("checkpoint_id")
      .notNull()
      .references(() => checkpoints.id),
    minute_start: tstz("minute_start").notNull(),
    scans: integer("scans").notNull().default(0),
    admitted: integer("admitted").notNull().default(0),
    denied: integer("denied").notNull().default(0),
    by_tier_jsonb: jsonb("by_tier_jsonb").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    primaryKey({ name: "gate_rate_rollups_pk", columns: [t.event_id, t.checkpoint_id, t.minute_start] }),
    index("gate_rate_rollups_minute_idx").on(t.event_id, t.minute_start),
    check("gate_rate_rollups_minute_aligned", sql`date_trunc('minute', ${t.minute_start}) = ${t.minute_start}`),
  ],
);

export const attendance_snapshots = pgTable(
  "attendance_snapshots",
  {
    event_id: uuid("event_id")
      .notNull()
      .references(() => events.id),
    taken_at: tstz("taken_at").notNull(),
    registered: integer("registered").notNull(),
    checked_in: integer("checked_in").notNull(),
    on_site: integer("on_site").notNull(),
    /** { "VIP": { "registered": n, "checked_in": n, "on_site": n }, … } */
    by_tier_jsonb: jsonb("by_tier_jsonb").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [primaryKey({ name: "attendance_snapshots_pk", columns: [t.event_id, t.taken_at] })],
);

export const event_reports = pgTable(
  "event_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    event_id: uuid("event_id")
      .notNull()
      .references(() => events.id),
    kind: reportKind("kind").notNull(),
    state: reportState("state").notNull().default("queued"),
    /** Object-storage key of the export. Served only through signed short-lived links. */
    object_key: text("object_key"),
    requested_by: uuid("requested_by").references(() => users.id),
    error: text("error"),
    created_at: tstz("created_at").notNull().defaultNow(),
    completed_at: tstz("completed_at"),
  },
  (t) => [index("event_reports_event_idx").on(t.event_id, t.created_at)],
);
