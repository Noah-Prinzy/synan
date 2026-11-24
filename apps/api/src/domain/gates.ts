/**
 * Gate health (01 §8, D-14) from one place: the `devices` table. Fixed readers and kiosks heartbeat
 * with their device token; staff phones running the Gate Scanner are registered as `scanner`
 * devices on their first heartbeat (no device token: they act through the signed-in user), one row
 * per install whoever uses it, and move with the current assignment. Heartbeats, queue depth and clock offset all land on the
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
import type { AlertService } from "./alerts.js";
import type { AuditService } from "./audit.js";

/** The offline fail-open window (01 §8, O-05). */
export const STALE_ALLOWLIST_MS = 15 * 60_000;
/** Prefix of the heartbeat-raised alert's detail (the sync-time stale_allowlist alerts read differently). */
const STALE_DETAIL = "Allowlist held at this gate is";

export function linkState(g: Pick<GateHealthDbRow, "link_state" | "queue_depth" | "clock_fault">): GateHealth["link_state"] {
  if (g.link_state !== "online") return "offline";
  return (g.queue_depth ?? 0) > 0 || g.clock_fault ? "degraded" : "online";
}

export class GateService {
  /** hardware id → device id, and the checkpoint and user it was last resolved for (saves a lookup per heartbeat). */
  private known = new Map<string, { id: string; checkpointId: string; userId: string }>();

  constructor(private readonly deps: { repos: Repos; clock: Clock; rateLimited?: (checkpointId: string, nowMs: number) => number; alerts?: AlertService; audit?: AuditService }) {}

  /** `${event}|${checkpoint}` → when a stale-allowlist alert was last raised or found open (this instance). */
  private staleSeen = new Map<string, number>();

  /**
   * A heartbeat reported the allowlist its device holds (01 §8, O-05). Older than 15 minutes, while
   * the event is live: one `stale_allowlist` alert per gate — none while one raised this way is still
   * open or acknowledged (checked in the store, so every instance agrees), at most one per 15 minutes
   * per instance otherwise. Identity-free: the alert names the gate and the age only.
   */
  async allowlistReported(i: { eventId: string | null; checkpointId: string; roomId: string | null; issuedAt: Date | null | undefined }) {
    const { repos, clock, alerts } = this.deps;
    if (!alerts || !i.eventId || !i.issuedAt) return;
    const now = clock.now();
    const ageMs = now - i.issuedAt.getTime();
    if (ageMs <= STALE_ALLOWLIST_MS) return;
    const key = `${i.eventId}|${i.checkpointId}`;
    const seen = this.staleSeen.get(key);
    if (seen !== undefined && now - seen < STALE_ALLOWLIST_MS) return;
    this.staleSeen.set(key, now);
    const event = await repos.events.byId(i.eventId);
    if (!event || event.state !== "live") return;
    const open = await repos.alerts.list({ eventId: event.id, checkpointIds: [i.checkpointId], limit: 200 });
    if (open.some((a) => a.kind === "stale_allowlist" && a.state !== "resolved" && a.detail.startsWith(STALE_DETAIL))) return;
    await alerts.raise(
      { kind: "stale_allowlist", severity: "medium", detail: `${STALE_DETAIL} ${Math.floor(ageMs / 60_000)} min old` },
      { eventId: event.id, checkpointId: i.checkpointId, roomId: i.roomId, credentialId: null, occurredAt: new Date(now) },
    );
  }

  /**
   * A staff phone's heartbeat (REST /gates/heartbeat or the `/stream/scans` heartbeat frame). The
   * caller has already checked the checkpoint is the user's current assignment.
   *
   * One install is one device: the row is keyed by the venue and the scanner's install id (hashed;
   * the id itself is never stored), whoever is signed in, so a phone handed from one person to the
   * next stays one device for gate health and allowlist age. The row records its last user; when
   * another user takes it over (or it moves gate) the allowlist age it held is cleared, and a change
   * of user is audited (`scanner.user_change`). Trust: a write needs a current assignment at the
   * checkpoint written to (checked by the caller) and the install id, a random id that only ever
   * leaves the phone in its own requests — the same proof of holding the phone that already lets the
   * next person at the gate sync the previous person's queued scans (A1). Without an install id
   * (an old stream client) the row stays per user.
   */
  async phoneHeartbeat(i: { userId: string; venueId: string; checkpointId: string; clientDeviceId: string | null | undefined; clockOffsetMs: number; queueDepth: number; online: boolean; allowlistIssuedAt?: Date | null }) {
    const { repos, audit } = this.deps;
    const install = i.clientDeviceId ? `install\n${i.venueId}\n${i.clientDeviceId}` : `user\n${i.userId}`;
    const hardwareId = `phone:${createHash("sha256").update(install).digest("hex").slice(0, 40)}`;
    const cached = this.known.get(hardwareId);
    let id = cached?.id;
    // Resolved once per install, and again when it moves to another checkpoint or another user.
    if (!cached || cached.checkpointId !== i.checkpointId || cached.userId !== i.userId) {
      const r = await repos.devices.ensureScanner({ venueId: i.venueId, hardwareId, label: "Gate Scanner (staff phone)", checkpointId: i.checkpointId, userId: i.userId });
      id = r.id;
      this.known.set(hardwareId, { id, checkpointId: i.checkpointId, userId: i.userId });
      if (r.previousUserId && audit) {
        await audit.append({ actorId: i.userId, action: "scanner.user_change", target: `device:${id}`, meta: { checkpoint_id: i.checkpointId, previous_user_id: r.previousUserId } });
      }
    }
    // A phone that reports itself offline is holding scans: count at least one queued.
    const queueDepth = i.online ? i.queueDepth : Math.max(1, i.queueDepth);
    const r = await repos.devices.heartbeat({ deviceId: id!, checkpointId: i.checkpointId, clockOffsetMs: i.clockOffsetMs, queueDepth, appVersion: null, allowlistIssuedAt: i.allowlistIssuedAt ?? null, now: new Date(this.deps.clock.now()) });
    if (r !== "ok") this.known.delete(hardwareId); // retired by an operator: re-resolved (and refused) next time
    return r;
  }

  async health(event: EventRow): Promise<GateHealth[]> {
    const { repos, clock } = this.deps;
    const now = clock.now();
    if (!event.venue_id) return []; // a draft without a venue has no gates
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
      allowlist_issued_at: g.allowlist_issued_at?.toISOString() ?? null,
      allowlist_stale: g.allowlist_stale,
    }));
  }
}
