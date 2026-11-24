/**
 * Persistence boundary. Every read and write the API makes goes through these
 * interfaces. Row shapes follow docs/02-architecture.md §4 column names, so a
 * Drizzle implementation over `@synan/db` is a mapping exercise.
 *
 * Implementations:
 *   - repo/memory.ts   in-process maps (default for dev; fastest tests)
 *   - repo/drizzle.ts  @synan/db over PostgreSQL / PGlite
 *
 * Fields marked PROPOSED are not in 02 §4 and are listed in the API README.
 */
import type { PostEventSummary as DbPostEventSummary, WorkbookData } from "@synan/db";
export type { DbPostEventSummary, WorkbookData };
import type {
  AccessEffect,
  AccessSubjectKind,
  AlertKind,
  AlertState,
  AttendeeTier,
  CapacityPolicy,
  CarrierKind,
  CarrierState,
  ChipProfile,
  CheckpointDirection,
  CredentialState,
  EventState,
  InvitationState,
  OccupancyAdjustmentReason,
  RegistrationState,
  ReportKind,
  ReportState,
  Role,
  ScanResult,
  Severity,
  SigningKeyPurpose,
  WizardStep,
} from "@synan/contracts/enums";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: Role;
  mfa_enrolled_at: Date | null;
  /** PROPOSED: base32 TOTP secret (encrypted at rest in the real store). */
  mfa_secret: string | null;
  /** users.display_name; null (or absent) when none was given. */
  display_name?: string | null;
}

export interface AttendeeRow {
  id: string;
  user_id: string | null;
  email: string | null;
  full_name: string | null;
  profile_jsonb: Record<string, unknown>;
}

export interface VenueRow {
  id: string;
  org_id: string;
  name: string;
  address: string;
  timezone: string;
  /** venues.city, shown in discovery. */
  city: string | null;
  /* Layout fields (migration 0024). Optional on writes through the fixture writer; reads always carry them. */
  /** Floor labels in display order. */
  floors?: string[];
  capacity_default?: number | null;
  /** Rises with every zone or room change (database trigger; mirrored in memory). */
  layout_version?: number;
  layout_published_at?: Date | null;
}
export interface ZoneRow {
  id: string;
  venue_id: string;
  name: string;
  floor: string | null;
  geometry_jsonb: GridShapeRow | null;
  /** Position in the zone list, set by a layout publish (default 0). */
  sort_order?: number;
}
export interface RoomRow {
  id: string;
  venue_id: string;
  zone_id: string;
  name: string;
  capacity: number;
  warn_at_pct: number;
  block_at_pct: number;
  continuous_bool: boolean;
  /** PROPOSED column: block | admit_with_alert (01 §7 names the policy; 02 §4.1 has no column). */
  capacity_policy: CapacityPolicy;
  geometry_jsonb: GridShapeRow | null;
}
export interface CheckpointRow {
  id: string;
  venue_id: string;
  zone_id: string;
  room_id: string | null;
  direction: CheckpointDirection;
  perimeter_bool: boolean;
  hardware_id: string | null;
  label: string;
  /** checkpoints.position_jsonb: where the gate sits on the venue grid (contracts GridPoint); null/absent = not placed. */
  position_jsonb?: GridPointRow | null;
}
/** A room's or zone's shape (contracts GridShape; the database checks it, 0023). */
export type GridShapeRow = { kind: "rect"; x: number; y: number; w: number; h: number } | { kind: "polygon"; points: [number, number][] };
export interface GridPointRow { x: number; y: number; side: "n" | "e" | "s" | "w" }
export interface TransitTimeRow { venue_id: string; from_checkpoint_id: string; to_checkpoint_id: string; min_seconds: number }

export interface EventRow {
  id: string;
  org_id: string;
  /** Null only on a draft that has not chosen its venue (events_scheduled_unless_draft). */
  venue_id: string | null;
  slug: string;
  title: string;
  /** PROPOSED: public description shown on the event page. */
  description: string | null;
  /** Null only on a draft whose dates are not set yet. */
  starts_at: Date | null;
  ends_at: Date | null;
  timezone: string;
  state: EventState;
  listed_bool: boolean;
  /** Hours (O-06). */
  grace_buffer: number;
  /** Pass template; publishing requires one (01 §9). */
  pass_template_jsonb: Record<string, unknown> | null;
  /** Event-defined attendee profile fields (GET /events/:slug/profile-schema). */
  profile_schema_jsonb: unknown[];
  /** Optimistic-concurrency version of the access-rule set; bumped on every republish. */
  access_rules_version: number;
  /** Bumped on every revocation; carried in the signed offline allowlist. */
  revocation_epoch: number;
  /** Set when the event closes; starts the retention clock (03 §6). */
  closed_at: Date | null;
  /* Draft and editing fields (migration 0024). Optional on writes through the fixture writer; reads always carry them. */
  /** The furthest wizard step reached (default basics). */
  wizard_step?: WizardStep;
  published_at?: Date | null;
  /** The operator who last changed the event, its rooms, sessions or rules. */
  updated_by?: string | null;
  created_at?: Date;
  /** Database time on SQL (a trigger stamps every update); wall-clock time in memory. */
  updated_at?: Date;
}
/** An event with its venue and dates: every event past draft, and a draft once they are set. */
export type ScheduledEvent = EventRow & { venue_id: string; starts_at: Date; ends_at: Date };
export const isScheduled = (e: EventRow): e is ScheduledEvent => e.venue_id !== null && e.starts_at !== null && e.ends_at !== null;
export interface EventRoomRow { event_id: string; room_id: string; capacity_override: number | null }
export interface SessionRow { id: string; event_id: string; room_id: string; title: string; starts_at: Date; ends_at: Date }

export interface RegistrationRow {
  id: string;
  event_id: string;
  attendee_id: string;
  tier: AttendeeTier;
  state: RegistrationState;
  zone_presence_consent_at: Date | null;
  /** First admission at this event; survives the purge (attendance reporting). */
  checked_in_at: Date | null;
  created_at: Date;
}
export interface AccessRuleRow {
  id: string;
  event_id: string;
  subject_kind: AccessSubjectKind;
  subject: string;
  room_id: string;
  window_start: Date | null;
  window_end: Date | null;
  effect: AccessEffect;
}
export interface StaffAssignmentRow {
  id: string;
  user_id: string;
  checkpoint_id: string;
  shift_start: Date;
  shift_end: Date;
  /** The event whose allowlist the shift caches; null = the checkpoint between events. */
  event_id?: string | null;
  /** Explicit handover (01 §3); does not shorten the reserved window. */
  handed_over_at?: Date | null;
}

