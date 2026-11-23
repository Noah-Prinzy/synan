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
import type { AlertKind, GateTone, ReportKind, ScanResult } from "../enums/index.js";
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
