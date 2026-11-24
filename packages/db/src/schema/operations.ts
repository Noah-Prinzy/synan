/**
 * Scans, occupancy corrections, alerts, audit, webhooks — docs/02-architecture.md §4.4
 * (P-06, P-12, D-03, D-04, D-13, D-14).
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { credentials } from "./credentials";
import {
  alertKind,
  alertSeverity,
  alertState,
  carrierKind,
  occupancyAdjustmentReason,
  scanDirection,
  scanResult,
} from "./enums";
import { users } from "./people";
import { piiVault } from "./vault";
import { checkpoints, event_rooms, events, organizations, rooms } from "./venue";

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * pii_vault.ephemeral_ids — the only link between a credential and its scans for one event
 * (03 §5). Destroyed by the purge, which de-identifies everything that survives.
 */
export const ephemeral_ids = piiVault.table(
  "ephemeral_ids",
  {
    event_id: uuid("event_id")
      .notNull()
      .references(() => events.id),
    credential_id: uuid("credential_id")
      .notNull()
      .references(() => credentials.id),
    ephemeral_id: uuid("ephemeral_id").notNull().defaultRandom(),
    created_at: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "ephemeral_ids_pk", columns: [t.event_id, t.credential_id] }),
    uniqueIndex("ephemeral_ids_ephemeral_uq").on(t.ephemeral_id),
  ],
);

/**
 * Append-only scan log, LIST-partitioned by event_id (one partition per event, created by a
 * trigger on `events`; see migration 0001's hand edit and 0002). The purge drops the partition.
 *
 * Because the table is partitioned by event_id, the primary key and the idempotency key are
 * unique *per event*: (event_id, id) and (event_id, idem_key).
 *
 * Stores which checkpoint, never coordinates (D-04), and the ephemeral ID, never the credential.
 */
export const scans = pgTable(
  "scans",
  {
    id: uuid("id").notNull().defaultRandom(),
    event_id: uuid("event_id")
      .notNull()
      .references(() => events.id),
    checkpoint_id: uuid("checkpoint_id")
      .notNull()
      .references(() => checkpoints.id),
    /** pii_vault.ephemeral_ids.ephemeral_id (no FK across the vault boundary). Null for unknown tokens. */
    ephemeral_id: uuid("ephemeral_id"),
    /** Server-derived carrier kind. Null when the token is unknown. */
    carrier_kind: carrierKind("carrier_kind"),
    result: scanResult("result").notNull(),
    /**
     * Direction the scan counts as. Required at a `both` checkpoint; when null the checkpoint's own
     * direction applies. For `implied_exit` rows it is ignored (always a decrement).
     */
    direction: scanDirection("direction"),
    /** Device clock time of the read (D-14). */
    occurred_at: tstz("occurred_at").notNull(),
    received_at: tstz("received_at").notNull().defaultNow(),
    /** server_time − device_time, measured by the device at its last sync. */
    clock_offset_ms: integer("clock_offset_ms").notNull().default(0),
    /** occurred_at + clock_offset_ms: the server's ordering key. Generated; never written. */
    corrected_at: tstz("corrected_at")
      .notNull()
      .generatedAlwaysAs(sql`public.scan_corrected_at(occurred_at, clock_offset_ms)`),
    /** Client-generated idempotency key; unique per event. */
    idem_key: text("idem_key").notNull(),
    offline_bool: boolean("offline_bool").notNull().default(false),
    /** What an offline gate showed. Informational; the server's `result` is authoritative. */
    local_result: scanResult("local_result"),
    device_id: text("device_id"),
    /** The security staff user operating the scanner, if any (fixed readers have none). */
    staff_user_id: uuid("staff_user_id").references(() => users.id),
  },
  (t) => [
    primaryKey({ name: "scans_pk", columns: [t.event_id, t.id] }),
    unique("scans_idem_key_uq").on(t.event_id, t.idem_key),
    // Hot paths. Partitions are per event, so event_id is not repeated in these.
    index("scans_checkpoint_time_idx").on(t.checkpoint_id, t.corrected_at),
    index("scans_ephemeral_time_idx").on(t.ephemeral_id, t.corrected_at),
    index("scans_time_idx").on(t.corrected_at),
    check("scans_result_stored", sql`${t.result} <> 'offline_queued'`),
    check("scans_idem_key_len", sql`length(${t.idem_key}) BETWEEN 8 AND 128`),
  ],
);

/**
 * Occupancy corrections (D-10). Two forms:
 *  - `set_to` NOT NULL: an anchor — the room's count was set to this absolute value at `at`
 *    (manual recount, session-end reset). Scans before `at` no longer matter for this room.
 *  - `set_to` NULL: a relative `delta` (sync_conflict corrections, or a recount written as a delta).
 * `delta` is always recorded (for an anchor: the change it made when written) for audit and display.
 */
export const occupancy_adjustments = pgTable(
  "occupancy_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    event_id: uuid("event_id").notNull(),
    room_id: uuid("room_id").notNull(),
    delta: integer("delta").notNull(),
    set_to: integer("set_to"),
    reason: occupancyAdjustmentReason("reason").notNull(),
    actor_id: uuid("actor_id").references(() => users.id),
    note: text("note"),
    at: tstz("at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "occupancy_adjustments_event_room_fk",
      columns: [t.event_id, t.room_id],
      foreignColumns: [event_rooms.event_id, event_rooms.room_id],
    }),
    index("occupancy_adjustments_room_time_idx").on(t.event_id, t.room_id, t.at),
    check("occupancy_adjustments_set_to_nonneg", sql`${t.set_to} IS NULL OR ${t.set_to} >= 0`),
  ],
);

