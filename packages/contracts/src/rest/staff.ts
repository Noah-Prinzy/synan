/** Staff, reports, dashboard (02 §5). */
import { z } from "zod";
import { Email, Id, IsoDateTime, Ok, pageOf, PageQuery } from "../common.js";
import { AttendeeTier, CheckpointDirection, EventState, ReportCadence, ReportKind, ReportScheduleState, ReportState, Role, Severity } from "../enums/index.js";
import { STAFF_PASSWORD } from "../copy/index.js";
import { ADMIN_ONLY, endpoint, IdParam, OPERATORS, PUBLIC, SCANNERS, SUPERVISE } from "./endpoint.js";

/** PATCH /staff/:id (admin, MFA, audited): a user's role. Takes effect when their access token next refreshes. */
export const ChangeStaffRole = z.object({ role: Role, reason: z.string().trim().min(3).max(500) });

export const StaffMember = z.object({
  id: Id,
  email: Email,
  role: Role,
  mfa_enrolled: z.boolean(),
  /** Additive: the name given at invitation (users.display_name); null when none was given. */
  display_name: z.string().nullable().optional(),
});
export const StaffAssignment = z.object({
  id: Id,
  user_id: Id,
  checkpoint_id: Id,
  shift_start: IsoDateTime,
  shift_end: IsoDateTime,
  /** The event whose allowlist this shift caches; null = the checkpoint between events. */
  event_id: Id.nullable().optional(),
  /** Set by the explicit end-of-shift handover (01 §3). */
  handed_over_at: IsoDateTime.nullable().optional(),
  /** Additive (operator lists): the gate's label. */
  checkpoint_label: z.string().optional(),
  /** Additive (operator lists): the staff member's display name, else their email. */
  staff_name: z.string().optional(),
  /** Additive (GET /me/assignments): the gate itself, so the scanner can pair without another call. */
  checkpoint: z
    .object({
      id: Id,
      label: z.string(),
      perimeter: z.boolean(),
      direction: CheckpointDirection,
      zone_id: Id,
      zone_name: z.string(),
      room_id: Id.nullable(),
      room_name: z.string().nullable(),
    })
    .optional(),
  /** Additive (GET /me/assignments): the event this shift works (the assignment's, else the venue's event running in the shift); null when none. */
  event: z
    .object({
      id: Id,
      title: z.string(),
      /** Additive: the event's slug (no public event read needed, also for an unlisted event). */
      slug: z.string().optional(),
      /**
       * Additive: the event's rooms by name, sorted by name — the scanner's "rooms this pass opens"
       * chips map `permitted_room_ids` through it. Names only: no capacity or occupancy.
       */
      rooms: z.array(z.object({ room_id: Id, name: z.string() })).optional(),
    })
    .nullable()
    .optional(),
});
export type StaffAssignment = z.infer<typeof StaffAssignment>;
export const CreateStaffAssignment = z.object({
  user_id: Id,
  checkpoint_id: Id,
  shift_start: IsoDateTime,
  shift_end: IsoDateTime,
  event_id: Id.nullable().optional(),
});

/**
 * Invite a staff member (01 §3): the user is created without a password and emailed a one-time
 * activation link (72 hours). The link opens the role's own app: the Gate Scanner for security
 * staff, the Admin Command for every other role. Additive: inviting an address whose account was
 * invited but never activated sends a new link (the earlier ones stop working) instead of CONFLICT;
 * an activated account is still CONFLICT.
 */
export const InviteStaff = z.object({ email: Email, role: Role, display_name: z.string().max(200).optional() });
/** The rules a staff password must meet (Zod-free in ../copy, so the scanner's bundle can show them too). */
export { STAFF_PASSWORD };
/** An activation token as it travels in the link fragment (`#token=…`). */
export const ActivationToken = z.string().min(16).max(512);
/** Redeem a staff activation link (the token travels in the link fragment). */
export const ActivateStaff = z.object({ token: ActivationToken, password: z.string().min(STAFF_PASSWORD.min).max(STAFF_PASSWORD.max) });
/** Additive: what an activation link is good for, before a password is chosen. */
export const CheckActivation = z.object({ token: ActivationToken });
export const ActivationState = z.enum(["valid", "expired", "used", "invalid"]);
export type ActivationState = z.infer<typeof ActivationState>;
/**
 * `valid`: the link can set the password; `role` says which app the account uses. `expired`: past its
 * 72 hours. `used`: a password was already set with it. `invalid`: not a link we issued, or one a
 * newer invitation replaced. Only a valid link answers `role` and `expires_at`; nothing here names
 * the account, its email or whether any other account exists.
 */
