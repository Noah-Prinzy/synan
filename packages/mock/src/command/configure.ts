/**
 * The configure side of Admin Command: first run (D0), venues and their layout (D2, D2b, D3),
 * events and the wizard (D4, D5), and the event workspace (D6). Everything the operator sets up
 * before and around an event, against contract shapes wherever contracts declares one.
 *
 * Shapes contracts does not declare are marked NOT IN CONTRACTS — proposals to the backend,
 * kept thin. Errors are thrown as `MockApiError` carrying a contract `ErrorCode`, plus field
 * messages where a form needs to point at the field that failed.
 *
 * State lives in memory for the page's life. Publishing an event adds it to the event selector
 * (the command mock's own list), so a new event appears everywhere at once.
 */
import type { ErrorCode } from "@synan/contracts/errors";
import type {
  AccessRule,
  Checkpoint,
  EventSession,
  HandoverSummary,
  Organization,
  Room,
  StaffAssignment,
  Venue,
  Zone,
} from "@synan/contracts/rest";
import type {
  AttendeeTier,
  CarrierState,
  CredentialState,
  EventState,
  RegistrationState,
  Role,
} from "@synan/contracts/enums";
import type { MockClock } from "../clock";
import { delay } from "../portal";
import { createRng, hashString, idFor, int, pick } from "../random";
import { buildVenue, type GridPolygon, type GridRect, type VenueKey } from "./venues";

/* -------------------------------------------------------------------- errors */

/** A failed call: the contract error code, and per-field messages for forms. */
export class MockApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly fields: Record<string, string> = {},
  ) {
    super(code);
    this.name = "MockApiError";
  }
}

/* --------------------------------------------------------------------- types */

/** GET /organizations/current — NOT IN CONTRACTS (only POST /organizations exists). */
export interface SetupStatus {
  organization: Organization | null;
  /** First run (D0) is reachable only while this is false. */
  has_published_venue: boolean;
}

/** One row of GET /venues, with the counts D2 shows. Counts are NOT IN CONTRACTS. */
export interface VenueRow {
  venue: Venue;
  floors: string[];
  zones: number;
  rooms: number;
  capacity: number;
  /** Events at this venue that are published or live. */
  active_events: number;
  events: number;
  layout_published_at: string | null;
}

/** GET /venues/:id plus the layout extras the editor needs (grid, floors, version). */
export interface VenueDetail {
  venue: Venue;
  /** Floors in display order. NOT IN CONTRACTS (zones carry `floor` as free text). */
  floors: string[];
  /** Default room capacity for new rooms. NOT IN CONTRACTS. */
  capacity_default: number | null;
  grid: { w: number; h: number };
  zones: Zone[];
  rooms: Room[];
  checkpoints: Checkpoint[];
  /** Optimistic concurrency for Publish layout. NOT IN CONTRACTS. */
  layout_version: number;
  layout_published_at: string | null;
  /** Events held here, so the editor can warn before changing a live venue. */
  events: { id: string; title: string; state: EventState }[];
}

export interface CreateVenueBody {
  name: string;
  city: string;
  address?: string;
  timezone: string;
  floors: string[];
  capacity_default?: number | null;
}

/** PUT of a whole layout draft. NOT IN CONTRACTS — today zones and rooms are saved one by one. */
export interface PublishLayoutBody {
  expected_version: number;
  floors: string[];
  zones: Omit<Zone, "venue_id">[];
  rooms: Omit<Room, "venue_id">[];
}

/** The pass template's fields (contracts leaves the shape to the designer). */
export interface PassTemplate {
  /** Large line on the pass, under the event title. */
  headline: string;
  /** One short note under the QR, e.g. where to collect wristbands. */
  note: string;
  show_tier: boolean;
  show_sessions: boolean;
  wallet: boolean;
}

export const WIZARD_STEPS = ["basics", "venue", "access", "pass", "review"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** An access rule as the matrix edits it (no ids). */
export type RuleInput = Omit<AccessRule, "id" | "event_id">;

/** One event as the operator sees it, drafts included. Superset of EventAdmin, nullable while a draft. */
export interface EventRecord {
  id: string;
  org_id: string;
  slug: string;
  title: string;
  description: string;
  state: EventState;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  venue_id: string | null;
  listed: boolean;
  grace_buffer_hours: number;
  rooms: { room_id: string; capacity_override: number | null }[];
  pass_template: PassTemplate | null;
  access_rules_version: number;
  /** The furthest wizard step the draft has reached (resume point). NOT IN CONTRACTS. */
  wizard_step: WizardStep;
  created_at: string;
  updated_at: string;
  updated_by: string;
  published_at: string | null;
  closed_at: string | null;
}

/** One row of GET /events?scope=all, with the counts D4 shows (counts NOT IN CONTRACTS). */
export interface EventRow {
  id: string;
  slug: string;
  title: string;
  state: EventState;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  venue: { id: string; name: string; city: string | null } | null;
  registrations: number;
  checked_in: number;
  listed: boolean;
  updated_at: string;
  updated_by: string;
}

/** A partial update while drafting; the same fields as UpdateEvent plus the draft's rules and step. */
export interface EventPatch {
  slug?: string;
  title?: string;
  description?: string;
  starts_at?: string | null;
  ends_at?: string | null;
  timezone?: string;
  venue_id?: string | null;
  listed?: boolean;
  grace_buffer_hours?: number;
  rooms?: { room_id: string; capacity_override: number | null }[];
  pass_template?: PassTemplate | null;
  /** Drafts only: published events go through putAccessRules (diff + republish). */
  rules?: RuleInput[];
  wizard_step?: WizardStep;
}

export type ReadinessKey = "basics" | "venue" | "rooms" | "capacity" | "rules" | "pass" | "email" | "staff";

/** One line of the readiness checklist (D5 review, D6.1). NOT IN CONTRACTS. */
export interface ReadinessItem {
  key: ReadinessKey;
  label: string;
  met: boolean;
  /** What is missing, or what was found, in one sentence. */
  detail: string;
  /** Publishing is refused while a blocking item is unmet (P-13). */
  blocking: boolean;
  /** The wizard step that fixes it. */
  step: WizardStep | null;
}

export interface AccessRuleSet {
  version: number;
  rules: AccessRule[];
}

export interface AttendeeQuery {
  q?: string;
  tier?: AttendeeTier;
  credential?: CredentialState;
  /** Registered but no band bound yet. */
  unbound?: boolean;
}

/** One row of the scoped attendee table (D6.4). A RegistrationRow plus credential and band, NOT IN CONTRACTS as one shape. */
export interface AttendeeListRow {
  registration_id: string;
  attendee_id: string;
  full_name: string | null;
  email: string | null;
  tier: AttendeeTier;
  state: RegistrationState;
  credential_state: CredentialState | null;
  /** Masked as the server's band hint: the UID's last four, e.g. `••••81BF`. */
  band_hint: string | null;
  checked_in: boolean;
  last_scan_at: string | null;
}

export interface CredentialOverview {
  by_state: Record<CarrierState, number>;
  by_chip_profile: Record<string, number>;
  credentials: Record<CredentialState, number>;
  recent: { at: string; band_hint: string; attendee: string; action: "bound" | "replaced" | "revoked" }[];
}

/**
 * One attendee as the registration desk sees them (D8): the table row plus what the desk acts
 * on. NOT IN CONTRACTS as one shape (Registration + Credential + Carrier, joined).
 */
export interface DeskAttendee extends AttendeeListRow {
  /** The current credential, or null when none is issued yet. */
  credential_id: string | null;
  /** The bound band, or null. */
  carrier_id: string | null;
  /** When the pass email last went out, and to which address (masked). */
  pass_sent_at: string | null;
  /** The last time a band was bound, rebound or replaced at a desk. */
  band_changed_at: string | null;
}

/** POST /carriers/bind — a stock band onto a registration (contracts `BindRequest`). */
export interface BindBandBody {
  registration_id: string;
  /** The band's UID, hex, 8–32 characters. */
  identifier: string;
}

/**
 * POST /carriers/:id/rebind (contracts `RebindRequest`). `lost`: the old band is marked lost, the
 * credential is replaced by a new one (old emailed and portal codes stop working) and the new
 * band is bound to it. `damaged`: the old band is retired and the credential is kept.
 */
export interface ReplaceBandBody {
  registration_id: string;
  identifier: string;
  reason: string;
  disposition: "lost" | "damaged";
}

/** POST /credentials/:id/clear-review, or revoke (contracts `ClearReviewRequest`). */
export interface ReviewBody {
  outcome: "clear" | "revoke";
  note: string;
}

/** What the desk shows at a glance: the bands it can hand out, and its own work today. */
export interface DeskStock {
  /** Bands in stock, unassigned (shared across the organisation's events). */
  stock: number;
  /** Bands bound to this event's registrations. */
  bound: number;
  lost: number;
  /** Desk actions since the page opened (mock) / since the shift began (API). */
  today: { bound: number; replaced: number; resent: number };
}

export interface StaffRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  mfa_enrolled: boolean;
}

