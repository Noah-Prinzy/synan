/** Event endpoints (02 §5 "Events", 01 §9). */
import { z } from "zod";
import { IanaTimezone, Id, IsoDateTime, pageOf, PageQuery, Slug } from "../common.js";
import { AccessEffect, AccessSubjectKind, AttendeeTier, CredentialState, EventState } from "../enums/index.js";
import { endpoint, IdParam, OPERATORS, PUBLIC, SlugParam, type Access } from "./endpoint.js";

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
});
export type EventSummary = z.infer<typeof EventSummary>;

export const EventRoom = z.object({
  room_id: Id,
  name: z.string(),
  zone_id: Id,
  capacity: z.number().int().min(0),
});
export type EventRoom = z.infer<typeof EventRoom>;

export const EventSession = z.object({
  id: Id,
  event_id: Id,
  room_id: Id,
  title: z.string(),
  starts_at: IsoDateTime,
  ends_at: IsoDateTime,
});
export type EventSession = z.infer<typeof EventSession>;

export const EventDetail = EventSummary.extend({
  description: z.string().nullable(),
  rooms: z.array(EventRoom),
  sessions: z.array(EventSession),
});
export type EventDetail = z.infer<typeof EventDetail>;

/** Full operator view, including fields hidden from discovery. */
export const EventAdmin = EventDetail.extend({
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
});
export type EventAdmin = z.infer<typeof EventAdmin>;

export const EventListQuery = PageQuery.extend({
  /** Discovery only returns published or live events; with scope=all (operators) any state. */
  state: EventState.optional(),
  q: z.string().max(100).optional(),
  /** `all`: every event in every state, listed or not — operators only (403 otherwise). */
  scope: z.enum(["public", "all"]).default("public"),
});

export const CreateEvent = z.object({
  venue_id: Id,
  slug: Slug,
  title: z.string().min(1).max(200),
  description: z.string().max(10_000).optional(),
  starts_at: IsoDateTime,
  ends_at: IsoDateTime,
  timezone: IanaTimezone,
  listed: z.boolean().default(true),
  grace_buffer_hours: z.number().int().min(0).max(24 * 90).default(72),
  rooms: z.array(z.object({ room_id: Id, capacity_override: z.number().int().min(0).nullable().optional() })).default([]),
  /** Pass template (required before publishing). Shape is the template designer's. */
  pass_template: z.record(z.string(), z.unknown()).nullable().optional(),
  /** Attendee profile fields collected at registration. */
  profile_schema: z.array(z.lazy(() => ProfileField)).max(50).optional(),
});
/**
 * PATCH body: every field optional and NO defaults (a `.partial()` of CreateEvent would still apply
 * the create defaults — listed, grace period, rooms: [] — and silently overwrite them on every patch).
 */
export const UpdateEvent = z.object({
  slug: Slug.optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(10_000).optional(),
  starts_at: IsoDateTime.optional(),
  ends_at: IsoDateTime.optional(),
  timezone: IanaTimezone.optional(),
  listed: z.boolean().optional(),
  grace_buffer_hours: z.number().int().min(0).max(24 * 90).optional(),
  rooms: z.array(z.object({ room_id: Id, capacity_override: z.number().int().min(0).nullable().optional() })).optional(),
  pass_template: z.record(z.string(), z.unknown()).nullable().optional(),
  profile_schema: z.array(z.lazy(() => ProfileField)).max(50).optional(),
});
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

export const EventLiveSummary = z.object({
  /** Additive: per-minute throughput, oldest first, zero-filled. */
  series: z.array(SummaryMinute).optional(),
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
});
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
  /** base64url SHA-256 of each NFC UID bound to the credential. */
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
  eventSummary: endpoint({ method: "GET", path: "/events/:id/summary", access: OPERATORS, params: IdParam, query: EventSummaryQuery, response: EventLiveSummary }),
  eventSessions: endpoint({ method: "GET", path: "/events/:id/sessions", access: PUBLIC, params: IdParam, response: z.object({ items: z.array(EventSession) }) }),
  profileSchema: endpoint({ method: "GET", path: "/events/:slug/profile-schema", access: PUBLIC, params: SlugParam, response: ProfileSchema }),
  getAccessRules: endpoint({ method: "GET", path: "/events/:id/access-rules", access: OPERATORS, params: IdParam, response: AccessRuleSet }),
  putAccessRules: endpoint({ method: "PUT", path: "/events/:id/access-rules", access: OPERATORS, audited: true, params: IdParam, body: PutAccessRules, response: AccessRuleSet }),
  allowlist: endpoint({ method: "GET", path: "/events/:id/allowlist", access: OPS_AND_SCANNERS, params: IdParam, query: z.object({ checkpoint_id: Id.optional() }), response: SignedAllowlist }),
} as const;
