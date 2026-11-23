/**
 * Occupancy telemetry fan-out (02 §6, P-07).
 *
 * - Changes are coalesced per event and flushed at most once per 250 ms (≤ 4 Hz),
 *   carrying only the rooms/zones that changed since the last flush.
 * - Every flushed delta gets a cursor `<bootId>.<seq>` and is kept in a ring buffer,
 *   so a reconnecting client sending `last_event_id` gets exactly what it missed;
 *   a cursor from another boot or older than the buffer gets a fresh snapshot.
 * - One delta object is built per flush and shared by all subscribers; the public
 *   scope sees counts below k suppressed (O-08).
 *
 * Single-process. With more than one API instance this sits behind
 * PostgreSQL LISTEN/NOTIFY (D-17); the interface does not change.
 */
import { randomBytes } from "node:crypto";
import type { RoomOccupancy, TelemetryEvent, ZoneOccupancy } from "@synan/contracts/ws";
import { TELEMETRY_BATCH_MS } from "@synan/contracts/ws";
import type { Clock } from "../lib/clock.js";

export type TelemetryScope = "full" | "public";
type Send = (msg: TelemetryEvent) => void;

interface Delta {
  seq: number;
  at: string;
  rooms: RoomOccupancy[];
  zones: ZoneOccupancy[];
}

interface EventState {
  rooms: Map<string, RoomOccupancy>;
  zones: Map<string, ZoneOccupancy>;
  dirtyRooms: Set<string>;
  dirtyZones: Set<string>;
  ring: Delta[];
  seq: number;
  lastFlushAt: number;
  timer: NodeJS.Timeout | null;
  subs: Set<{ scope: TelemetryScope; send: Send }>;
}

export class TelemetryHub {
  readonly bootId = randomBytes(4).toString("hex");
  private events = new Map<string, EventState>();
  /** Counts flushes, for tests and metrics. */
  flushes = 0;

  constructor(
    private readonly clock: Clock,
    private readonly opts: { batchMs?: number; ringSize?: number; kAnon: number },
  ) {}

  private state(eventId: string): EventState {
    let s = this.events.get(eventId);
    if (!s) {
      s = {
        rooms: new Map(),
        zones: new Map(),
        dirtyRooms: new Set(),
        dirtyZones: new Set(),
        ring: [],
        seq: 0,
        lastFlushAt: 0,
        timer: null,
        subs: new Set(),
      };
      this.events.set(eventId, s);
    }
    return s;
  }

  /** Set the full state without emitting (startup / projection rebuild). */
  prime(eventId: string, rooms: RoomOccupancy[], zones: ZoneOccupancy[]) {
    const s = this.state(eventId);
    for (const r of rooms) s.rooms.set(r.room_id, r);
    for (const z of zones) s.zones.set(z.zone_id, z);
  }

  update(eventId: string, rooms: RoomOccupancy[], zones: ZoneOccupancy[]) {
    const s = this.state(eventId);
    for (const r of rooms) {
      const prev = s.rooms.get(r.room_id);
      if (prev && prev.occupancy === r.occupancy && prev.level === r.level && prev.capacity === r.capacity) continue;
      s.rooms.set(r.room_id, r);
      s.dirtyRooms.add(r.room_id);
    }
    for (const z of zones) {
      const prev = s.zones.get(z.zone_id);
      if (prev && prev.occupancy === z.occupancy) continue;
      s.zones.set(z.zone_id, z);
      s.dirtyZones.add(z.zone_id);
    }
    if (s.dirtyRooms.size || s.dirtyZones.size) this.schedule(eventId, s);
  }

  private schedule(eventId: string, s: EventState) {
    if (s.timer) return;
    const batch = this.opts.batchMs ?? TELEMETRY_BATCH_MS;
    // Wait out the batch window, and never flush sooner than `batch` after the previous flush.
    const wait = Math.max(batch, s.lastFlushAt + batch - Date.now());
    s.timer = setTimeout(() => this.flush(eventId), wait);
    s.timer.unref?.();
  }