export interface CredentialRow {
  id: string;
  registration_id: string | null;
  staff_user_id: string | null;
  /** base64url SHA-256 of the credential secret. The secret itself is never stored. */
  token_hash: string;
  state: CredentialState;
  zone_state: string;
  issued_at: Date;
  revoked_at: Date | null;
}
export interface CarrierRow {
  id: string;
  credential_id: string | null;
  kind: CarrierKind;
  /** NFC: base64url SHA-256 of the UID (never the raw UID). Emailed QR: hex SHA-256 of the code id. Portal QR: null. */
  identifier: string | null;
  chip_profile: ChipProfile | null;
  state: CarrierState;
  bound_at: Date | null;
  redeemed_at: Date | null;
}
export interface SigningKeyRow {
  id: string;
  purpose: SigningKeyPurpose;
  /** 4-byte key id carried in compact QR codes, 8 lowercase hex (unique). */
  qr_kid: string;
  /** Public JWK JSON. */
  public_key: string;
  /**
   * Private JWK JSON, in the clear at this boundary. The SQL repository encrypts it into
   * signing_keys.private_key_enc (AES-256-GCM envelope); the in-memory repository does not encrypt.
   */
  private_key: string;
  active_from: Date;
  retired_at: Date | null;
}

export interface ScanRow {
  id: string;
  event_id: string;
  /** For implied_exit rows: the checkpoint the holder was counted into the room through. */
  checkpoint_id: string;
  /** Null for an unknown token. */
  ephemeral_id: string | null;
  carrier_kind: CarrierKind | null;
  result: ScanResult;
  occurred_at: Date;
  received_at: Date;
  clock_offset_ms: number;
  idem_key: string;
  offline_bool: boolean;
  /** In|out as recorded (needed at `both` checkpoints). */
  direction: "in" | "out";
  /** What an offline gate showed. */
  local_result: ScanResult | null;
  device_id: string | null;
  staff_user_id: string | null;
}

export interface OccupancyAdjustmentRow {
  id: string;
  event_id: string;
  room_id: string;
  delta: number;
  /** Absolute anchor (recount, session-end reset); null for a relative correction. */
  set_to: number | null;
  reason: OccupancyAdjustmentReason;
  actor_id: string | null;
  note: string | null;
  at: Date;
}

export interface BreachAlertRow {
  id: string;
  event_id: string;
  severity: Severity;
  kind: AlertKind;
  checkpoint_id: string | null;
  room_id: string | null;
  credential_id: string | null;
  occurred_at: Date;
  state: AlertState;
  acked_by: string | null;
  acked_at: Date | null;
  resolved_by: string | null;
  resolved_at: Date | null;
  resolution_note: string | null;
  /** PROPOSED: scans involved (D-13 says alerts name every scan involved). */
  scan_ids: string[];
  /** PROPOSED: non-personal machine description. */
  detail: string;
}

export interface AuditRow {
  id: string;
  actor_id: string | null;
  action: string;
  target: string;
  meta_jsonb: Record<string, unknown>;
  at: Date;
  prev_hash: string;
  hash: string;
}

export interface GateRateRollupRow {
  event_id: string;
  checkpoint_id: string;
  minute_start: Date;
  scans: number;
  admitted: number;
  denied: number;
  /** Tier, or "STAFF" / "UNKNOWN" (matches @synan/db rebuild_event_rollups). */
  by_tier_jsonb: Partial<Record<AttendeeTier | "UNKNOWN" | "STAFF", number>>;
  /** Physical reads by recorded result (the failure breakdown). */
  by_result_jsonb: Record<string, number>;
}

/* ---- sign-in state (mirrors @synan/db src/auth.ts and the SQL functions of migration 0004) ---- */

export type AuthHolder = { userId: string; attendeeId?: never } | { attendeeId: string; userId?: never };
export type AuthRevokeReason = "logout" | "reuse_detected" | "mfa_step_up" | "operator" | "credential_change" | "erasure";
export type WsChannelPath = "/stream/scans" | "/stream/telemetry" | "/stream/alerts" | "/stream/me";

export interface StartSessionInput {
  holder: AuthHolder;
  familyId: string;
  /** base64url SHA-256 of the refresh token (43 chars). */
  tokenHash: string;
  expiresAt: Date;
  mfaAt: Date | null;
  userAgent?: string | null;
  ip?: string | null;
  now: Date;
}

/** New refresh lifetime by holder kind; the store picks it inside the same atomic step as the exchange. */
export interface RefreshTtl {
  userSeconds: number;
  attendeeSeconds: number;
}

export interface RotateResult {
  status: "rotated" | "invalid" | "revoked" | "expired" | "reuse_detected";
  family_id: string | null;
  user_id: string | null;
  attendee_id: string | null;
  mfa_at: Date | null;
  /** When rotated: expiry of the new token. */
  expires_at: Date | null;
}

export interface RedeemLinkResult {
  status: "redeemed" | "invalid" | "already_redeemed" | "expired";
  attendee_id: string | null;
}

export interface MintTicketInput {
  ticketHash: string;
  holder: AuthHolder;
  sessionFamilyId: string | null;
  channel: WsChannelPath;
  eventId: string | null;
  checkpointId: string | null;
  expiresAt: Date;
  now: Date;
}

export interface ConsumeTicketResult {
  status: "valid" | "invalid" | "already_consumed" | "expired" | "revoked";
  user_id: string | null;
  attendee_id: string | null;
  session_family_id: string | null;
  channel: WsChannelPath | null;
  event_id: string | null;
  checkpoint_id: string | null;
}

/* ---------------------------------------------------------------- interfaces */

export interface UsersRepo {
  byEmail(email: string): Promise<UserRow | null>;
  byId(id: string): Promise<UserRow | null>;
  insert(row: UserRow): Promise<void>;
  setMfa(id: string, secret: string, enrolledAt: Date): Promise<void>;
  /** Ordered by id, keyset on id. */
  list(opts: { after?: string; limit: number }): Promise<UserRow[]>;
  setPassword(id: string, passwordHash: string): Promise<void>;
  setRole(id: string, role: Role): Promise<void>;
  /** Pending MFA enrolment, held encrypted on the user (SQL: @synan/db startMfaEnrolment and friends). */
  startMfaEnrolment(id: string, secret: string, now: Date): Promise<void>;
  readPendingMfaSecret(id: string, now: Date): Promise<string | null>;
  /** Compare-and-swap: the pending secret becomes the active one. */
  confirmMfaEnrolment(id: string, now: Date): Promise<boolean>;
}
export interface AttendeesRepo {
  byEmail(email: string): Promise<AttendeeRow | null>;
  byId(id: string): Promise<AttendeeRow | null>;
  insert(row: AttendeeRow): Promise<void>;
  /** Identity through the vault helpers (SQL: updateAttendeeIdentity). False when no such attendee. */
  update(id: string, patch: { full_name?: string | null; profile_jsonb?: Record<string, unknown>; email?: string | null }): Promise<boolean>;
  byIds(ids: readonly string[]): Promise<AttendeeRow[]>;
  /** Every attendee, ordered by id, keyset on id (operator listing; decrypts on the SQL backend). */
  list(opts: { after?: string; limit: number }): Promise<AttendeeRow[]>;
  /** Case-insensitive substring search on name and email (bounded decrypt-and-filter on SQL), optionally within candidates. */
  search(q: string, opts: { attendeeIds?: readonly string[]; limit: number }): Promise<AttendeeRow[]>;
}

