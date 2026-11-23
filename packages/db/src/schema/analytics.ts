/**
 * Aggregates — docs/02-architecture.md §4.5 (P-14, D-16). Non-identifying; retained after the purge.
 * `rebuild_event_rollups(event_id)` (migration 0002) recomputes occupancy_rollups and
 * gate_rate_rollups from scans and is called by the purge before the partition is dropped.
 */
import { sql } from "drizzle-orm";
import { bigint, bigserial, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { reportKind, reportState } from "./enums";
import { users } from "./people";
import { checkpoints, events, rooms, zones } from "./venue";

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
    /** Physical reads by result code, e.g. { "admitted": 12, "denied_room": 1 } — the failure breakdown. */
    by_result_jsonb: jsonb("by_result_jsonb").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    primaryKey({ name: "gate_rate_rollups_pk", columns: [t.event_id, t.checkpoint_id, t.minute_start] }),
    index("gate_rate_rollups_minute_idx").on(t.event_id, t.minute_start),
    check("gate_rate_rollups_minute_aligned", sql`date_trunc('minute', ${t.minute_start}) = ${t.minute_start}`),
  ],
);

/**
 * Dwell per zone (Dwell and Flow report), rebuilt from scans before the purge. A visit starts when a
 * person is admitted into a zone and ends at their next zone change (another zone, or a perimeter
 * exit); a visit still open at the end is closed at the event's end. Aggregates only.
 * `dwell_histogram` counts visits in minute buckets [0,5) [5,15) [15,30) [30,60) [60,120) [120,∞).
 */
export const zone_dwell_rollups = pgTable(
  "zone_dwell_rollups",
  {
    event_id: uuid("event_id")
      .notNull()
      .references(() => events.id),
    zone_id: uuid("zone_id")
      .notNull()
      .references(() => zones.id),
    visits: integer("visits").notNull(),
    /** Visits still open when the event ended. */
    open_visits: integer("open_visits").notNull(),
    total_seconds: bigint("total_seconds", { mode: "number" }).notNull(),
    dwell_histogram: integer("dwell_histogram").array().notNull(),
  },
  (t) => [
    primaryKey({ name: "zone_dwell_rollups_pk", columns: [t.event_id, t.zone_id] }),
    check("zone_dwell_rollups_histogram", sql`cardinality(${t.dwell_histogram}) = 6`),
  ],
);

/**
 * Movement between zones per hour (Dwell and Flow report). `from_zone_id` null = arrived from
 * outside the venue; `to_zone_id` null = left through a perimeter exit.
 */
export const zone_flow_rollups = pgTable(
  "zone_flow_rollups",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    event_id: uuid("event_id")
      .notNull()
      .references(() => events.id),
    bucket_start: tstz("bucket_start").notNull(),
    from_zone_id: uuid("from_zone_id").references(() => zones.id),
    to_zone_id: uuid("to_zone_id").references(() => zones.id),
    moves: integer("moves").notNull(),
  },
  (t) => [
    index("zone_flow_rollups_event_idx").on(t.event_id, t.bucket_start),
    check("zone_flow_rollups_distinct", sql`${t.from_zone_id} IS DISTINCT FROM ${t.to_zone_id}`),
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
