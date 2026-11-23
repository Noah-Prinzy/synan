/**
 * Rogue scanner connections (03 §8.2: "Rogue scanner connection — assignment check in v1 — connection
 * dropped, security operations alerted").
 *
 * Called wherever a scanner or gate device is turned away: a device token or access token that is
 * unknown, malformed, retired, moved or rotated; a WebSocket ticket for `/stream/scans` that is not
 * valid; a heartbeat or scanner stream for a checkpoint the person is not staffing now; a heartbeat from
 * a retired scanner. The caller still refuses as before; this only records and alerts.
 *
 * - One `rogue_scanner` alert (severity high) per source and reason per window (10 min), however often
 *   the source retries: the source is the device id when known, else the staff user, else the
 *   client address. At most ALERTS_PER_WINDOW connection alerts per window in all, so a storm from
 *   many addresses cannot flood the alert stream; suppressed refusals are counted.
 * - The alert belongs to the live event(s) at the venue when the venue is known (device or
 *   checkpoint), else to every live event; with none live, the refusal is audited only.
 * - Each alert is audited (`security.scanner_refused`). Neither alert nor audit carries a token, a
 *   ticket or any part of one; the alert text carries no address either (the audit entry keeps it).
 */
import type { AlertService } from "./alerts.js";
import type { AuditService } from "./audit.js";
import type { Clock } from "../lib/clock.js";
import type { Repos } from "../repo/types.js";

export const ROGUE_CONNECTION_WINDOW_MS = 10 * 60_000;
const ALERTS_PER_WINDOW = 20;
const MAX_TRACKED = 10_000;

export type ScannerRefusal =
  | "unknown_device_token" // POST /auth/device-token with a token no active device holds
  | "invalid_access_token" // a malformed or forged bearer on a scanner endpoint (expiry is not a refusal)
  | "device_not_active" // the device was retired (or is not active)
  | "device_moved" // the device's checkpoint changed since its access token was minted
  | "device_token_rotated" // its device token was rotated since
  | "invalid_ws_ticket" // /stream/scans upgrade with an unknown, used, expired or revoked ticket
  | "not_assigned" // a scanner stream, ticket or heartbeat for a checkpoint not staffed now
  | "scanner_retired"; // a staff phone whose scanner device an operator retired

const REASON_TEXT: Record<ScannerRefusal, string> = {
  unknown_device_token: "unknown or revoked device token",
  invalid_access_token: "invalid access token",
  device_not_active: "device is not active",
  device_moved: "device was moved to another checkpoint",
  device_token_rotated: "device token was rotated",
  invalid_ws_ticket: "invalid stream ticket",
  not_assigned: "not assigned to this checkpoint now",
  scanner_retired: "scanner was retired",
};

export interface RefusalInput {
  reason: ScannerRefusal;
  /** Where it was refused, e.g. `POST /devices/heartbeat`, `ws /stream/scans`. */
  channel: string;
  ip: string;
  deviceId?: string | null;
  userId?: string | null;
  /** Only an id the caller has not verified; it is used only if it names a real checkpoint. */
  checkpointId?: string | null;
  venueId?: string | null;
  eventId?: string | null;
}

export class ScannerTrust {
  private seen = new Map<string, number>();
  private windowStart = 0;
  private alertsInWindow = 0;
  /** Refusals not alerted (duplicates within the window, or over the per-window cap). */
  suppressed = 0;

  constructor(private readonly deps: { repos: Repos; alerts: AlertService; audit: AuditService; clock: Clock }) {}

  /** Never throws: a failure to alert must not turn a refusal into a 500. */
  async refused(i: RefusalInput): Promise<void> {
    try {
      await this.handle(i);
    } catch (e) {
      console.error(`[security] scanner refusal not recorded: ${e instanceof Error ? e.message.slice(0, 120) : "error"}`);
    }
  }

  private async handle(i: RefusalInput) {
    const now = this.deps.clock.now();
    const source = i.deviceId ? `device:${i.deviceId}` : i.userId ? `user:${i.userId}` : `ip:${i.ip}`;
    const key = `${source}|${i.reason}`;
    const last = this.seen.get(key);
    if (last !== undefined && now - last < ROGUE_CONNECTION_WINDOW_MS) {
      this.suppressed++;
      return;
    }
    if (now - this.windowStart >= ROGUE_CONNECTION_WINDOW_MS) {
      this.windowStart = now;
      this.alertsInWindow = 0;
    }
    if (this.alertsInWindow >= ALERTS_PER_WINDOW) {
      this.suppressed++;
      return;
    }
    this.alertsInWindow++;
    this.remember(key, now);

    const { repos } = this.deps;
    const cp = i.checkpointId ? await repos.venues.checkpoint(i.checkpointId).catch(() => null) : null;
    let venueId = i.venueId ?? cp?.venue_id ?? null;
    if (!venueId && i.deviceId) venueId = (await repos.devices.byId(i.deviceId))?.venue_id ?? null;
    let eventIds: string[];
    if (i.eventId && (await repos.events.byId(i.eventId).catch(() => null))) eventIds = [i.eventId];
    else {
      const live = await repos.events.listAll({ state: "live", limit: 100 });
      eventIds = live.filter((e) => !venueId || e.venue_id === venueId).slice(0, 5).map((e) => e.id);
    }

    const label = i.deviceId ? `device ${i.deviceId}` : i.userId ? `staff user ${i.userId}` : "unrecognised client";
    const detail = `Scanner connection refused at ${i.channel}: ${REASON_TEXT[i.reason]} (${label}).`;
    const alertIds: string[] = [];
    for (const eventId of eventIds) {
      const ev = await repos.events.byId(eventId);
      const checkpointId = cp && ev && cp.venue_id === ev.venue_id ? cp.id : null;
      const row = await this.deps.alerts.raise({ kind: "rogue_scanner", severity: "high", detail }, { eventId, checkpointId, credentialId: null, occurredAt: new Date(now) });
      alertIds.push(row.id);
    }
    await this.deps.audit.append({
      actorId: i.userId ?? null,
      action: "security.scanner_refused",
      target: i.deviceId ? `device:${i.deviceId}` : i.userId ? `user:${i.userId}` : "scanner:unknown",
      meta: { reason: i.reason, channel: i.channel, ip: i.ip, checkpoint_id: cp?.id ?? null, alert_ids: alertIds },
    });
  }

  private remember(key: string, now: number) {
    if (this.seen.size >= MAX_TRACKED) {
      for (const [k, at] of this.seen) if (now - at >= ROGUE_CONNECTION_WINDOW_MS) this.seen.delete(k);
      // Still full of live entries (a very wide storm): forget the oldest half; the cap still bounds alerts.
      if (this.seen.size >= MAX_TRACKED) for (const k of [...this.seen.keys()].slice(0, MAX_TRACKED / 2)) this.seen.delete(k);
    }
    this.seen.set(key, now);
  }
}
