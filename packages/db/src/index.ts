/**
 * Database package — PostgreSQL schema, migrations and helpers.
 * Specification: docs/02-architecture.md §4, docs/03-security-privacy.md §5–§7.
 */
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import * as schema from "./schema/index";

export { schema };
export * from "./schema/index";
export { assertRoleSeparation, createDatabases, createDb, describeConnection, setVaultScope, withVaultScope } from "./client";
export type {
  AnyDb,
  AnyTx,
  ConnectionRole,
  CreateDatabasesOptions,
  CreateDbOptions,
  Databases,
  Db,
  Schema,
  TxOf,
  VaultScope,
} from "./client";
export * from "./functions";
export * from "./auth";
export * from "./secrets";
export * from "./crypto/index";
export * from "./reports";
export * from "./access-rules";
export * from "./allowlist";
export * from "./carriers";
export type { Page, PageQuery, RangeQuery } from "./sqlrows";
export { MIGRATIONS_FOLDER, runMigrations } from "./migrate";

/* ------------------------------------------------------------ inferred row types */

export type Organization = InferSelectModel<typeof schema.organizations>;
export type NewOrganization = InferInsertModel<typeof schema.organizations>;
export type Venue = InferSelectModel<typeof schema.venues>;
export type NewVenue = InferInsertModel<typeof schema.venues>;
export type Zone = InferSelectModel<typeof schema.zones>;
export type NewZone = InferInsertModel<typeof schema.zones>;
export type Room = InferSelectModel<typeof schema.rooms>;
export type NewRoom = InferInsertModel<typeof schema.rooms>;
export type Checkpoint = InferSelectModel<typeof schema.checkpoints>;
export type NewCheckpoint = InferInsertModel<typeof schema.checkpoints>;
export type TransitTime = InferSelectModel<typeof schema.transit_times>;
export type NewTransitTime = InferInsertModel<typeof schema.transit_times>;
export type Event = InferSelectModel<typeof schema.events>;
export type NewEvent = InferInsertModel<typeof schema.events>;
export type EventRoom = InferSelectModel<typeof schema.event_rooms>;
export type NewEventRoom = InferInsertModel<typeof schema.event_rooms>;
export type Session = InferSelectModel<typeof schema.sessions>;
export type NewSession = InferInsertModel<typeof schema.sessions>;

export type User = InferSelectModel<typeof schema.users>;
export type NewUser = InferInsertModel<typeof schema.users>;
export type StaffAssignment = InferSelectModel<typeof schema.staff_assignments>;
export type NewStaffAssignment = InferInsertModel<typeof schema.staff_assignments>;
export type Attendee = InferSelectModel<typeof schema.attendees>;
export type NewAttendee = InferInsertModel<typeof schema.attendees>;
export type Invitation = InferSelectModel<typeof schema.invitations>;
export type NewInvitation = InferInsertModel<typeof schema.invitations>;
export type Registration = InferSelectModel<typeof schema.registrations>;
export type NewRegistration = InferInsertModel<typeof schema.registrations>;
export type AccessRule = InferSelectModel<typeof schema.access_rules>;
export type NewAccessRule = InferInsertModel<typeof schema.access_rules>;

export type Credential = InferSelectModel<typeof schema.credentials>;
export type NewCredential = InferInsertModel<typeof schema.credentials>;
export type Carrier = InferSelectModel<typeof schema.carriers>;
export type NewCarrier = InferInsertModel<typeof schema.carriers>;
export type SigningKey = InferSelectModel<typeof schema.signing_keys>;
export type NewSigningKey = InferInsertModel<typeof schema.signing_keys>;

export type EphemeralId = InferSelectModel<typeof schema.ephemeral_ids>;
export type NewEphemeralId = InferInsertModel<typeof schema.ephemeral_ids>;
export type Scan = InferSelectModel<typeof schema.scans>;
export type NewScan = InferInsertModel<typeof schema.scans>;
export type OccupancyAdjustment = InferSelectModel<typeof schema.occupancy_adjustments>;
export type NewOccupancyAdjustment = InferInsertModel<typeof schema.occupancy_adjustments>;
export type BreachAlert = InferSelectModel<typeof schema.breach_alerts>;
export type NewBreachAlert = InferInsertModel<typeof schema.breach_alerts>;
export type AuditLogEntry = InferSelectModel<typeof schema.audit_log>;
/** Insert only actor_id, action, target, meta_jsonb; the trigger fills id, at, prev_hash, hash. */
export type NewAuditLogEntry = Pick<InferInsertModel<typeof schema.audit_log>, "actor_id" | "action" | "target" | "meta_jsonb">;
export type WebhookEndpoint = InferSelectModel<typeof schema.webhook_endpoints>;
export type NewWebhookEndpoint = InferInsertModel<typeof schema.webhook_endpoints>;

export type AuthSession = InferSelectModel<typeof schema.auth_sessions>;
export type AuthLink = InferSelectModel<typeof schema.auth_links>;
export type WsTicket = InferSelectModel<typeof schema.ws_tickets>;

export type OccupancyRollup = InferSelectModel<typeof schema.occupancy_rollups>;
export type GateRateRollup = InferSelectModel<typeof schema.gate_rate_rollups>;
export type AttendanceSnapshot = InferSelectModel<typeof schema.attendance_snapshots>;
export type EventReport = InferSelectModel<typeof schema.event_reports>;
export type NewEventReport = InferInsertModel<typeof schema.event_reports>;

/* ------------------------------------------------------------ enum value unions */

export type EventState = (typeof schema.eventState.enumValues)[number];
export type AttendeeTier = (typeof schema.attendeeTier.enumValues)[number];
export type UserRole = (typeof schema.userRole.enumValues)[number];
export type CredentialState = (typeof schema.credentialState.enumValues)[number];
export type CarrierKind = (typeof schema.carrierKind.enumValues)[number];
export type CarrierState = (typeof schema.carrierState.enumValues)[number];
export type ScanResult = (typeof schema.scanResult.enumValues)[number];
export type AlertState = (typeof schema.alertState.enumValues)[number];
export type AlertSeverity = (typeof schema.alertSeverity.enumValues)[number];
export type AlertKind = (typeof schema.alertKind.enumValues)[number];