  private flush(eventId: string) {
    const s = this.state(eventId);
    s.timer = null;
    if (!s.dirtyRooms.size && !s.dirtyZones.size) return;
    const delta: Delta = {
      seq: ++s.seq,
      at: new Date(this.clock.now()).toISOString(),
      rooms: [...s.dirtyRooms].map((id) => s.rooms.get(id)!),
      zones: [...s.dirtyZones].map((id) => s.zones.get(id)!),
    };
    s.dirtyRooms.clear();
    s.dirtyZones.clear();
    s.lastFlushAt = Date.now();
    s.ring.push(delta);
    const max = this.opts.ringSize ?? 2400; // 10 min at 4 Hz
    if (s.ring.length > max) s.ring.splice(0, s.ring.length - max);
    this.flushes++;
    const full = this.toMessage(eventId, delta, "full");
    let pub: TelemetryEvent | null = null;
    for (const sub of s.subs) {
      if (sub.scope === "full") sub.send(full);
      else sub.send((pub ??= this.toMessage(eventId, delta, "public")));
    }
  }

  private cursor(seq: number) {
    return `${this.bootId}.${seq}`;
  }

  private suppress<T extends { occupancy: number | null }>(x: T, scope: TelemetryScope): T {
    if (scope === "full" || x.occupancy === null || x.occupancy >= this.opts.kAnon) return x;
    return { ...x, occupancy: null };
  }

  private toMessage(eventId: string, d: Delta, scope: TelemetryScope): TelemetryEvent {
    return {
      id: this.cursor(d.seq),
      type: "occupancy.delta",
      at: d.at,
      data: {
        event_id: eventId,
        rooms: d.rooms.map((r) => this.suppress(r, scope)),
        zones: d.zones.map((z) => this.suppress(z, scope)),
      },
    };
  }

  snapshot(eventId: string, scope: TelemetryScope): TelemetryEvent {
    const s = this.state(eventId);
    return {
      id: this.cursor(s.seq),
      type: "occupancy.snapshot",
      at: new Date(this.clock.now()).toISOString(),
      data: {
        event_id: eventId,
        rooms: [...s.rooms.values()].map((r) => this.suppress(r, scope)),
        zones: [...s.zones.values()].map((z) => this.suppress(z, scope)),
      },
    };
  }

  /**
   * Subscribe. Returns whether the cursor resumed, and the catch-up messages to send
   * immediately (replayed deltas or one snapshot), before live deltas start arriving.
   */
  subscribe(
    eventId: string,
    scope: TelemetryScope,
    send: Send,
    lastEventId?: string,
  ): { resumed: boolean; catchUp: TelemetryEvent[]; unsubscribe: () => void } {
    const s = this.state(eventId);
    const sub = { scope, send };
    let resumed = false;
    let catchUp: TelemetryEvent[] = [];
    if (lastEventId) {
      const [boot, seqStr] = lastEventId.split(".");
      const seq = Number(seqStr);
      const oldest = s.ring[0]?.seq ?? s.seq + 1;
      if (boot === this.bootId && Number.isInteger(seq) && seq <= s.seq && seq >= oldest - 1) {
        resumed = true;
        catchUp = s.ring.filter((d) => d.seq > seq).map((d) => this.toMessage(eventId, d, scope));
      }
    }
    if (!resumed) catchUp = [this.snapshot(eventId, scope)];
    s.subs.add(sub);
    return { resumed, catchUp, unsubscribe: () => s.subs.delete(sub) };
  }

  subscriberCount(eventId: string) {
    return this.events.get(eventId)?.subs.size ?? 0;
  }

  close() {
    for (const s of this.events.values()) {
      if (s.timer) clearTimeout(s.timer);
      s.timer = null;
      s.subs.clear();
    }
  }
}