export const ActivationCheck = z.object({ state: ActivationState, role: Role.optional(), expires_at: IsoDateTime.optional() });
export type ActivationCheck = z.infer<typeof ActivationCheck>;

/** End-of-shift handover (01 §3): what the gate did during the shift. */
export const HandoverSummary = z.object({
  assignment_id: Id,
  checkpoint_id: Id,
  shift_start: IsoDateTime,
  shift_end: IsoDateTime,
  handed_over_at: IsoDateTime,
  /** Let through: admitted + already_inside (= `let_through`), admissions undone at the scanner left out. */
  admitted: z.number().int(),
  refused: z.number().int(),
  /** Scans decided offline on the device and synced (= `offline`). */
  queued: z.number().int(),
  /** Count per recorded result; undone admissions left out. */
  by_result: z.record(z.string(), z.number().int()),
  /** Additive: admissions undone at the scanner (POST /scans/:id/undo) in the period; not in `admitted` or `by_result`. */
  undone: z.number().int().optional(),
  /* ---- additive: the full summary ---- */
  /** All scans recorded by this person at this gate in the period (implied exits excluded; undone ones included). */
  scans: z.number().int().optional(),
  let_through: z.number().int().optional(),
  duplicates: z.number().int().optional(),
  offline: z.number().int().optional(),
  /** Received after the period ended: they were still queued on the device at handover. */
  late_synced: z.number().int().optional(),
  /** The counted period: shift start to handover (or shift end). */
  period_end: IsoDateTime.optional(),
  first_scan_at: IsoDateTime.nullable().optional(),
  last_scan_at: IsoDateTime.nullable().optional(),
});
export type HandoverSummary = z.infer<typeof HandoverSummary>;

/** REST heartbeat for a gate (01 §6, O-22): feeds gate health like the `/stream/scans` heartbeat frame. */
export const GateHeartbeat = z.object({
  checkpoint_id: Id,
  device_id: z.string().min(1).max(128),
  queue_depth: z.number().int().min(0),
  clock_offset_ms: z.number().int(),
  online: z.boolean(),
  /**
   * Additive: `issued_at` of the signed allowlist the scanner holds (null: none). Over 15 minutes old
   * raises a `stale_allowlist` alert once per gate, and shows in gate health (01 §8, O-05).
   */
  allowlist_issued_at: IsoDateTime.nullable().optional(),
});

/** MFA enrolment (O-22). The secret is shown once; enrolment completes when a code from it is confirmed. */
export const MfaEnrolment = z.object({ secret: z.string(), otpauth_url: z.string(), expires_at: IsoDateTime });
export const MfaEnrolConfirm = z.object({ code: z.string().regex(/^\d{6}$/) });

export const ExportFormat = z.enum(["xlsx", "csv", "pdf"]);
export const EventReportRow = z.object({
  id: Id,
  event_id: Id,
  /** Null for the whole-event workbook and the PDF summary. */
  kind: ReportKind.nullable(),
  /** The workbook carries names and emails (operators only; audited). */
  include_identity: z.boolean().optional(),
  state: ReportState,
  requested_by: Id,
  created_at: IsoDateTime,
  /** What the export produces. */
  format: ExportFormat,
  /** Signed short-lived link once state=ready; null before that, and once the file has expired (`expired_at`). */
  download_url: z.url().nullable(),
  /**
   * Additive: when the exported file stopped being available, from the register of exported files
   * (03 §6): its retention ran out, or the retention job deleted it. `state` stays `ready` (the export
   * did complete); `download_url` is then null, and a link made earlier answers 410 EXPORT_EXPIRED.
   * Null or absent while the file can be downloaded (and for an export not ready yet).
   */
  expired_at: IsoDateTime.nullable().optional(),
});
/** Sections of each report kind, in order; the first is the default. */
export const REPORT_SECTIONS = {
  attendance: ["by_tier", "arrivals"],
  dwell_flow: ["flow", "dwell"],
  peak_occupancy: ["peaks"],
  breach_compliance: ["alerts"],
  gate_throughput: ["throughput"],
} as const;
/** Path of the signed, short-lived CSV download (not a JSON endpoint; the link carries `exp`, `key` and `sig`). */
export const REPORT_FILE_PATH = "/report-files/:id";
export const ReportData = z.object({
  event_id: Id,
  kind: ReportKind,
  /** Each kind has one or more sections (attendance: by_tier, arrivals; dwell_flow: flow, dwell; others: one). */
  section: z.string(),
  /** Rows in the whole section. */
  total: z.number().int(),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
  next_cursor: z.string().nullable(),
});
/**
 * Export formats (D-21): `xlsx` (default) is the whole event as one workbook — a summary sheet, then
 * one sheet per report, and an attendee sheet only when `include_attendees` is set (operators;
 * audited). `csv` is one report and needs `kind`. `pdf` is the one-page summary.
 */
