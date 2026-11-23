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
  Role,
  ScanResult,
  Severity,
  SigningKeyPurpose,
} from "@synan/contracts/enums";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: Role;
  mfa_enrolled_at: Date | null;
  /** PROPOSED: base32 TOTP secret (encrypted at rest in the real store). */
  mfa_secret: string | null;
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
  /** PROPOSED column `venues.city` (not in @connexia/db yet; the Drizzle repo returns null). */
  city: string | null;
}
export interface ZoneRow { id: string; venue_id: string; name: string; floor: string | null; geometry_jsonb: Record<string, unknown> | null }
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
  geometry_jsonb: Record<string, unknown> | null;
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
}
export interface TransitTimeRow { venue_id: string; from_checkpoint_id: string; to_checkpoint_id: string; min_seconds: number }

export interface EventRow {
  id: string;
  org_id: string;
  venue_id: string;
  slug: string;
  title: string;
  /** PROPOSED: public description shown on the event page. */
  description: string | null;
  starts_at: Date;
  ends_at: Date;
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
}
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
export interface StaffAssignmentRow { id: string; user_id: string; checkpoint_id: string; shift_start: Date; shift_end: Date }

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
  updateVenue(id: string, patch: Partial<Omit<VenueRow, "id" | "org_id">>): Promise<VenueRow>;
  updateZone(id: string, patch: Partial<Omit<ZoneRow, "id" | "venue_id">>): Promise<ZoneRow>;
  updateRoom(id: string, patch: Partial<Omit<RoomRow, "id" | "venue_id">>): Promise<RoomRow>;
  updateCheckpoint(id: string, patch: Partial<Omit<CheckpointRow, "id" | "venue_id">>): Promise<CheckpointRow>;
}
export interface EventsRepo {
  /** Published or live, listed, ordered by starts_at, keyset-paginated on (starts_at, id). */
  listPublic(opts: { state?: "published" | "live"; q?: string; after?: { starts_at: Date; id: string }; limit: number }): Promise<EventRow[]>;
  bySlug(slug: string): Promise<EventRow | null>;
  byId(id: string): Promise<EventRow | null>;
  rooms(eventId: string): Promise<EventRoomRow[]>;
  sessions(eventId: string): Promise<SessionRow[]>;
  accessRules(eventId: string): Promise<AccessRuleRow[]>;
  /** Every event (operators), optionally by state; ordered by starts_at, id; keyset on (starts_at, id). */
  listAll(opts: { state?: EventState; q?: string; after?: { starts_at: Date; id: string }; limit: number }): Promise<EventRow[]>;
  update(id: string, patch: Partial<Omit<EventRow, "id" | "org_id" | "venue_id">>): Promise<EventRow>;
  /** Replace the event's rooms (draft or published only; the caller checks). */
  setRooms(eventId: string, rooms: EventRoomRow[]): Promise<void>;
  /**
   * Atomically replace the rule set if the stored version equals `expectedVersion`. Returns the new
   * version, or null when another republish won (optimistic concurrency).
   */
  replaceAccessRules(eventId: string, expectedVersion: number, rules: AccessRuleRow[]): Promise<number | null>;
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
}
export interface StaffRepo {
  assignmentsFor(userId: string): Promise<StaffAssignmentRow[]>;
}
export interface CredentialsRepo {
  byId(id: string): Promise<CredentialRow | null>;
  byTokenHash(hash: string): Promise<CredentialRow | null>;
  forRegistration(registrationId: string): Promise<CredentialRow | null>;
  insert(row: CredentialRow): Promise<void>;
  update(id: string, patch: Partial<Pick<CredentialRow, "state" | "zone_state" | "revoked_at">>): Promise<CredentialRow>;
}
export interface CarriersRepo {
  byIdentifier(kind: CarrierKind, identifier: string): Promise<CarrierRow | null>;
  forCredential(credentialId: string): Promise<CarrierRow[]>;
  insert(row: CarrierRow): Promise<void>;
  update(id: string, patch: Partial<Pick<CarrierRow, "state" | "redeemed_at" | "bound_at" | "credential_id">>): Promise<CarrierRow>;
  /** Atomically set redeemed_at if still null. Returns false if it was already redeemed. */
  redeemOnce(id: string, at: Date): Promise<boolean>;
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
}
export interface AuditRepo {
  /** Append to the hash chain. The store assigns id, prev_hash and hash atomically. */
  append(entry: Pick<AuditRow, "actor_id" | "action" | "target" | "meta_jsonb" | "at">): Promise<AuditRow>;
  all(): Promise<AuditRow[]>;
  /** Index of the first broken entry, or -1 when the chain is intact. */
  verify(): Promise<number>;
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
  incrementGateRate(key: { event_id: string; checkpoint_id: string; minute_start: Date }, inc: { admitted: number; denied: number; tier: string }): Promise<void>;
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
  fixtures: FixtureWriter;
  /** Which implementation this is, for logs and tests. */
  kind: "memory" | "drizzle";
  close?(): Promise<void>;
}