export interface InvitationRow {
  id: string;
  event_id: string;
  /** Email blind index (64 hex). The address itself is never stored with the invitation. */
  email_hash: string;
  /** base64url SHA-256 of the invite token (43 chars). */
  token_hash: string;
  state: InvitationState;
  expires_at: Date;
  redeemed_at: Date | null;
  created_at: Date;
}
export interface InvitationsRepo {
  /** The blind index the store uses for `email_hash` (SQL: @synan/db emailBlindIndex; memory: SHA-256 hex). */
  hashEmail(email: string): string;
  /** Every hash the store would accept for this address (blind-index rotation). */
  hashCandidates(email: string): string[];
  /** `duplicate` when an open (`sent`) invitation already exists for this recipient and event. */
  insert(row: InvitationRow): Promise<"ok" | "duplicate">;
  byTokenHash(tokenHash: string): Promise<InvitationRow | null>;
  /** Atomically `sent` → `redeemed` (stamping redeemed_at) or → `revoked`, only while unexpired at `now`. */
  consume(id: string, outcome: "redeemed" | "revoked", now: Date): Promise<boolean>;
  forEvent(eventId: string): Promise<InvitationRow[]>;
}
export interface VenuesRepo {
  zonesOfVenue(venueId: string): Promise<ZoneRow[]>;
  room(id: string): Promise<RoomRow | null>;
  roomsByIds(ids: readonly string[]): Promise<RoomRow[]>;
  checkpoint(id: string): Promise<CheckpointRow | null>;
  checkpointsOfVenue(venueId: string): Promise<CheckpointRow[]>;
  venue(id: string): Promise<VenueRow | null>;
  transitTimes(venueId: string): Promise<TransitTimeRow[]>;
  /** Single organisation in v1 (O-01). */
  organizations(): Promise<{ id: string; name: string; timezone: string; support_email: string }[]>;
  /** Ordered by name then id; keyset on id. */
  listVenues(opts: { after?: string; limit: number }): Promise<VenueRow[]>;
  zone(id: string): Promise<ZoneRow | null>;
  roomsOfVenue(venueId: string): Promise<RoomRow[]>;
  /** Name, address, timezone, city, capacity_default (floors and the layout version change through zones, rooms and publishLayout). */
  updateVenue(id: string, patch: Partial<Pick<VenueRow, "name" | "address" | "timezone" | "city" | "capacity_default">>): Promise<VenueRow>;
  updateZone(id: string, patch: Partial<Omit<ZoneRow, "id" | "venue_id">>): Promise<ZoneRow>;
  updateRoom(id: string, patch: Partial<Omit<RoomRow, "id" | "venue_id">>): Promise<RoomRow>;
  updateCheckpoint(id: string, patch: Partial<Omit<CheckpointRow, "id" | "venue_id">>): Promise<CheckpointRow>;
  /**
   * The whole layout in one step if `expectedVersion` is still current (SQL: @synan/db
   * publishVenueLayout / venue_layout_publish; memory: a mirror). Statuses as there.
   */
  publishLayout(i: {
    venueId: string; expectedVersion: number; floors: string[]; zones: LayoutZoneRow[]; rooms: LayoutRoomRow[]; now: Date;
  }): Promise<PublishLayoutOutcome>;
}
export interface LayoutZoneRow { id: string; name: string; floor: string | null; geometry: GridShapeRow | null }
export interface LayoutRoomRow {
  id: string; zone_id: string; name: string; capacity: number; warn_at_pct: number; block_at_pct: number;
  capacity_policy: CapacityPolicy; continuous: boolean; geometry: GridShapeRow | null;
}
export interface PublishLayoutOutcome {
  status: "ok" | "version_conflict" | "foreign_id" | "blocked";
  layout_version: number;
  zones_added: number;
  zones_removed: number;
  rooms_added: number;
  rooms_removed: number;
  blocking: { kind: "zone" | "room"; id: string; reason: "in_use" | "has_checkpoints" | "doors_in_other_zone" }[];
}
export interface EventsRepo {
  /** Published or live, listed, ordered by starts_at, keyset-paginated on (starts_at, id). */
  listPublic(opts: { state?: "published" | "live"; q?: string; after?: { starts_at: Date; id: string }; limit: number }): Promise<EventRow[]>;
  bySlug(slug: string): Promise<EventRow | null>;
  byId(id: string): Promise<EventRow | null>;
  rooms(eventId: string): Promise<EventRoomRow[]>;
  sessions(eventId: string): Promise<SessionRow[]>;
  accessRules(eventId: string): Promise<AccessRuleRow[]>;
  /**
   * Every event (operators), optionally by state; ordered by starts_at, id; keyset on (starts_at, id).
   * Events without dates (drafts) sort last, among themselves by id.
   */
  listAll(opts: { state?: EventState; q?: string; after?: { starts_at: Date; id: string }; limit: number }): Promise<EventRow[]>;
  /** Every event, drafts included, most recently changed first; keyset on (updated_at, id) descending. */
  listAdmin(opts: { state?: EventState; q?: string; venueId?: string; after?: { updated_at: Date; id: string }; limit: number }): Promise<EventRow[]>;
  update(id: string, patch: Partial<Omit<EventRow, "id" | "org_id" | "venue_id" | "created_at" | "updated_at">>): Promise<EventRow>;
  /** A draft's venue: its rooms go, and with them their sessions and access rules (as the database cascades). */
  setVenue(eventId: string, venueId: string): Promise<EventRow>;
  /** Replace the event's rooms (draft or published only; the caller checks). Removed rooms take their sessions and rules. */
  setRooms(eventId: string, rooms: EventRoomRow[]): Promise<void>;
  /**
   * Atomically replace the rule set if the stored version equals `expectedVersion`, recording who
   * published the new version and when. Returns the new version, or null when another republish won.
   */
  replaceAccessRules(eventId: string, expectedVersion: number, rules: AccessRuleRow[], by?: { actorId: string | null; now: Date }): Promise<number | null>;
  /** When and by whom a stored access-rule version was published; null when it was never recorded. */
  accessRuleVersion(eventId: string, version: number): Promise<{ published_at: Date; published_by: string | null } | null>;
  /** A draft copy (SQL: @synan/db duplicateEvent, which audits `event.duplicate`; memory: a mirror). */
  duplicate(i: { eventId: string; slug: string; title: string; startsAt: Date | null; actorId: string | null; now: Date }): Promise<string>;
  /** SQL: @synan/db deleteDraftEvent. The caller audits. */
  deleteDraft(eventId: string): Promise<"deleted" | "not_found" | "not_draft" | "has_registrations" | "has_history">;
  insertSession(row: SessionRow): Promise<void>;
  updateSession(id: string, patch: Partial<Pick<SessionRow, "room_id" | "title" | "starts_at" | "ends_at">>): Promise<SessionRow>;
  deleteSession(id: string): Promise<boolean>;
  /**
   * The offline allowlist (01 §8) in the contract's flat shape, read in one snapshot: every credential
   * of the event with its effective state and band hashes, and the rooms (behind `checkpointIds`, or
   * all event rooms) its subject may enter at some time in [from, to). No identity. SQL: /db
   * allowlistEntries.
   */
  allowlist(eventId: string, q: { from: Date; to: Date; checkpointId: string | null }): Promise<AllowlistData>;
}
export interface RegistrationsRepo {
  byId(id: string): Promise<RegistrationRow | null>;
  forAttendee(attendeeId: string): Promise<RegistrationRow[]>;
  forEvent(eventId: string): Promise<RegistrationRow[]>;
  /** Set checked_in_at if it is still null (first admission only). */
  markCheckedIn(id: string, at: Date): Promise<void>;
  /** `duplicate` when the attendee is already registered for the event (registrations_event_attendee_uq). */
  insert(row: RegistrationRow & { invitation_id?: string | null }): Promise<"ok" | "duplicate">;
  /** Tier and state changes. Bumps the event's revocation epoch like the database trigger does. */
  update(id: string, patch: Partial<Pick<RegistrationRow, "tier" | "state">>): Promise<RegistrationRow>;
  /** Registration counts per attendee (cancelled excluded). */
  countByAttendee(attendeeIds: readonly string[]): Promise<Map<string, number>>;
  /** Per event: registrations not cancelled, and how many of them checked in. */
  countByEvent(eventIds: readonly string[]): Promise<Map<string, { registered: number; checked_in: number }>>;
}
export interface StaffRepo {
  assignmentsFor(userId: string): Promise<StaffAssignmentRow[]>;
  byId(id: string): Promise<StaffAssignmentRow | null>;
  /** Ordered by shift_start then id; keyset on id is not stable here, so the cursor is an offset. */
  list(opts: { checkpointId?: string; userId?: string; eventId?: string; offset: number; limit: number }): Promise<StaffAssignmentRow[]>;
  /** `overlap` when the person already has an assignment overlapping this window (staff_assignments_no_overlap). */
  insert(row: StaffAssignmentRow & { created_by: string | null }): Promise<"ok" | "overlap">;
  markHandedOver(id: string, at: Date): Promise<void>;
  /**
   * Ends a shift once: stamps handed_over_at, audits `staff.handover` (the summary, no ids) and
   * returns the summary (SQL: @synan/db handOverShift). `already_handed_over` the second time.
   */
  handOver(id: string, i: { actorId: string | null; now: Date }): Promise<HandoverRow | "already_handed_over" | null>;
  /** The handover summary at any time (SQL: shiftHandoverSummary). */
  handoverSummary(id: string): Promise<HandoverRow | null>;
}
export interface CredentialsRepo {
  byId(id: string): Promise<CredentialRow | null>;
  byTokenHash(hash: string): Promise<CredentialRow | null>;
  forRegistration(registrationId: string): Promise<CredentialRow | null>;
  insert(row: CredentialRow): Promise<void>;
  update(id: string, patch: Partial<Pick<CredentialRow, "state" | "zone_state" | "revoked_at">>): Promise<CredentialRow>;
  /** Ordered by id, keyset on id. `registrationIds` scopes to those registrations (empty = nothing). */
  page(opts: { registrationIds?: readonly string[]; state?: CredentialState; after?: string; limit: number }): Promise<CredentialRow[]>;
  /** Every credential (any state) of these registrations. */
  forRegistrations(registrationIds: readonly string[]): Promise<CredentialRow[]>;
}
export interface CarriersRepo {
  byIdentifier(kind: CarrierKind, identifier: string): Promise<CarrierRow | null>;
  byId(id: string): Promise<CarrierRow | null>;
  forCredential(credentialId: string): Promise<CarrierRow[]>;
  /** Every carrier of these credentials (any state). */
  forCredentials(credentialIds: readonly string[]): Promise<CarrierRow[]>;
  insert(row: CarrierRow): Promise<void>;
  update(id: string, patch: Partial<Pick<CarrierRow, "state" | "redeemed_at" | "bound_at" | "credential_id">>): Promise<CarrierRow>;
  /** Atomically set redeemed_at if still null. Returns false if it was already redeemed. */
  redeemOnce(id: string, at: Date): Promise<boolean>;

