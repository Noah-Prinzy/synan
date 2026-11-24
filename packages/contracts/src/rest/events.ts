/** Event endpoints (02 §5 "Events", 01 §9). */
import { z } from "zod";
import { Email, IanaTimezone, Id, IsoDateTime, Ok, pageOf, PageQuery, Slug } from "../common.js";
import { AccessEffect, AccessSubjectKind, AttendeeTier, CredentialState, EventState, WizardStep } from "../enums/index.js";
import { endpoint, IdParam, OPERATORS, PUBLIC, SlugParam, type Access } from "./endpoint.js";

/** An operator named in a record ("last edited by"): the display name, or the email when there is none. */
export const OperatorRef = z.object({ id: Id, name: z.string() });
export type OperatorRef = z.infer<typeof OperatorRef>;

/** Public card for discovery. */
export const EventSummary = z.object({
  id: Id,
  slug: Slug,
  title: z.string().min(1).max(200),
  starts_at: IsoDateTime,
  ends_at: IsoDateTime,
  timezone: IanaTimezone,
  state: EventState,
  venue: z.object({ id: Id, name: z.string(), city: z.string().nullable() }),
  /**
   * People on site now, for discovery. Null when the event is not live, or when the count is below
   * the minimum crowd size (k-anonymity, O-08) — the same rule as public telemetry.
   */
  on_site: z.number().int().min(0).nullable(),
  /* ---- additive; always present in server responses ---- */
  /** Sum of the capacities in force of the event's rooms; null when the event has no rooms. */
  capacity: z.number().int().min(0).nullable().optional(),
  /** Number of sessions in the programme. */
  session_count: z.number().int().min(0).optional(),
  /** The event's image; null until event photos exist. */
  image_url: z.url().nullable().optional(),
});
export type EventSummary = z.infer<typeof EventSummary>;

/** A short reference to an event, carried on attendee self-service items (passes, registrations). */
export const EventRef = z.object({
  id: Id,
  slug: Slug,
  title: z.string(),
  starts_at: IsoDateTime.nullable(),
  ends_at: IsoDateTime.nullable(),
  timezone: IanaTimezone,
  state: EventState,
  venue_name: z.string().nullable(),
});
export type EventRef = z.infer<typeof EventRef>;

export const EventRoom = z.object({
  room_id: Id,
  name: z.string(),
  zone_id: Id,
  /** The capacity in force for this event (the override, else the room's own). */
  capacity: z.number().int().min(0),
  /** Operator views only (EventAdmin): the event's own capacity for the room; null keeps the venue's. */
  capacity_override: z.number().int().min(0).nullable().optional(),
});
export type EventRoom = z.infer<typeof EventRoom>;

export const EventSession = z.object({
  id: Id,
  event_id: Id,
  room_id: Id,
  title: z.string(),
  starts_at: IsoDateTime,
  ends_at: IsoDateTime,
  /* ---- additive: set on GET /me/sessions items (the attendee's agenda across events) ---- */
  event_slug: Slug.optional(),
  event_title: z.string().optional(),
  event_timezone: IanaTimezone.optional(),
  room_name: z.string().optional(),
  /** The room's capacity in force for the event. */
  room_capacity: z.number().int().min(0).optional(),
});
export type EventSession = z.infer<typeof EventSession>;

export const EventDetail = EventSummary.extend({
  description: z.string().nullable(),
  rooms: z.array(EventRoom),
  sessions: z.array(EventSession),
});
export type EventDetail = z.infer<typeof EventDetail>;

/**
 * Full operator view, including fields hidden from discovery. A draft may not have its venue or dates
 * yet (06 D5 writes a draft per step): `venue`, `starts_at` and `ends_at` are null only then.
 */
