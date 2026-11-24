/**
 * Canonical enumerations shared by every client surface and the API.
 *
 * Source of truth: docs/01-product.md and docs/02-architecture.md §4.
 * Each enum is a Zod schema plus its inferred TS union plus a readonly tuple of
 * its values (`*_VALUES`) for exhaustive iteration in UI and tests.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ people */

/** Attendee tiers (D-02, 01 §4). Speakers and crew are staff roles, not tiers. */
export const AttendeeTier = z.enum(["VIP", "ORDINARY", "PRIVATE_INVITE", "PUBLIC"]);
export type AttendeeTier = z.infer<typeof AttendeeTier>;
export const ATTENDEE_TIER_VALUES = AttendeeTier.options;

/**
 * Operator and staff roles stored in `users.role` (01 §3, 02 §4.2). `supervisor` (operator kind: the
 * live screens) and `desk_clerk` (staff kind: the registration desk of the events they are assigned
 * to) were added by D-23.
 */
export const Role = z.enum(["admin", "organiser", "security_staff", "speaker", "crew", "supervisor", "desk_clerk"]);
export type Role = z.infer<typeof Role>;
export const ROLE_VALUES = Role.options;

/**
 * Kind of authenticated principal carried in an access token. Attendees are not a
 * `users.role`; they sign in by email link and get an `attendee` principal.
 */
export const PrincipalKind = z.enum(["operator", "staff", "attendee", "device"]);
export type PrincipalKind = z.infer<typeof PrincipalKind>;

/** Full operators (events, attendees, reports; admin also venues, staff, settings). */
export const OPERATOR_ROLES = ["admin", "organiser"] as const satisfies readonly Role[];
/** Roles that may open Admin Command; each sees only its own screens (D-23). */
export const CONSOLE_ROLES = ["admin", "organiser", "supervisor", "desk_clerk"] as const satisfies readonly Role[];
/** Roles whose principal kind is `operator` (the others are `staff`). */
export const OPERATOR_KIND_ROLES = ["admin", "organiser", "supervisor"] as const satisfies readonly Role[];
/** Roles that may operate a Gate Scanner. */
export const SCANNER_ROLES = ["security_staff"] as const satisfies readonly Role[];

/** `registrations.state` — not enumerated in the spec; see contracts README. */
export const RegistrationState = z.enum(["pending_approval", "confirmed", "cancelled"]);
export type RegistrationState = z.infer<typeof RegistrationState>;

/** `invitations.state` — not enumerated in the spec; see contracts README. */
export const InvitationState = z.enum(["sent", "redeemed", "expired", "revoked"]);
export type InvitationState = z.infer<typeof InvitationState>;

/* ------------------------------------------------------------- credentials */

/** `credentials.state` (01 §5.2). */
export const CredentialState = z.enum(["issued", "active", "suspended_review", "revoked", "replaced"]);
export type CredentialState = z.infer<typeof CredentialState>;
export const CREDENTIAL_STATE_VALUES = CredentialState.options;

/** `carriers.state` (01 §5.2). */
export const CarrierState = z.enum(["stock", "assigned", "bound", "active", "retired", "lost"]);
export type CarrierState = z.infer<typeof CarrierState>;
export const CARRIER_STATE_VALUES = CarrierState.options;

/** `carriers.kind` and `scans.carrier_kind` (02 §4.3). */
export const CarrierKind = z.enum(["qr_portal", "qr_email", "nfc"]);
export type CarrierKind = z.infer<typeof CarrierKind>;
export const CARRIER_KIND_VALUES = CarrierKind.options;

/** NFC chip family (03 §2). */
export const ChipProfile = z.enum(["ntag_uid", "ntag424_dna", "desfire_ev3"]);
export type ChipProfile = z.infer<typeof ChipProfile>;

/** `signing_keys.purpose` (02 §4.3). */
export const SigningKeyPurpose = z.enum(["qr", "allowlist"]);
export type SigningKeyPurpose = z.infer<typeof SigningKeyPurpose>;

/* ------------------------------------------------------------ venue/events */

/** `events.state` (01 §9). */
export const EventState = z.enum(["draft", "published", "live", "closed", "archived"]);
export type EventState = z.infer<typeof EventState>;
export const EVENT_STATE_VALUES = EventState.options;

/**
 * The five steps of the event wizard (06 D5), in order: `events.wizard_step` holds the furthest one a
 * draft has reached, so the wizard resumes there.
 */
export const WizardStep = z.enum(["basics", "venue", "access", "pass", "review"]);
export type WizardStep = z.infer<typeof WizardStep>;
export const WIZARD_STEP_VALUES = WizardStep.options;

/** `checkpoints.direction` (01 §6). */
export const CheckpointDirection = z.enum(["in", "out", "both"]);
export type CheckpointDirection = z.infer<typeof CheckpointDirection>;

/** Direction a single scan is recorded as. `both` checkpoints must say which. */
export const ScanDirection = z.enum(["in", "out"]);
export type ScanDirection = z.infer<typeof ScanDirection>;

