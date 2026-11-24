/**
 * UI copy for API errors and scan results: the single source (02 §7). Screens import these
 * strings; they never retype them.
 *
 * ZOD-FREE ON PURPOSE. This module has only `import type` statements, so importing
 * `@synan/contracts/copy` pulls no runtime dependency into a client bundle. `errors/` re-exports
 * everything here for code that already imports from there.
 *
 * The tables are checked with `satisfies Record<Code, …>`: adding a code without copy is a type
 * error here, and so is a typo in a key.
 */
import type {
  AlertKind,
  AttendeeTier,
  CarrierState,
  ChipProfile,
  CredentialState,
  EventState,
  GateTone,
  InvitationState,
  RegistrationState,
  ReportKind,
  Role,
  ScanResult,
  WizardStep,
} from "../enums/index.js";
import type { ErrorCode } from "../errors/index.js";

/* ------------------------------------------------------------------ tones */

/** Gate colours, in severity order (01 §7). `none` = not shown at a gate / ignored. */
export const GATE_TONE_VALUES = ["green", "amber", "red", "none"] as const satisfies readonly GateTone[];

/* -------------------------------------------------------------- API errors */

export interface ErrorCopy {
  /** HTTP status the API returns with this code. */
  status: number;
  /** Short title for toasts and banners. */
  title: string;
  /** One-sentence plain-language explanation. */
  message: string;
}

export const ERROR_COPY = {
  VALIDATION_FAILED: { status: 400, title: "Check the details", message: "Some of the information sent was not valid." },
  UNAUTHENTICATED: { status: 401, title: "Sign in required", message: "Sign in to continue." },
  TOKEN_EXPIRED: { status: 401, title: "Session expired", message: "Your session has expired. Sign in again." },
  FORBIDDEN: { status: 403, title: "Not allowed", message: "Your role does not permit this action." },
  MFA_REQUIRED: { status: 403, title: "Second factor required", message: "Confirm with your authenticator code to continue." },
  INVALID_CREDENTIALS: { status: 401, title: "Sign-in failed", message: "That email and password do not match." },
  INVALID_MFA_CODE: { status: 401, title: "Code not accepted", message: "That authenticator code is wrong or has expired." },
  MFA_NOT_ENROLLED: { status: 403, title: "Set up a second factor", message: "This account has no authenticator enrolled yet." },
  RATE_LIMITED: { status: 429, title: "Too many attempts", message: "Too many requests. Wait a moment and try again." },
  NOT_FOUND: { status: 404, title: "Not found", message: "That item does not exist or is not available to you." },
  CONFLICT: { status: 409, title: "Already changed", message: "This item was changed by someone else. Reload and try again." },
  IDEMPOTENCY_CONFLICT: { status: 409, title: "Duplicate request", message: "A different request was already sent with this key." },
  LINK_INVALID: { status: 400, title: "Link not valid", message: "This sign-in link is not valid. Request a new one." },
  LINK_EXPIRED: { status: 400, title: "Link expired", message: "This sign-in link has expired or was already used. Request a new one." },
  TICKET_INVALID: { status: 401, title: "Live connection refused", message: "The live connection ticket was missing, used, or expired." },
  CHECKPOINT_NOT_ASSIGNED: { status: 403, title: "Not your gate", message: "You are not assigned to this checkpoint." },
  OUTSIDE_SHIFT: { status: 403, title: "Outside your shift", message: "Scanning is only possible during your assigned shift." },
  EVENT_NOT_LIVE: { status: 409, title: "Event not live", message: "This event is not open for scanning." },
  NO_CREDENTIAL: { status: 404, title: "No pass yet", message: "There is no pass issued for this registration yet." },
  NOT_IMPLEMENTED: { status: 501, title: "Not available yet", message: "This feature is not available on this server yet." },
  INTERNAL: { status: 500, title: "Something went wrong", message: "An unexpected error occurred. Try again." },
} as const satisfies Readonly<Record<ErrorCode, ErrorCopy>>;

/**
 * A request that got no answer from the server at all, so there is no error code to look up:
 * `offline` when the device reports itself offline, `network` otherwise (unreachable, timed out, or
 * refused by the browser). `status` is 0: nothing came back.
 */