export const EventAdmin = EventDetail.extend({
  starts_at: IsoDateTime.nullable(),
  ends_at: IsoDateTime.nullable(),
  venue: z.object({ id: Id, name: z.string(), city: z.string().nullable() }).nullable(),
  org_id: Id,
  listed: z.boolean(),
  /** Pass template; publishing requires one (01 §9). */
  pass_template: z.record(z.string(), z.unknown()).nullable().optional(),
  /** Version of the access-rule set (bumped on every republish). */
  access_rules_version: z.number().int().min(0).optional(),
  /** When the event closed; the retention clock starts here (03 §6). */
  closed_at: IsoDateTime.nullable().optional(),
  /** Grace period before the post-event purge, in hours (O-06). */
  grace_buffer_hours: z.number().int().min(0).max(24 * 90),
  /* ---- additive; always present in server responses ---- */
  /** The furthest wizard step reached: where the wizard resumes (06 D5). */
  wizard_step: WizardStep.optional(),
  /** When the event was published; null while a draft. */
  published_at: IsoDateTime.nullable().optional(),
  created_at: IsoDateTime.optional(),
  /** Last change to the event, its rooms, sessions or access rules. */
  updated_at: IsoDateTime.optional(),
  updated_by: OperatorRef.nullable().optional(),
  /** Additive: the organiser contact shown on invitations; null when none was set. */
  contact: z.lazy(() => EventContact).nullable().optional(),
});
export type EventAdmin = z.infer<typeof EventAdmin>;

/** One row of the operators' event list (06 D4): every state, drafts included, with counts. */
export const EventAdminRow = z.object({
  id: Id,
  slug: Slug,
  title: z.string(),
  state: EventState,
  starts_at: IsoDateTime.nullable(),
  ends_at: IsoDateTime.nullable(),
  timezone: IanaTimezone,
  listed: z.boolean(),
  venue: z.object({ id: Id, name: z.string(), city: z.string().nullable() }).nullable(),
  /** Registrations that are not cancelled. */
  registrations: z.number().int().min(0),
  checked_in: z.number().int().min(0),
  wizard_step: WizardStep,
  published_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
  updated_by: OperatorRef.nullable(),
});
export type EventAdminRow = z.infer<typeof EventAdminRow>;
/** Most recently changed first. */
export const EventAdminListQuery = PageQuery.extend({
  state: EventState.optional(),
  q: z.string().max(100).optional(),
  venue_id: Id.optional(),
});

/** The readiness checklist's lines (06 D5 review, D6.1). */
export const ReadinessKey = z.enum(["basics", "venue", "rooms", "capacity", "rules", "pass", "email", "staff", "doors", "gate", "sessions"]);
export type ReadinessKey = z.infer<typeof ReadinessKey>;
/** One line of the readiness checklist. Publishing is refused while a blocking line is unmet (P-13). */
export const ReadinessItem = z.object({
  key: ReadinessKey,
  label: z.string(),
  met: z.boolean(),
  /** What is missing, or what was found, in one sentence. */
  detail: z.string(),
  blocking: z.boolean(),
  /** The wizard step that fixes it; null when it is fixed elsewhere (settings, staff). */
  step: WizardStep.nullable(),
});
export type ReadinessItem = z.infer<typeof ReadinessItem>;
export const EventReadiness = z.object({
  event_id: Id,
  /** No blocking line is unmet. */
  ready: z.boolean(),
  items: z.array(ReadinessItem),
});
export type EventReadiness = z.infer<typeof EventReadiness>;

/**
 * POST /events/:id/duplicate. Defaults: slug `<slug>-copy` (then -copy-2, …), title `<title> (copy)`.
 * Without `starts_at` the copy has no dates (the wizard asks for them), no sessions, and only the
 * access rules without a time window; with it, dates, sessions and rule windows are shifted.
 */
export const DuplicateEvent = z
  .object({
    slug: Slug.optional(),
    title: z.string().trim().min(1).max(200).optional(),
    starts_at: IsoDateTime.optional(),
  })
  .default({});

