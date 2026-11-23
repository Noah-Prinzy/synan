/**
 * MockRealtime: the same client interface the real WebSocket client will expose
 * (docs/02 §6), delivering contract-shaped server messages per channel, plus the
 * ability to replay the named scenarios in docs/02 §8 against a controllable clock.
 *
 * Telemetry follows the data-rate rule (P-07): occupancy changes are coalesced and
 * flushed at most once per 250 ms, only for rooms that changed.
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

type AnyHandler = (message: unknown) => void;

export const TELEMETRY_FLUSH_MS = 250;

export class MockRealtime implements RealtimeClient {
  readonly clock: MockClock;
  readonly portal: PortalStore | undefined;
  readonly eventId: string;
  readonly gates: MockGate[];
  /** Live room occupancy, mutated by scenarios and flushed as deltas. */
  readonly rooms = new Map<string, RoomOccupancy>();

  private handlers = new Map<WsChannel, Set<AnyHandler>>();
  private statusListeners = new Set<(status: LinkStatus) => void>();
  private link: LinkStatus = "live";
  private seq = 0;
  private dirty = new Set<string>();
  private flushTimer: number | null = null;
  private playing: { name: ScenarioName; timers: number[] }[] = [];

  constructor(options: { clock: MockClock; portal?: PortalStore; eventSlug?: string }) {
    this.clock = options.clock;
    this.portal = options.portal;

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

    // Like the server: `ready`, then a snapshot where the channel has one.
    const scope = channel === "/stream/me" ? "own" : "full";
    this.deliver(channel, {
      type: "ready",
      channel,
      scope,
      resumed: false,
      heartbeat_interval_ms: 15_000,
    } as MessageFor<C>);
    if (channel === "/stream/telemetry") {
      this.deliver(channel, this.envelope("occupancy.snapshot", {
        event_id: this.eventId,
        rooms: [...this.rooms.values()],
        zones: [],
      }) as MessageFor<C>);
    }
    return () => set?.delete(handler as AnyHandler);
  }

  status(): LinkStatus {
    return this.link;
  }

  onStatus(listener: (status: LinkStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
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
    this.link = status;
    for (const listener of this.statusListeners) listener(status);
  }

  scan(input: {
    gate: MockGate;
    result: ScanResult;
    tier?: AttendeeTier | null;
    carrier?: CarrierKind | null;
    offline?: boolean;
    /** ms to add to "now" for corrected_at (clock-skew replays). */
    correctedOffsetMs?: number;
  }): string {
    const scanId = idFor(`scan:${this.seq + 1}:${input.gate.id}`);
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
    const pct = room.capacity > 0 ? (occupancy / room.capacity) * 100 : 0;
    this.rooms.set(roomId, {
      ...room,
      occupancy,
      level: pct >= 100 ? "block" : pct >= 85 ? "warn" : "ok",
    });
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

  private flush(): void {
    this.flushTimer = null;
    if (this.dirty.size === 0) return;
    const rooms = [...this.dirty].map((id) => this.rooms.get(id) as RoomOccupancy);
    this.dirty.clear();
    this.emit("/stream/telemetry", "occupancy.delta", { event_id: this.eventId, rooms, zones: [] });
  }

  private envelope(type: string, data: unknown) {
    this.seq++;
    return { id: String(this.seq), type, at: new Date(this.clock.now()).toISOString(), data };
  }

  private emit(channel: WsChannel, type: string, data: unknown): void {
    this.deliver(channel, this.envelope(type, data));
  }

  private deliver(channel: WsChannel, message: unknown): void {
    for (const handler of this.handlers.get(channel) ?? []) handler(message);
  }
}
