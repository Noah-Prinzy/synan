/**
 * Gate health (01 §8, D-14) from one place: the `devices` table. Fixed readers and kiosks heartbeat
 * with their device token; staff phones running the Gate Scanner are registered as `scanner`
 * devices on their first heartbeat (no device token: they act through the signed-in user) and move
 * with the user's current assignment. Heartbeats, queue depth and clock offset all land on the
 * device and its checkpoint, so every API instance sees the same health.
 *
 * Contract mapping (@synan/db gate_health → GateHealth):
 *   unknown (never heard from) or offline (> 60 s)        → offline (heartbeat_age_s null = never)
 *   online, and a device holds unsynced scans or the
 *   clock is more than two minutes out                    → degraded
 *   otherwise                                             → online
 * `scans_last_minute` is the last complete minute's per-gate rollup (D-16); `scans_last_15m` is
 * passed through.
 */
import { createHash } from "node:crypto";
import type { GateHealth } from "@synan/contracts/rest";
import type { Clock } from "../lib/clock.js";
import type { EventRow, GateHealthDbRow, Repos } from "../repo/types.js";

export function linkState(g: Pick<GateHealthDbRow, "link_state" | "queue_depth" | "clock_fault">): GateHealth["link_state"] {
  if (g.link_state !== "online") return "offline";
  return (g.queue_depth ?? 0) > 0 || g.clock_fault ? "degraded" : "online";
}

export class GateService {
  /** hardware id → device id (device rows are stable; saves a lookup per heartbeat). */
  private known = new Map<string, string>();

  constructor(private readonly deps: { repos: Repos; clock: Clock; rateLimited?: (checkpointId: string, nowMs: number) => number }) {}

  /**
   * A staff phone's heartbeat (REST /gates/heartbeat or the `/stream/scans` heartbeat frame). The
   * caller has already checked the checkpoint is the user's current assignment. The phone's own id
   * is namespaced by the user and hashed, so one person can never write to another's device row.
   */
  async phoneHeartbeat(i: { userId: string; venueId: string; checkpointId: string; clientDeviceId: string; clockOffsetMs: number; queueDepth: number; online: boolean }) {
    const { repos } = this.deps;
    const hardwareId = `phone:${createHash("sha256").update(`${i.userId}\n${i.clientDeviceId}`).digest("hex").slice(0, 40)}`;
    let id = this.known.get(hardwareId);
    // Resolved once per phone, and again only when it moves to another checkpoint.
    if (!id || this.lastCheckpoint.get(hardwareId) !== i.checkpointId) {
      id = await repos.devices.ensureScanner({ venueId: i.venueId, hardwareId, label: "Gate Scanner (staff phone)", checkpointId: i.checkpointId });
      this.known.set(hardwareId, id);
      this.lastCheckpoint.set(hardwareId, i.checkpointId);
    }
    // A phone that reports itself offline is holding scans: count at least one queued.
    const queueDepth = i.online ? i.queueDepth : Math.max(1, i.queueDepth);
    const r = await repos.devices.heartbeat({ deviceId: id, checkpointId: i.checkpointId, clockOffsetMs: i.clockOffsetMs, queueDepth, appVersion: null, now: new Date(this.deps.clock.now()) });
    if (r !== "ok") this.known.delete(hardwareId); // retired by an operator: re-resolved (and refused) next time
    return r;
  }
  private lastCheckpoint = new Map<string, string>();

  async health(event: EventRow): Promise<GateHealth[]> {
    const { repos, clock } = this.deps;
    const now = clock.now();
    const rows = await repos.devices.gateHealth(event.venue_id, { eventId: event.id, now: new Date(now) });
    const rates = await repos.rollups.gateRates(event.id);
    const minute = Math.floor(now / 60_000) * 60_000 - 60_000;
    return rows.map((g) => ({
      checkpoint_id: g.checkpoint_id,
      label: g.label,
      link_state: linkState(g),
      heartbeat_age_s: g.heartbeat_age_s === null ? null : Math.max(0, g.heartbeat_age_s),
      perimeter: g.perimeter,
      last_scan_at: g.last_scan_at?.toISOString() ?? null,
      scans_last_15m: g.scans_last_15m,
      staff_on_duty: g.staff_on_duty,
      last_heartbeat_at: g.last_heartbeat_at?.toISOString() ?? null,
      queue_depth: Math.max(0, g.queue_depth ?? 0),
      clock_offset_ms: g.clock_offset_ms,
      clock_fault: g.clock_fault,
      scans_last_minute: rates.find((r) => r.checkpoint_id === g.checkpoint_id && r.minute_start.getTime() === minute)?.scans ?? 0,
      position: g.position ?? null,
      scans_rate_limited_15m: this.deps.rateLimited?.(g.checkpoint_id, now) ?? 0,
    }));
  }
}