/** A session of an event (06 D6.2): in one of the event's rooms, inside the event's dates. */
export const CreateSession = z.object({
  room_id: Id,
  title: z.string().trim().min(1).max(200),
  starts_at: IsoDateTime,
  ends_at: IsoDateTime,
});
export type CreateSession = z.infer<typeof CreateSession>;
export const UpdateSession = CreateSession.partial();
export const SessionParams = z.object({ id: Id, sessionId: Id });

export const EventListQuery = PageQuery.extend({
  /** Discovery only returns published or live events; with scope=all (operators) any state. */
  state: EventState.optional(),
  q: z.string().max(100).optional(),
  /**
   * `all`: every event in every state, listed or not — operators only (403 otherwise).
   * `work` (additive): the events the caller may work, listed or not (unlisted Private Invitation events
   * included) — admins, organisers and supervisors: published and live events; desk clerks: only the
   * events of their current desk assignments. Signed-in staff only (403 for anyone else, never public).
   */
  scope: z.enum(["public", "all", "work"]).default("public"),
});

/**
 * Creates a draft. Venue and dates may come later (the wizard writes a draft per step); publishing
 * needs them. `rooms` needs `venue_id`.
 */
export const CreateEvent = z.object({
  venue_id: Id.optional(),
  slug: Slug,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10_000).optional(),
  starts_at: IsoDateTime.optional(),
  ends_at: IsoDateTime.optional(),
  timezone: IanaTimezone,
  /** The wizard step the draft has reached (default basics). */
  wizard_step: WizardStep.optional(),
  listed: z.boolean().default(true),
  grace_buffer_hours: z.number().int().min(0).max(24 * 90).default(72),
  rooms: z.array(z.object({ room_id: Id, capacity_override: z.number().int().min(0).nullable().optional() })).default([]),
  /** Pass template (required before publishing). Shape is the template designer's. */
  pass_template: z.record(z.string(), z.unknown()).nullable().optional(),
  /** Attendee profile fields collected at registration. */
  profile_schema: z.array(z.lazy(() => ProfileField)).max(50).optional(),
  /** Additive: the organiser contact shown on invitations (EventContactInput). */
  contact: z.lazy(() => EventContactInput).optional(),
});
/**
 * PATCH body: every field optional and NO defaults (a `.partial()` of CreateEvent would still apply
 * the create defaults — listed, grace period, rooms: [] — and silently overwrite them on every patch).
 */
export const UpdateEvent = z.object({
  slug: Slug.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(10_000).optional(),
  /** Null clears the date (drafts only). */
  starts_at: IsoDateTime.nullable().optional(),
  ends_at: IsoDateTime.nullable().optional(),
  timezone: IanaTimezone.optional(),
  /**
   * Drafts only. A different venue clears the draft's rooms, with their sessions and access rules.
   * Additive: null clears the draft's venue (and so its rooms, sessions and access rules).
   */
  venue_id: Id.nullable().optional(),
  /** The wizard step reached; the stored step only moves forward (the furthest step is kept). */
  wizard_step: WizardStep.optional(),
  listed: z.boolean().optional(),
  grace_buffer_hours: z.number().int().min(0).max(24 * 90).optional(),
  rooms: z.array(z.object({ room_id: Id, capacity_override: z.number().int().min(0).nullable().optional() })).optional(),
  pass_template: z.record(z.string(), z.unknown()).nullable().optional(),
  profile_schema: z.array(z.lazy(() => ProfileField)).max(50).optional(),
  /** Additive: the organiser contact shown on invitations; null removes it. */
  contact: z.lazy(() => EventContactInput).nullable().optional(),
});
/**
 * The organiser contact for an event (shown to invitees before they reply): a display name and an
 * address chosen for the event — never an operator's sign-in address unless typed in here.
 */