export interface AssignmentRow extends StaffAssignment {
  staff_name: string;
  checkpoint_label: string;
}

export interface CreateAssignmentBody {
  user_id: string;
  checkpoint_id: string;
  shift_start: string;
  shift_end: string;
}

export interface SessionBody {
  title: string;
  room_id: string;
  starts_at: string;
  ends_at: string;
}

export interface ConfigureApi {
  setupStatus(): Promise<SetupStatus>;
  createOrganization(body: Omit<Organization, "id">): Promise<Organization>;

  venues(): Promise<VenueRow[]>;
  venue(id: string): Promise<VenueDetail>;
  createVenue(body: CreateVenueBody): Promise<Venue>;
  publishLayout(id: string, body: PublishLayoutBody): Promise<VenueDetail>;

  eventRows(): Promise<EventRow[]>;
  event(id: string): Promise<EventRecord>;
  createDraft(patch: EventPatch): Promise<EventRecord>;
  updateEvent(id: string, patch: EventPatch): Promise<EventRecord>;
  duplicateEvent(id: string): Promise<EventRecord>;
  deleteDraft(id: string): Promise<void>;
  readiness(id: string): Promise<ReadinessItem[]>;
  publishEvent(id: string): Promise<EventRecord>;
  transitionEvent(id: string, state: "live" | "closed" | "archived"): Promise<EventRecord>;

  sessions(eventId: string): Promise<EventSession[]>;
  createSession(eventId: string, body: SessionBody): Promise<EventSession>;
  updateSession(eventId: string, sessionId: string, body: SessionBody): Promise<EventSession>;
  deleteSession(eventId: string, sessionId: string): Promise<void>;

  accessRules(eventId: string): Promise<AccessRuleSet>;
  putAccessRules(eventId: string, body: { expected_version: number; rules: RuleInput[] }): Promise<AccessRuleSet>;

  attendees(eventId: string, query?: AttendeeQuery): Promise<{ items: AttendeeListRow[]; total: number }>;
  credentialOverview(eventId: string): Promise<CredentialOverview>;

  /* the registration desk (D8) and pass review (D-06) */
  /** One attendee with what the desk acts on. */
  deskAttendee(eventId: string, registrationId: string): Promise<DeskAttendee>;
  bindBand(eventId: string, body: BindBandBody): Promise<DeskAttendee>;
  replaceBand(eventId: string, body: ReplaceBandBody): Promise<DeskAttendee>;
  /** Rate-limited: once a minute per attendee (RATE_LIMITED). */
  resendPass(eventId: string, registrationId: string): Promise<DeskAttendee>;
  /** Clear a pass under review back to active, or revoke it. Only for `suspended_review`. */
  reviewCredential(eventId: string, registrationId: string, body: ReviewBody): Promise<DeskAttendee>;
  deskStock(eventId: string): Promise<DeskStock>;

  staff(): Promise<StaffRow[]>;
  checkpoints(eventId: string): Promise<Checkpoint[]>;
  assignments(eventId: string): Promise<AssignmentRow[]>;
  createAssignment(eventId: string, body: CreateAssignmentBody): Promise<AssignmentRow>;
  handover(assignmentId: string): Promise<HandoverSummary>;
}

/** The command mock's event list entry, as it reaches the configure layer. */
export interface LinkedEvent {
  id: string;
  slug: string;
  title: string;
  state: EventState;
  starts_at: string;
  ends_at: string;
  venue_name: string;
  timezone: string;
  venue: VenueKey | null;
}

export interface ConfigureOptions {
  clock: MockClock;
  latencyMs: number;
  /** The command mock's events: the selector's list. Kept in step when an event is published. */
  events: LinkedEvent[];
  orgId: string;
  operator: { id: string; name: string };
  venueSize: "standard" | "large";
  /** Live counts for an event the live mock runs, so D4 and D1 agree. */
  liveCounts: (eventId: string) => { registered: number; checked_in: number } | null;
  /** First-run world: no organisation and no venues (dev `?setup=fresh`). */
  fresh: boolean;
  /** Each list endpoint fails once (dev `?fail=1`). */
  failOnce: boolean;
}

/* --------------------------------------------------------------- helpers */

const TIERS: AttendeeTier[] = ["VIP", "ORDINARY", "PRIVATE_INVITE", "PUBLIC"];

const clone = <T>(value: T): T => structuredClone(value);

function rect(x: number, y: number, w: number, h: number): GridRect {
  return { kind: "rect", x, y, w, h };
}

function box(x: number, y: number, w: number, h: number): GridPolygon {
  return { kind: "polygon", points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] };
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/* ----------------------------------------------------------------- seeds */

interface VenueState {
  detail: VenueDetail;
}

/** Innovation Village: a small two-zone venue hand-drawn on the grid (Design Week Kampala). */
function innovationVillage(orgId: string): VenueDetail {
  const venueId = idFor("venue:Innovation Village");
  const z1 = idFor("zone:Innovation Village:Ground:Courtyard");
  const z2 = idFor("zone:Innovation Village:Level 1:Studios");
  const room = (name: string, zone: string, capacity: number, geometry: GridRect, continuous = false): Room => ({
    id: idFor(`room:Innovation Village:${name}`),
    venue_id: venueId,
    zone_id: zone,
    name,
    capacity,
    warn_at_pct: 85,
    block_at_pct: 100,
    continuous,
    capacity_policy: "block",
    geometry,
  });
  const rooms = [
    room("Courtyard Stage", z1, 300, rect(2, 5, 30, 22)),
    room("Maker Space", z1, 80, rect(34, 5, 16, 22)),
    room("Café", z1, 60, rect(2, 29, 48, 10), true),
    room("Studio 1", z2, 40, rect(56, 5, 18, 16)),
    room("Studio 2", z2, 40, rect(76, 5, 18, 16)),
    room("Crit Room", z2, 24, rect(56, 23, 38, 16)),
  ];
  const gate = (label: string, zone: string, direction: Checkpoint["direction"]): Checkpoint => ({
    id: idFor(`checkpoint:Innovation Village:${label}`),
    venue_id: venueId,
    zone_id: zone,
    room_id: null,
    direction,
    perimeter: true,
    hardware_id: null,
    label,
  });
  return {
    venue: { id: venueId, org_id: orgId, name: "Innovation Village", address: "Ntinda, Kampala", city: "Kampala", timezone: "Africa/Kampala" },
    floors: ["Ground", "Level 1"],
    capacity_default: 40,
    grid: { w: 96, h: 60 },
    zones: [
      { id: z1, venue_id: venueId, name: "Courtyard", floor: "Ground", geometry: box(0, 0, 52, 42) },
      { id: z2, venue_id: venueId, name: "Studios", floor: "Level 1", geometry: box(54, 0, 42, 42) },
    ],
    rooms,
    checkpoints: [gate("Gate 1 · Courtyard", z1, "both"), gate("Gate 2 · Studios", z2, "in")],
    layout_version: 3,
    layout_published_at: "2026-11-12T09:20:00.000Z",
    events: [],
  };
}

/** A venue just created, with nothing drawn yet: the editor's empty state. */
function emptyVenue(orgId: string): VenueDetail {
  const venueId = idFor("venue:Kololo Pavilion");
  return {
    venue: { id: venueId, org_id: orgId, name: "Kololo Pavilion", address: "Kololo, Kampala", city: "Kampala", timezone: "Africa/Kampala" },
    floors: ["Ground"],
    capacity_default: 100,
    grid: { w: 96, h: 60 },
    zones: [],
    rooms: [],
    checkpoints: [],
    layout_version: 0,
    layout_published_at: null,
    events: [],
  };
}

function builtVenue(key: VenueKey, orgId: string, publishedAt: string): VenueDetail {
  const { layout } = buildVenue(key, orgId);
  const floors: string[] = [];
  for (const zone of layout.zones) if (zone.floor && !floors.includes(zone.floor)) floors.push(zone.floor);
  return {
    venue: layout.venue,
    floors,
    capacity_default: 80,
    grid: layout.grid,
    zones: layout.zones,
    rooms: layout.rooms,
    checkpoints: layout.checkpoints,
    layout_version: 7,
    layout_published_at: publishedAt,
    events: [],
  };
}