  /* ---- provisioning (01 §5.3). Each is one atomic step that also writes its audit entries (SQL: @synan/db 0012). ---- */

  /** Bulk import of NFC identifier hashes into `stock`. Duplicates (in the list or already present) are reported, never fatal. */
  importStock(hashes: readonly string[], chipProfile: ChipProfile): Promise<{ inserted: number; duplicates: string[] }>;
  /** Desk binding of a stock band: stock → bound. Audit `carrier.bind`. */
  bind(i: { identifier: string; credentialId: string; actorId: string | null; now: Date }): Promise<{ status: BindStatus; carrier_id: string | null }>;
  /** Swap the credential's live band for a stock band; the old band → retired | lost. Audit `carrier.mark_<d>`, `carrier.rebind`. */
  rebind(i: { credentialId: string; newIdentifier: string; disposition: "retired" | "lost"; actorId: string | null; now: Date }): Promise<{ status: RebindStatus; old_carrier_id: string | null; new_carrier_id: string | null }>;
  /**
   * Lost band: band → lost, credential → replaced, a new credential (reference `newCredentialRef`) with
   * a portal carrier, the new band bound to it. Audit: carrier.mark_lost, credential.replace,
   * credential.reissue, carrier.bind.
   */
  replaceLost(i: { lostIdentifier: string; newIdentifier: string; newCredentialRef: string; actorId: string | null; now: Date }): Promise<ReplaceLostOutcome>;
  /** Counts of NFC carriers per state and per chip profile; with `credentialIds`, only carriers of those credentials. */
  inventory(credentialIds?: readonly string[]): Promise<{ by_state: Record<string, number>; by_chip_profile: Record<string, number> }>;
}