export const EventContactInput = z.object({
  name: z.string().trim().min(1).max(200).nullable().optional(),
  email: Email.nullable().optional(),
});
export const EventContact = z.object({ name: z.string().nullable(), email: Email.nullable() });
export type EventContact = z.infer<typeof EventContact>;
/** Not in 02 §5: the rest of the guarded lifecycle (publish has its own endpoint). */
export const EventTransition = z.object({ state: z.enum(["live", "closed", "archived"]) });

/** One minute of gate throughput across the event (the per-gate, per-minute rollups summed; D-16). */
export const SummaryMinute = z.object({
  /** Start of the minute (server time). */
  at: IsoDateTime,
  scans: z.number().int().min(0),
  /** Let through: admitted + already_inside. */
  admitted: z.number().int().min(0),
  denied: z.number().int().min(0),
});
export type SummaryMinute = z.infer<typeof SummaryMinute>;
/** `series_minutes`: how many whole minutes of `series`, ending with the last complete minute (default 60, 0 = none). */
export const EventSummaryQuery = z.object({ series_minutes: z.coerce.number().int().min(0).max(240).default(60) });

/**
 * One value per headline figure per bucket (the Command Center KPI sparklines, 06 D1), oldest first.
 * Buckets are whole minutes; the last is the current minute and its values are the headline figures
 * now. Each earlier value is the figure at the end of its minute: registered and checked in from the
 * registrations, open alerts from the alerts' raise and acknowledge times, and on site and capacity
 * risk by replaying the event's scans (0 unless the event is live).
 */
export const KpiSeries = z.object({
  bucket_ms: z.number().int().positive(),
  /** Start of the first bucket. */
  from: IsoDateTime,
  registered: z.array(z.number().int().min(0)),
  checked_in: z.array(z.number().int().min(0)),
  on_site: z.array(z.number().int().min(0)),
  capacity_risk: z.array(z.number().int().min(0)),
  open_alerts: z.array(z.number().int().min(0)),
});
export type KpiSeries = z.infer<typeof KpiSeries>;

export const EventLiveSummary = z.object({
  /** Additive: per-minute throughput, oldest first, zero-filled. */
  series: z.array(SummaryMinute).optional(),
  /** Additive: rooms at or over their warning threshold now (live events; 0 otherwise). */
  capacity_risk: z.number().int().min(0).optional(),
  /** Additive: a series per headline figure, `series_minutes` buckets long (absent when 0). */
  kpi_series: KpiSeries.optional(),
  event_id: Id,
  registered: z.number().int(),
  checked_in: z.number().int(),
  on_site: z.number().int(),
  by_tier: z.record(AttendeeTier, z.number().int()),
  open_alerts: z.number().int(),
  as_of: IsoDateTime,
});
export type EventLiveSummary = z.infer<typeof EventLiveSummary>;

export const ProfileField = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  label: z.string().max(200),
  type: z.enum(["text", "email", "phone", "select", "multiselect", "checkbox", "date"]),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  /** Help text shown under the field. */
  hint: z.string().max(500).nullable().optional(),
  /** Example value shown inside an empty input. */
  placeholder: z.string().max(200).nullable().optional(),
});
export type ProfileField = z.infer<typeof ProfileField>;
export const ProfileSchema = z.object({ event_slug: Slug, fields: z.array(ProfileField) });
export type ProfileSchema = z.infer<typeof ProfileSchema>;

export const AccessRule = z.object({
  id: Id,
  event_id: Id,
  subject_kind: AccessSubjectKind,
  /** An AttendeeTier when subject_kind=tier, a Role when subject_kind=role. */
  subject: z.string(),
  room_id: Id,
  window_start: IsoDateTime.nullable(),
  window_end: IsoDateTime.nullable(),
  effect: AccessEffect,
});
export type AccessRule = z.infer<typeof AccessRule>;
export const AccessRuleSet = z.object({
  /** Increments on every republish; the scanner compares it with its allowlist. */
  version: z.number().int().min(0),
  rules: z.array(AccessRule),
  /** Additive: when this version was published; null for version 0 (never published). */
  published_at: IsoDateTime.nullable().optional(),
  /** Additive: who published it; null when unknown. */
  published_by: OperatorRef.nullable().optional(),
});
export type AccessRuleSet = z.infer<typeof AccessRuleSet>;
export const PutAccessRules = z.object({
  /** Optimistic concurrency: must equal the current version. */
  expected_version: z.number().int().min(0),
  rules: z.array(AccessRule.omit({ id: true, event_id: true })),
});

