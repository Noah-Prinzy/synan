/**
 * Venue and events — docs/02-architecture.md §4.1 (P-03, P-05, P-13).
 *
 * Property keys are the SQL column names (snake_case, exactly as in the spec), so a row read with
 * Drizzle has the same field names as the contract payloads.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  interval,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { capacityPolicy, checkpointDirection, eventState } from "./enums";

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => tstz("created_at").notNull().defaultNow();
const updatedAt = () => tstz("updated_at").notNull().defaultNow();

/** `checkpoints.position_jsonb` — the contracts' `GridPoint`. */
export interface CheckpointPosition {
  x: number;
  y: number;
  side: "n" | "e" | "s" | "w";
}

/**
 * The shape of `GridPoint` (packages/contracts/src/rest/venue.ts): an object with exactly the keys
 * x, y (integers 0–10 000) and side (n, e, s or w). CASE fixes the evaluation order, so a malformed
 * value fails the check instead of raising a cast error.
 */
const CHECKPOINT_POSITION_CHECK = `position_jsonb IS NULL OR CASE
  WHEN jsonb_typeof(position_jsonb) <> 'object' THEN false
  WHEN (position_jsonb - 'x' - 'y' - 'side') <> '{}'::jsonb THEN false
  WHEN coalesce(jsonb_typeof(position_jsonb -> 'x'), '') <> 'number' OR coalesce(jsonb_typeof(position_jsonb -> 'y'), '') <> 'number' THEN false
  WHEN coalesce(jsonb_typeof(position_jsonb -> 'side'), '') <> 'string' THEN false
  ELSE (position_jsonb ->> 'side') IN ('n', 'e', 's', 'w')
   AND (position_jsonb ->> 'x')::numeric BETWEEN 0 AND 10000 AND (position_jsonb ->> 'x')::numeric = trunc((position_jsonb ->> 'x')::numeric)
   AND (position_jsonb ->> 'y')::numeric BETWEEN 0 AND 10000 AND (position_jsonb ->> 'y')::numeric = trunc((position_jsonb ->> 'y')::numeric)
END`;

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** IANA timezone, e.g. Europe/London. */
  timezone: text("timezone").notNull(),
  support_email: text("support_email").notNull(),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const venues = pgTable(
  "venues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    org_id: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    address: text("address").notNull().default(""),
    /** City shown in event summaries. */
    city: text("city"),
    timezone: text("timezone").notNull(),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [index("venues_org_idx").on(t.org_id)],
);

export const zones = pgTable(
  "zones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venue_id: uuid("venue_id")
      .notNull()
      .references(() => venues.id),
    name: text("name").notNull(),
    /** Free-form floor label ("G", "1", "Mezzanine"). */
    floor: text("floor"),
    /** Map shape. Zone presence only — never attendee coordinates (D-04). */
    geometry_jsonb: jsonb("geometry_jsonb"),
    created_at: createdAt(),
  },
  (t) => [
    // Target of composite FKs that pin rooms/checkpoints to a zone of the *same* venue.
    unique("zones_id_venue_uq").on(t.id, t.venue_id),
    index("zones_venue_idx").on(t.venue_id),
  ],
);

