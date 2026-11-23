/**
 * MockRealtime: the same client interface the real WebSocket client will expose
 * (docs/02 §6), delivering contract-shaped server messages per channel, plus the
 * ability to replay the named scenarios in docs/02 §8 against a controllable clock.
 *
 * Telemetry follows the data-rate rule (P-07): occupancy changes are coalesced and
 * flushed at most once per 250 ms, only for rooms (and zones) that changed.
 *
 * Two kinds of listener:
 *   subscribe()  a client. Sees what a socket would see: nothing while the link is
 *                down (when `dropWhileDown`), then `ready` + a fresh snapshot on return.
 *   tap()        the mock server's own bookkeeping (alert table, counters). Always sees
 *                everything; never part of the client interface.
 */
import type { MockClock } from "./clock";
import type { PortalStore } from "./portal";
import { idFor } from "./random";
import { SCENARIOS, type ScenarioName } from "./scenarios";
import type {
  AlertsServerMessage,
  BreachAlert,
  GateHealth,
  MeServerMessage,
  RoomOccupancy,
  ScanResult,
  ScansServerMessage,
  TelemetryServerMessage,
  WsChannel,
  AttendeeTier,
  CarrierKind,
} from "./types";

export type MessageFor<C extends WsChannel> = C extends "/stream/telemetry"
  ? TelemetryServerMessage
  : C extends "/stream/scans"
    ? ScansServerMessage
    : C extends "/stream/alerts"
      ? AlertsServerMessage
      : MeServerMessage;

/** Link state as Admin Command's live pill and the scanner header show it. */
export type LinkStatus = "connecting" | "live" | "reconnecting" | "offline";

export interface RealtimeClient {
  subscribe<C extends WsChannel>(channel: C, handler: (message: MessageFor<C>) => void): () => void;
  status(): LinkStatus;
  onStatus(listener: (status: LinkStatus) => void): () => void;
  /** Round trip of a ping/pong, in ms. Rejects while the link is down. */
  ping(): Promise<number>;
}

export interface MockGate {
  id: string;
  label: string;
  perimeter: boolean;
  roomId: string | null;
}

export interface Playback {
  name: ScenarioName;
  stop(): void;
}

/** A room as the realtime mock needs it: where it is, how big, its thresholds. */
export interface MockRoomSpec {
  room_id: string;
  zone_id: string;
  capacity: number;
  warn_at_pct: number;
  block_at_pct: number;
  occupancy: number;
}

type AnyHandler = (message: unknown) => void;

export const TELEMETRY_FLUSH_MS = 250;

/** Messages kept for replay while a client is disconnected (alerts only, like the server's cursor). */
const REPLAY_LIMIT = 200;

export class MockRealtime implements RealtimeClient {
  readonly clock: MockClock;
  readonly portal: PortalStore | undefined;
  readonly eventId: string;
  readonly gates: MockGate[];
  /** Live room occupancy, mutated by scenarios and flushed as deltas. */
  readonly rooms = new Map<string, RoomOccupancy>();
  /** Running totals the mock server reports in GET /events/:id/summary. */
  readonly counters = { checkedIn: 0, exited: 0 };

  private thresholds = new Map<string, { warn: number; block: number }>();
  private handlers = new Map<WsChannel, Set<AnyHandler>>();
  private taps = new Map<WsChannel, Set<AnyHandler>>();
  private statusListeners = new Set<(status: LinkStatus) => void>();
  private link: LinkStatus = "live";
  private seq = 0;
  private dirty = new Set<string>();
  private flushTimer: number | null = null;
  private playing: { name: ScenarioName; timers: number[] }[] = [];
  private dropWhileDown: boolean;
  private missed: { channel: WsChannel; message: unknown }[] = [];
  private pings = 0;

  constructor(options: {
    clock: MockClock;
    portal?: PortalStore;
    eventSlug?: string;
    /** Build from a Command Center venue instead of the portal's public occupancy. */
    venue?: { eventId: string; rooms: MockRoomSpec[]; gates: MockGate[] };
    /** Behave like a socket: deliver nothing to clients while the link is down. */
    dropWhileDown?: boolean;
  }) {
    this.clock = options.clock;
    this.portal = options.portal;
    this.dropWhileDown = options.dropWhileDown ?? false;

    if (options.venue) {
      this.eventId = options.venue.eventId;
      for (const room of options.venue.rooms) {
        this.thresholds.set(room.room_id, { warn: room.warn_at_pct, block: room.block_at_pct });
        this.rooms.set(room.room_id, {
          room_id: room.room_id,
          zone_id: room.zone_id,
          capacity: room.capacity,
          occupancy: room.occupancy,
          level: this.levelFor(room.room_id, room.occupancy, room.capacity),
        });
      }
      this.gates = options.venue.gates;
      return;
    }

    const event =
      options.portal?.getEvent(options.eventSlug ?? "nexus-summit-2026") ?? options.portal?.passEvent();
    this.eventId = event?.detail.id ?? idFor("event:mock");
    for (const room of options.portal?.occupancy(this.eventId) ?? []) {
      this.rooms.set(room.room_id, { ...room });
    }
    const roomIds = [...this.rooms.keys()];
    this.gates = [
      { id: idFor("gate:north-1"), label: "Gate 1 · North", perimeter: true, roomId: null },
      { id: idFor("gate:north-2"), label: "Gate 2 · North", perimeter: true, roomId: null },
      { id: idFor("gate:west-3"), label: "Gate 3 · West", perimeter: true, roomId: null },
      { id: idFor("gate:interior-4"), label: "Door 4 · Workshop A", perimeter: false, roomId: roomIds[1] ?? null },
    ];
  }