export const ExportRequest = z.object({
  format: ExportFormat.default("xlsx"),
  include_attendees: z.boolean().default(false),
});

/**
 * A report emailed on a schedule (01 §10). Each run builds the export and emails every recipient a
 * signed, short-lived download link; the message itself carries no report data. A schedule that
 * includes the attendee sheet may only be sent to operator accounts.
 */
export const ReportSchedule = z.object({
  id: Id,
  event_id: Id,
  format: ExportFormat,
  /** Null for the whole-event workbook and the PDF summary. */
  kind: ReportKind.nullable(),
  include_identity: z.boolean(),
  recipients: z.array(Email),
  cadence: ReportCadence,
  /** Next due time (null for on_close, and once done). */
  next_run_at: IsoDateTime.nullable(),
  last_run_at: IsoDateTime.nullable(),
  state: ReportScheduleState,
  /** Consecutive failed runs; three make the schedule `failed`. */
  failures: z.number().int(),
  created_by: Id.nullable(),
  created_at: IsoDateTime,
});
export type ReportSchedule = z.infer<typeof ReportSchedule>;
export const CreateReportSchedule = z.object({
  format: ExportFormat.default("xlsx"),
  /** Required for csv; not allowed otherwise. */
  kind: ReportKind.optional(),
  /** Workbook only; every recipient must then be an operator account. */
  include_attendees: z.boolean().default(false),
  recipients: z.array(Email).min(1).max(20),
  cadence: ReportCadence,
  /** First run for daily/weekly/monthly (default: now; at most a year ahead). Not allowed for on_close. */
  first_run_at: IsoDateTime.optional(),
});
export const SetReportScheduleState = z.object({ state: z.enum(["active", "paused"]) });
export const ReportScheduleParams = z.object({ id: Id, scheduleId: Id });

export const Dashboard = z.object({
  live_events: z.number().int(),
  on_site: z.number().int(),
  open_alerts: z.number().int(),
  gates_offline: z.number().int(),
  as_of: IsoDateTime,
});
export type Dashboard = z.infer<typeof Dashboard>;

/** The signed-in operator or staff member (the console header): who, which role, the shift in progress. */
export const OperatorProfile = z.object({
  id: Id,
  email: Email,
  role: Role,
  mfa_enrolled: z.boolean(),
  /** True while an MFA step-up is fresh (privileged actions allowed). */
  mfa_fresh: z.boolean(),
  current_shift: StaffAssignment.extend({ checkpoint_label: z.string() }).nullable(),
  /**
   * Additive (D-23): the endpoint names (keys of the contract registry) this role may call, derived
   * from the registry itself, so a console builds its screens without a copy of the matrix. A desk
   * clerk is further limited by the handler to the events of their current assignments.
   */
  capabilities: z.array(z.string()).optional(),
  /** Additive (D-23): for a desk clerk, the events their current assignments cover. */
  desk_event_ids: z.array(Id).optional(),
  /** Additive: the name given at invitation (users.display_name); null when none was given (show the email). */
  display_name: z.string().nullable().optional(),
  /**
   * Additive: a label for the shift in progress — the gate's label, then the event's title when the
   * shift works one ("North gate · Tech Summit"). Null when there is no current shift; the server never
   * invents one.
   */
  shift_label: z.string().nullable().optional(),
});
export type OperatorProfile = z.infer<typeof OperatorProfile>;