export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venue_id: uuid("venue_id")
      .notNull()
      .references(() => venues.id),
    zone_id: uuid("zone_id").notNull(),
    name: text("name").notNull(),
    capacity: integer("capacity").notNull(),
    warn_at_pct: smallint("warn_at_pct").notNull().default(85),
    block_at_pct: smallint("block_at_pct").notNull().default(100),
    /** What happens at block_at_pct: refuse, or admit and raise an alert (01 §7). */
    capacity_policy: capacityPolicy("capacity_policy").notNull().default("block"),
    /** Exempt from the session-end occupancy reset (D-10): lounges, expo floors. */
    continuous_bool: boolean("continuous_bool").notNull().default(false),
    geometry_jsonb: jsonb("geometry_jsonb"),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [
    unique("rooms_id_venue_uq").on(t.id, t.venue_id),
    // Target of checkpoints_room_same_zone_fk: a room's door is in the room's own zone.
    unique("rooms_id_zone_uq").on(t.id, t.zone_id),
    foreignKey({
      name: "rooms_zone_same_venue_fk",
      columns: [t.zone_id, t.venue_id],
      foreignColumns: [zones.id, zones.venue_id],
    }),
    index("rooms_venue_idx").on(t.venue_id),
    index("rooms_zone_idx").on(t.zone_id),
    check("rooms_capacity_nonneg", sql`${t.capacity} >= 0`),
    check(
      "rooms_thresholds",
      sql`${t.warn_at_pct} > 0 AND ${t.block_at_pct} >= ${t.warn_at_pct} AND ${t.block_at_pct} <= 1000`,
    ),
  ],
);

export const checkpoints = pgTable(
  "checkpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venue_id: uuid("venue_id")
      .notNull()
      .references(() => venues.id),
    zone_id: uuid("zone_id").notNull(),
    /** Set when the gate is a room door; such scans count toward that room's occupancy. */
    room_id: uuid("room_id"),
    direction: checkpointDirection("direction").notNull(),
    /** Perimeter gate or desk: accepts QR and wristband. Interior: wristband only (D-11). */
    perimeter_bool: boolean("perimeter_bool").notNull().default(false),
    /** Fixed reader serial or paired device id. Unique when present. */
    hardware_id: text("hardware_id"),
    label: text("label").notNull(),
    /** Gate health (01 §6, 06 D12). Written by the heartbeat handler. */
    last_heartbeat_at: tstz("last_heartbeat_at"),
    last_clock_offset_ms: integer("last_clock_offset_ms"),
    /**
     * Where the gate sits on the venue's abstract grid and which edge it faces — the contracts'
     * `GridPoint` (`{ x, y, side }`, integer grid units 0–10 000, side n/e/s/w). Null when not placed.
     * A place on the floor plan, never a person's location (D-04). The grid's extent is derived.
     */
    position_jsonb: jsonb("position_jsonb").$type<CheckpointPosition>(),
    created_at: createdAt(),
  },
  (t) => [
    unique("checkpoints_id_venue_uq").on(t.id, t.venue_id),
    check("checkpoints_position_grid_point", sql.raw(CHECKPOINT_POSITION_CHECK)),
    foreignKey({
      name: "checkpoints_zone_same_venue_fk",
      columns: [t.zone_id, t.venue_id],
      foreignColumns: [zones.id, zones.venue_id],
    }),
    foreignKey({
      name: "checkpoints_room_same_venue_fk",
      columns: [t.room_id, t.venue_id],
      foreignColumns: [rooms.id, rooms.venue_id],
    }),
    // A room's door must be in the room's own zone (zone presence follows the door's zone).
    foreignKey({
      name: "checkpoints_room_same_zone_fk",
      columns: [t.room_id, t.zone_id],
      foreignColumns: [rooms.id, rooms.zone_id],
    }),
    uniqueIndex("checkpoints_hardware_id_uq")
      .on(t.hardware_id)
      .where(sql`${t.hardware_id} IS NOT NULL`),
    index("checkpoints_venue_idx").on(t.venue_id),
    index("checkpoints_room_idx").on(t.room_id),
  ],
);