export type BindStatus = "bound" | "assigned" | "unknown_carrier" | "not_in_stock" | "credential_not_usable" | "credential_has_carrier";
export type RebindStatus = "rebound" | "no_current_carrier" | "unknown_carrier" | "not_in_stock" | "credential_not_usable";
export interface ReplaceLostOutcome {
  status: "replaced" | "unknown_carrier" | "carrier_not_live" | "not_in_stock" | "credential_not_usable";
  old_carrier_id: string | null;
  new_carrier_id: string | null;
  old_credential_id: string | null;
  new_credential_id: string | null;
}
export interface SigningKeysRepo {
  all(): Promise<SigningKeyRow[]>;
  insert(row: SigningKeyRow): Promise<void>;
  retire(id: string, at: Date): Promise<void>;
}
export interface EphemeralIdsRepo {
  /** Returns the event-scoped ephemeral id for a credential, creating it on first use. */
  getOrCreate(eventId: string, credentialId: string): Promise<string>;
  /** Read-only lookup; null when the credential has no scans at this event. */
  find(eventId: string, credentialId: string): Promise<string | null>;
}
export interface ScansRepo {
  byIdemKey(eventId: string, idemKey: string): Promise<ScanRow | null>;
  insert(row: ScanRow): Promise<void>;
  /** All scans for an event, ordered by corrected time (occurred_at + clock_offset_ms). Used to rebuild projections. */
  forEvent(eventId: string): Promise<ScanRow[]>;
  page(eventId: string, opts: { checkpointId?: string; result?: ScanResult; ephemeralId?: string; limit: number; before?: string }): Promise<ScanRow[]>;
  /** Scans recorded at a checkpoint by one staff user with corrected time in [from, to): counts by result, and how many were offline. */
  shiftCounts(q: { checkpointId: string; staffUserId: string; from: Date; to: Date }): Promise<{ byResult: Record<string, number>; offline: number }>;
}
export interface OccupancyRepo {
  insertAdjustment(row: OccupancyAdjustmentRow): Promise<void>;
  adjustments(eventId: string): Promise<OccupancyAdjustmentRow[]>;
}
export interface AlertsRepo {
  insert(row: BreachAlertRow): Promise<void>;
  byId(id: string): Promise<BreachAlertRow | null>;
  update(id: string, patch: Partial<BreachAlertRow>): Promise<BreachAlertRow>;
  /** `checkpointIds` scopes the list (an empty array returns nothing); the limit applies after scoping. */
  list(opts: { eventId?: string; state?: AlertState; severity?: Severity; checkpointIds?: readonly string[]; limit: number }): Promise<BreachAlertRow[]>;
  /**
   * Retention (03 §6, D-03): delete alerts that occurred more than `olderThanMonths` (≥ 12, else it
   * throws) months before `now`, with their finished webhook deliveries (an alert whose delivery is
   * still pending waits for the next run), and write one `retention.alerts_pruned` audit entry when
   * anything went. Returns how many alerts were deleted. SQL: @synan/db alertsPrune.
   */
  prune(i: { olderThanMonths: number; now: Date }): Promise<number>;
}
export interface AuditRepo {
  /** Append to the hash chain. The store assigns id, prev_hash and hash atomically. */
  append(entry: Pick<AuditRow, "actor_id" | "action" | "target" | "meta_jsonb" | "at">): Promise<AuditRow>;
  all(): Promise<AuditRow[]>;
  /** Index of the first broken entry, or -1 when the chain is intact. */
  verify(): Promise<number>;
  /**
   * Retention (03 §6, D-03): delete the oldest contiguous run of entries older than 12 months and
   * keep the rest verifiable (the store records the hash the pruned run ended on). Returns how many
   * were deleted. SQL: @synan/db auditPrune — the database's clock decides (entries carry database
   * time); memory: `now`.
   */
  prune(now: Date): Promise<number>;
}

/** Writes reference data (venues, events, rules, assignments). Used by the dev seed and tests only. */
export interface FixtureWriter {
  organization(row: { id: string; name: string; timezone: string; support_email: string }): Promise<void>;
  venue(row: VenueRow): Promise<void>;
  zone(row: ZoneRow): Promise<void>;
  room(row: RoomRow): Promise<void>;
  checkpoint(row: CheckpointRow): Promise<void>;
  transitTime(row: TransitTimeRow): Promise<void>;
  event(row: EventRow): Promise<void>;
  eventRoom(row: EventRoomRow): Promise<void>;
  session(row: SessionRow): Promise<void>;
  registration(row: RegistrationRow): Promise<void>;
  accessRule(row: AccessRuleRow): Promise<void>;
  staffAssignment(row: StaffAssignmentRow): Promise<void>;
}
export interface RollupsRepo {
  /** Upsert-increment one per-gate, per-minute row (D-16). */
  /** `admitted` counts let-through scans (admitted and already_inside); `result` feeds by_result_jsonb. */
  incrementGateRate(key: { event_id: string; checkpoint_id: string; minute_start: Date }, inc: { admitted: number; denied: number; tier: string; result: string }): Promise<void>;
  gateRates(eventId: string): Promise<GateRateRollupRow[]>;
}
/**
 * Sign-in state. Same semantics on both backends (the SQL one is @synan/db's atomic functions):
 * every secret arrives already hashed; every call takes `now` so a manual clock works.
 */
export interface AuthRepo {
  /** Login, email-link sign-in, MFA step-up: a new refresh-token family. */
  startSession(i: StartSessionInput): Promise<void>;
  /**
   * Exchange a refresh token. Presenting an already-exchanged token is reuse: the whole family is
   * revoked and `reuse_detected` returned. Creates the new row itself.
   */
  rotateSession(i: { tokenHash: string; newTokenHash: string; ttl: RefreshTtl; now: Date }): Promise<RotateResult>;
  revokeFamily(familyId: string, reason: AuthRevokeReason, now: Date): Promise<number>;
  createLink(i: { tokenHash: string; attendeeId: string; expiresAt: Date; now: Date }): Promise<void>;
  /** Single use, even under concurrency. Only `redeemed` grants anything. */
  redeemLink(tokenHash: string, now: Date): Promise<RedeemLinkResult>;
  mintTicket(i: MintTicketInput): Promise<void>;
  /** Consumed on first presentation, valid or not. `revoked` when its session family is no longer live. */
  consumeTicket(ticketHash: string, now: Date): Promise<ConsumeTicketResult>;
  /** Delete expired state (scheduled). */
  cleanup(now: Date): Promise<{ sessions: number; links: number; tickets: number }>;
}

/**
 * One-time desk codes for attendee self-binding (01 §5.3). Stored only as hashes.
 */
export interface DeskCodesRepo {
  /** A code (10 min) for a stock band; stored only as a keyed digest. Any earlier code for the band stops working. */
  create(i: { bandIdentifier: string; createdBy: string | null; now: Date }): Promise<{ status: "created" | "unknown_carrier" | "not_in_stock"; code: string | null; expires_at: Date | null }>;
  /** Single use; wrong codes count against the attendee (5 per 10 minutes). */
  consume(i: { code: string; attendeeId: string; now: Date }): Promise<{ status: "consumed" | "too_many_attempts" | "invalid" | "expired" | "already_used"; carrier_identifier: string | null }>;
}

/**
 * Staff activation tokens (stored hashed; SQL: user_invites).
 */
