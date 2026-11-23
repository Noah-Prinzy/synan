/** Organisation and venue endpoints (02 §5, 02 §4.1). */
import { z } from "zod";
import { Email, IanaTimezone, Id, IsoDateTime, pageOf, PageQuery } from "../common.js";
import { CapacityPolicy, CarrierKind, CheckpointDirection, GateLinkState, ScanResult } from "../enums/index.js";
import { ADMIN_ONLY, endpoint, IdParam, OPERATORS, type Access } from "./endpoint.js";

/** Optional map geometry. Abstract zone-grid shapes only, never real coordinates of people (D-04). */
export const Geometry = z.record(z.string(), z.unknown()).nullable();

export const Organization = z.object({
  id: Id,
  name: z.string().min(1).max(200),
  timezone: IanaTimezone,
  support_email: Email,
});
export type Organization = z.infer<typeof Organization>;
export const CreateOrganization = Organization.omit({ id: true });

export const Venue = z.object({
  id: Id,
  org_id: Id,
  name: z.string().min(1).max(200),
  address: z.string().max(500),
  timezone: IanaTimezone,
  /** Shown in discovery (venues.city). Optional for backward compatibility. */
  city: z.string().max(100).nullable().optional(),
});
export type Venue = z.infer<typeof Venue>;
export const UpdateVenue = Venue.omit({ id: true, org_id: true }).partial();
export const CreateVenue = Venue.omit({ id: true, org_id: true });

export const Zone = z.object({
  id: Id,
  venue_id: Id,
  name: z.string().min(1).max(200),
  floor: z.string().max(50).nullable(),
  geometry: Geometry,
});
export type Zone = z.infer<typeof Zone>;
export const CreateZone = Zone.omit({ id: true, venue_id: true });
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
export const CreateRoom = Room.omit({ id: true });
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
});
export type Checkpoint = z.infer<typeof Checkpoint>;

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
});
export type ScanRecord = z.infer<typeof ScanRecord>;

export const GateHealth = z.object({
  checkpoint_id: Id,
  label: z.string(),
  link_state: GateLinkState,
  last_heartbeat_at: IsoDateTime.nullable(),
  queue_depth: z.number().int().min(0),
  clock_offset_ms: z.number().int().nullable(),
  /** Offset beyond two minutes (D-14). */
  clock_fault: z.boolean(),
  scans_last_minute: z.number().int().min(0),
});
export type GateHealth = z.infer<typeof GateHealth>;

const OPS_AND_SECURITY: readonly Access[] = ["admin", "organiser", "security_staff"];

export const venueEndpoints = {
  createOrganization: endpoint({ method: "POST", path: "/organizations", access: ADMIN_ONLY, audited: true, body: CreateOrganization, response: Organization, status: 201 }),
  listVenues: endpoint({ method: "GET", path: "/venues", access: OPERATORS, query: PageQuery, response: pageOf(Venue) }),
  createVenue: endpoint({ method: "POST", path: "/venues", access: ADMIN_ONLY, audited: true, body: CreateVenue, response: Venue, status: 201 }),
  getVenue: endpoint({ method: "GET", path: "/venues/:id", access: OPERATORS, params: IdParam, response: Venue.extend({ zones: z.array(Zone), rooms: z.array(Room), checkpoints: z.array(Checkpoint) }) }),
  listZones: endpoint({ method: "GET", path: "/venues/:id/zones", access: OPERATORS, params: IdParam, response: z.object({ items: z.array(Zone) }) }),
  createZone: endpoint({ method: "POST", path: "/venues/:id/zones", access: ADMIN_ONLY, audited: true, params: IdParam, body: CreateZone, response: Zone, status: 201 }),
  updateZone: endpoint({ method: "PUT", path: "/zones/:id", access: ADMIN_ONLY, audited: true, params: IdParam, body: UpdateZone, response: Zone }),
  createRoom: endpoint({ method: "POST", path: "/rooms", access: ADMIN_ONLY, audited: true, body: CreateRoom, response: Room, status: 201 }),
  updateRoom: endpoint({ method: "PUT", path: "/rooms/:id", access: ADMIN_ONLY, audited: true, params: IdParam, body: UpdateRoom, response: Room }),
  recountRoom: endpoint({ method: "POST", path: "/rooms/:id/recount", access: OPERATORS, audited: true, params: IdParam, body: RecountRequest, response: RecountResult }),
  listCheckpoints: endpoint({ method: "GET", path: "/checkpoints", access: OPS_AND_SECURITY, query: CheckpointQuery, response: pageOf(Checkpoint) }),
  checkpointScans: endpoint({ method: "GET", path: "/checkpoints/:id/scans", access: OPERATORS, params: IdParam, query: CheckpointScansQuery, response: pageOf(ScanRecord) }),
  /** Not in 02 §5: create and edit gates (the layout needs them; only GET /checkpoints was listed). */
  createCheckpoint: endpoint({ method: "POST", path: "/checkpoints", access: ADMIN_ONLY, audited: true, body: CreateCheckpoint, response: Checkpoint, status: 201 }),
  updateCheckpoint: endpoint({ method: "PUT", path: "/checkpoints/:id", access: ADMIN_ONLY, audited: true, params: IdParam, body: UpdateCheckpoint, response: Checkpoint }),
  /** Not in 02 §5: edit a venue's name, address, timezone or city. */
  updateVenue: endpoint({ method: "PUT", path: "/venues/:id", access: ADMIN_ONLY, audited: true, params: IdParam, body: UpdateVenue, response: Venue }),
  gateHealth: endpoint({ method: "GET", path: "/gates/health", access: OPERATORS, query: z.object({ event_id: Id }), response: z.object({ items: z.array(GateHealth) }) }),
} as const;
