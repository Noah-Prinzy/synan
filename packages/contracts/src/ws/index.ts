/**
 * WebSocket contracts (02 §6). One discriminated union per channel, keyed on `type`.
 *
 * Connecting: mint a ticket with POST /auth/ws-ticket, then
 *   new WebSocket(url + channel, ticket.protocols)
 * The ticket travels in `Sec-WebSocket-Protocol`, never in the URL (P-16).
 *
 * After open, the client sends `hello` (optionally with `last_event_id`). The server
 * answers `ready`, then either replays missed events (resumed=true) or sends a
 * fresh snapshot (resumed=false). Every server event carries a monotonically
 * increasing `id` usable as the next `last_event_id`.
 */
import { z } from "zod";
import { Id, IsoDateTime } from "../common.js";
import { AttendeeTier, CarrierKind, CredentialState, ScanResult, WsChannel } from "../enums/index.js";
import { ErrorCode } from "../errors/index.js";
import { BreachAlert } from "../rest/scans.js";
import { GateHealth } from "../rest/venue.js";

/* ------------------------------------------------------------ client → server */

export const ClientHello = z.object({
  type: z.literal("hello"),
  /** Cursor from the last event received before a disconnect. */
  last_event_id: z.string().max(64).optional(),
});
export const ClientPing = z.object({ type: z.literal("ping"), t: z.number().optional() });
/** `/stream/scans` only: the scanner's heartbeat, which feeds gate health (01 §6). */
export const ClientHeartbeat = z.object({
  type: z.literal("heartbeat"),
  queue_depth: z.number().int().min(0),
  clock_offset_ms: z.number().int(),
  online: z.boolean(),
});

export const ClientMessage = z.discriminatedUnion("type", [ClientHello, ClientPing, ClientHeartbeat]);
export type ClientMessage = z.infer<typeof ClientMessage>;

/* ------------------------------------------------------------ server → client */

const envelope = <T extends string, D extends z.ZodTypeAny>(type: T, data: D) =>
  z.object({
    /** Replay cursor. Opaque; compare only for equality. */
    id: z.string(),
    type: z.literal(type),
    at: IsoDateTime,
    data,
  });

/** Control frames are not replayable and carry no `id`. */
export const ServerReady = z.object({
  type: z.literal("ready"),
  channel: WsChannel,
  /** `public` = reduced scope with k-anonymity applied (O-08). */
  scope: z.enum(["full", "public", "own"]),
  /** True when events after `last_event_id` are being replayed; false when a snapshot follows. */
  resumed: z.boolean(),
  heartbeat_interval_ms: z.number().int().positive(),
});
export const ServerPong = z.object({ type: z.literal("pong"), t: z.number().optional(), server_time: IsoDateTime });
export const ServerError = z.object({ type: z.literal("error"), code: ErrorCode, message: z.string() });

/* ---- telemetry */

export const OccupancyLevel = z.enum(["ok", "warn", "block"]);
export type OccupancyLevel = z.infer<typeof OccupancyLevel>;

export const RoomOccupancy = z.object({
  room_id: Id,
  zone_id: Id,
  /** Null when suppressed below the minimum crowd size (public scope only). */
  occupancy: z.number().int().min(0).nullable(),
  capacity: z.number().int().min(0),
  level: OccupancyLevel,
});
export type RoomOccupancy = z.infer<typeof RoomOccupancy>;

export const ZoneOccupancy = z.object({
  zone_id: Id,
  occupancy: z.number().int().min(0).nullable(),
});
export type ZoneOccupancy = z.infer<typeof ZoneOccupancy>;

export const OccupancySnapshot = envelope(
  "occupancy.snapshot",
  z.object({ event_id: Id, rooms: z.array(RoomOccupancy), zones: z.array(ZoneOccupancy) }),
);
/** Coalesced: at most one per 250 ms per connection, only rooms/zones that changed. */
export const OccupancyDelta = envelope(
  "occupancy.delta",
  z.object({ event_id: Id, rooms: z.array(RoomOccupancy), zones: z.array(ZoneOccupancy) }),
);

export const TelemetryEvent = z.discriminatedUnion("type", [OccupancySnapshot, OccupancyDelta]);
export type TelemetryEvent = z.infer<typeof TelemetryEvent>;

/* ---- scans */

export const ScanResultEvent = envelope(
  "scan.result",
  z.object({
    scan_id: Id,
    event_id: Id,
    checkpoint_id: Id,
    result: ScanResult,
    carrier_kind: CarrierKind.nullable(),
    tier: AttendeeTier.nullable(),
    corrected_at: IsoDateTime,
    offline: z.boolean(),
  }),
);
export const ScansEvent = z.discriminatedUnion("type", [ScanResultEvent]);
export type ScansEvent = z.infer<typeof ScansEvent>;

/* ---- alerts */

export const AlertRaised = envelope("alert.raised", BreachAlert);
export const AlertUpdated = envelope("alert.updated", BreachAlert);
export const GateHealthEvent = envelope("gate.health", GateHealth);
export const AlertsEvent = z.discriminatedUnion("type", [AlertRaised, AlertUpdated, GateHealthEvent]);
export type AlertsEvent = z.infer<typeof AlertsEvent>;

/* ---- me */

export const PassStatus = envelope("pass.status", z.object({ event_id: Id, state: CredentialState }));
export const EntitlementsUpdated = envelope(
  "entitlements.updated",
  z.object({ event_id: Id, permitted_room_ids: z.array(Id) }),
);
export const MeEvent = z.discriminatedUnion("type", [PassStatus, EntitlementsUpdated]);
export type MeEvent = z.infer<typeof MeEvent>;

/* ---- per-channel full server message unions */

const control = [ServerReady, ServerPong, ServerError] as const;

export const TelemetryServerMessage = z.discriminatedUnion("type", [...control, OccupancySnapshot, OccupancyDelta]);
export type TelemetryServerMessage = z.infer<typeof TelemetryServerMessage>;
export const ScansServerMessage = z.discriminatedUnion("type", [...control, ScanResultEvent]);
export type ScansServerMessage = z.infer<typeof ScansServerMessage>;
export const AlertsServerMessage = z.discriminatedUnion("type", [...control, AlertRaised, AlertUpdated, GateHealthEvent]);
export type AlertsServerMessage = z.infer<typeof AlertsServerMessage>;
export const MeServerMessage = z.discriminatedUnion("type", [...control, PassStatus, EntitlementsUpdated]);
export type MeServerMessage = z.infer<typeof MeServerMessage>;

/** Server message schema per channel path. */
export const serverMessageByChannel = {
  "/stream/telemetry": TelemetryServerMessage,
  "/stream/scans": ScansServerMessage,
  "/stream/alerts": AlertsServerMessage,
  "/stream/me": MeServerMessage,
} as const satisfies Record<WsChannel, z.ZodTypeAny>;

/** Max server data rate per channel (P-07). */
export const TELEMETRY_BATCH_MS = 250;

/** WebSocket close codes used by the server. */
export const WS_CLOSE = {
  NORMAL: 1000,
  POLICY: 1008,
  TICKET_INVALID: 4401,
  FORBIDDEN: 4403,
  BAD_MESSAGE: 4400,
} as const;