export const FAILURE_COPY = {
  offline: { status: 0, title: "You are offline", message: "This needs a connection. It will work again when you are back online." },
  network: { status: 0, title: "Server not reachable", message: "The server did not answer. Check the connection and try again." },
} as const satisfies Readonly<Record<"offline" | "network", ErrorCopy>>;
export type FailureKind = keyof typeof FAILURE_COPY;

/**
 * Field messages the API sends for a wristband it cannot bind or swap (POST /carriers/bind,
 * /carriers/:id/rebind, /me/credential/bind, /kiosk/registrations). The API puts `message` in the
 * error's field issue; screens may show `title` above it.
 */
export const BAND_ERROR_COPY = {
  unknown_band: { title: "Band not known", message: "This band is not known: import it first." },
  not_in_stock: { title: "Band not in stock", message: "This band is not in stock. Use a band from the box." },
  band_in_use: { title: "Band already in use", message: "This band is already in use. Keep it aside and take a fresh band from the box." },
  pass_has_band: { title: "Already has a band", message: "This pass already has a band. Replace it instead." },
  pass_not_usable: { title: "Pass cannot take a band", message: "This pass is revoked or under review." },
  no_band_to_replace: { title: "No band to replace", message: "This pass has no band to replace. Bind a band instead." },
} as const satisfies Readonly<Record<string, { title: string; message: string }>>;
export type BandErrorKind = keyof typeof BAND_ERROR_COPY;

/* ------------------------------------------------------------ scan results */

export interface ScanResultCopy {
  tone: GateTone;
  /** Large label on the gate verdict screen. */
  label: string;
  /** One-line instruction for gate staff. */
  instruction: string;
  /** Whether the person passes. */
  admits: boolean;
  /** Whether the result is shown at a gate at all. */
  shownAtGate: boolean;
}

/** Copy and colour per scan result (01 §7). */
export const SCAN_RESULT_COPY = {
  admitted: { tone: "green", label: "ADMITTED", instruction: "Let them through.", admits: true, shownAtGate: true },
  already_inside: { tone: "amber", label: "ALREADY INSIDE", instruction: "Recorded as inside already. Check and wave through.", admits: true, shownAtGate: true },
  duplicate_read: { tone: "none", label: "DUPLICATE READ", instruction: "Same pass read twice. Ignored.", admits: true, shownAtGate: false },
  denied_room: { tone: "red", label: "NOT PERMITTED", instruction: "This pass does not allow entry to this room.", admits: false, shownAtGate: true },
  capacity_block: { tone: "red", label: "ROOM FULL", instruction: "The room is at capacity. Hold entry.", admits: false, shownAtGate: true },
  revoked: { tone: "red", label: "REVOKED", instruction: "This pass has been cancelled. Refer to the desk.", admits: false, shownAtGate: true },
  suspended: { tone: "red", label: "UNDER REVIEW", instruction: "Pass held for review. Call a supervisor.", admits: false, shownAtGate: true },
  unknown_token: { tone: "red", label: "NOT RECOGNISED", instruction: "Not a valid pass for this event. Call a supervisor.", admits: false, shownAtGate: true },
  wristband_required: { tone: "red", label: "WRISTBAND REQUIRED", instruction: "QR codes are accepted at the entrance only. Tap the wristband.", admits: false, shownAtGate: true },
  pass_spent: { tone: "red", label: "PASS ALREADY USED", instruction: "This emailed code was used once already. Ask for the app pass or wristband.", admits: false, shownAtGate: true },
  implied_exit: { tone: "none", label: "IMPLIED EXIT", instruction: "System record: holder entered another room.", admits: false, shownAtGate: false },
  offline_queued: { tone: "none", label: "LOCAL", instruction: "Decided on this device. Will sync when online.", admits: true, shownAtGate: true },
} as const satisfies Readonly<Record<ScanResult, ScanResultCopy>>;