  /* ------------------------------------------------------------ client API */

  subscribe<C extends WsChannel>(channel: C, handler: (message: MessageFor<C>) => void): () => void {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
    }
    set.add(handler as AnyHandler);
    if (this.isUp()) this.greet(channel, handler as AnyHandler, false);
    return () => set?.delete(handler as AnyHandler);
  }

  status(): LinkStatus {
    return this.link;
  }

  onStatus(listener: (status: LinkStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  ping(): Promise<number> {
    if (!this.isUp()) return Promise.reject(new Error("link down"));
    // Deterministic, plausible venue-Wi-Fi round trips: 18–46 ms.
    const rtt = 18 + ((this.pings++ * 7919) % 29);
    return new Promise((resolve) => setTimeout(() => resolve(rtt), rtt));
  }

  /** Server-side observer: sees every message regardless of the link. Not client API. */
  tap<C extends WsChannel>(channel: C, handler: (message: MessageFor<C>) => void): () => void {
    let set = this.taps.get(channel);
    if (!set) {
      set = new Set();
      this.taps.set(channel, set);
    }
    set.add(handler as AnyHandler);
    return () => set?.delete(handler as AnyHandler);
  }

  /* ----------------------------------------------------- scenario playback */

  play(name: ScenarioName): Playback {
    const timers: number[] = [];
    const entry = { name, timers };
    this.playing.push(entry);
    SCENARIOS[name]({
      rt: this,
      at: (ms, fn) => {
        timers.push(this.clock.setTimeout(fn, ms));
      },
    });
    return {
      name,
      stop: () => {
        for (const id of timers) this.clock.clearTimeout(id);
        this.playing = this.playing.filter((item) => item !== entry);
      },
    };
  }

  stopAll(): void {
    for (const entry of this.playing) for (const id of entry.timers) this.clock.clearTimeout(id);
    this.playing = [];
  }

  /* ------------------------------------------------- emitters for scenarios */

  setLink(status: LinkStatus): void {
    const wasUp = this.isUp();
    this.link = status;
    for (const listener of this.statusListeners) listener(status);
    if (!wasUp && this.isUp()) this.resume();
  }

  scan(input: {
    gate: MockGate;
    result: ScanResult;
    tier?: AttendeeTier | null;
    carrier?: CarrierKind | null;
    offline?: boolean;
    /** ms to add to "now" for corrected_at (clock-skew replays). */
    correctedOffsetMs?: number;
    /** An exit through an `out` gate. Default `in`. */
    direction?: "in" | "out";
  }): string {
    const scanId = idFor(`scan:${this.seq + 1}:${input.gate.id}`);
    // Mock simplification: every perimeter admission counts as a first check-in.
    if (input.gate.perimeter && input.result === "admitted" && input.direction !== "out") {
      this.counters.checkedIn++;
    }
    this.emit("/stream/scans", "scan.result", {
      scan_id: scanId,
      event_id: this.eventId,
      checkpoint_id: input.gate.id,
      result: input.result,
      carrier_kind: input.carrier ?? (input.gate.perimeter ? "qr_portal" : "nfc"),
      tier: input.tier === undefined ? "ORDINARY" : input.tier,
      corrected_at: new Date(this.clock.now() + (input.correctedOffsetMs ?? 0)).toISOString(),
      offline: input.offline ?? false,
    });
    return scanId;
  }

  /** Someone leaves the venue through an exit gate. */
  exit(gate: MockGate): void {
    this.counters.exited++;
    this.scan({ gate, result: "admitted", carrier: "nfc", direction: "out" });
  }

  /** Change a room's count; telemetry flushes the delta within 250 ms. */
  adjustRoom(roomId: string, delta: number): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const occupancy = Math.max(0, (room.occupancy ?? 0) + delta);
    this.setRoom(roomId, occupancy);
  }

  setRoom(roomId: string, occupancy: number): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.rooms.set(roomId, { ...room, occupancy, level: this.levelFor(roomId, occupancy, room.capacity) });
    this.dirty.add(roomId);
    if (this.flushTimer === null) {
      this.flushTimer = this.clock.setTimeout(() => this.flush(), TELEMETRY_FLUSH_MS);
    }
  }

  alert(input: Pick<BreachAlert, "kind" | "severity" | "detail"> & Partial<BreachAlert>): BreachAlert {
    const alert: BreachAlert = {
      id: idFor(`alert:${this.seq + 1}:${input.kind}`),
      event_id: this.eventId,
      checkpoint_id: null,
      credential_id: null,
      occurred_at: new Date(this.clock.now()).toISOString(),
      state: "open",
      acked_by: null,
      acked_at: null,
      resolution_note: null,
      scan_ids: [],
      ...input,
    };
    this.emit("/stream/alerts", "alert.raised", alert);
    return alert;
  }

  /** An alert changed state (acknowledged, resolved). */
  alertUpdated(alert: BreachAlert): void {
    this.emit("/stream/alerts", "alert.updated", alert);
  }

  gateHealth(gate: MockGate, patch: Partial<GateHealth>): void {
    this.emit("/stream/alerts", "gate.health", {
      checkpoint_id: gate.id,
      label: gate.label,
      link_state: "online",
      last_heartbeat_at: new Date(this.clock.now()).toISOString(),
      queue_depth: 0,
      clock_offset_ms: 0,
      clock_fault: false,
      scans_last_minute: 0,
      ...patch,
    });
  }

  passStatus(state: "active" | "revoked" | "suspended_review" | "replaced"): void {
    this.portal?.setCredentialState(state);
    this.emit("/stream/me", "pass.status", { event_id: this.eventId, state });
  }

  /* --------------------------------------------------------------- plumbing */

  private levelFor(roomId: string, occupancy: number, capacity: number): RoomOccupancy["level"] {
    const { warn, block } = this.thresholds.get(roomId) ?? { warn: 85, block: 100 };
    const pct = capacity > 0 ? (occupancy / capacity) * 100 : 0;
    return pct >= block ? "block" : pct >= warn ? "warn" : "ok";
  }

  private zoneTotals(zoneIds?: Set<string>) {
    const totals = new Map<string, number>();
    for (const room of this.rooms.values()) {
      if (zoneIds && !zoneIds.has(room.zone_id)) continue;
      totals.set(room.zone_id, (totals.get(room.zone_id) ?? 0) + (room.occupancy ?? 0));
    }
    return [...totals].map(([zone_id, occupancy]) => ({ zone_id, occupancy }));
  }

  private flush(): void {
    this.flushTimer = null;
    if (this.dirty.size === 0) return;
    const rooms = [...this.dirty].map((id) => this.rooms.get(id) as RoomOccupancy);
    this.dirty.clear();
    const zones = this.zoneTotals(new Set(rooms.map((room) => room.zone_id)));
    this.emit("/stream/telemetry", "occupancy.delta", { event_id: this.eventId, rooms, zones });
  }

  private isUp(): boolean {
    return !this.dropWhileDown || this.link === "live";
  }

  /** `ready`, then a snapshot where the channel has one — as the server does on connect. */
  private greet(channel: WsChannel, handler: AnyHandler, resumed: boolean): void {
    handler({
      type: "ready",
      channel,
      scope: channel === "/stream/me" ? "own" : "full",
      resumed,
      heartbeat_interval_ms: 15_000,
    });
    if (channel === "/stream/telemetry") {
      handler(
        this.envelope("occupancy.snapshot", {
          event_id: this.eventId,
          rooms: [...this.rooms.values()],
          zones: this.zoneTotals(),
        }),
      );
    }
  }

  /** Link back: re-greet every client, replay missed alerts, fresh telemetry snapshot. */
  private resume(): void {
    for (const [channel, set] of this.handlers) {
      for (const handler of set) this.greet(channel, handler, channel === "/stream/alerts");
    }
    const missed = this.missed;
    this.missed = [];
    for (const { channel, message } of missed) {
      for (const handler of this.handlers.get(channel) ?? []) handler(message);
    }
  }

  private envelope(type: string, data: unknown) {
    this.seq++;
    return { id: String(this.seq), type, at: new Date(this.clock.now()).toISOString(), data };
  }

  private emit(channel: WsChannel, type: string, data: unknown): void {
    this.deliver(channel, this.envelope(type, data));
  }

  private deliver(channel: WsChannel, message: unknown): void {
    for (const handler of this.taps.get(channel) ?? []) handler(message);
    if (!this.isUp()) {
      // Alerts replay from the cursor on reconnect; scans and telemetry do not
      // (telemetry is re-sent as a snapshot).
      if (channel === "/stream/alerts" && this.missed.length < REPLAY_LIMIT) {
        this.missed.push({ channel, message });
      }
      return;
    }
    for (const handler of this.handlers.get(channel) ?? []) handler(message);
  }
}
