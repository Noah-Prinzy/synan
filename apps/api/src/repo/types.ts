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
  /** Public JWK JSON. */
  public_key: string;
  /** Private JWK JSON (encrypted in the real store). */
  private_key_enc: string;
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

/** PROPOSED table `auth_sessions`: refresh-token families with rotation and reuse detection. */
export interface AuthSessionRow {
  id: string;
  principal_kind: "user" | "attendee";
  principal_id: string;
  refresh_hash: string;
  family_id: string;
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
  mfa_at: Date | null;
}

/** PROPOSED table `auth_links`: single-use attendee sign-in links. */
export interface AuthLinkRow {
  token_hash: string;
  attendee_id: string;
  expires_at: Date;
  used_at: Date | null;
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
}
export interface VenuesRepo {
  zonesOfVenue(venueId: string): Promise<ZoneRow[]>;
  room(id: string): Promise<RoomRow | null>;
  roomsByIds(ids: readonly string[]): Promise<RoomRow[]>;
  checkpoint(id: string): Promise<CheckpointRow | null>;
  checkpointsOfVenue(venueId: string): Promise<CheckpointRow[]>;
  venue(id: string): Promise<VenueRow | null>;
  transitTimes(venueId: string): Promise<TransitTimeRow[]>;
}
export interface EventsRepo {
  /** Published or live, listed, ordered by starts_at, keyset-paginated on (starts_at, id). */
  listPublic(opts: { state?: "published" | "live"; q?: string; after?: { starts_at: Date; id: string }; limit: number }): Promise<EventRow[]>;
  bySlug(slug: string): Promise<EventRow | null>;
  byId(id: string): Promise<EventRow | null>;
  rooms(eventId: string): Promise<EventRoomRow[]>;
  sessions(eventId: string): Promise<SessionRow[]>;
  accessRules(eventId: string): Promise<AccessRuleRow[]>;
}
export interface RegistrationsRepo {
  byId(id: string): Promise<RegistrationRow | null>;
  forAttendee(attendeeId: string): Promise<RegistrationRow[]>;
  /** Set checked_in_at if it is still null (first admission only). */
  markCheckedIn(id: string, at: Date): Promise<void>;
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
}
export interface ScansRepo {
  byIdemKey(eventId: string, idemKey: string): Promise<ScanRow | null>;
  insert(row: ScanRow): Promise<void>;
  /** All scans for an event, ordered by corrected time (occurred_at + clock_offset_ms). Used to rebuild projections. */
  forEvent(eventId: string): Promise<ScanRow[]>;
  page(eventId: string, opts: { checkpointId?: string; result?: ScanResult; limit: number; before?: string }): Promise<ScanRow[]>;
}
export interface OccupancyRepo {
  insertAdjustment(row: OccupancyAdjustmentRow): Promise<void>;
  adjustments(eventId: string): Promise<OccupancyAdjustmentRow[]>;
}
export interface AlertsRepo {
  insert(row: BreachAlertRow): Promise<void>;
  byId(id: string): Promise<BreachAlertRow | null>;
  update(id: string, patch: Partial<BreachAlertRow>): Promise<BreachAlertRow>;
  list(opts: { eventId?: string; state?: AlertState; severity?: Severity; limit: number }): Promise<BreachAlertRow[]>;
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
export interface AuthRepo {
  insertSession(row: AuthSessionRow): Promise<void>;
  sessionByRefreshHash(hash: string): Promise<AuthSessionRow | null>;
  /** Atomically mark used if unused. Returns false if it was already used (reuse). */
  markSessionUsed(id: string, at: Date): Promise<boolean>;
  revokeFamily(familyId: string, at: Date): Promise<void>;
  insertLink(row: AuthLinkRow): Promise<void>;
  /** Atomically consume a link if unused and unexpired. */
  consumeLink(tokenHash: string, at: Date): Promise<AuthLinkRow | null>;
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
  fixtures: FixtureWriter;
  /** Which implementation this is, for logs and tests. */
  kind: "memory" | "drizzle";
  close?(): Promise<void>;
}