export interface UserInvitesRepo {
  /** A 72-hour single-use activation token; older open invites for the user are revoked. */
  create(i: { userId: string; createdBy: string | null; now: Date }): Promise<string>;
  /** The user id if the token is known, unused, unrevoked and unexpired. */
  consume(token: string, now: Date): Promise<string | null>;
}

export interface Repos {
  users: UsersRepo;
  attendees: AttendeesRepo;
  venues: VenuesRepo;
  events: EventsRepo;
  registrations: RegistrationsRepo;
  staff: StaffRepo;
  credentials: CredentialsRepo;
  carriers: CarriersRepo;
  signingKeys: SigningKeysRepo;
  ephemeralIds: EphemeralIdsRepo;
  scans: ScansRepo;
  occupancy: OccupancyRepo;
  alerts: AlertsRepo;
  audit: AuditRepo;
  rollups: RollupsRepo;
  auth: AuthRepo;
  invitations: InvitationsRepo;
  deskCodes: DeskCodesRepo;
  userInvites: UserInvitesRepo;
  webhooks: WebhooksRepo;
  webhookDeliveries: WebhookDeliveriesRepo;
  devices: DevicesRepo;
  reports: ReportsRepo;
  reportSchedules: ReportSchedulesRepo;
  emailOutbox: EmailOutboxRepo;
  notifications: NotificationsRepo;
  exportedFiles: ExportedFilesRepo;
  /** Run `fn` as one unit of work (see TxScope). Nested calls join the outer unit. */
  transaction<T>(fn: (scope: TxScope) => Promise<T>): Promise<T>;
  dataRequests: DataRequestsRepo;
  maintenance: MaintenanceRepo;
  fixtures: FixtureWriter;
  /** Which implementation this is, for logs and tests. */
  kind: "memory" | "drizzle";
  close?(): Promise<void>;
}

export interface AllowlistData {
  revocation_epoch: number;
  access_rules_version: number;
  entries: {
    credential_hash: string;
    nfc_hashes: string[];
    tier: AttendeeTier | null;
    permitted_room_ids: string[];
    revoked: boolean;
    state: CredentialState;
    dead_nfc_hashes: string[];
    qr_email_spent: boolean;
    /** Carrier hashes of the emailed codes still usable (0027). */
    qr_email_hashes: string[];
  }[];
}

export interface WebhookEndpointRow {
  id: string;
  org_id: string;
  url: string;
  /** HMAC secret, in the clear at this boundary (the SQL repository encrypts it). */
  secret: string;
  events: string[];
  active: boolean;
  created_at: Date;
}
export interface WebhooksRepo {
  list(): Promise<WebhookEndpointRow[]>;
  byId(id: string): Promise<WebhookEndpointRow | null>;
  insert(row: WebhookEndpointRow): Promise<void>;
  update(id: string, patch: Partial<Pick<WebhookEndpointRow, "url" | "events" | "active" | "secret">>): Promise<WebhookEndpointRow>;
  delete(id: string): Promise<void>;
}
export interface WebhookDeliveryRow {
  id: string;
  endpoint_id: string;
  event: string;
  state: "pending" | "in_flight" | "succeeded" | "dead";
  /** Attempts made so far. */
  attempt: number;
  response_code: number | null;
  last_error: string | null;
  next_attempt_at: Date;
  created_at: Date;
  delivered_at: Date | null;
}
export interface ClaimedDeliveryRow {
  delivery_id: string;
  endpoint_id: string;
  url: string;
  /** Decrypted signing secret. */
  secret: string;
  event: string;
  payload: Record<string, unknown>;
  /** Attempts made before this one. */
  attempt: number;
}
/** Backoff after n failed attempts: 30 s × 2^(n−1), capped at 1 h; dead after 8 (@synan/db webhook_record_attempt). */
export const WEBHOOK_MAX_ATTEMPTS = 8;
export const webhookBackoffMs = (n: number) => Math.min(3_600_000, 30_000 * 2 ** (n - 1));
/** SQL: @synan/db enqueueWebhookEvent / claimWebhookDeliveries / recordWebhookAttempt / listWebhookDeliveries. */
export interface WebhookDeliveriesRepo {
  /** One delivery per active endpoint of the organisation subscribed to the event. */
  enqueue(i: { orgId: string; event: string; payload: Record<string, unknown>; alertId: string | null; now: Date }): Promise<number>;
  /** Leases due deliveries so concurrent workers never send one twice. */
  claim(now: Date, limit: number): Promise<ClaimedDeliveryRow[]>;
  record(i: { deliveryId: string; ok: boolean; responseCode: number | null; error: string | null; now: Date }): Promise<{ state: "pending" | "succeeded" | "dead" }>;
  forEndpoint(endpointId: string, opts: { offset: number; limit: number }): Promise<WebhookDeliveryRow[]>;
}

export interface DeviceRow {
  id: string;
  venue_id: string;
  kind: "scanner" | "fixed_reader" | "kiosk";
  label: string;
  hardware_id: string;
  checkpoint_id: string | null;
  state: "active" | "maintenance" | "retired" | "lost";
  last_heartbeat_at: Date | null;
  last_clock_offset_ms: number | null;
  last_queue_depth: number | null;
  created_at: Date;
  /** Goes up on every token rotation; access tokens carry it, so a rotation ends them. */
  token_version: number;
}
/** Gate devices (O-17). SQL: @synan/db registerDevice / rotateDeviceToken / authenticateDevice / recordHeartbeat. */
export interface DevicesRepo {
  /** Returns the device token once (fixed readers and kiosks); only its hash is stored. `duplicate` on a hardware id in use. */
  register(i: { venueId: string; kind: DeviceRow["kind"]; label: string; hardwareId: string; checkpointId: string | null }): Promise<{ id: string; token: string | null } | "duplicate">;
  byId(id: string): Promise<DeviceRow | null>;
  list(venueId?: string): Promise<DeviceRow[]>;
  rotateToken(id: string): Promise<string>;
  retire(id: string, at: Date): Promise<void>;
  /** The active device holding this token, or null. */
  authenticate(token: string): Promise<DeviceRow | null>;
  /** Also stamps the checkpoint's gate-health fields (`checkpointId`, else the device's own). */
  heartbeat(i: { deviceId: string; checkpointId?: string | null; clockOffsetMs: number; queueDepth: number; appVersion: string | null; now: Date }): Promise<"ok" | "unknown_device" | "not_active">;
  /**
   * The device row of a staff phone running the Gate Scanner (kind `scanner`, no device token),
   * found by its hardware id or created, and moved to `checkpointId` (its current assignment).
   */
  ensureScanner(i: { venueId: string; hardwareId: string; label: string; checkpointId: string }): Promise<string>;
  /** Gate health for a venue, faults first (SQL: @synan/db gateHealth). */
  gateHealth(venueId: string, opts: { eventId: string | null; now: Date }): Promise<GateHealthDbRow[]>;
}