/** Minimum transit time between two checkpoints — the impossible-travel rule (01 §7). */
export const transit_times = pgTable(
  "transit_times",
  {
    venue_id: uuid("venue_id")
      .notNull()
      .references(() => venues.id),
    from_checkpoint_id: uuid("from_checkpoint_id").notNull(),
    to_checkpoint_id: uuid("to_checkpoint_id").notNull(),
    min_seconds: integer("min_seconds").notNull(),
  },
  (t) => [
    primaryKey({ name: "transit_times_pk", columns: [t.from_checkpoint_id, t.to_checkpoint_id] }),
    foreignKey({
      name: "transit_times_from_fk",
      columns: [t.from_checkpoint_id, t.venue_id],
      foreignColumns: [checkpoints.id, checkpoints.venue_id],
    }).onDelete("cascade"),
    foreignKey({
      name: "transit_times_to_fk",
      columns: [t.to_checkpoint_id, t.venue_id],
      foreignColumns: [checkpoints.id, checkpoints.venue_id],
    }).onDelete("cascade"),
    check("transit_times_distinct", sql`${t.from_checkpoint_id} <> ${t.to_checkpoint_id}`),
    check("transit_times_positive", sql`${t.min_seconds} > 0`),
  ],
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    org_id: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    venue_id: uuid("venue_id")
      .notNull()
      .references(() => venues.id),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    starts_at: tstz("starts_at").notNull(),
    ends_at: tstz("ends_at").notNull(),
    /** IANA timezone. All times are stored in UTC (01 §9). */
    timezone: text("timezone").notNull(),
    state: eventState("state").notNull().default("draft"),
    /** False for Private Invitation events: never in public discovery. */
    listed_bool: boolean("listed_bool").notNull().default(true),
    /** Wait between close and the purge (O-06, default 72 h). */
    grace_buffer: interval("grace_buffer").notNull().default("72 hours"),
    /** Event-defined attendee profile fields (GET /events/:slug/profile-schema). */
    profile_schema_jsonb: jsonb("profile_schema_jsonb").notNull().default(sql`'[]'::jsonb`),
    /** Pass template; publishing requires one (01 §9). */
    pass_template_jsonb: jsonb("pass_template_jsonb"),
    /** Optimistic-concurrency version of this event's access_rules set (PUT /events/:id/access-rules). */
    access_rules_version: integer("access_rules_version").notNull().default(0),
    /** Bumped on every revocation; carried in the signed offline allowlist (01 §8). */
    revocation_epoch: integer("revocation_epoch").notNull().default(0),
    /** Set by trigger when state becomes `closed`; starts the retention clock. */
    closed_at: tstz("closed_at"),
    /** Set by purge_event_movement_data(). */
    purged_at: tstz("purged_at"),
    /** Last rebuild_event_rollups() run: how current the reports and summary are. */
    rollups_rebuilt_at: tstz("rollups_rebuilt_at"),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [
    uniqueIndex("events_slug_uq").on(t.slug),
    index("events_venue_idx").on(t.venue_id),
    index("events_state_idx").on(t.state, t.starts_at),
    check("events_time_order", sql`${t.ends_at} > ${t.starts_at}`),
    check("events_grace_nonneg", sql`${t.grace_buffer} >= interval '0'`),
  ],
);

export const event_rooms = pgTable(
  "event_rooms",
  {
    event_id: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    room_id: uuid("room_id")
      .notNull()
      .references(() => rooms.id),
    /** Null = use rooms.capacity. */
    capacity_override: integer("capacity_override"),
  },
  (t) => [
    primaryKey({ name: "event_rooms_pk", columns: [t.event_id, t.room_id] }),
    index("event_rooms_room_idx").on(t.room_id),
    check("event_rooms_capacity_nonneg", sql`${t.capacity_override} IS NULL OR ${t.capacity_override} >= 0`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    event_id: uuid("event_id").notNull(),
    room_id: uuid("room_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    starts_at: tstz("starts_at").notNull(),
    ends_at: tstz("ends_at").notNull(),
  },
  (t) => [
    foreignKey({
      name: "sessions_event_room_fk",
      columns: [t.event_id, t.room_id],
      foreignColumns: [event_rooms.event_id, event_rooms.room_id],
    }).onDelete("cascade"),
    index("sessions_event_idx").on(t.event_id, t.starts_at),
    check("sessions_time_order", sql`${t.ends_at} > ${t.starts_at}`),
  ],
);
