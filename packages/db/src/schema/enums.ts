/**
 * Postgres enums. Vocabularies follow docs/01-product.md and docs/02-architecture.md §4 and are
 * kept value-for-value identical to the contracts package (packages/contracts/src/enums) where that package defines them,
 * so a contract value is always insertable.
 */
import { pgEnum } from "drizzle-orm/pg-core";

/* ---------------------------------------------------------------- venue/events */

/** events.state (01 §9). Transitions are guarded by a trigger (see migrations 0002). */
export const eventState = pgEnum("event_state", ["draft", "published", "live", "closed", "archived"]);

/** checkpoints.direction (01 §6). */
export const checkpointDirection = pgEnum("checkpoint_direction", ["in", "out", "both"]);

/** scans.direction: what a single scan was recorded as. Needed for `both` checkpoints. */
export const scanDirection = pgEnum("scan_direction", ["in", "out"]);

/** events.wizard_step: the five steps of the event wizard (06 D5); matches contracts WizardStep. */
export const wizardStep = pgEnum("wizard_step", ["basics", "venue", "access", "pass", "review"]);

/** rooms.capacity_policy: behaviour at block_at_pct (01 §7, "admit with alert"). */
export const capacityPolicy = pgEnum("capacity_policy", ["block", "admit_with_alert"]);

/* ---------------------------------------------------------------------- people */

/** users.role (01 §3); supervisor and desk_clerk added by D-23 (migration 0026). */
export const userRole = pgEnum("user_role", ["admin", "organiser", "security_staff", "speaker", "crew", "supervisor", "desk_clerk"]);

/** registrations.tier (D-02, 01 §4). */
export const attendeeTier = pgEnum("attendee_tier", ["VIP", "ORDINARY", "PRIVATE_INVITE", "PUBLIC"]);

/** registrations.state — not enumerated by the spec; matches contracts RegistrationState. */
export const registrationState = pgEnum("registration_state", ["pending_approval", "confirmed", "cancelled"]);

/** invitations.state — not enumerated by the spec; matches contracts InvitationState. */
export const invitationState = pgEnum("invitation_state", ["sent", "redeemed", "expired", "revoked"]);

/** access_rules.subject_kind and .effect (02 §4.2). */
export const accessSubjectKind = pgEnum("access_subject_kind", ["tier", "role"]);
export const accessEffect = pgEnum("access_effect", ["permit", "deny"]);

/* ----------------------------------------------------------------- credentials */

/** credentials.state (01 §5.2). */
export const credentialState = pgEnum("credential_state", [
  "issued",
  "active",
  "suspended_review",
  "revoked",
  "replaced",
]);

/** carriers.kind and scans.carrier_kind (02 §4.3). */
export const carrierKind = pgEnum("carrier_kind", ["qr_portal", "qr_email", "nfc"]);

/** carriers.state (01 §5.2). */
export const carrierState = pgEnum("carrier_state", ["stock", "assigned", "bound", "active", "retired", "lost"]);

/** carriers.chip_profile — NFC chip family (03 §2). */
export const chipProfile = pgEnum("chip_profile", ["ntag_uid", "ntag424_dna", "desfire_ev3"]);

/** signing_keys.purpose (02 §4.3). */
export const signingKeyPurpose = pgEnum("signing_key_purpose", ["qr", "allowlist"]);

/* ----------------------------------------------------------------------- scans */

/**
 * scans.result (01 §7). `offline_queued` is in the type so the enum matches the contract
 * vocabulary, but it is a client-side display state: a CHECK on `scans` rejects it. A synced
 * offline scan stores the result the gate decided, with `offline_bool = true`.
 */
export const scanResult = pgEnum("scan_result", [
  "admitted",
  "already_inside",
  "duplicate_read",
  "denied_room",
  "capacity_block",
  "revoked",
  "suspended",
  "unknown_token",
  "wristband_required",
  "pass_spent",
  "implied_exit",
  "offline_queued",
]);

/** occupancy_adjustments.reason (02 §4.4). */
export const occupancyAdjustmentReason = pgEnum("occupancy_adjustment_reason", [
  "session_end",
  "recount",
  "sync_conflict",
  "scan_undo",
]);

/* ---------------------------------------------------------------------- alerts */

/** breach_alerts.state (02 §4.4). */
export const alertState = pgEnum("alert_state", ["open", "acked", "resolved"]);

/** breach_alerts.severity — matches contracts Severity. */
export const alertSeverity = pgEnum("alert_severity", ["low", "medium", "high", "critical"]);

/** breach_alerts.kind — matches contracts AlertKind (03 §8.2, 01 §6–§8). */
export const alertKind = pgEnum("alert_kind", [
  "invalid_qr",
  "pass_replayed",
  "unauthorised_tier",
  "impossible_travel",
  "capacity_warn",
  "capacity_exceeded",
  "offline_conflict_pass_reuse",
  "offline_conflict_passback",
  "offline_conflict_capacity",
  "clock_skew",
  "gate_offline",
  "rogue_scanner",
  "stale_allowlist",
  "reconciliation_fault",
  "band_reported_lost",
]);

/* --------------------------------------------------------------------- reports */

export const reportKind = pgEnum("report_kind", [
  "attendance",
  "dwell_flow",
  "peak_occupancy",
  "breach_compliance",
  "gate_throughput",
]);

export const reportState = pgEnum("report_state", ["queued", "running", "ready", "failed"]);

/** event_reports.format and report_schedules.format — matches contracts ExportFormat (D-21). */
export const exportFormat = pgEnum("export_format", ["xlsx", "csv", "pdf"]);