export type ReportCell = string | number | null;
export interface ReportPageData {
  section: string;
  columns: string[];
  rows: ReportCell[][];
  next_cursor: string | null;
  total: number;
}
export interface ReportRow {
  id: string;
  event_id: string;
  /** Null for the whole-event workbook and the PDF summary. */
  kind: ReportKind | null;
  format: "xlsx" | "csv" | "pdf";
  /** The workbook carries the attendee sheet with name and email. */
  include_identity: boolean;
  state: ReportState;
  object_key: string | null;
  requested_by: string | null;
  params: Record<string, unknown>;
  error: string | null;
  created_at: Date;
  completed_at: Date | null;
}
/**
 * Reports (01 §10) read aggregates only, so they are identical before and after the purge.
 * SQL: @synan/db runReport, rebuildEventRollups, purgeEventMovementData, requestReport / claimReport /
 * completeReport / failReport / listReports. Memory: the same sections from in-memory aggregates.
 */
export interface ReportsRepo {
  /** One page of one section. Throws `Error("invalid report cursor")` for a bad cursor. */
  run(kind: ReportKind, eventId: string, opts: { section?: string; cursor?: string | null; limit: number }): Promise<ReportPageData>;
  /** Recompute the event's rollups from its scans (scheduled during live events; run by the purge). */
  rebuildRollups(eventId: string): Promise<void>;
  /** Post-event purge: rollups rebuilt, then scans and the ephemeral-ID mapping destroyed. */
  purge(eventId: string, actorId: string | null): Promise<void>;
  /** `requestedBy` is null for a scheduled run whose creator has gone. */
  request(i: { eventId: string; kind: ReportKind | null; format: "xlsx" | "csv" | "pdf"; includeIdentity: boolean; requestedBy: string | null; params: Record<string, unknown> }): Promise<string>;
  claim(now: Date): Promise<ReportRow | null>;
  complete(id: string, objectKey: string, now: Date): Promise<boolean>;
  fail(id: string, error: string, now: Date): Promise<boolean>;
  list(opts: { eventId?: string; offset: number; limit: number }): Promise<ReportRow[]>;
  /** On site per 5-minute bucket: the sum of room peaks in that bucket (occupancy_rollups). */
  occupancyCurve(eventId: string): Promise<{ at: Date; on_site: number }[]>;
  /** When the event's movement data was purged, or null. */
  purgedAt(eventId: string): Promise<Date | null>;
  /** The post-event summary (SQL: @synan/db postEventSummary; frozen by the purge). Null when no such event. */
  postEventSummary(eventId: string, now: Date): Promise<DbPostEventSummary | null>;
  /** The event workbook sheets, read in one snapshot, inside `consume` (SQL: @synan/db withWorkbookData). */
  workbook<T>(eventId: string, opts: { includeIdentity: boolean; now: Date }, consume: (wb: WorkbookData) => Promise<T>): Promise<T>;
}
export type ReportCadenceT = "on_close" | "daily" | "weekly" | "monthly";
export interface ReportScheduleRow {
  id: string;
  event_id: string;
  format: "xlsx" | "csv" | "pdf";
  kind: ReportKind | null;
  include_identity: boolean;
  /** In the clear at this boundary (the SQL store encrypts the list, bound to the row). */
  recipients: string[];
  cadence: ReportCadenceT;
  next_run_at: Date | null;
  last_run_at: Date | null;
  state: "active" | "paused" | "done" | "failed";
  failures: number;
  last_error: string | null;
  created_by: string | null;
  created_at: Date;
}
/**
 * Scheduled reports (01 §10). SQL: @synan/db createReportSchedule, listReportSchedules,
 * setReportScheduleState, deleteReportSchedule, claimDueReportSchedules, finishReportSchedule.
 */
export interface ReportSchedulesRepo {
  /** `firstRunAt` is required unless on_close. */
  create(i: { eventId: string; format: ReportScheduleRow["format"]; kind: ReportKind | null; includeIdentity: boolean; recipients: readonly string[]; cadence: ReportCadenceT; firstRunAt: Date | null; createdBy: string | null; now: Date }): Promise<string>;
  /** Newest first. */
  list(eventId: string): Promise<ReportScheduleRow[]>;
  /** Pause or resume (resuming resets failures, also from `failed`). False when done or missing. */
  setState(id: string, state: "active" | "paused", now: Date): Promise<boolean>;
  delete(id: string): Promise<boolean>;
  /**
   * Leases due schedules (a lease of `leaseMinutes`; concurrent workers never claim the same one):
   * active with next_run_at ≤ now, or on_close not yet run whose event closed at or before now.
   */
  claimDue(now: Date, opts: { limit: number; leaseMinutes: number }): Promise<ReportScheduleRow[]>;
  /** Success advances next_run_at past now (missed periods skipped; on_close → done); three failures in a row → failed. */
  finish(id: string, i: { ok: boolean; error: string | null; now: Date }): Promise<{ state: ReportScheduleRow["state"]; next_run_at: Date | null }>;
}

/** Content of an outbox email (encrypted at rest with its recipient on the SQL backend). */
export interface EmailContent {
  subject: string;
  text: string;
}
export interface ClaimedEmail {
  id: string;
  template: string;
  to: string;
  content: EmailContent;
  /** Including this one. */
  attempts: number;
}
/**
 * The email outbox. SQL: @synan/db enqueueEmail / claimEmail / finishEmail; `due` reads
 * email_outbox ids directly (no personal data). Claims are atomic: a duplicate job never sends twice.
 */
export interface EmailOutboxRepo {
  enqueue(i: { template: string; to: string; content: EmailContent; now: Date }): Promise<string>;
  /**
   * queued, failed with attempts left, or `sending` under a claim older than the lease (its worker
   * died) → sending (attempts + 1, claimed now); null otherwise. Lease default: @synan/db
   * EMAIL_CLAIM_LEASE_SECONDS (120 s).
   */
  claim(id: string, opts: { maxAttempts: number; now: Date; leaseSeconds?: number }): Promise<ClaimedEmail | null>;
  /**
   * sending → sent | failed. Null when the email was not being sent — or, with `attempt`, when it has
   * been reclaimed since that attempt (a slow worker must not overwrite the reclaimer's outcome).
   */
  finish(id: string, i: { ok: boolean; error: string | null; now: Date; attempt?: number }): Promise<"sent" | "failed" | null>;
  /** Ids that a claim would take now (queued, failed with attempts left, `sending` past its lease), oldest first. */
  due(opts: { maxAttempts: number; limit: number; now: Date; leaseSeconds?: number }): Promise<string[]>;
  /** Counts by state ("dead" = failed with no attempts left), for tests and health. */
  stats(maxAttempts: number): Promise<{ queued: number; sending: number; sent: number; failed: number; dead: number }>;
}