/** `access_rules.subject_kind` and `.effect` (02 §4.2). */
export const AccessSubjectKind = z.enum(["tier", "role"]);
export type AccessSubjectKind = z.infer<typeof AccessSubjectKind>;
export const AccessEffect = z.enum(["permit", "deny"]);
export type AccessEffect = z.infer<typeof AccessEffect>;

/** Room capacity policy at the blocking threshold (01 §7). */
export const CapacityPolicy = z.enum(["block", "admit_with_alert"]);
export type CapacityPolicy = z.infer<typeof CapacityPolicy>;

/* -------------------------------------------------------------------- scan */

/** The fixed scan-result vocabulary (01 §7). */
export const ScanResult = z.enum([
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
export type ScanResult = z.infer<typeof ScanResult>;
export const SCAN_RESULT_VALUES = ScanResult.options;

/** Gate colour for a result (01 §7). `none` = not shown / ignored. */
export const GateTone = z.enum(["green", "amber", "red", "none"]);
export type GateTone = z.infer<typeof GateTone>;

/** `occupancy_adjustments.reason` (02 §4.4). */
/** `scan_undo` (additive): the count correction written when a scanner undoes a mistaken admission. */
export const OccupancyAdjustmentReason = z.enum(["session_end", "recount", "sync_conflict", "scan_undo"]);
export type OccupancyAdjustmentReason = z.infer<typeof OccupancyAdjustmentReason>;

/* ------------------------------------------------------------------ alerts */

/** `breach_alerts.state` (02 §4.4). */
export const AlertState = z.enum(["open", "acked", "resolved"]);
export type AlertState = z.infer<typeof AlertState>;
export const ALERT_STATE_VALUES = AlertState.options;

/** Alert severity. The spec names no levels; four ordered levels chosen. */
export const Severity = z.enum(["low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof Severity>;
export const SEVERITY_VALUES = Severity.options;

/** Alert kinds, derived from the response matrix (03 §8.2) and 01 §6–§8. */
export const AlertKind = z.enum([
  "invalid_qr", // cloned, expired, or forged QR
  "pass_replayed", // single-use emailed QR presented again
  "unauthorised_tier", // denied_room
  "impossible_travel",
  "capacity_warn", // room passed warn_at_pct
  "capacity_exceeded", // admitted over block threshold (admit_with_alert)
  "offline_conflict_pass_reuse", // single-use QR accepted twice by offline gates
  "offline_conflict_passback", // pass-back across offline gates
  "offline_conflict_capacity", // capacity overrun found at sync
  "clock_skew", // scanner offset > 2 min
  "gate_offline", // no heartbeat > 60 s
  "rogue_scanner", // scanner outside assignment/shift
  "stale_allowlist", // offline fail-open on a stale allowlist
  "reconciliation_fault", // occupancy would have gone negative
  "band_reported_lost", // the holder reported their wristband lost (low; the desk binds a new one)
]);
export type AlertKind = z.infer<typeof AlertKind>;
export const ALERT_KIND_VALUES = AlertKind.options;

/* ----------------------------------------------------------- notifications */

/** What an attendee notification is about (drives its icon and grouping). */
export const NotificationKind = z.enum([
  "pass", // pass issued, resent, revoked, under review
  "session", // a session the attendee follows starts soon or changed
  "capacity", // a room the attendee may want is filling up
  "event", // event-wide announcement or schedule change
  "security", // sign-in from a new device, data export ready, etc.
]);
export type NotificationKind = z.infer<typeof NotificationKind>;

/* ----------------------------------------------------------------- reports */

export const ReportKind = z.enum([
  "attendance",
  "dwell_flow",
  "peak_occupancy",
  "breach_compliance",
  "gate_throughput",
]);
export type ReportKind = z.infer<typeof ReportKind>;

export const ReportState = z.enum(["queued", "running", "ready", "failed"]);
export type ReportState = z.infer<typeof ReportState>;

/** How often a scheduled report is sent (01 §10). `on_close` runs once, when the event closes. */
export const ReportCadence = z.enum(["on_close", "daily", "weekly", "monthly"]);
export type ReportCadence = z.infer<typeof ReportCadence>;

/** `failed` after three failed runs in a row (resuming resets it); `done` once an on_close schedule has run. */
export const ReportScheduleState = z.enum(["active", "paused", "done", "failed"]);
export type ReportScheduleState = z.infer<typeof ReportScheduleState>;

/* -------------------------------------------------------------------- live */

/** WebSocket channel paths (02 §6). */
export const WsChannel = z.enum(["/stream/scans", "/stream/telemetry", "/stream/alerts", "/stream/me"]);
export type WsChannel = z.infer<typeof WsChannel>;

/** Gate link state shown in Admin Command (01 §8). */
export const GateLinkState = z.enum(["online", "offline", "degraded"]);
export type GateLinkState = z.infer<typeof GateLinkState>;