const FIRST = ["Amara", "Brian", "Ciara", "Daniel", "Esther", "Faisal", "Grace", "Hassan", "Irene", "Joel", "Kemi", "Lydia", "Moses", "Nadia", "Owen", "Patience", "Ruth", "Samuel", "Tendai", "Vivian", "Winnie", "Yusuf", "Zawadi", "Peter", "Agnes", "Ivan", "Sarah", "Kato", "Nakato", "Musa"];
const LAST = ["Okello", "Nakamya", "Mugisha", "Achieng", "Kintu", "Ssali", "Atim", "Odongo", "Namutebi", "Wasswa", "Babirye", "Kizza", "Auma", "Lubega", "Byaruhanga", "Opio", "Nansubuga", "Tumusiime", "Akello", "Mwesigwa"];

/* ------------------------------------------------------------------ the api */

export function createConfigureMock(options: ConfigureOptions): ConfigureApi {
  const { clock, orgId, operator } = options;
  const latency = options.latencyMs;
  const now = () => new Date(clock.now()).toISOString();
  const wait = (ms = latency) => delay(ms);

  const failing = new Set<string>(options.failOnce ? ["venues", "eventRows", "event", "venue"] : []);
  const maybeFail = (name: string) => {
    if (failing.has(name)) {
      failing.delete(name);
      throw new MockApiError("INTERNAL");
    }
  };

  /* organisation */
  let organization: Organization | null = options.fresh
    ? null
    : { id: orgId, name: "Synan Demo Organisation", timezone: "Africa/Kampala", support_email: "help@synan-demo.example" };

  /* venues */
  const venues = new Map<string, VenueState>();
  if (!options.fresh) {
    const nexusKey: VenueKey = options.venueSize === "large" ? "nexus-hall-full" : "nexus-hall";
    for (const detail of [
      builtVenue(nexusKey, orgId, "2026-11-18T14:05:00.000Z"),
      builtVenue("serena", orgId, "2026-11-10T08:40:00.000Z"),
      innovationVillage(orgId),
      emptyVenue(orgId),
    ]) {
      venues.set(detail.venue.id, { detail });
    }
  }
  const venueIdByName = (name: string) => [...venues.values()].find((v) => v.detail.venue.name === name)?.detail.venue.id ?? null;

  /* events */
  const records = new Map<string, EventRecord>();
  const rulesByEvent = new Map<string, AccessRule[]>();
  const sessionsByEvent = new Map<string, EventSession[]>();
  const counts = new Map<string, { registered: number; checked_in: number }>();

  const ruleRecords = (eventId: string, rules: RuleInput[]): AccessRule[] =>
    rules.map((rule) => ({
      ...rule,
      id: idFor(`rule:${eventId}:${rule.subject_kind}:${rule.subject}:${rule.room_id}:${rule.window_start ?? ""}`),
      event_id: eventId,
    }));

  /** A plausible default matrix: VIP everywhere, Ordinary all but the restricted rooms, Public the open ones. */
  const defaultRules = (roomList: Room[]): RuleInput[] => {
    const restricted = /vip|green room|boardroom|press|operations/i;
    const open = /expo|courtyard|café|cafe|garden|foyer|lounge|registration|terrace/i;
    const invite = /boardroom|press|main hall|ballroom|vip/i;
    const out: RuleInput[] = [];
    for (const room of roomList) {
      const permit = (tier: AttendeeTier, yes: boolean) =>
        out.push({ subject_kind: "tier", subject: tier, room_id: room.id, window_start: null, window_end: null, effect: yes ? "permit" : "deny" });
      permit("VIP", true);
      permit("ORDINARY", !restricted.test(room.name));
      permit("PRIVATE_INVITE", invite.test(room.name) || open.test(room.name));
      permit("PUBLIC", open.test(room.name) && !restricted.test(room.name));
    }
    return out;
  };

  const sessionsFor = (eventId: string, startsAt: string, endsAt: string, roomList: Room[]): EventSession[] => {
    const rng = createRng(hashString(`sessions:${eventId}`));
    const titles = ["Opening keynote", "Founders panel", "Product deep dive", "Security roundtable", "Design critique", "Investor office hours", "Lightning talks", "Fireside chat", "Hands-on workshop", "Closing remarks", "Community meetup", "Data and privacy"];
    const out: EventSession[] = [];
    const start = Date.parse(startsAt);
    const end = Date.parse(endsAt);
    const days = Math.max(1, Math.ceil((end - start) / 86_400_000));
    const bookable = roomList.filter((r) => !r.continuous).slice(0, 5);
    for (let d = 0; d < days; d++) {
      for (const [i, room] of bookable.entries()) {
        let t = start + d * 86_400_000 + (i % 2) * 30 * 60_000;
        for (let k = 0; k < 3; k++) {
          const length = (int(rng, 2, 4) * 15 + 30) * 60_000;
          if (t + length > Math.min(end, start + d * 86_400_000 + 9 * 3_600_000)) break;
          out.push({
            id: idFor(`session:${eventId}:${d}:${room.id}:${k}`),
            event_id: eventId,
            room_id: room.id,
            title: pick(rng, titles),
            starts_at: new Date(t).toISOString(),
            ends_at: new Date(t + length).toISOString(),
          });
          t += length + 30 * 60_000;
        }
      }
    }
    return out.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  };

  const defaultPass = (title: string): PassTemplate => ({
    headline: title,
    note: "Show this at the entrance to collect your wristband.",
    show_tier: true,
    show_sessions: true,
    wallet: true,
  });

  const seedCounts: Record<string, { registered: number; checked_in: number }> = {
    "nexus-summit-2026": { registered: 3120, checked_in: 2411 },
    "security-operations-forum": { registered: 486, checked_in: 402 },
    "founders-forum-2026": { registered: 1184, checked_in: 1006 },
    "design-week-kampala": { registered: 642, checked_in: 0 },
  };

  if (!options.fresh) {
    for (const linked of options.events) {
      const venueId = venueIdByName(linked.venue_name);
      const venue = venueId ? venues.get(venueId)?.detail : undefined;
      const roomList = venue?.rooms ?? [];
      const record: EventRecord = {
        id: linked.id,
        org_id: orgId,
        slug: linked.slug,
        title: linked.title,
        description: `${linked.title} at ${linked.venue_name}.`,
        state: linked.state,
        starts_at: linked.starts_at,
        ends_at: linked.ends_at,
        timezone: linked.timezone,
        venue_id: venueId,
        listed: true,
        grace_buffer_hours: 72,
        rooms: roomList.map((room) => ({ room_id: room.id, capacity_override: null })),
        pass_template: defaultPass(linked.title),
        access_rules_version: linked.state === "live" ? 4 : 2,
        wizard_step: "review",
        created_at: new Date(Date.parse(linked.starts_at) - 40 * 86_400_000).toISOString(),
        updated_at: new Date(Date.parse(linked.starts_at) - (linked.state === "live" ? 1 : 3) * 86_400_000).toISOString(),
        updated_by: operator.name,
        published_at: new Date(Date.parse(linked.starts_at) - 30 * 86_400_000).toISOString(),
        closed_at: linked.state === "closed" ? linked.ends_at : null,
      };
      records.set(record.id, record);
      rulesByEvent.set(record.id, ruleRecords(record.id, defaultRules(roomList)));
      sessionsByEvent.set(record.id, sessionsFor(record.id, linked.starts_at, linked.ends_at, roomList));
      counts.set(record.id, seedCounts[linked.slug] ?? { registered: 0, checked_in: 0 });
    }

    // Two drafts: one barely started, one waiting on its access rules.
    const serena = venueIdByName("Serena Conference Centre");
    const serenaRooms = serena ? (venues.get(serena)?.detail.rooms ?? []) : [];
    const drafts: EventRecord[] = [
      {
        id: idFor("event:founders-forum-2027"),
        org_id: orgId,
        slug: "founders-forum-2027",
        title: "Founders Forum 2027",
        description: "The second Founders Forum, two days at the Serena.",
        state: "draft",
        starts_at: "2027-03-16T05:30:00.000Z",
        ends_at: "2027-03-17T15:00:00.000Z",
        timezone: "Africa/Kampala",
        venue_id: serena,
        listed: true,
        grace_buffer_hours: 72,
        rooms: serenaRooms.map((room) => ({ room_id: room.id, capacity_override: null })),
        pass_template: null,
        access_rules_version: 0,
        wizard_step: "access",
        created_at: "2026-11-20T10:12:00.000Z",
        updated_at: "2026-11-21T16:48:00.000Z",
        updated_by: operator.name,
        published_at: null,
        closed_at: null,
      },
      {
        id: idFor("event:kampala-startup-night"),
        org_id: orgId,
        slug: "kampala-startup-night",
        title: "Kampala Startup Night",
        description: "",
        state: "draft",
        starts_at: null,
        ends_at: null,
        timezone: "Africa/Kampala",
        venue_id: null,
        listed: true,
        grace_buffer_hours: 72,
        rooms: [],
        pass_template: null,
        access_rules_version: 0,
        wizard_step: "basics",
        created_at: "2026-11-22T18:02:00.000Z",
        updated_at: "2026-11-22T18:02:00.000Z",
        updated_by: "Brian Mugisha",
        published_at: null,
        closed_at: null,
      },
    ];
    for (const draft of drafts) {
      records.set(draft.id, draft);
      rulesByEvent.set(draft.id, []);
      sessionsByEvent.set(draft.id, []);
      counts.set(draft.id, { registered: 0, checked_in: 0 });
    }
  }

  const need = (id: string): EventRecord => {
    const record = records.get(id);
    if (!record) throw new MockApiError("NOT_FOUND");
    return record;
  };
  const needVenue = (id: string): VenueDetail => {
    const venue = venues.get(id)?.detail;
    if (!venue) throw new MockApiError("NOT_FOUND");
    return venue;
  };
  const countsFor = (id: string) => options.liveCounts(id) ?? counts.get(id) ?? { registered: 0, checked_in: 0 };
  const eventRooms = (record: EventRecord): Room[] => {
    if (!record.venue_id) return [];
    const venue = venues.get(record.venue_id)?.detail;
    if (!venue) return [];
    const picked = new Map(record.rooms.map((r) => [r.room_id, r]));
    return venue.rooms
      .filter((room) => picked.has(room.id))
      .map((room) => ({ ...room, capacity: picked.get(room.id)?.capacity_override ?? room.capacity }));
  };

  /** Keep the event selector in step: published and later events appear there. */
  const sync = (record: EventRecord) => {
    const list = options.events;
    const index = list.findIndex((e) => e.id === record.id);
    if (record.state === "draft" || !record.starts_at || !record.ends_at) {
      if (index !== -1) list.splice(index, 1);
      return;
    }
    const venueName = record.venue_id ? (venues.get(record.venue_id)?.detail.venue.name ?? "—") : "—";
    const entry: LinkedEvent = {
      id: record.id,
      slug: record.slug,
      title: record.title,
      state: record.state,
      starts_at: record.starts_at,
      ends_at: record.ends_at,
      venue_name: venueName,
      timezone: record.timezone,
      venue: index === -1 ? null : (list[index] as LinkedEvent).venue,
    };
    if (index === -1) list.push(entry);
    else list[index] = entry;
  };

  const touch = (record: EventRecord) => {
    record.updated_at = now();
    record.updated_by = operator.name;
  };

  /** Field checks shared by drafting and publishing. Returns messages keyed by field. */
  const fieldErrors = (record: EventRecord, patch: EventPatch): Record<string, string> => {
    const errors: Record<string, string> = {};
    const title = patch.title ?? record.title;
    const slug = patch.slug ?? record.slug;
    if (patch.title !== undefined && title.trim().length === 0) errors.title = "Give the event a name.";
    if (patch.title !== undefined && title.length > 200) errors.title = "Keep the name under 200 characters.";
    if (patch.slug !== undefined) {
      if (!SLUG_RE.test(slug)) errors.slug = "Use lowercase letters, numbers and single hyphens.";
      else if ([...records.values()].some((r) => r.id !== record.id && r.slug === slug)) errors.slug = "Another event already uses this address.";
    }
    if (patch.timezone !== undefined && !isTimeZone(patch.timezone)) errors.timezone = "Choose a time zone from the list.";
    const starts = patch.starts_at !== undefined ? patch.starts_at : record.starts_at;
    const ends = patch.ends_at !== undefined ? patch.ends_at : record.ends_at;
    if (starts && ends && Date.parse(ends) <= Date.parse(starts)) errors.ends_at = "The event must end after it starts.";
    if (patch.venue_id && !venues.has(patch.venue_id)) errors.venue_id = "That venue no longer exists.";
    if (patch.grace_buffer_hours !== undefined && (patch.grace_buffer_hours < 0 || patch.grace_buffer_hours > 24 * 90)) {
      errors.grace_buffer_hours = "Between 0 hours and 90 days.";
    }
    return errors;
  };

  const readinessOf = (record: EventRecord): ReadinessItem[] => {
    const rooms = eventRooms(record);
    const rules = rulesByEvent.get(record.id) ?? [];
    const basics = record.title.trim().length > 0 && !!record.starts_at && !!record.ends_at && SLUG_RE.test(record.slug);
    const zeroCapacity = rooms.filter((room) => room.capacity <= 0);
    const tiersWithAccess = TIERS.filter((tier) => rules.some((rule) => rule.subject === tier && rule.effect === "permit"));
    const staffCount = assignments.filter((a) => a.event_id === record.id).length;
    const venueName = record.venue_id ? venues.get(record.venue_id)?.detail.venue.name : null;
    return [
      {
        key: "basics",
        label: "Name and dates",
        met: basics,
        detail: basics ? "Named, with start and end dates." : "Add the event name, address and dates.",
        blocking: true,
        step: "basics",
      },
      {
        key: "venue",
        label: "Venue",
        met: !!venueName,
        detail: venueName ? venueName : "Choose where the event is held.",
        blocking: true,
        step: "venue",
      },
      {
        key: "rooms",
        label: "At least one room",
        met: rooms.length > 0,
        detail: rooms.length > 0 ? `${rooms.length} room${rooms.length === 1 ? "" : "s"} in use.` : "Pick the rooms this event uses.",
        blocking: true,
        step: "venue",
      },
      {
        key: "capacity",
        label: "Capacity on every room",
        met: rooms.length > 0 && zeroCapacity.length === 0,
        detail:
          rooms.length === 0
            ? "Set once rooms are picked."
            : zeroCapacity.length === 0
              ? `${rooms.reduce((sum, room) => sum + room.capacity, 0).toLocaleString("en-GB")} places in total.`
              : `${zeroCapacity.map((room) => room.name).join(", ")} ${zeroCapacity.length === 1 ? "has" : "have"} no capacity.`,
        blocking: true,
        step: "venue",
      },
      {
        key: "rules",
        label: "Access rules",
        met: tiersWithAccess.length > 0,
        detail:
          tiersWithAccess.length === 0
            ? "No tier can enter any room yet. Attendees would be refused at every door."
            : `${tiersWithAccess.length} of 4 tiers can enter at least one room.`,
        blocking: false,
        step: "access",
      },
      {
        key: "pass",
        label: "Pass template",
        met: record.pass_template !== null,
        detail: record.pass_template ? "Set." : "Set up the pass attendees will carry.",
        blocking: true,
        step: "pass",
      },
      {
        key: "email",
        label: "Sending domain verified",
        met: organization !== null,
        detail: organization ? "Passes are sent from a verified domain." : "Verify the sending domain in Settings.",
        blocking: false,
        step: null,
      },
      {
        key: "staff",
        label: "Gate staff assigned",
        met: staffCount > 0,
        detail: staffCount > 0 ? `${staffCount} shift${staffCount === 1 ? "" : "s"} assigned.` : "Assign staff to gates before doors open.",
        blocking: false,
        step: null,
      },
    ];
  };

  /* staff */
  const staffList: StaffRow[] = [
    ["Amara Okello", "admin"],
    ["Brian Mugisha", "organiser"],
    ["Esther Achieng", "security_staff"],
    ["Hassan Kintu", "security_staff"],
    ["Irene Namutebi", "security_staff"],
    ["Joel Odongo", "security_staff"],
    ["Ruth Atim", "security_staff"],
    ["Samuel Wasswa", "crew"],
    ["Zawadi Auma", "speaker"],
  ].map(([name, role]) => ({
    id: idFor(`user:${name}`),
    name: name as string,
    email: `${(name as string).toLowerCase().replace(/[^a-z]+/g, ".")}@synan-demo.example`,
    role: role as Role,
    mfa_enrolled: role !== "speaker",
  }));
  const assignments: StaffAssignment[] = [];
  if (!options.fresh) {
    for (const linked of options.events.filter((e) => e.state === "live")) {
      const record = records.get(linked.id);
      const venue = record?.venue_id ? venues.get(record.venue_id)?.detail : undefined;
      if (!venue) continue;
      const gates = venue.checkpoints.filter((c) => c.perimeter);
      const security = staffList.filter((s) => s.role === "security_staff");
      gates.forEach((gate, i) => {
        const person = security[(i + (linked.slug.length % 3)) % security.length] as StaffRow;
        assignments.push({
          id: idFor(`assignment:${linked.id}:${gate.id}`),
          user_id: person.id,
          checkpoint_id: gate.id,
          shift_start: "2026-11-22T05:00:00.000Z",
          shift_end: "2026-11-22T11:00:00.000Z",
          event_id: linked.id,
          handed_over_at: null,
        });
      });
    }
  }

  /* attendees: generated per event on first ask, deterministic */
  const attendeeCache = new Map<string, AttendeeListRow[]>();
  const attendeesFor = (record: EventRecord): AttendeeListRow[] => {
    const cached = attendeeCache.get(record.id);
    if (cached) return cached;
    const { registered, checked_in } = countsFor(record.id);
    const n = Math.min(registered, 400);
    const rng = createRng(hashString(`attendees:${record.id}`));
    const ratio = registered > 0 ? checked_in / registered : 0;
    const rows: AttendeeListRow[] = [];
    for (let i = 0; i < n; i++) {
      const first = pick(rng, FIRST);
      const last = pick(rng, LAST);
      const roll = rng();
      const tier: AttendeeTier = roll < 0.06 ? "VIP" : roll < 0.1 ? "PRIVATE_INVITE" : roll < 0.25 ? "PUBLIC" : "ORDINARY";
      const anonymous = tier === "PUBLIC";
      const checkedIn = record.state !== "draft" && record.state !== "published" && rng() < ratio;
      const stateRoll = rng();
      const credential: CredentialState | null =
        stateRoll < 0.01 ? "revoked" : stateRoll < 0.015 ? "suspended_review" : stateRoll < 0.02 ? "replaced" : checkedIn ? "active" : "issued";
      const bound = checkedIn || rng() < 0.08;
      const hex = () => Math.floor(rng() * 256).toString(16).toUpperCase().padStart(2, "0");
      rows.push({
        registration_id: idFor(`registration:${record.id}:${i}`),
        attendee_id: idFor(`attendee:${record.id}:${i}`),
        full_name: anonymous ? null : `${first} ${last}`,
        email: anonymous ? null : `${first}.${last}${i % 7 === 0 ? i : ""}@example.org`.toLowerCase(),
        tier,
        state: tier === "VIP" && rng() < 0.15 ? "pending_approval" : "confirmed",
        credential_state: credential,
        // The server's hint: the UID's last four (three draws kept, so every later fixture stays the same).
        band_hint: bound ? ((_a: string, b: string, c: string) => `••••${b}${c}`)(hex(), hex(), hex()) : null,
        checked_in: checkedIn,
        last_scan_at: checkedIn ? new Date(clock.now() - Math.floor(rng() * 5 * 3_600_000)).toISOString() : null,
      });
    }
    attendeeCache.set(record.id, rows);
    return rows;
  };

  /* the registration desk: band, credential and pass state per registration, in memory */
  interface DeskExtra {
    identifier: string | null;
    credential_id: string | null;
    carrier_id: string | null;
    pass_sent_at: string | null;
    band_changed_at: string | null;
    last_resend: number | null;
  }
  const deskExtras = new Map<string, DeskExtra>();
  /** Band UID → registration it is bound to (organisation-wide: a band is bound once). */
  const usedBands = new Map<string, string>();
  const lostBands = new Set<string>();
  const lostByEvent = new Map<string, number>();
  const deskToday = new Map<string, { bound: number; replaced: number; resent: number }>();
  const deskLog = new Map<string, CredentialOverview["recent"]>();
  const stockBase = new Map<string, { stock: number; bound: number; lost: number }>();

  const deskRow = (eventId: string, registrationId: string): { row: AttendeeListRow; record: EventRecord } => {
    const record = need(eventId);
    const row = attendeesFor(record).find((r) => r.registration_id === registrationId);
    if (!row) throw new MockApiError("NOT_FOUND");
    return { row, record };
  };

  const deskExtra = (row: AttendeeListRow): DeskExtra => {
    let extra = deskExtras.get(row.registration_id);
    if (!extra) {
      const seed = hashString(row.registration_id);
      extra = {
        identifier: null,
        credential_id: row.credential_state ? idFor(`credential:${row.registration_id}`) : null,
        carrier_id: row.band_hint ? idFor(`carrier:${row.registration_id}`) : null,
        // Most passes went out when the registration was confirmed, days before the event.
        pass_sent_at:
          row.state === "confirmed" && row.email ? new Date(clock.now() - (2 + (seed % 9)) * 86_400_000 - (seed % 600) * 60_000).toISOString() : null,
        band_changed_at: null,
        last_resend: null,
      };
      deskExtras.set(row.registration_id, extra);
    }
    return extra;
  };

  const deskView = (row: AttendeeListRow): DeskAttendee => {
    const extra = deskExtra(row);
    return {
      ...clone(row),
      credential_id: extra.credential_id,
      carrier_id: extra.carrier_id,
      pass_sent_at: extra.pass_sent_at,
      band_changed_at: extra.band_changed_at,
    };
  };

  /** The server's own validation of a band UID (contracts: hex, 8–32 characters). */
  const checkIdentifier = (raw: string): string => {
    const identifier = raw.replace(/[\s:-]/g, "").toUpperCase();
    if (!identifier) throw new MockApiError("VALIDATION_FAILED", { identifier: "Scan the band, or type the number printed on it." });
    if (!/^[0-9A-F]+$/.test(identifier)) {
      throw new MockApiError("VALIDATION_FAILED", { identifier: "A band number has only the digits 0–9 and the letters A–F." });
    }
    if (identifier.length < 8 || identifier.length > 32) {
      throw new MockApiError("VALIDATION_FAILED", {
        identifier: `A band number is 8 to 32 characters long; this one has ${identifier.length}. Scan it again.`,
      });
    }
    // Demo: bands starting FF were never imported, so they are not in stock.
    if (identifier.startsWith("FF")) {
      throw new MockApiError("CONFLICT", { identifier: "This band is not in stock: it was never imported. Use a band from this event's box." });
    }
    if (lostBands.has(identifier)) {
      throw new MockApiError("CONFLICT", { identifier: "This band was reported lost, so it cannot be used again. Take a fresh band from the box." });
    }
    return identifier;
  };

  const useBand = (identifier: string, row: AttendeeListRow) => {
    const owner = usedBands.get(identifier);
    if (owner && owner !== row.registration_id) {
      throw new MockApiError("CONFLICT", { identifier: "This band is already bound to another attendee. Take a fresh band from the box." });
    }
    usedBands.set(identifier, row.registration_id);
  };

  /** What the desk may not do for this registration, in the words the clerk will read. */
  const deskRefuse = (row: AttendeeListRow) => {
    if (row.state === "cancelled") throw new MockApiError("VALIDATION_FAILED", { identifier: "This registration is cancelled, so no band can be bound to it." });
    if (row.state === "pending_approval") {
      throw new MockApiError("VALIDATION_FAILED", { identifier: "This registration is awaiting approval. A band can be bound once it is approved." });
    }
    if (row.credential_state === "revoked") throw new MockApiError("VALIDATION_FAILED", { identifier: "This pass is revoked, so no band can be bound to it." });
    if (row.credential_state === "suspended_review") {
      throw new MockApiError("VALIDATION_FAILED", { identifier: "This pass is under review. A supervisor must clear it before a band is bound." });
    }
  };

  /** As the server's band hint: the UID's last four in upper-case hex (`••••81BF`). */
  const maskBand = (identifier: string) => `••••${identifier.slice(-4).toUpperCase()}`;

  const deskCount = (eventId: string, what: "bound" | "replaced" | "resent") => {
    const today = deskToday.get(eventId) ?? { bound: 0, replaced: 0, resent: 0 };
    today[what] += 1;
    deskToday.set(eventId, today);
  };

  const deskNote = (eventId: string, row: AttendeeListRow, action: "bound" | "replaced") => {
    const log = deskLog.get(eventId) ?? [];
    log.unshift({ at: now(), band_hint: row.band_hint ?? "", attendee: row.full_name ?? "Public visitor", action });
    deskLog.set(eventId, log.slice(0, 8));
  };

  const assignmentRow = (assignment: StaffAssignment): AssignmentRow => {
    const person = staffList.find((s) => s.id === assignment.user_id);
    let label = "Unknown gate";
    for (const { detail } of venues.values()) {
      const gate = detail.checkpoints.find((c) => c.id === assignment.checkpoint_id);
      if (gate) label = gate.label;
    }
    return { ...assignment, staff_name: person?.name ?? "Unknown", checkpoint_label: label };
  };

  const venueRow = (detail: VenueDetail): VenueRow => {
    const held = [...records.values()].filter((r) => r.venue_id === detail.venue.id);
    return {
      venue: clone(detail.venue),
      floors: [...detail.floors],
      zones: detail.zones.length,
      rooms: detail.rooms.length,
      capacity: detail.rooms.reduce((sum, room) => sum + room.capacity, 0),
      active_events: held.filter((r) => r.state === "published" || r.state === "live").length,
      events: held.length,
      layout_published_at: detail.layout_published_at,
    };
  };

  /* ---------------------------------------------------------------- api */

  const api: ConfigureApi = {
    async setupStatus() {
      await wait();
      return {
        organization: clone(organization),
        has_published_venue: [...venues.values()].some((v) => v.detail.layout_published_at !== null),
      };
    },

    async createOrganization(body) {
      await wait();
      const fields: Record<string, string> = {};
      if (!body.name.trim()) fields.name = "Give the organisation a name.";
      if (!isTimeZone(body.timezone)) fields.timezone = "Choose a time zone from the list.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.support_email)) fields.support_email = "Enter an email address attendees can write to.";
      if (Object.keys(fields).length) throw new MockApiError("VALIDATION_FAILED", fields);
      organization = { id: orgId, ...body, name: body.name.trim() };
      return clone(organization);
    },

    async venues() {
      await wait();
      maybeFail("venues");
      return [...venues.values()].map((v) => venueRow(v.detail)).sort((a, b) => a.venue.name.localeCompare(b.venue.name));
    },

    async venue(id) {
      await wait();
      maybeFail("venue");
      const detail = needVenue(id);
      const held = [...records.values()]
        .filter((r) => r.venue_id === id)
        .map((r) => ({ id: r.id, title: r.title, state: r.state }));
      return clone({ ...detail, events: held });
    },

    async createVenue(body) {
      await wait();
      const fields: Record<string, string> = {};
      const name = body.name.trim();
      if (!name) fields.name = "Give the venue a name.";
      else if ([...venues.values()].some((v) => v.detail.venue.name.toLowerCase() === name.toLowerCase())) {
        fields.name = "A venue with this name already exists.";
      }
      if (!body.city.trim()) fields.city = "Add the city, so attendees can find it.";
      if (!isTimeZone(body.timezone)) fields.timezone = "Choose a time zone from the list.";
      const floors = body.floors.map((f) => f.trim()).filter(Boolean);
      if (floors.length === 0) fields.floors = "Add at least one floor.";
      if (new Set(floors.map((f) => f.toLowerCase())).size !== floors.length) fields.floors = "Each floor needs its own name.";
      if (body.capacity_default != null && (!Number.isInteger(body.capacity_default) || body.capacity_default < 1)) {
        fields.capacity_default = "A whole number of people, at least 1.";
      }
      if (Object.keys(fields).length) throw new MockApiError("VALIDATION_FAILED", fields);
      const id = idFor(`venue:${name}:${clock.now()}`);
      const venue: Venue = {
        id,
        org_id: orgId,
        name,
        address: body.address?.trim() || body.city.trim(),
        city: body.city.trim(),
        timezone: body.timezone,
      };
      venues.set(id, {
        detail: {
          venue,
          floors,
          capacity_default: body.capacity_default ?? null,
          grid: { w: 96, h: 60 },
          zones: [],
          rooms: [],
          checkpoints: [],
          layout_version: 0,
          layout_published_at: null,
          events: [],
        },
      });
      return clone(venue);
    },

    async publishLayout(id, body) {
      await wait();
      const detail = needVenue(id);
      if (body.expected_version !== detail.layout_version) throw new MockApiError("CONFLICT");
      const fields: Record<string, string> = {};
      if (body.zones.length === 0) fields.zones = "Add at least one zone before publishing.";
      const zoneIds = new Set(body.zones.map((z) => z.id));
      for (const room of body.rooms) {
        if (!zoneIds.has(room.zone_id)) fields[`room:${room.id}`] = `${room.name} is not inside a zone.`;
        else if (!room.name.trim()) fields[`room:${room.id}`] = "Every room needs a name.";
        else if (!Number.isInteger(room.capacity) || room.capacity < 1) fields[`room:${room.id}`] = `${room.name} needs a capacity of at least 1.`;
        else if (room.block_at_pct < room.warn_at_pct) fields[`room:${room.id}`] = `${room.name}: the stop threshold must be at or above the warning.`;
      }
      if (Object.keys(fields).length) throw new MockApiError("VALIDATION_FAILED", fields);
      detail.floors = [...body.floors];
      detail.zones = body.zones.map((zone) => ({ ...zone, venue_id: id }));
      detail.rooms = body.rooms.map((room) => ({ ...room, venue_id: id }));
      // Rooms removed from the layout leave the events that used them.
      const roomIds = new Set(detail.rooms.map((r) => r.id));
      for (const record of records.values()) {
        if (record.venue_id === id) record.rooms = record.rooms.filter((r) => roomIds.has(r.room_id));
      }
      detail.checkpoints = detail.checkpoints.filter((c) => zoneIds.has(c.zone_id) && (c.room_id === null || roomIds.has(c.room_id)));
      detail.layout_version += 1;
      detail.layout_published_at = now();
      return api.venue(id);
    },

    async eventRows() {
      await wait();
      maybeFail("eventRows");
      return [...records.values()]
        .map((record): EventRow => {
          const venue = record.venue_id ? venues.get(record.venue_id)?.detail.venue : undefined;
          const { registered, checked_in } = countsFor(record.id);
          return {
            id: record.id,
            slug: record.slug,
            title: record.title,
            state: record.state,
            starts_at: record.starts_at,
            ends_at: record.ends_at,
            timezone: record.timezone,
            venue: venue ? { id: venue.id, name: venue.name, city: venue.city ?? null } : null,
            registrations: registered,
            checked_in,
            listed: record.listed,
            updated_at: record.updated_at,
            updated_by: record.updated_by,
          };
        })
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    },

    async event(id) {
      await wait();
      maybeFail("event");
      return clone(need(id));
    },

    async createDraft(patch) {
      await wait();
      const created = now();
      const title = patch.title?.trim() ?? "";
      const base = patch.slug ?? (slugify(title) || "untitled-event");
      let slug = base;
      for (let i = 2; [...records.values()].some((r) => r.slug === slug); i++) slug = `${base}-${i}`;
      const record: EventRecord = {
        id: idFor(`event:draft:${slug}:${created}`),
        org_id: orgId,
        slug,
        title,
        description: patch.description ?? "",
        state: "draft",
        starts_at: patch.starts_at ?? null,
        ends_at: patch.ends_at ?? null,
        timezone: patch.timezone ?? organization?.timezone ?? "Africa/Kampala",
        venue_id: patch.venue_id ?? null,
        listed: patch.listed ?? true,
        grace_buffer_hours: patch.grace_buffer_hours ?? 72,
        rooms: patch.rooms ?? [],
        pass_template: patch.pass_template ?? null,
        access_rules_version: 0,
        wizard_step: patch.wizard_step ?? "basics",
        created_at: created,
        updated_at: created,
        updated_by: operator.name,
        published_at: null,
        closed_at: null,
      };
      const errors = fieldErrors(record, { ...patch, slug });
      if (Object.keys(errors).length) throw new MockApiError("VALIDATION_FAILED", errors);
      records.set(record.id, record);
      rulesByEvent.set(record.id, patch.rules ? ruleRecords(record.id, patch.rules) : []);
      sessionsByEvent.set(record.id, []);
      counts.set(record.id, { registered: 0, checked_in: 0 });
      return clone(record);
    },

    async updateEvent(id, patch) {
      await wait();
      const record = need(id);
      if (record.state === "archived") throw new MockApiError("CONFLICT");
      const errors = fieldErrors(record, patch);
      if (Object.keys(errors).length) throw new MockApiError("VALIDATION_FAILED", errors);
      const { rules, ...rest } = patch;
      if (rules) {
        if (record.state !== "draft") throw new MockApiError("CONFLICT");
        rulesByEvent.set(id, ruleRecords(id, rules));
      }
      if (rest.venue_id !== undefined && rest.venue_id !== record.venue_id) {
        // A new venue means new rooms and new rules.
        record.rooms = [];
        rulesByEvent.set(id, []);
      }
      if (rest.wizard_step) {
        const furthest = Math.max(WIZARD_STEPS.indexOf(record.wizard_step), WIZARD_STEPS.indexOf(rest.wizard_step));
        rest.wizard_step = WIZARD_STEPS[furthest] as WizardStep;
      }
      Object.assign(record, rest);
      if (rest.title !== undefined) record.title = rest.title.trim();
      touch(record);
      sync(record);
      return clone(record);
    },

    async duplicateEvent(id) {
      await wait();
      const source = need(id);
      const base = `${source.slug}-copy`;
      let slug = base;
      for (let i = 2; [...records.values()].some((r) => r.slug === slug); i++) slug = `${base}-${i}`;
      const created = now();
      const copy: EventRecord = {
        ...clone(source),
        id: idFor(`event:copy:${slug}:${created}`),
        slug,
        title: `${source.title} (copy)`,
        state: "draft",
        // Dates are the one thing a repeat always changes: cleared so the wizard asks.
        starts_at: null,
        ends_at: null,
        access_rules_version: 0,
        wizard_step: "basics",
        created_at: created,
        updated_at: created,
        updated_by: operator.name,
        published_at: null,
        closed_at: null,
      };
      records.set(copy.id, copy);
      rulesByEvent.set(
        copy.id,
        ruleRecords(copy.id, (rulesByEvent.get(id) ?? []).map(({ id: _id, event_id: _event, ...rule }) => rule)),
      );
      sessionsByEvent.set(copy.id, []);
      counts.set(copy.id, { registered: 0, checked_in: 0 });
      return clone(copy);
    },

    async deleteDraft(id) {
      await wait();
      const record = need(id);
      if (record.state !== "draft") throw new MockApiError("CONFLICT");
      records.delete(id);
      rulesByEvent.delete(id);
      sessionsByEvent.delete(id);
    },

    async readiness(id) {
      await wait(Math.min(latency, 160));
      return readinessOf(need(id));
    },

    async publishEvent(id) {
      await wait();
      const record = need(id);
      if (record.state !== "draft") throw new MockApiError("CONFLICT");
      const unmet = readinessOf(record).filter((item) => item.blocking && !item.met);
      if (unmet.length) {
        throw new MockApiError("VALIDATION_FAILED", Object.fromEntries(unmet.map((item) => [item.key, item.detail])));
      }
      record.state = "published";
      record.published_at = now();
      record.access_rules_version = Math.max(1, record.access_rules_version);
      touch(record);
      sync(record);
      return clone(record);
    },

    async transitionEvent(id, state) {
      await wait();
      const record = need(id);
      const allowed: Record<EventState, EventState[]> = {
        draft: [],
        published: ["live", "closed"],
        live: ["closed"],
        closed: ["archived"],
        archived: [],
      };
      if (!allowed[record.state].includes(state)) throw new MockApiError("CONFLICT");
      record.state = state;
      if (state === "closed") record.closed_at = now();
      touch(record);
      sync(record);
      return clone(record);
    },

    async sessions(eventId) {
      await wait();
      need(eventId);
      return clone(sessionsByEvent.get(eventId) ?? []);
    },

    async createSession(eventId, body) {
      await wait();
      const record = need(eventId);
      const session = validateSession(record, body, null);
      const list = sessionsByEvent.get(eventId) ?? [];
      list.push(session);
      list.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      sessionsByEvent.set(eventId, list);
      touch(record);
      return clone(session);
    },

    async updateSession(eventId, sessionId, body) {
      await wait();
      const record = need(eventId);
      const list = sessionsByEvent.get(eventId) ?? [];
      const index = list.findIndex((s) => s.id === sessionId);
      if (index === -1) throw new MockApiError("NOT_FOUND");
      const session = validateSession(record, body, sessionId);
      list[index] = session;
      list.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      touch(record);
      return clone(session);
    },

    async deleteSession(eventId, sessionId) {
      await wait();
      const record = need(eventId);
      const list = sessionsByEvent.get(eventId) ?? [];
      sessionsByEvent.set(eventId, list.filter((s) => s.id !== sessionId));
      touch(record);
    },

    async accessRules(eventId) {
      await wait();
      const record = need(eventId);
      return { version: record.access_rules_version, rules: clone(rulesByEvent.get(eventId) ?? []) };
    },

    async putAccessRules(eventId, body) {
      await wait();
      const record = need(eventId);
      if (body.expected_version !== record.access_rules_version) throw new MockApiError("CONFLICT");
      const roomIds = new Set(eventRooms(record).map((r) => r.id));
      if (body.rules.some((rule) => !roomIds.has(rule.room_id))) {
        throw new MockApiError("VALIDATION_FAILED", { rules: "A rule points at a room this event does not use." });
      }
      rulesByEvent.set(eventId, ruleRecords(eventId, body.rules));
      record.access_rules_version += 1;
      touch(record);
      return { version: record.access_rules_version, rules: clone(rulesByEvent.get(eventId) ?? []) };
    },

    async attendees(eventId, query = {}) {
      await wait();
      const record = need(eventId);
      const q = query.q?.trim().toLowerCase() ?? "";
      const all = attendeesFor(record);
      const items = all.filter(
        (row) =>
          (!query.tier || row.tier === query.tier) &&
          (!query.credential || row.credential_state === query.credential) &&
          (!query.unbound || row.band_hint === null) &&
          (!q ||
            row.full_name?.toLowerCase().includes(q) ||
            row.email?.toLowerCase().includes(q) ||
            row.band_hint?.toLowerCase().includes(q)),
      );
      return { items: clone(items), total: countsFor(eventId).registered };
    },

    async credentialOverview(eventId) {
      await wait();
      const record = need(eventId);
      const rows = attendeesFor(record);
      const scale = rows.length > 0 ? countsFor(eventId).registered / rows.length : 0;
      const n = (predicate: (row: AttendeeListRow) => boolean) => Math.round(rows.filter(predicate).length * scale);
      const bound = n((r) => r.band_hint !== null && r.credential_state !== "revoked");
      const credentials: Record<CredentialState, number> = {
        issued: n((r) => r.credential_state === "issued"),
        active: n((r) => r.credential_state === "active"),
        suspended_review: n((r) => r.credential_state === "suspended_review"),
        revoked: n((r) => r.credential_state === "revoked"),
        replaced: n((r) => r.credential_state === "replaced"),
      };
      const seeded = rows
        .filter((r) => r.band_hint && r.last_scan_at)
        .slice(0, 8)
        .map((r, i) => ({
          at: r.last_scan_at as string,
          band_hint: r.band_hint as string,
          attendee: r.full_name ?? "Public visitor",
          action: (i === 3 ? "replaced" : "bound") as "bound" | "replaced",
        }));
      // What the desk did on this page comes first.
      const recent = [...(deskLog.get(eventId) ?? []), ...seeded].slice(0, 8);
      return {
        by_state: {
          stock: Math.max(0, 1500 - bound),
          assigned: n((r) => r.tier === "VIP" && r.band_hint === null),
          bound: Math.round(bound * 0.1),
          active: Math.round(bound * 0.9),
          lost: n((r) => r.credential_state === "replaced"),
          retired: 4,
        },
        by_chip_profile: { ntag_uid: Math.round(bound * 0.82), ntag424_dna: Math.round(bound * 0.18) },
        credentials,
        recent,
      };
    },

    async deskAttendee(eventId, registrationId) {
      await wait(Math.min(latency, 200));
      const { row } = deskRow(eventId, registrationId);
      return deskView(row);
    },

    async bindBand(eventId, body) {
      await wait(Math.min(latency * 2, 700));
      const { row, record } = deskRow(eventId, body.registration_id);
      const identifier = checkIdentifier(body.identifier);
      deskRefuse(row);
      if (row.band_hint) {
        throw new MockApiError("CONFLICT", { identifier: "This attendee already has a band. Use Rebind or Lost band instead." });
      }
      useBand(identifier, row);
      const extra = deskExtra(row);
      row.band_hint = maskBand(identifier);
      extra.identifier = identifier;
      extra.carrier_id = idFor(`carrier:${identifier}`);
      extra.band_changed_at = now();
      if (row.credential_state === null) row.credential_state = "issued";
      extra.credential_id ??= idFor(`credential:${row.registration_id}`);
      deskCount(record.id, "bound");
      deskNote(record.id, row, "bound");
      return deskView(row);
    },

    async replaceBand(eventId, body) {
      await wait(Math.min(latency * 2, 700));
      const { row, record } = deskRow(eventId, body.registration_id);
      const identifier = checkIdentifier(body.identifier);
      if (body.reason.trim().length < 3) {
        throw new MockApiError("VALIDATION_FAILED", { reason: "Say in a few words what happened to the old band." });
      }
      deskRefuse(row);
      if (!row.band_hint) {
        throw new MockApiError("CONFLICT", { identifier: "This attendee has no band yet. Use Bind band instead." });
      }
      const extra = deskExtra(row);
      if (extra.identifier === identifier) {
        throw new MockApiError("VALIDATION_FAILED", { identifier: "That is the band they have now. Scan the new band from the box." });
      }
      useBand(identifier, row);
      if (extra.identifier) {
        usedBands.delete(extra.identifier);
        if (body.disposition === "lost") lostBands.add(extra.identifier);
      }
      if (body.disposition === "lost") {
        // 01 §5.3: old band lost, credential revoked and replaced, new band bound to the new one.
        lostByEvent.set(record.id, (lostByEvent.get(record.id) ?? 0) + 1);
        extra.credential_id = idFor(`credential:${row.registration_id}:${clock.now()}`);
        row.credential_state = row.checked_in ? "active" : "issued";
        // The old emailed pass stops working with the old credential: the new one goes out.
        extra.pass_sent_at = now();
      }
      row.band_hint = maskBand(identifier);
      extra.identifier = identifier;
      extra.carrier_id = idFor(`carrier:${identifier}`);
      extra.band_changed_at = now();
      deskCount(record.id, "replaced");
      deskNote(record.id, row, "replaced");
      return deskView(row);
    },

    async resendPass(eventId, registrationId) {
      await wait(Math.min(latency * 2, 600));
      const { row, record } = deskRow(eventId, registrationId);
      if (!row.email) {
        throw new MockApiError("VALIDATION_FAILED", { pass: "This visitor registered without an email address, so there is nowhere to send the pass. Bind a band instead." });
      }
      if (row.state !== "confirmed") {
        throw new MockApiError("VALIDATION_FAILED", { pass: row.state === "cancelled" ? "This registration is cancelled, so it has no pass." : "This registration is awaiting approval. The pass is sent when it is approved." });
      }
      if (row.credential_state === "revoked") {
        throw new MockApiError("VALIDATION_FAILED", { pass: "This pass is revoked, so it cannot be sent again." });
      }
      const extra = deskExtra(row);
      if (extra.last_resend !== null && clock.now() - extra.last_resend < 60_000) throw new MockApiError("RATE_LIMITED");
      extra.last_resend = clock.now();
      extra.pass_sent_at = now();
      deskCount(record.id, "resent");
      return deskView(row);
    },

    async reviewCredential(eventId, registrationId, body) {
      await wait(Math.min(latency * 2, 600));
      const { row } = deskRow(eventId, registrationId);
      if (row.credential_state !== "suspended_review") {
        throw new MockApiError("CONFLICT", { review: "This pass is no longer under review. Someone may have decided already." });
      }
      if (body.note.trim().length < 3) {
        throw new MockApiError("VALIDATION_FAILED", { note: "Write a short note on why: it goes in the audit log." });
      }
      row.credential_state = body.outcome === "clear" ? (row.checked_in ? "active" : "issued") : "revoked";
      return deskView(row);
    },

    async deskStock(eventId) {
      await wait(Math.min(latency, 200));
      const record = need(eventId);
      let base = stockBase.get(eventId);
      if (!base) {
        const rows = attendeesFor(record);
        const scale = rows.length > 0 ? countsFor(eventId).registered / rows.length : 0;
        const bound = Math.round(rows.filter((r) => r.band_hint !== null && r.credential_state !== "revoked").length * scale);
        base = { stock: Math.max(0, 1500 - bound), bound, lost: Math.round(rows.filter((r) => r.credential_state === "replaced").length * scale) };
        stockBase.set(eventId, base);
      }
      const today = deskToday.get(eventId) ?? { bound: 0, replaced: 0, resent: 0 };
      return {
        stock: Math.max(0, base.stock - today.bound - today.replaced),
        bound: base.bound + today.bound,
        lost: base.lost + (lostByEvent.get(eventId) ?? 0),
        today: { ...today },
      };
    },

    async staff() {
      await wait();
      return clone(staffList);
    },

    async checkpoints(eventId) {
      await wait();
      const record = need(eventId);
      return clone(record.venue_id ? (venues.get(record.venue_id)?.detail.checkpoints ?? []) : []);
    },

    async assignments(eventId) {
      await wait();
      need(eventId);
      return assignments.filter((a) => a.event_id === eventId).map(assignmentRow);
    },

    async createAssignment(eventId, body) {
      await wait();
      const record = need(eventId);
      const fields: Record<string, string> = {};
      if (!staffList.some((s) => s.id === body.user_id)) fields.user_id = "Choose a staff member.";
      const gates = record.venue_id ? (venues.get(record.venue_id)?.detail.checkpoints ?? []) : [];
      if (!gates.some((g) => g.id === body.checkpoint_id)) fields.checkpoint_id = "Choose a gate at this venue.";
      const start = Date.parse(body.shift_start);
      const end = Date.parse(body.shift_end);
      if (!Number.isFinite(start) || !Number.isFinite(end)) fields.shift = "Set the start and end of the shift.";
      else if (end <= start) fields.shift = "The shift must end after it starts.";
      if (Object.keys(fields).length) throw new MockApiError("VALIDATION_FAILED", fields);
      const clash = assignments.find(
        (a) => a.user_id === body.user_id && Date.parse(a.shift_start) < end && start < Date.parse(a.shift_end),
      );
      if (clash) {
        const row = assignmentRow(clash);
        throw new MockApiError("CONFLICT", { shift: `${row.staff_name} is already on ${row.checkpoint_label} for part of this time.` });
      }
      const assignment: StaffAssignment = {
        id: idFor(`assignment:${eventId}:${body.user_id}:${body.shift_start}:${clock.now()}`),
        ...body,
        event_id: eventId,
        handed_over_at: null,
      };
      assignments.push(assignment);
      touch(record);
      return assignmentRow(assignment);
    },

    async handover(assignmentId) {
      await wait();
      const assignment = assignments.find((a) => a.id === assignmentId);
      if (!assignment) throw new MockApiError("NOT_FOUND");
      if (assignment.handed_over_at) throw new MockApiError("CONFLICT");
      assignment.handed_over_at = now();
      const rng = createRng(hashString(`handover:${assignmentId}`));
      const admitted = int(rng, 180, 900);
      const refused = int(rng, 2, 30);
      const queued = int(rng, 0, 12);
      return {
        assignment_id: assignment.id,
        checkpoint_id: assignment.checkpoint_id,
        shift_start: assignment.shift_start,
        shift_end: assignment.shift_end,
        handed_over_at: assignment.handed_over_at,
        admitted,
        refused,
        queued,
        by_result: { admitted, already_inside: int(rng, 4, 40), denied_room: Math.ceil(refused / 2), revoked: Math.floor(refused / 2) },
      };
    },
  };

  function validateSession(record: EventRecord, body: SessionBody, existingId: string | null): EventSession {
    const fields: Record<string, string> = {};
    if (!body.title.trim()) fields.title = "Give the session a title.";
    if (!eventRooms(record).some((room) => room.id === body.room_id)) fields.room_id = "Choose one of this event's rooms.";
    const start = Date.parse(body.starts_at);
    const end = Date.parse(body.ends_at);
    if (!Number.isFinite(start) || !Number.isFinite(end)) fields.starts_at = "Set when the session starts and ends.";
    else if (end <= start) fields.ends_at = "The session must end after it starts.";
    else if (record.starts_at && record.ends_at && (start < Date.parse(record.starts_at) || end > Date.parse(record.ends_at))) {
      fields.starts_at = "Sessions must fall within the event's dates.";
    }
    if (Object.keys(fields).length) throw new MockApiError("VALIDATION_FAILED", fields);
    const clash = (sessionsByEvent.get(record.id) ?? []).find(
      (s) => s.id !== existingId && s.room_id === body.room_id && Date.parse(s.starts_at) < end && start < Date.parse(s.ends_at),
    );
    if (clash) throw new MockApiError("CONFLICT", { starts_at: `Overlaps “${clash.title}” in the same room.` });
    return {
      id: existingId ?? idFor(`session:${record.id}:${body.room_id}:${body.starts_at}:${clock.now()}`),
      event_id: record.id,
      room_id: body.room_id,
      title: body.title.trim(),
      starts_at: new Date(start).toISOString(),
      ends_at: new Date(end).toISOString(),
    };
  }

  return api;
}