export const staffEndpoints = {
  myOperator: endpoint({ method: "GET", path: "/me/operator", access: ["admin", "organiser", "security_staff", "speaker", "crew", "supervisor", "desk_clerk"], response: OperatorProfile }),
  listStaff: endpoint({ method: "GET", path: "/staff", access: ADMIN_ONLY, query: PageQuery, response: pageOf(StaffMember) }),
  /**
   * `event_id` (additive): the shifts tied to that event (06 D6.6).
   * Supervisors (additive, read only — the gate detail page): `checkpoint_id` or `event_id` is required
   * (VALIDATION_FAILED otherwise); only current and upcoming shifts (not over, not handed over); each item
   * carries the gate, the shift times and the person's display name only (`staff_name` absent when they
   * have none; never an email). `user_id` filtering is not available to them.
   */
  listAssignments: endpoint({ method: "GET", path: "/staff-assignments", access: SUPERVISE, query: PageQuery.extend({ checkpoint_id: Id.optional(), user_id: Id.optional(), event_id: Id.optional() }), response: pageOf(StaffAssignment) }),
  createAssignment: endpoint({ method: "POST", path: "/staff-assignments", access: ADMIN_ONLY, audited: true, body: CreateStaffAssignment, response: StaffAssignment, status: 201 }),
  /* ---- additions (not in 02 §5; proposed) ---- */
  inviteStaff: endpoint({ method: "POST", path: "/staff", access: ADMIN_ONLY, audited: true, body: InviteStaff, response: StaffMember, status: 201 }),
  /** D-23: change a user's role (never one's own). */
  changeStaffRole: endpoint({ method: "PATCH", path: "/staff/:id", access: ADMIN_ONLY, mfa: true, audited: true, params: IdParam, body: ChangeStaffRole, response: StaffMember }),
  /**
   * Sets the password and spends the link, in one step (audited `staff.activate`). LINK_EXPIRED past
   * its 72 hours; LINK_INVALID when unknown, already used, or replaced by a newer invitation.
   */
  activateStaff: endpoint({ method: "POST", path: "/auth/activate", access: PUBLIC, rateLimit: "auth", body: ActivateStaff, response: Ok }),
  /** Additive: reads an activation link's state without spending it (the activation screens, before the password). */
  checkActivation: endpoint({ method: "POST", path: "/auth/activate/check", access: PUBLIC, rateLimit: "auth", body: CheckActivation, response: ActivationCheck }),
  handover: endpoint({ method: "POST", path: "/staff-assignments/:id/handover", access: ["admin", "organiser", "security_staff"], audited: true, params: IdParam, response: HandoverSummary }),
  gateHeartbeat: endpoint({ method: "POST", path: "/gates/heartbeat", access: SCANNERS, rateLimit: "scan", body: GateHeartbeat, response: z.object({ server_time: IsoDateTime }) }),
  mfaEnrol: endpoint({ method: "POST", path: "/auth/mfa/enrol", access: ["admin", "organiser", "security_staff", "speaker", "crew", "supervisor", "desk_clerk"], rateLimit: "auth", response: MfaEnrolment, status: 201 }),
  mfaEnrolConfirm: endpoint({ method: "POST", path: "/auth/mfa/enrol/confirm", access: ["admin", "organiser", "security_staff", "speaker", "crew", "supervisor", "desk_clerk"], rateLimit: "auth", audited: true, body: MfaEnrolConfirm, response: Ok }),
} as const;