/** Result → gate tone, for code that needs only the colour. */
export const SCAN_RESULT_TONE = Object.fromEntries(
  Object.entries(SCAN_RESULT_COPY).map(([r, c]) => [r, c.tone]),
) as { readonly [R in ScanResult]: (typeof SCAN_RESULT_COPY)[R]["tone"] };

/** Results that are a refusal at the gate. */
export const DENY_RESULTS = (Object.keys(SCAN_RESULT_COPY) as ScanResult[]).filter((r) => !SCAN_RESULT_COPY[r].admits);

/** Operator-facing copy for each alert kind (06 D10). */
export const ALERT_KIND_COPY = {
  invalid_qr: { label: "Invalid QR", description: "A cloned, expired or forged QR code was presented." },
  pass_replayed: { label: "Pass replayed", description: "A single-use emailed QR was presented again." },
  unauthorised_tier: { label: "Not permitted here", description: "A pass tried a room its tier may not enter." },
  impossible_travel: { label: "Impossible travel", description: "The same pass was read at two gates too quickly; it is under review." },
  capacity_warn: { label: "Room filling", description: "A room passed its warning threshold." },
  capacity_exceeded: { label: "Capacity exceeded", description: "A room was entered beyond its blocking threshold." },
  offline_conflict_pass_reuse: { label: "Offline: pass used twice", description: "Two offline gates accepted the same single-use QR." },
  offline_conflict_passback: { label: "Offline: pass-back", description: "A pass already inside was admitted again at another offline gate." },
  offline_conflict_capacity: { label: "Offline: capacity overrun", description: "Offline gates together admitted beyond capacity." },
  clock_skew: { label: "Scanner clock wrong", description: "A scanner's clock is more than two minutes off." },
  gate_offline: { label: "Gate offline", description: "A gate has sent no heartbeat for over a minute." },
  rogue_scanner: { label: "Scanner refused", description: "A scanner tried a gate or time it is not assigned to." },
  stale_allowlist: { label: "Stale allowlist", description: "An offline gate admitted on an allowlist more than 15 minutes old." },
  reconciliation_fault: { label: "Count corrected", description: "Occupancy would have gone below zero and was clamped." },
  band_reported_lost: { label: "Wristband reported lost", description: "A wristband was reported lost by its holder. Gates now refuse it; the desk can bind a new one." },
} as const satisfies Record<AlertKind, { label: string; description: string }>;

/** Labels for the five reports (01 §10) and the export formats. */
export const REPORT_KIND_LABEL = {
  attendance: "Attendance",
  dwell_flow: "Dwell and flow",
  peak_occupancy: "Peak occupancy",
  breach_compliance: "Breach and compliance",
  gate_throughput: "Gate throughput",
} as const satisfies Record<ReportKind, string>;
export const EXPORT_FORMAT_LABEL = { xlsx: "Excel workbook", csv: "CSV", pdf: "PDF summary" } as const;

/* ------------------------------------------------------------- state words */

/**
 * How a state reads at a glance: `ok` (as it should be), `warn` (needs a look), `stop` (refused or
 * ended badly), `idle` (neutral). Screens pair it with a shape and the word, never colour alone.
 */
export type StateSignal = "ok" | "warn" | "stop" | "idle";

export interface StateCopy {
  /** The word for the state, in sentence case. */
  label: string;
  /** One plain-language sentence for operators. */
  description: string;
  signal: StateSignal;
}

/** Credential states (01 §5.2). */
export const CREDENTIAL_STATE_COPY = {
  issued: { label: "Issued", description: "Issued and not yet used at a gate.", signal: "idle" },
  active: { label: "Active", description: "In use: seen at a gate at least once.", signal: "ok" },
  suspended_review: { label: "Under review", description: "Held for a check; gates refuse it until a supervisor clears or revokes it.", signal: "warn" },
  revoked: { label: "Revoked", description: "Cancelled; gates refuse it.", signal: "stop" },
  replaced: { label: "Replaced", description: "Superseded by a newer credential, for example after a lost wristband.", signal: "idle" },
} as const satisfies Readonly<Record<CredentialState, StateCopy>>;

