/**
 * Phase 4 operational tables: attendee data requests, webhook deliveries, gate devices.
 */
import { sql } from "drizzle-orm";
import {
  check,
  cidr,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { breach_alerts, webhook_endpoints } from "./operations";
import { users } from "./people";
import { attendees } from "./vault";
import { checkpoints, venues } from "./venue";

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const dataRequestKind = pgEnum("data_request_kind", ["export", "erasure"]);
export const dataRequestState = pgEnum("data_request_state", ["requested", "in_progress", "completed", "rejected"]);

/**
 * Attendee rights requests (docs/03 §5): the operator queue for data export and erasure. No
 * identity is stored here; `object_key` points at the export file once built.
 */
export const data_requests = pgTable(
  "data_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attendee_id: uuid("attendee_id")
      .notNull()
      .references(() => attendees.id),
    kind: dataRequestKind("kind").notNull(),
    state: dataRequestState("state").notNull().default("requested"),
    requested_at: tstz("requested_at").notNull().defaultNow(),
    started_at: tstz("started_at"),
    completed_at: tstz("completed_at"),
    handled_by: uuid("handled_by").references(() => users.id),
    /** Export: object-storage key of the archive, served by a signed short-lived link. */
    object_key: text("object_key"),
    /** Operator note (e.g. why a request was rejected). Never personal data. */
    note: text("note"),
  },
  (t) => [
    // One open request of each kind per attendee.
    uniqueIndex("data_requests_open_uq").on(t.attendee_id, t.kind).where(sql`${t.state} IN ('requested', 'in_progress')`),
    index("data_requests_queue_idx").on(t.state, t.requested_at),
    check("data_requests_completed_at", sql`(${t.state} IN ('completed', 'rejected')) = (${t.completed_at} IS NOT NULL)`),
  ],
);

export const webhookDeliveryState = pgEnum("webhook_delivery_state", ["pending", "in_flight", "succeeded", "dead"]);

/**
 * One row per webhook message to one endpoint, with its retry state. Each attempt is appended to
 * `attempts_jsonb` ({ at, response_code, error, ms }) for the delivery log (06 D10).
 */
export const webhook_deliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    endpoint_id: uuid("endpoint_id")
      .notNull()
      .references(() => webhook_endpoints.id, { onDelete: "cascade" }),
    /** Event name, e.g. "alert.raised". */
    event: text("event").notNull(),
    /** The JSON body to send. Never personal data (alerts carry none). */
    payload: jsonb("payload").notNull(),
    alert_id: uuid("alert_id").references(() => breach_alerts.id),
    state: webhookDeliveryState("state").notNull().default("pending"),
    /** Attempts made so far. */
    attempt: integer("attempt").notNull().default(0),
    response_code: integer("response_code"),
    last_error: text("last_error"),
    next_attempt_at: tstz("next_attempt_at").notNull().defaultNow(),
    /** While in_flight: when the claim lapses and the delivery may be claimed again. */
    lease_until: tstz("lease_until"),
    attempts_jsonb: jsonb("attempts_jsonb").notNull().default(sql`'[]'::jsonb`),
    created_at: tstz("created_at").notNull().defaultNow(),
    last_attempt_at: tstz("last_attempt_at"),
    delivered_at: tstz("delivered_at"),
  },
  (t) => [
    index("webhook_deliveries_due_idx").on(t.next_attempt_at).where(sql`${t.state} IN ('pending', 'in_flight')`),
    index("webhook_deliveries_endpoint_idx").on(t.endpoint_id, t.created_at),
    check("webhook_deliveries_attempt_nonneg", sql`${t.attempt} >= 0`),
  ],
);

export const deviceKind = pgEnum("device_kind", ["scanner", "fixed_reader", "kiosk"]);
export const deviceState = pgEnum("device_state", ["active", "maintenance", "retired", "lost"]);

/**
 * Venue-owned gate devices (D-09): Gate Scanner phones and tablets, fixed readers, kiosks. Holds the
 * latest heartbeat for gate health (01 §6, O-22). A fixed reader has no signed-in user (O-17): it
 * authenticates with a device token, stored only as `token_hash` (base64url SHA-256).
 */
export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venue_id: uuid("venue_id")
      .notNull()
      .references(() => venues.id),
    kind: deviceKind("kind").notNull(),
    label: text("label").notNull(),
    /** Serial or install id. Unique. */
    hardware_id: text("hardware_id").notNull(),
    /** A fixed reader is installed at one checkpoint; a phone pairs per shift (staff_assignments). */
    checkpoint_id: uuid("checkpoint_id").references(() => checkpoints.id),
    token_hash: text("token_hash"),
    token_rotated_at: tstz("token_rotated_at"),
    /** Bumped on every token issue or rotation and when the device leaves service; access tokens carry it. */
    token_version: integer("token_version").notNull().default(0),
    state: deviceState("state").notNull().default("active"),
    last_heartbeat_at: tstz("last_heartbeat_at"),
    last_clock_offset_ms: integer("last_clock_offset_ms"),
    /** Scans queued on the device at its last heartbeat ("Offline 4m, 182 queued"). */
    last_queue_depth: integer("last_queue_depth"),
    last_ip_prefix: cidr("last_ip_prefix"),
    app_version: text("app_version"),
    /** `issued_at` of the signed allowlist the device reported holding at its last heartbeat (0028). */
    allowlist_issued_at: tstz("allowlist_issued_at"),
    created_at: tstz("created_at").notNull().defaultNow(),
    retired_at: tstz("retired_at"),
  },
  (t) => [
    uniqueIndex("devices_hardware_id_uq").on(t.hardware_id),
    uniqueIndex("devices_token_hash_uq").on(t.token_hash).where(sql`${t.token_hash} IS NOT NULL`),
    index("devices_checkpoint_idx").on(t.checkpoint_id),
    check("devices_token_hash_format", sql`${t.token_hash} IS NULL OR ${t.token_hash} ~ '^[A-Za-z0-9_-]{43}$'`),
    check("devices_fixed_reader_checkpoint", sql`${t.kind} <> 'fixed_reader' OR ${t.checkpoint_id} IS NOT NULL`),
    check("devices_queue_nonneg", sql`${t.last_queue_depth} IS NULL OR ${t.last_queue_depth} >= 0`),
  ],
);