export const reportEndpoints = {
  listReports: endpoint({ method: "GET", path: "/reports", access: OPERATORS, query: PageQuery, response: pageOf(EventReportRow) }),
  eventReports: endpoint({ method: "GET", path: "/reports/:eventId", access: OPERATORS, params: z.object({ eventId: Id }), response: z.object({ items: z.array(EventReportRow) }) }),
  reportData: endpoint({ method: "GET", path: "/reports/:eventId/:kind", access: OPERATORS, params: z.object({ eventId: Id, kind: ReportKind }), query: PageQuery.extend({ section: z.string().max(32).optional() }), response: ReportData }),
  /** `:id` is the event id (02 §5 says `:id`; an export creates an event_reports row). */
  exportReport: endpoint({ method: "POST", path: "/reports/:id/export", access: OPERATORS, mfa: true, audited: true, params: IdParam, body: ExportRequest.extend({ kind: ReportKind.optional() }), response: EventReportRow, status: 202 }),
  dashboard: endpoint({ method: "GET", path: "/dashboard", access: SUPERVISE, response: Dashboard }),
  /* ---- scheduled reports (01 §10; additions) ---- */
  listReportSchedules: endpoint({ method: "GET", path: "/events/:id/report-schedules", access: OPERATORS, params: IdParam, response: z.object({ items: z.array(ReportSchedule) }) }),
  /** Sending data out by email: MFA and audited, like an export. */
  createReportSchedule: endpoint({ method: "POST", path: "/events/:id/report-schedules", access: OPERATORS, mfa: true, audited: true, params: IdParam, body: CreateReportSchedule, response: ReportSchedule, status: 201 }),
  /** Pause or resume. Resuming one that includes the attendee sheet needs a fresh MFA step-up (MFA_REQUIRED otherwise). */
  setReportScheduleState: endpoint({ method: "PATCH", path: "/events/:id/report-schedules/:scheduleId", access: OPERATORS, audited: true, params: ReportScheduleParams, body: SetReportScheduleState, response: ReportSchedule }),
  deleteReportSchedule: endpoint({ method: "DELETE", path: "/events/:id/report-schedules/:scheduleId", access: OPERATORS, audited: true, params: ReportScheduleParams, response: Ok }),
} as const;

/**
 * The one-page event summary (06 D13c, D-21), from aggregates only, so it reads the same after the
 * purge. `provisional` is true while the event is not yet closed.
 */
export const PostEventSummary = z.object({
  event_id: Id,
  state: EventState,
  provisional: z.boolean(),
  as_of: IsoDateTime,
  /** True once the purge has frozen the summary; it no longer changes. */
  frozen: z.boolean().optional(),
  frozen_at: IsoDateTime.nullable().optional(),
  /** Figures are as fresh as the last rollup rebuild (every ~5 minutes while live). */
  rollups_rebuilt_at: IsoDateTime.nullable().optional(),
  headline: z.object({
    registered: z.number().int(),
    checked_in: z.number().int(),
    no_shows: z.number().int(),
    /** Highest number counted in rooms at once (sum of room peaks in one 5-minute bucket). */
    peak_on_site: z.number().int(),
    peak_on_site_at: IsoDateTime.nullable(),
    rooms_at_capacity: z.number().int(),
    alerts_raised: z.number().int(),
  }),
  attendance_by_tier: z.array(z.object({ tier: AttendeeTier, registered: z.number().int(), checked_in: z.number().int(), no_shows: z.number().int() })),
  /** On site per 5-minute bucket. */
  occupancy_curve: z.array(z.object({ at: IsoDateTime, on_site: z.number().int() })),
  busiest_rooms: z.array(z.object({ room_id: Id, name: z.string(), capacity: z.number().int(), peak: z.number().int(), peak_at: IsoDateTime.nullable() })),
  busiest_gates: z.array(z.object({ checkpoint_id: Id, label: z.string(), scans: z.number().int(), admitted: z.number().int(), denied: z.number().int() })),
  alerts: z.object({
    by_severity: z.record(Severity, z.number().int()),
    ack_p50_s: z.number().nullable(),
    resolve_p50_s: z.number().nullable(),
  }),
  downloads: z.array(EventReportRow),
  purge: z.object({
    /** When individual scan records and the ID mapping were deleted; null until then. */
    purged_at: IsoDateTime.nullable(),
    /** When the purge is due (close + grace period); null while the event is open. */
    due_at: IsoDateTime.nullable(),
    /** False once the individual scan records are gone. */
    scans_available: z.boolean().optional(),
  }),
});
export type PostEventSummary = z.infer<typeof PostEventSummary>;

export const postEventEndpoints = {
  /** Not in 02 §5 (D-21). */
  postEventSummary: endpoint({ method: "GET", path: "/events/:id/post-event-summary", access: OPERATORS, params: IdParam, response: PostEventSummary }),
} as const;