/**
 * Signed offline allowlist (P-09, 03 §4). `jws` is a compact EdDSA JWS signed with
 * an `allowlist` key; its payload is `AllowlistPayload`. Scanners must verify it.
 */
export const AllowlistEntry = z.object({
  /** 128-bit credential reference, base64url (the `ref` inside portal and emailed QR codes). Never an identity. */
  credential_hash: z.string(),
  /**
   * The credential's live wristbands (bound or active; an `assigned` band is not yet verified at the
   * desk and opens nothing), each as base64url SHA-256 of the text `nfc:` + the UID in upper-case hex.
   */
  nfc_hashes: z.array(z.string()),
  tier: AttendeeTier.nullable(),
  /** Rooms behind the requested checkpoint (or the whole event) this pass may enter at some time in the window. A perimeter gate with no room admits any valid pass. */
  permitted_room_ids: z.array(Id),
  /** True for revoked or replaced credentials and cancelled registrations. */
  revoked: z.boolean(),
  /** The finer state, so an offline gate can answer `suspended` rather than `revoked`. */
  state: CredentialState,
  /** Lost or retired bands of this credential: an offline gate answers `revoked`, not `unknown_token`. */
  dead_nfc_hashes: z.array(z.string()),
  /** The single-use emailed QR has been used (an offline gate answers `pass_spent`). */
  qr_email_spent: z.boolean(),
  /**
   * Additive: the emailed codes of this pass that may still be used once — not used, not superseded by
   * a resend — each as base64url SHA-256 of the code's `cid` text (as parsed by `parseSignedQr`). An
   * offline gate answers `pass_spent` for any other emailed code of the pass.
   */
  qr_email_hashes: z.array(z.string()).optional(),
  /**
   * Additive, perimeter checkpoints only: the event's rooms this pass may enter at some time in the
   * window (ids only), for the verdict's room chips while offline. Not an admission rule: a perimeter
   * gate with no room admits any valid pass.
   */
  perimeter_room_ids: z.array(Id).optional(),
});
export type AllowlistEntry = z.infer<typeof AllowlistEntry>;
export const AllowlistPayload = z.object({
  event_id: Id,
  checkpoint_id: Id.nullable(),
  shift_end: IsoDateTime.nullable(),
  revocation_epoch: z.number().int(),
  /** The access-rule version the entries were resolved against. */
  access_rules_version: z.number().int(),
  /** The window the entries are valid for: now → shift end for staff; the event for operators. */
  window_start: IsoDateTime,
  window_end: IsoDateTime,
  issued_at: IsoDateTime,
  entries: z.array(AllowlistEntry),
});
export type AllowlistPayload = z.infer<typeof AllowlistPayload>;
/** JWS protected-header `typ` of a signed allowlist. */
export const ALLOWLIST_JWS_TYP = "synan-allowlist+jws";
export const SignedAllowlist = z.object({ kid: z.string(), jws: z.string(), issued_at: IsoDateTime });
export type SignedAllowlist = z.infer<typeof SignedAllowlist>;

const OPS_AND_SCANNERS: readonly Access[] = ["admin", "organiser", "security_staff", "device"];