export type NotificationKindT = "pass" | "session" | "capacity" | "event" | "security";
export interface NotificationRow {
  id: string;
  kind: NotificationKindT;
  at: Date;
  title: string;
  body: string;
  read: boolean;
}
/**
 * Attendee notifications. SQL: @synan/db notifyAttendee, broadcastNotification, listNotifications,
 * markNotificationsRead. Text is generic: never a location, movement, or another person.
 */
export interface NotificationsRepo {
  /** Personal (lives 30 days). */
  notify(i: { attendeeId: string; kind: NotificationKindT; title: string; body: string; eventId: string | null; now: Date }): Promise<string>;
  /** To the event's confirmed registrations (optionally one tier); lives until 7 days after the event ends. */
  broadcast(i: { eventId: string; tier: AttendeeTier | null; kind: NotificationKindT; title: string; body: string; now: Date }): Promise<string>;
  /** Personal and broadcast, newest first, unexpired at `now`. */
  list(attendeeId: string, opts: { now: Date; limit: number }): Promise<NotificationRow[]>;
  /** Marks those visible to the attendee; returns how many were newly marked. */
  markRead(attendeeId: string, ids: readonly string[], now: Date): Promise<number>;
}

/** @synan/db gate_health, one row per checkpoint of the venue (faults first). */
export interface GateHealthDbRow {
  checkpoint_id: string;
  label: string;
  perimeter: boolean;
  /** unknown: never heard from; offline: no heartbeat for 60 s. */
  link_state: "online" | "offline" | "unknown";
  last_heartbeat_at: Date | null;
  heartbeat_age_s: number | null;
  clock_offset_ms: number | null;
  /** |offset| > 2 minutes (D-14). */
  clock_fault: boolean;
  /** Largest unsynced queue reported by an active device at the checkpoint; null when none reported. */
  queue_depth: number | null;
  last_scan_at: Date | null;
  scans_last_15m: number;
  staff_on_duty: number;
  /** The checkpoint's grid position; null when not placed. */
  position?: GridPointRow | null;
}
/** @synan/db shift_handover_summary. */
export interface HandoverRow {
  assignment_id: string;
  checkpoint_id: string;
  user_id: string;
  period_start: Date;
  period_end: Date;
  scans: number;
  /** admitted + already_inside */
  let_through: number;
  refused: number;
  duplicates: number;
  /** Decided on the device while offline. */
  offline: number;
  /** Received after the period ended (still queued on the device at handover). */
  late_synced: number;
  by_result: Record<string, number>;
  first_scan_at: Date | null;
  last_scan_at: Date | null;
}

export interface ExportedFileRow {
  id: string;
  report_id: string | null;
  data_request_id: string | null;
  object_key: string;
  content_type: string;
  size_bytes: number | null;
  contains_identity: boolean;
  /** The data key that wrapped the file's own key. */
  key_id: string | null;
  created_at: Date;
  expires_at: Date;
  deleted_at: Date | null;
}
/**
 * The register of exported files (retention, 03 §6). SQL: @synan/db recordExportedFile,
 * exportedFilesDue, markExportedFilesDeleted, listExportedFiles, cleanupDelivery. Recording a file
 * that contains identity, and marking any file deleted, write audit entries (export.create,
 * export.delete) in the same step.
 */
export interface ExportedFilesRepo {
  record(i: {
    reportId: string | null; dataRequestId: string | null; objectKey: string; contentType: string; sizeBytes: number | null;
    containsIdentity: boolean; keyId: string | null; retentionDays: number; actorId: string | null; now: Date;
  }): Promise<string>;
  /** Not deleted and past expiry at `now`, oldest expiry first. */
  due(now: Date, limit: number): Promise<ExportedFileRow[]>;
  /** After their objects were removed. Returns how many were newly marked. */
  markDeleted(ids: readonly string[], i: { actorId: string | null; now: Date }): Promise<number>;
  list(q: { reportId?: string; dataRequestId?: string }): Promise<ExportedFileRow[]>;
  /** Sent/failed email after 7 days, expired notifications, finished schedules after 30 days. */
  cleanupDelivery(now: Date): Promise<{ emails: number; notifications: number; schedules: number }>;
}

/**
 * A unit of work: `repos` write inside one transaction on the operational connection (SQL); on the
 * memory backend outbox rows are only stored once `fn` succeeds. `handle` is the Drizzle
 * transaction (pg-boss enqueueInTransaction), null in memory. `afterCommit` runs after commit.
 */
export interface TxScope {
  repos: Repos;
  handle: unknown;
  afterCommit(fn: () => void): void;
}

export const REPORT_SECTION_NAMES = {
  attendance: ["by_tier", "arrivals"],
  dwell_flow: ["flow", "dwell"],
  peak_occupancy: ["peaks"],
  breach_compliance: ["alerts"],
  gate_throughput: ["throughput"],
} as const satisfies Record<ReportKind, readonly string[]>;

export interface DataRequestRowT {
  id: string;
  attendee_id: string;
  kind: "export" | "erasure";
  state: "requested" | "in_progress" | "completed" | "rejected";
  requested_at: Date;
  completed_at: Date | null;
  handled_by: string | null;
  object_key: string | null;
  note: string | null;
}
/** Data-subject requests (03 §5). SQL: @synan/db data_requests functions. */
export interface DataRequestsRepo {
  /** Opens one (or returns the open one of that kind). */
  open(attendeeId: string, kind: "export" | "erasure", now: Date): Promise<{ status: "opened" | "already_open"; request_id: string }>;
  /** Claims the oldest waiting export for processing. */
  claimExport(now: Date): Promise<DataRequestRowT | null>;
  byId(id: string): Promise<DataRequestRowT | null>;
  finish(id: string, i: { state: "completed" | "rejected"; objectKey?: string | null; note?: string | null; actorId: string | null; now: Date }): Promise<"completed" | "rejected" | "not_open">;
  list(q: { state?: DataRequestRowT["state"]; kind?: DataRequestRowT["kind"]; offset: number; limit: number }): Promise<DataRequestRowT[]>;
  forAttendee(attendeeId: string): Promise<DataRequestRowT[]>;
  /** Everything held about the attendee: identity, registrations, credential states. */
  collectExport(attendeeId: string): Promise<Record<string, unknown>>;
  /** Scrubs the identity (row kept), ends the attendee's sessions, completes the request. */
  erase(request: DataRequestRowT, actorId: string | null, now: Date): Promise<void>;
}

/** Scheduled maintenance (slice 11). SQL: @synan/db eventsDueForPurge, applySessionResets, expireInvitations. */
export interface MaintenanceRepo {
  /** Closed, unpurged events whose grace period has run out at `now`. */
  eventsDueForPurge(now: Date): Promise<string[]>;
  /** Session-end resets (D-10) for sessions ended by `now` in non-continuous rooms; returns how many were applied. */
  applySessionResets(eventId: string, now: Date): Promise<number>;
  /** Mark invitations past their expiry; returns how many. */
  expireInvitations(now: Date): Promise<number>;
}
