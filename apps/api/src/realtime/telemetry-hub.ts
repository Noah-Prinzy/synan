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
  /** Full-scope totals at the flush. */
  totals: { on_site: number; in_rooms: number };
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
  /** Last values sent to the public scope (suppressed). Public frames carry only changes to these. */
  pubRooms: Map<string, RoomOccupancy>;
  pubZones: Map<string, ZoneOccupancy>;
  /** People inside the perimeter (from the projection). */
  onSite: number;
  dirtyTotals: boolean;
  /** Last totals sent to the public scope (suppressed). */
  pubTotals: string;
}

export class TelemetryHub {
  readonly bootId = randomBytes(4).toString("hex");
  private events = new Map<string, EventState>();
  /** Counts flushes, for tests and metrics. */
  flushes = 0;
  /** Wall-clock times of the most recent flushes (last 100), for tests and metrics. */
  readonly flushTimes: number[] = [];

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
        pubRooms: new Map(),
        pubZones: new Map(),
        onSite: 0,
        dirtyTotals: false,
        pubTotals: JSON.stringify({ on_site: null, in_rooms: null }), // zero is below any k ≥ 1
      };
      this.events.set(eventId, s);
    }
    return s;
  }

  /** Set the full state without emitting (startup / projection rebuild). */
  prime(eventId: string, rooms: RoomOccupancy[], zones: ZoneOccupancy[], onSite?: number) {
    const s = this.state(eventId);
    if (onSite !== undefined) s.onSite = onSite;
    for (const r of rooms) {
      s.rooms.set(r.room_id, r);
      s.pubRooms.set(r.room_id, this.suppress(r, "public"));
    }
    for (const z of zones) {
      s.zones.set(z.zone_id, z);
      s.pubZones.set(z.zone_id, this.suppress(z, "public"));
    }
    s.pubTotals = JSON.stringify(this.publicView(eventId).totals);
  }

  onSiteOf(eventId: string): number {
    return this.state(eventId).onSite;
  }

  /** `onSite`: people inside the perimeter now (the projection's count), when the caller knows it. */
  update(eventId: string, rooms: RoomOccupancy[], zones: ZoneOccupancy[], onSite?: number) {
    const s = this.state(eventId);
    if (onSite !== undefined && onSite !== s.onSite) {
      s.onSite = onSite;
      s.dirtyTotals = true;
    }
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
    if (s.dirtyRooms.size || s.dirtyZones.size || s.dirtyTotals) this.schedule(eventId, s);
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
    if (!s.dirtyRooms.size && !s.dirtyZones.size && !s.dirtyTotals) return;
    s.dirtyTotals = false;
    const delta: Delta = {
      seq: ++s.seq,
      at: new Date(this.clock.now()).toISOString(),
      rooms: [...s.dirtyRooms].map((id) => s.rooms.get(id)!),
      zones: [...s.dirtyZones].map((id) => s.zones.get(id)!),
      totals: this.totalsOf(s),
    };
    s.dirtyRooms.clear();
    s.dirtyZones.clear();
    s.lastFlushAt = Date.now();
    s.ring.push(delta);
    const max = this.opts.ringSize ?? 2400; // 10 min at 4 Hz
    if (s.ring.length > max) s.ring.splice(0, s.ring.length - max);
    this.flushes++;
    this.flushTimes.push(s.lastFlushAt);
    if (this.flushTimes.length > 100) this.flushTimes.shift();
    const full = this.toMessage(eventId, delta, "full");
    const pub = this.publicDelta(eventId, s, delta);
    for (const sub of s.subs) {
      if (sub.scope === "full") sub.send(full);
      else if (pub) sub.send(pub);
    }
  }

  /**
   * The public view of a delta: only entries whose *suppressed* value changed since the last public
   * frame. A change that stays below k (or a level change on a suppressed room) produces nothing, so
   * a public viewer cannot see when a lone person moves (O-08, 03 §5). Null when nothing changed.
   */
  private publicDelta(eventId: string, s: EventState, d: Delta): TelemetryEvent | null {
    const rooms: RoomOccupancy[] = [];
    for (const r of d.rooms) {
      const v = this.suppress(r, "public");
      const prev = s.pubRooms.get(r.room_id);
      if (prev && prev.occupancy === v.occupancy && prev.level === v.level && prev.capacity === v.capacity) continue;
      s.pubRooms.set(r.room_id, v);
      rooms.push(v);
    }
    const zones: ZoneOccupancy[] = [];
    for (const z of d.zones) {
      const v = this.suppress(z, "public");
      const prev = s.pubZones.get(z.zone_id);
      if (prev && prev.occupancy === v.occupancy) continue;
      s.pubZones.set(z.zone_id, v);
      zones.push(v);
    }
    // Public totals add up only what is shown (publicView), never the full sums: total − shown rooms
    // would otherwise recover the suppressed rooms' count (O-08). The state is the delta's state here.
    const totals = this.publicView(eventId).totals;
    const totalsChanged = JSON.stringify(totals) !== s.pubTotals;
    if (!rooms.length && !zones.length && !totalsChanged) return null;
    s.pubTotals = JSON.stringify(totals);
    return { id: this.cursor(d.seq), type: "occupancy.delta", at: d.at, data: { event_id: eventId, rooms, zones, totals } };
  }

  private totalsOf(s: EventState) {
    let inRooms = 0;
    for (const r of s.rooms.values()) inRooms += r.occupancy ?? 0;
    return { on_site: s.onSite, in_rooms: inRooms };
  }

  /** Public scope: a total below k is hidden like a room count (O-08). */
  private suppressTotals(t: { on_site: number; in_rooms: number }, scope: TelemetryScope) {
    const k = (n: number) => (scope === "full" || n >= this.opts.kAnon ? n : null);
    return { on_site: k(t.on_site), in_rooms: k(t.in_rooms) };
  }

  private cursor(seq: number) {
    return `${this.bootId}.${seq}`;
  }

  /**
   * Public scope: a count below k is hidden, and so is anything derived from it — a suppressed room's
   * `level` reads "ok", because warn/block thresholds below k would otherwise state the count.
   */
  private suppress<T extends { occupancy: number | null }>(x: T, scope: TelemetryScope): T {
    if (scope === "full" || x.occupancy === null || x.occupancy >= this.opts.kAnon) return x;
    return { ...x, occupancy: null, ...("level" in x ? { level: "ok" as const } : {}) };
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
        totals: this.suppressTotals(d.totals, scope),
      },
    };
  }

  snapshot(eventId: string, scope: TelemetryScope): TelemetryEvent {
    const s = this.state(eventId);
    // The public snapshot is exactly the public read: one implementation of the public scope.
    const data =
      scope === "public"
        ? this.publicView(eventId)
        : { rooms: [...s.rooms.values()], zones: [...s.zones.values()], totals: this.suppressTotals(this.totalsOf(s), scope) };
    return {
      id: this.cursor(s.seq),
      type: "occupancy.snapshot",
      at: new Date(this.clock.now()).toISOString(),
      data: { event_id: eventId, ...data },
    };
  }

  /**
   * The public scope as a read (GET /events/:id/occupancy): rooms and zones suppressed exactly as on
   * the public stream, and totals that add up only the rooms and zones shown (each then suppressed
   * below k), so no suppressed count can be recovered by subtracting the shown ones (O-08).
   */
  publicView(eventId: string): { rooms: RoomOccupancy[]; zones: ZoneOccupancy[]; totals: { on_site: number | null; in_rooms: number | null } } {
    const s = this.state(eventId);
    const rooms = [...s.rooms.values()].map((r) => this.suppress(r, "public"));
    const zones = [...s.zones.values()].map((z) => this.suppress(z, "public"));
    const shown = (xs: { occupancy: number | null }[]) => xs.reduce((n, x) => n + (x.occupancy ?? 0), 0);
    return { rooms, zones, totals: this.suppressTotals({ on_site: shown(zones), in_rooms: shown(rooms) }, "public") };
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
    // Only the full scope resumes. A public subscriber always gets a fresh suppressed snapshot, so the
    // retained history cannot be replayed to reconstruct sub-k movements from before it connected.
    if (lastEventId && scope === "full") {
      const [boot, seqStr] = lastEventId.split(".");
      const seq = Number(seqStr);
      const oldest = s.ring[0]?.seq ?? s.seq + 1;
      if (boot === this.bootId && Number.isInteger(seq) && seq <= s.seq && seq >= oldest - 1) {
        resumed = true;
        catchUp = s.ring.filter((d) => d.seq > seq).map((d) => this.toMessage(eventId, d, "full"));
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
