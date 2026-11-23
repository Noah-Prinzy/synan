/**
 * Occupancy projection for one event (01 §7, D-10).
 *
 * Occupancy is derivable from `scans` + `occupancy_adjustments`; this class is the
 * in-memory projection of that derivation, rebuilt by replaying scans in corrected-time
 * order. It owns: room counts, who is counted where (by ephemeral id), zone presence,
 * last passage per (credential, checkpoint) for debounce, last read per credential for
 * impossible travel, and recent denials for alert escalation.
 */
import type { CapacityPolicy } from "@synan/contracts/enums";
import type { OccupancyLevel, RoomOccupancy, ZoneOccupancy } from "@synan/contracts/ws";
import { blockThreshold, warnThreshold } from "./decision.js";

export interface RoomMeta {
  id: string;
  zoneId: string;
  capacity: number;
  warnAtPct: number;
  blockAtPct: number;
  policy: CapacityPolicy;
  continuous: boolean;
}

const DENIAL_WINDOW_MS = 10 * 60_000;

export class OccupancyProjection {
  readonly roomCount = new Map<string, number>();
  /** ephemeral id → room currently counted in, and the checkpoint they were counted in through. */
  readonly presence = new Map<string, { roomId: string; checkpointId: string }>();
  /** ephemeral id → time of the last movement applied to presence. */
  readonly lastMoveAt = new Map<string, number>();
  /** ephemeral id → zone currently inside (mirror of credentials.zone_state for this event). */
  readonly zoneOf = new Map<string, string>();
  /** `${eph}|${checkpoint}` → corrected ms of last passage. */
  readonly lastPassage = new Map<string, number>();
  /** ephemeral id → last read (any known-token scan). */
  readonly lastRead = new Map<string, { checkpointId: string; atMs: number }>();
  private readonly denials = new Map<string, number[]>();
  /** Reconciliation faults (a count that would have gone negative). */
  faults = 0;

  constructor(
    readonly eventId: string,
    readonly rooms: Map<string, RoomMeta>,
    readonly zoneIds: string[],
  ) {
    for (const id of rooms.keys()) this.roomCount.set(id, 0);
  }

  count(roomId: string) {
    return this.roomCount.get(roomId) ?? 0;
  }

  /** Returns false (and clamps) when the delta would take the room below zero. */
  add(roomId: string, delta: number): boolean {
    const next = this.count(roomId) + delta;
    if (next < 0) {
      this.roomCount.set(roomId, 0);
      this.faults++;
      return false;
    }
    this.roomCount.set(roomId, next);
    return true;
  }

  recentDenials(eph: string, nowMs: number): number {
    const list = (this.denials.get(eph) ?? []).filter((t) => nowMs - t < DENIAL_WINDOW_MS);
    this.denials.set(eph, list);
    return list.length;
  }
  recordDenial(eph: string, atMs: number) {
    const list = this.denials.get(eph) ?? [];
    list.push(atMs);
    this.denials.set(eph, list);
  }

  level(roomId: string): OccupancyLevel {
    const m = this.rooms.get(roomId);
    if (!m) return "ok";
    const c = this.count(roomId);
    if (c >= blockThreshold(m)) return "block";
    if (c >= warnThreshold(m)) return "warn";
    return "ok";
  }

  roomView(roomId: string): RoomOccupancy {
    const m = this.rooms.get(roomId)!;
    return { room_id: roomId, zone_id: m.zoneId, occupancy: this.count(roomId), capacity: m.capacity, level: this.level(roomId) };
  }

  zoneCount(zoneId: string): number {
    let n = 0;
    for (const z of this.zoneOf.values()) if (z === zoneId) n++;
    return n;
  }

  zoneView(zoneId: string): ZoneOccupancy {
    return { zone_id: zoneId, occupancy: this.zoneCount(zoneId) };
  }

  allRooms(): RoomOccupancy[] {
    return [...this.rooms.keys()].map((id) => this.roomView(id));
  }
  allZones(): ZoneOccupancy[] {
    return this.zoneIds.map((id) => this.zoneView(id));
  }
}