/**
 * Correction records for scans (0028): a scanner undid a mistaken admission (06 S3). The scan itself
 * stays (append-only); the projection treats a voided scan as if it had not happened, and the count
 * change is written as `scan_undo` occupancy adjustments so SQL derivations agree. One per scan.
 * Movement data: deleted with the event's scans at the purge.
 */
export const scan_voids = pgTable(
  "scan_voids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    event_id: uuid("event_id")
      .notNull()
      .references(() => events.id),
    /** scans.id (no FK: scans is partitioned and dropped at the purge). */
    scan_id: uuid("scan_id").notNull(),
    voided_by: uuid("voided_by").references(() => users.id),
    reason: text("reason"),
    voided_at: tstz("voided_at").notNull().defaultNow(),
  },
  (t) => [
    unique("scan_voids_scan_uq").on(t.event_id, t.scan_id),
    check("scan_voids_reason_len", sql`${t.reason} IS NULL OR length(${t.reason}) <= 200`),
  ],
);

/**
 * Security alerts. Kept 12 months after the event (D-03), including credential_id (O-11).
 * `scan_ids` names the scans involved (D-13); they dangle after the purge by design.
 */
export const breach_alerts = pgTable(
  "breach_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    event_id: uuid("event_id")
      .notNull()
      .references(() => events.id),
    severity: alertSeverity("severity").notNull(),
    kind: alertKind("kind").notNull(),
    /** Null for room-level (capacity) and system alerts. */
    checkpoint_id: uuid("checkpoint_id").references(() => checkpoints.id),
    room_id: uuid("room_id").references(() => rooms.id),
    credential_id: uuid("credential_id").references(() => credentials.id),
    occurred_at: tstz("occurred_at").notNull(),
    state: alertState("state").notNull().default("open"),
    /** Short machine-built description. Never personal data. */
    detail: text("detail").notNull().default(""),
    scan_ids: uuid("scan_ids").array().notNull().default(sql`'{}'::uuid[]`),
    assignee_id: uuid("assignee_id").references(() => users.id),
    acked_by: uuid("acked_by").references(() => users.id),
    acked_at: tstz("acked_at"),
    resolved_by: uuid("resolved_by").references(() => users.id),
    resolved_at: tstz("resolved_at"),
    resolution_note: text("resolution_note"),
    created_at: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("breach_alerts_event_state_idx").on(t.event_id, t.state, t.occurred_at),
    index("breach_alerts_credential_idx").on(t.credential_id),
    index("breach_alerts_occurred_idx").on(t.occurred_at),
    // report_breach and alert lists filter one event by time range without a state.
    index("breach_alerts_event_time_idx").on(t.event_id, t.occurred_at),
    check(
      "breach_alerts_ack_consistent",
      sql`${t.state} = 'open' OR (${t.acked_at} IS NOT NULL AND ${t.acked_by} IS NOT NULL)`,
    ),
    check(
      "breach_alerts_resolve_consistent",
      sql`${t.state} <> 'resolved' OR (${t.resolved_at} IS NOT NULL AND ${t.resolution_note} IS NOT NULL AND length(btrim(${t.resolution_note})) > 0)`,
    ),
  ],
);

/**
 * Hash-chained, append-only audit log (03 §7). Insert only `actor_id, action, target, meta_jsonb`
 * (and optionally `at`); the BEFORE INSERT trigger assigns `id`, `prev_hash` and `hash`.
 * UPDATE, DELETE and TRUNCATE are rejected by triggers. Verify with `audit_verify()`.
 */
export const audit_log = pgTable(
  "audit_log",
  {
    /** Chain order. Assigned by the trigger under the chain lock. */
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** users.id or pii_vault.attendees.id or null for the system. No FK: the log outlives both. */
    actor_id: uuid("actor_id"),
    action: text("action").notNull(),
    /** "<kind>:<id>", e.g. "credential:9f…". */
    target: text("target").notNull(),
    meta_jsonb: jsonb("meta_jsonb").notNull().default(sql`'{}'::jsonb`),
    at: tstz("at").notNull().defaultNow(),
    /** Filled by trigger. Hex SHA-256. Genesis prev_hash is 64 zeros. */
    prev_hash: text("prev_hash").notNull().default(""),
    hash: text("hash").notNull().default(""),
  },
  (t) => [
    index("audit_log_at_idx").on(t.at),
    index("audit_log_target_idx").on(t.target),
    index("audit_log_actor_idx").on(t.actor_id),
    check("audit_log_hash_len", sql`length(${t.hash}) = 64 AND length(${t.prev_hash}) = 64`),
  ],
);

/** Outbound webhooks mirroring /stream/alerts, HMAC-signed (02 §6). */
export const webhook_endpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    org_id: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    url: text("url").notNull(),
    /** HMAC secret, encrypted at the application layer. */
    secret: text("secret").notNull(),
    /** Subscribed event names, e.g. {'alert.raised','alert.resolved'}. */
    events: text("events").array().notNull().default(sql`'{}'::text[]`),
    active: boolean("active").notNull().default(true),
    created_at: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("webhook_endpoints_org_idx").on(t.org_id),
    check("webhook_endpoints_https", sql`${t.url} ~ '^https://'`),
  ],
);