/** Wristband and other carrier states (01 §5.2). */
export const CARRIER_STATE_COPY = {
  stock: { label: "Stock", description: "In the box, not yet given to anyone.", signal: "idle" },
  assigned: { label: "Assigned", description: "Set aside for a named attendee.", signal: "idle" },
  bound: { label: "Bound", description: "Linked to a credential, not yet scanned.", signal: "ok" },
  active: { label: "Active", description: "Bound and seen at a gate.", signal: "ok" },
  retired: { label: "Retired", description: "Out of service.", signal: "idle" },
  lost: { label: "Lost", description: "Reported lost and replaced; gates refuse it.", signal: "stop" },
} as const satisfies Readonly<Record<CarrierState, StateCopy>>;

/** Registration states. */
export const REGISTRATION_STATE_COPY = {
  pending_approval: { label: "Awaiting approval", description: "Waiting for an organiser to approve it; no pass yet.", signal: "warn" },
  confirmed: { label: "Confirmed", description: "Registered, with a pass.", signal: "idle" },
  cancelled: { label: "Cancelled", description: "Cancelled; the pass no longer opens doors.", signal: "idle" },
} as const satisfies Readonly<Record<RegistrationState, StateCopy>>;

/** Private Invitation states. */
export const INVITATION_STATE_COPY = {
  sent: { label: "Sent", description: "Sent and not answered yet.", signal: "idle" },
  redeemed: { label: "Accepted", description: "Accepted: the invitee is registered.", signal: "ok" },
  expired: { label: "Expired", description: "Not answered in time; the link no longer works.", signal: "idle" },
  revoked: { label: "Declined", description: "Declined or withdrawn; the link no longer works.", signal: "idle" },
} as const satisfies Readonly<Record<InvitationState, StateCopy>>;

/** Event lifecycle states (01 §9). Only live carries a signal colour. */
export const EVENT_STATE_COPY = {
  draft: { label: "Draft", description: "Being set up; not visible to attendees.", signal: "idle" },
  published: { label: "Published", description: "Open for registration; doors not yet open.", signal: "idle" },
  live: { label: "Live", description: "Doors are open; gates are scanning.", signal: "ok" },
  closed: { label: "Closed", description: "Over; scan records are deleted when the grace period ends.", signal: "idle" },
  archived: { label: "Archived", description: "Kept for its reports only.", signal: "idle" },
} as const satisfies Readonly<Record<EventState, StateCopy>>;

/** Operator and staff roles (01 §3). */
export const ROLE_COPY = {
  admin: { label: "Admin", description: "Sets up the organisation, venues and staff, and runs events." },
  organiser: { label: "Organiser", description: "Runs events: attendees, passes, access rules and reports." },
  security_staff: { label: "Security staff", description: "Scans at the gates assigned to them, during their shift." },
  speaker: { label: "Speaker", description: "Presents at sessions; no console access." },
  crew: { label: "Crew", description: "Works the event on site; no console access." },
  supervisor: { label: "Supervisor", description: "Runs the live event: alerts, gates, access log, recounts, and clearing or revoking a pass under review." },
  desk_clerk: { label: "Desk clerk", description: "Works the registration desk of the events they are assigned to: wristbands and passes." },
} as const satisfies Readonly<Record<Role, { label: string; description: string }>>;

/** Attendee tiers (D-02, 01 §4). */
export const TIER_LABEL = {
  VIP: "VIP",
  ORDINARY: "Ordinary",
  PRIVATE_INVITE: "Invitation",
  PUBLIC: "Public",
} as const satisfies Readonly<Record<AttendeeTier, string>>;

/** NFC chip families (03 §2). */
export const CHIP_PROFILE_LABEL = {
  ntag_uid: "NTAG (UID)",
  ntag424_dna: "NTAG 424 DNA",
  desfire_ev3: "DESFire EV3",
} as const satisfies Readonly<Record<ChipProfile, string>>;

/** The event wizard's steps (06 D5). */
export const WIZARD_STEP_LABEL = {
  basics: "Basics",
  venue: "Venue & rooms",
  access: "Access rules",
  pass: "Pass template",
  review: "Review",
} as const satisfies Readonly<Record<WizardStep, string>>;
