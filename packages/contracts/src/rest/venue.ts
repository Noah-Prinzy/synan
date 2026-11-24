/** Organisation and venue endpoints (02 §5, 02 §4.1). */
import { z } from "zod";
import { Email, IanaTimezone, Id, IsoDateTime, pageOf, PageQuery } from "../common.js";
import { CapacityPolicy, CarrierKind, CheckpointDirection, EventState, GateLinkState, ScanResult } from "../enums/index.js";
import { ADMIN_ONLY, endpoint, IdParam, OPERATORS, SUPERVISE, type Access } from "./endpoint.js";

/**
 * Map geometry on the venue's abstract grid (integer grid units, origin top-left). Shapes of rooms
 * and zones only — never coordinates of people (D-04).
 */
const GridUnit = z.number().int().min(0).max(10_000);
/** Rooms are drawn as rectangles. */
export const GridRect = z.object({ kind: z.literal("rect"), x: GridUnit, y: GridUnit, w: GridUnit.min(1), h: GridUnit.min(1) });
export type GridRect = z.infer<typeof GridRect>;
/** Zones are drawn as polygons (3–64 vertices). */
export const GridPolygon = z.object({ kind: z.literal("polygon"), points: z.array(z.tuple([GridUnit, GridUnit])).min(3).max(64) });
export type GridPolygon = z.infer<typeof GridPolygon>;
/** What a write accepts for `geometry` (validated server-side); either shape on a room or a zone. */
export const GridShape = z.discriminatedUnion("kind", [GridRect, GridPolygon]);
export type GridShape = z.infer<typeof GridShape>;
/** Where a gate sits on the grid and which edge it faces (`checkpoints.position_jsonb`). */
export const GridPoint = z.object({ x: GridUnit, y: GridUnit, side: z.enum(["n", "e", "s", "w"]) });
export type GridPoint = z.infer<typeof GridPoint>;
/** The grid's extent: the smallest box holding every room and zone shape of the venue. */
export const VenueGrid = z.object({ w: z.number().int().min(0), h: z.number().int().min(0) });
export type VenueGrid = z.infer<typeof VenueGrid>;
/**
 * A room's or zone's shape: a GridShape, or null when not drawn. The database enforces the shape
 * (`grid_shape_valid`, migration 0023), so reads are typed exactly like writes.
 */
export const Geometry = GridShape.nullable();
export type Geometry = z.infer<typeof Geometry>;

export const Organization = z.object({
  id: Id,
  name: z.string().min(1).max(200),
  timezone: IanaTimezone,
  support_email: Email,
});
export type Organization = z.infer<typeof Organization>;
export const CreateOrganization = Organization.omit({ id: true });

/**
 * GET /organizations/current — the operator's organisation (single organisation in v1, O-01), and
 * whether first-run setup (06 D0) still applies: it does while no venue has a published layout.
 */
export const SetupStatus = z.object({
  organization: Organization.nullable(),
  has_published_venue: z.boolean(),
  /** Venues of the organisation, published layout or not. */
  venues: z.number().int().min(0),
});
export type SetupStatus = z.infer<typeof SetupStatus>;

/** A floor label, e.g. "Ground", "Level 1", "Mezzanine". */
export const FloorName = z.string().trim().min(1).max(50);

export const Venue = z.object({
  id: Id,
  org_id: Id,
  name: z.string().min(1).max(200),
  address: z.string().max(500),
  timezone: IanaTimezone,
  /** Shown in discovery (venues.city). Optional for backward compatibility. */
  city: z.string().max(100).nullable().optional(),
  /* ---- additive; always present in server responses ---- */
  /** Floor labels in display order (06 D2b, D3). A zone's `floor` is one of them. */
  floors: z.array(z.string().max(50)).optional(),
  /** Capacity proposed for a new room in the editor; null: none. */
  capacity_default: z.number().int().min(1).nullable().optional(),
  /** Version of the layout (floors, zones, rooms); rises with every change. PUT /venues/:id/layout names it. */
  layout_version: z.number().int().min(0).optional(),
  /** When the layout last changed; null while nothing has been drawn. */
  layout_published_at: IsoDateTime.nullable().optional(),
});
export type Venue = z.infer<typeof Venue>;
export const UpdateVenue = z
  .object({
    name: z.string().trim().min(1).max(200),
    address: z.string().max(500),
    timezone: IanaTimezone,
    city: z.string().max(100).nullable(),
    capacity_default: z.number().int().min(1).nullable(),
  })
  .partial();
/** Floors (unique, case-insensitively) default to none; zones add theirs as they are drawn. */
export const CreateVenue = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().max(500).default(""),
  timezone: IanaTimezone,
  city: z.string().trim().max(100).nullable().optional(),
  floors: z.array(FloorName).max(50).optional(),
  capacity_default: z.number().int().min(1).nullable().optional(),
});
export type CreateVenue = z.infer<typeof CreateVenue>;