export const eventEndpoints = {
  listEvents: endpoint({ method: "GET", path: "/events", access: PUBLIC, query: EventListQuery, response: pageOf(EventSummary) }),
  createEvent: endpoint({ method: "POST", path: "/events", access: OPERATORS, audited: true, body: CreateEvent, response: EventAdmin, status: 201 }),
  /** Unlisted events resolve by slug for anyone holding the link; they never appear in listEvents. */
  getEvent: endpoint({ method: "GET", path: "/events/:slug", access: PUBLIC, params: SlugParam, response: EventDetail }),
  updateEvent: endpoint({ method: "PATCH", path: "/events/:id", access: OPERATORS, audited: true, params: IdParam, body: UpdateEvent, response: EventAdmin }),
  publishEvent: endpoint({ method: "POST", path: "/events/:id/publish", access: OPERATORS, audited: true, params: IdParam, response: EventAdmin }),
  /** published → live → closed → archived. Closing starts the retention clock. */
  transitionEvent: endpoint({ method: "POST", path: "/events/:id/state", access: OPERATORS, audited: true, params: IdParam, body: EventTransition, response: EventAdmin }),
  /** The operator's full view of one event (drafts and unlisted included). */
  getEventAdmin: endpoint({ method: "GET", path: "/events/:id/admin", access: OPERATORS, params: IdParam, response: EventAdmin }),
  eventSummary: endpoint({ method: "GET", path: "/events/:id/summary", access: ["admin", "organiser", "supervisor"], params: IdParam, query: EventSummaryQuery, response: EventLiveSummary }),
  eventSessions: endpoint({ method: "GET", path: "/events/:id/sessions", access: PUBLIC, params: IdParam, response: z.object({ items: z.array(EventSession) }) }),
  profileSchema: endpoint({ method: "GET", path: "/events/:slug/profile-schema", access: PUBLIC, params: SlugParam, response: ProfileSchema }),
  getAccessRules: endpoint({ method: "GET", path: "/events/:id/access-rules", access: OPERATORS, params: IdParam, response: AccessRuleSet }),
  putAccessRules: endpoint({ method: "PUT", path: "/events/:id/access-rules", access: OPERATORS, audited: true, params: IdParam, body: PutAccessRules, response: AccessRuleSet }),
  allowlist: endpoint({ method: "GET", path: "/events/:id/allowlist", access: OPS_AND_SCANNERS, params: IdParam, query: z.object({ checkpoint_id: Id.optional() }), response: SignedAllowlist }),
  /* ---- additions for Admin Command's configure screens (06 D4–D6; not in 02 §5) ---- */
  /** Every event in every state, drafts without venue or dates included, with counts (06 D4). */
  listEventsAdmin: endpoint({ method: "GET", path: "/admin/events", access: OPERATORS, query: EventAdminListQuery, response: pageOf(EventAdminRow) }),
  /** The checklist that guards publish; POST /events/:id/publish enforces its blocking lines. */
  eventReadiness: endpoint({ method: "GET", path: "/events/:id/readiness", access: OPERATORS, params: IdParam, response: EventReadiness }),
  duplicateEvent: endpoint({ method: "POST", path: "/events/:id/duplicate", access: OPERATORS, audited: true, params: IdParam, body: DuplicateEvent, response: EventAdmin, status: 201 }),
  /** Drafts only, and only before anything happened under them (registrations, exports, alerts). */
  deleteEvent: endpoint({ method: "DELETE", path: "/events/:id", access: OPERATORS, audited: true, params: IdParam, response: Ok }),
  /** Sessions (06 D6.2). A change of time or room, or a deletion, notifies the registered attendees of a published or live event. */
  createSession: endpoint({ method: "POST", path: "/events/:id/sessions", access: OPERATORS, audited: true, params: IdParam, body: CreateSession, response: EventSession, status: 201 }),
  updateSession: endpoint({ method: "PATCH", path: "/events/:id/sessions/:sessionId", access: OPERATORS, audited: true, params: SessionParams, body: UpdateSession, response: EventSession }),
  deleteSession: endpoint({ method: "DELETE", path: "/events/:id/sessions/:sessionId", access: OPERATORS, audited: true, params: SessionParams, response: Ok }),
} as const;