/** What D2 shows per venue. */
export const VenueCounts = z.object({
  zones: z.number().int().min(0),
  rooms: z.number().int().min(0),
  checkpoints: z.number().int().min(0),
  /** Sum of the rooms' capacities. */
  capacity: z.number().int().min(0),
  /** Events held here, in any state. */
  events: z.number().int().min(0),
  /** Events held here that are published or live. */
  active_events: z.number().int().min(0),
});
export type VenueCounts = z.infer<typeof VenueCounts>;
export const VenueListItem = Venue.extend({ counts: VenueCounts });
export type VenueListItem = z.infer<typeof VenueListItem>;
export const VenueListQuery = PageQuery.extend({ q: z.string().max(100).optional() });

export const Zone = z.object({
  id: Id,
  venue_id: Id,
  name: z.string().min(1).max(200),
  floor: z.string().max(50).nullable(),
  geometry: Geometry,
});
export type Zone = z.infer<typeof Zone>;
export const CreateZone = Zone.omit({ id: true, venue_id: true }).extend({ geometry: GridShape.nullable() });
export const UpdateZone = CreateZone.partial();

export const Room = z.object({
  id: Id,
  venue_id: Id,
  zone_id: Id,
  name: z.string().min(1).max(200),
  capacity: z.number().int().min(0),
  warn_at_pct: z.number().int().min(1).max(1000).default(85),
  block_at_pct: z.number().int().min(1).max(1000).default(100),
  /** Exempt from the session-end reset (D-10). */
  continuous: z.boolean(),
  /** What happens at the blocking threshold (01 §7). Not a column in 02 §4.1; proposed. */
  capacity_policy: CapacityPolicy.default("block"),
  geometry: Geometry,
});
export type Room = z.infer<typeof Room>;
export const CreateRoom = Room.omit({ id: true }).extend({ geometry: GridShape.nullable() });
export const UpdateRoom = CreateRoom.partial();

export const RecountRequest = z.object({
  event_id: Id,
  /** Observed headcount. */
  count: z.number().int().min(0),
  note: z.string().max(500).optional(),
});
export type RecountRequest = z.infer<typeof RecountRequest>;
export const RecountResult = z.object({
  room_id: Id,
  previous: z.number().int(),
  occupancy: z.number().int(),
  adjustment_id: Id,
});
export type RecountResult = z.infer<typeof RecountResult>;

export const Checkpoint = z.object({
  id: Id,
  venue_id: Id,
  zone_id: Id,
  room_id: Id.nullable(),
  direction: CheckpointDirection,
  /** Perimeter gates and desks accept QR; interior gates are wristband-only (D-11). */
  perimeter: z.boolean(),
  hardware_id: z.string().max(200).nullable(),
  label: z.string().max(200),
  /**
   * Where the gate sits on the venue grid (a gate marker, never a person's location — D-04). Null or
   * absent: not placed. On update, null removes it and omitting it leaves it unchanged.
   */
  position: GridPoint.nullable().optional(),
});
export type Checkpoint = z.infer<typeof Checkpoint>;

/** An event held at a venue, so the editor can warn before changing a venue in use. */
export const VenueEventRef = z.object({ id: Id, title: z.string(), state: EventState });
/** GET /venues/:id: the venue, its layout (zones in display order: by floor, then position), gates and events. */
export const VenueDetail = Venue.extend({
  zones: z.array(Zone),
  rooms: z.array(Room),
  checkpoints: z.array(Checkpoint),
  /** Derived from the room and zone shapes; null when none has a shape. */
  grid: VenueGrid.nullable().optional(),
  /** Additive: events held here, newest first. */
  events: z.array(VenueEventRef).optional(),
});
export type VenueDetail = z.infer<typeof VenueDetail>;

/** One zone of a whole-layout publish. A new zone carries a new (client-chosen) id. */
export const LayoutZone = z.object({
  id: Id,
  name: z.string().trim().min(1).max(200),
  /** One of the layout's `floors`, or null. */
  floor: z.string().trim().max(50).nullable(),
  geometry: GridShape.nullable(),
});
export type LayoutZone = z.infer<typeof LayoutZone>;
/** One room of a whole-layout publish; `zone_id` names a zone of the same publish. */
export const LayoutRoom = z.object({
  id: Id,
  zone_id: Id,
  name: z.string().trim().min(1).max(200),
  capacity: z.number().int().min(0),
  warn_at_pct: z.number().int().min(1).max(1000).default(85),
  block_at_pct: z.number().int().min(1).max(1000).default(100),
  continuous: z.boolean().default(false),
  capacity_policy: CapacityPolicy.default("block"),
  geometry: GridShape.nullable(),
});
export type LayoutRoom = z.infer<typeof LayoutRoom>;
/**
 * PUT /venues/:id/layout: the whole layout as drawn in the editor (06 D3), applied in one step. Zones
 * and rooms left out are removed; a zone or room still in use (an event past draft, recorded
 * history, gates or doors on it) cannot be, and the publish is refused naming it. Refused with
 * CONFLICT when `expected_version` is not the current `layout_version`.
 */
export const PublishLayout = z.object({
  expected_version: z.number().int().min(0),
  /** Floor labels in display order; unique, case-insensitively. */
  floors: z.array(FloorName).min(1).max(50),
  zones: z.array(LayoutZone).min(1).max(500),
  rooms: z.array(LayoutRoom).max(2000),
});
export type PublishLayout = z.infer<typeof PublishLayout>;

export const CheckpointQuery = PageQuery.extend({ venue_id: Id.optional(), event_id: Id.optional() });
export const CreateCheckpoint = Checkpoint.omit({ id: true });
export type CreateCheckpoint = z.infer<typeof CreateCheckpoint>;
export const UpdateCheckpoint = Checkpoint.omit({ id: true, venue_id: true }).partial();
/** GET /checkpoints/:id/scans: scans are per event; without event_id the venue's live event is used. */
export const CheckpointScansQuery = PageQuery.extend({ event_id: Id.optional() });

/** A scan as seen by operators — ephemeral id only, never identity (03 §5). */
export const ScanRecord = z.object({
  id: Id,
  event_id: Id,
  checkpoint_id: Id,
  /**
   * Always null in general lists (GET /scans, GET /checkpoints/:id/scans): a stable per-person id
   * would let a list be regrouped into individual movement trails (03 §5). Present only in the
   * audited access-history lookup, GET /credentials/:id/scans.
   */
  ephemeral_id: z.string().nullable(),
  /** Server-derived; null for an unknown token. */
  carrier_kind: CarrierKind.nullable(),
  result: ScanResult,
  occurred_at: IsoDateTime,
  received_at: IsoDateTime,
  clock_offset_ms: z.number().int(),
  offline: z.boolean(),
  /** Additive: occurred_at + clock_offset_ms, the time the server orders the scan by (D-14). */
  corrected_at: IsoDateTime.optional(),
});
export type ScanRecord = z.infer<typeof ScanRecord>;

/**
 * GET /checkpoints/:id/activity: one gate's throughput per minute, from the per-gate, per-minute
 * rollups (D-16), so it reads the same after the purge. Oldest first, zero-filled, ending with the
 * current minute. Link-state history is not included: heartbeats keep only each device's latest
 * state, so no history is stored to derive it from.
 */
export const GateActivity = z.object({
  checkpoint_id: Id,
  event_id: Id,
  /** Start of the first minute. */
  from: IsoDateTime,
  minutes: z.array(z.object({ at: IsoDateTime, scans: z.number().int().min(0), admitted: z.number().int().min(0), denied: z.number().int().min(0) })),
  /** Physical reads by recorded result over the whole window (the failure breakdown). */
  by_result: z.record(z.string(), z.number().int().min(0)),
});
export type GateActivity = z.infer<typeof GateActivity>;
export const GateActivityQuery = z.object({
  event_id: Id,
  /** Whole minutes ending with the current one (default 15, at most 240). */
  minutes: z.coerce.number().int().min(1).max(240).default(15),
});

/**
 * Gate health from the devices at each checkpoint (fixed readers, kiosks and staff phones all
 * heartbeat as devices). `link_state`: `offline` after 60 s without a heartbeat or never heard from
 * (`heartbeat_age_s` null); `degraded` when the link is up but a device still holds unsynced scans
 * or its clock is more than two minutes out; otherwise `online`.
 */
export const GateHealth = z.object({
  checkpoint_id: Id,
  label: z.string(),
  link_state: GateLinkState,
  /** Seconds since the last heartbeat; null when the gate has never been heard from. */
  heartbeat_age_s: z.number().int().min(0).nullable().optional(),
  perimeter: z.boolean().optional(),
  last_scan_at: IsoDateTime.nullable().optional(),
  /** Scans in the last 15 minutes (implied exits excluded). */
  scans_last_15m: z.number().int().min(0).optional(),
  /** Staff assigned and on shift now (not handed over). */
  staff_on_duty: z.number().int().min(0).optional(),
  last_heartbeat_at: IsoDateTime.nullable(),
  queue_depth: z.number().int().min(0),
  clock_offset_ms: z.number().int().nullable(),
  /** Offset beyond two minutes (D-14). */
  clock_fault: z.boolean(),
  scans_last_minute: z.number().int().min(0),
  /** The gate's grid position (as Checkpoint.position); null when not placed. */
  position: GridPoint.nullable().optional(),
  /** Scans refused in the last 15 minutes by the checkpoint's per-minute scan limit (03 §4; this API instance). */
  scans_rate_limited_15m: z.number().int().min(0).optional(),
  /**
   * Additive: the oldest allowlist `issued_at` among the gate's devices heard from in the last 15
   * minutes (from their heartbeats); null when none reported one.
   */
  allowlist_issued_at: IsoDateTime.nullable().optional(),
  /** Additive: that allowlist is more than 15 minutes old (the offline fail-open window, O-05). */
  allowlist_stale: z.boolean().optional(),
});
export type GateHealth = z.infer<typeof GateHealth>;

const OPS_AND_SECURITY: readonly Access[] = ["admin", "organiser", "supervisor", "security_staff"];

export const venueEndpoints = {
  createOrganization: endpoint({ method: "POST", path: "/organizations", access: ADMIN_ONLY, audited: true, body: CreateOrganization, response: Organization, status: 201 }),
  /** Not in 02 §5: the organisation and whether first-run setup (06 D0) still applies. */
  currentOrganization: endpoint({ method: "GET", path: "/organizations/current", access: OPERATORS, response: SetupStatus }),
  /** Ordered by name. Each venue carries its counts (06 D2). */
  listVenues: endpoint({ method: "GET", path: "/venues", access: OPERATORS, query: VenueListQuery, response: pageOf(VenueListItem) }),
  createVenue: endpoint({ method: "POST", path: "/venues", access: ADMIN_ONLY, audited: true, body: CreateVenue, response: Venue, status: 201 }),
  /** `grid` (additive) is derived from the room and zone shapes; null when none has a grid shape. */
  getVenue: endpoint({ method: "GET", path: "/venues/:id", access: SUPERVISE, params: IdParam, response: VenueDetail }),
  /**
   * Not in 02 §5: whole-layout publish (06 D3). While an event at the venue is live, a fresh second
   * factor is required (capacities and rooms feed live decisions), as for republishing access rules.
   */
  publishLayout: endpoint({ method: "PUT", path: "/venues/:id/layout", access: ADMIN_ONLY, audited: true, params: IdParam, body: PublishLayout, response: VenueDetail }),
  listZones: endpoint({ method: "GET", path: "/venues/:id/zones", access: OPERATORS, params: IdParam, response: z.object({ items: z.array(Zone) }) }),
  createZone: endpoint({ method: "POST", path: "/venues/:id/zones", access: ADMIN_ONLY, audited: true, params: IdParam, body: CreateZone, response: Zone, status: 201 }),
  updateZone: endpoint({ method: "PUT", path: "/zones/:id", access: ADMIN_ONLY, audited: true, params: IdParam, body: UpdateZone, response: Zone }),
  createRoom: endpoint({ method: "POST", path: "/rooms", access: ADMIN_ONLY, audited: true, body: CreateRoom, response: Room, status: 201 }),
  updateRoom: endpoint({ method: "PUT", path: "/rooms/:id", access: ADMIN_ONLY, audited: true, params: IdParam, body: UpdateRoom, response: Room }),
  recountRoom: endpoint({ method: "POST", path: "/rooms/:id/recount", access: SUPERVISE, audited: true, params: IdParam, body: RecountRequest, response: RecountResult }),
  listCheckpoints: endpoint({ method: "GET", path: "/checkpoints", access: OPS_AND_SECURITY, query: CheckpointQuery, response: pageOf(Checkpoint) }),
  checkpointScans: endpoint({ method: "GET", path: "/checkpoints/:id/scans", access: SUPERVISE, params: IdParam, query: CheckpointScansQuery, response: pageOf(ScanRecord) }),
  /** Addition (06 D12, D12b): a gate's per-minute throughput from the rollups. */
  checkpointActivity: endpoint({ method: "GET", path: "/checkpoints/:id/activity", access: SUPERVISE, params: IdParam, query: GateActivityQuery, response: GateActivity }),
  /** Not in 02 §5: create and edit gates (the layout needs them; only GET /checkpoints was listed). */
  createCheckpoint: endpoint({ method: "POST", path: "/checkpoints", access: ADMIN_ONLY, audited: true, body: CreateCheckpoint, response: Checkpoint, status: 201 }),
  updateCheckpoint: endpoint({ method: "PUT", path: "/checkpoints/:id", access: ADMIN_ONLY, audited: true, params: IdParam, body: UpdateCheckpoint, response: Checkpoint }),
  /** Not in 02 §5: edit a venue's name, address, timezone or city. */
  updateVenue: endpoint({ method: "PUT", path: "/venues/:id", access: ADMIN_ONLY, audited: true, params: IdParam, body: UpdateVenue, response: Venue }),
  gateHealth: endpoint({ method: "GET", path: "/gates/health", access: SUPERVISE, query: z.object({ event_id: Id }), response: z.object({ items: z.array(GateHealth) }) }),
} as const;
