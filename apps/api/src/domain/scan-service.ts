/**
 * Scan ingest (POST /scans): online scans and offline sync, batch and idempotent.
 *
 * Per event (keyed on the database's canonical event id), batches are serialised. Each item is
 * authorised and timed independently; an item that fails is returned in `rejected` and does not
 * block the others (01 §8: the queue is counted exactly once).
 *
 * Time (D-14, 03 §4). The server's receipt time is the authority:
 *   - online scans (`offline: false`) are judged at receipt time — shift window, QR validity, the
 *     decision and ordering. The device time is kept as a record; a large gap raises `clock_skew`.
 *   - offline scans keep their corrected time (occurred_at + clock_offset_ms), but never later
 *     than receipt (a future time is clamped to receipt and raises `clock_skew`), and must arrive
 *     within OFFLINE_SYNC_GRACE_S of the end of the shift they were taken in.
 *   The stored clock_offset_ms is the offset the server applied, so occurred_at + clock_offset_ms
 *   (the database's generated corrected_at) is always the time the scan was judged and ordered at.
 *
 * Each accepted item: resolve token → impossible-travel check → decide() → reconcile offline
 * conflicts → persist scan → apply movement (implied exit, presence, zone, perimeter state) →
 * alerts → gate_rate_rollups → telemetry.
 */
import { createHash, randomUUID } from "node:crypto";
import { ContractError, type ErrorCode } from "@synan/contracts/errors";
import type { AttendeeTier, ScanResult } from "@synan/contracts/enums";
import type { ScanBatchRequest, ScanBatchResponse, ScanOutcome, ScanRejection, ScanSubmission } from "@synan/contracts/rest";
import { canonicalJson } from "./audit.js";
import type { AuditService } from "./audit.js";
import type { AlertService } from "./alerts.js";
import {
  CLOCK_FAULT_MS,
  decide,
  evaluateAccess,
  isDenial,
  isImpossibleTravel,
  isPassage,
  type AlertSpec,
  type ResolvedToken,
} from "./decision.js";
import { OccupancyProjection, type RoomMeta } from "./occupancy.js";
import type { AuthContext } from "./principal.js";
import type { QrService } from "./qr.js";
import { sha256b64url } from "../lib/crypto.js";
import type { Clock } from "../lib/clock.js";
import { KeyedMutex } from "../lib/mutex.js";
import { EventEmitter } from "node:events";
import type { CarrierRow, CheckpointRow, CredentialRow, EventRow, OccupancyAdjustmentRow, Repos, ScanRow } from "../repo/types.js";
import type { TelemetryHub } from "../realtime/telemetry-hub.js";

const PASSING_LOCAL: ReadonlySet<ScanResult> = new Set(["admitted", "already_inside", "offline_queued"]);

/** A device clock further than this from server time cannot be recorded (and is certainly broken). */
export const MAX_CLOCK_DRIFT_MS = 24 * 3600 * 1000;
/** One `rogue_scanner` alert per (event, checkpoint, device, reason) in this window, however often it retries. */
const ROGUE_ALERT_WINDOW_MS = 10 * 60_000;

/** NFC UIDs are stored hashed; the raw UID is never persisted. */
export function nfcIdentifier(uid: string): string {
  return sha256b64url(`nfc:${uid.toUpperCase()}`);
}

interface Resolved {
  token: ResolvedToken;
  credential: CredentialRow | null;
  carrier: CarrierRow | null;
  tier: AttendeeTier | null;
  subject: { kind: "tier" | "role"; value: string } | null;
}

export interface GateStat {
  checkpointId: string;
  lastSeenAt: number;
  /** Measured server − device offset (online) or the device's reported offset (offline). */
  clockOffsetMs: number;
  deviceId: string;
  /** Scans the device still holds unsynced (heartbeat); 0 when unknown. */
  queueDepth?: number;
}

interface Accepted {
  s: ScanSubmission;
  i: number;
  cp: CheckpointRow;
  /** The time the scan is judged and ordered at. */
  at: number;
  /** Device clock disagrees with the server beyond CLOCK_FAULT_MS. */
  skewMs: number | null;
}

export class ScanService {
  private mutex = new KeyedMutex();
  private projections = new Map<string, Promise<OccupancyProjection>>();
  private outcomeCache = new Map<string, ScanOutcome>();
  private skewAlerted = new Set<string>();
  private rogueAlerted = new Map<string, number>();
  readonly gates = new Map<string, GateStat>();
  /** Emits `scan` with a ScanResultEvent payload for every newly recorded scan. */
  readonly events = new EventEmitter();

  constructor(
    private readonly repos: Repos,
    private readonly qr: QrService,
    private readonly alerts: AlertService,
    private readonly audit: AuditService,
    private readonly telemetry: TelemetryHub,
    private readonly clock: Clock,
    private readonly opts: { offlineSyncGraceMs: number } = { offlineSyncGraceMs: 3600_000 },
  ) {}

  /* ------------------------------------------------------------ projection */

  /**
   * Drop cached projections (after a layout or event-room change); the next use rebuilds from the
   * log with the new room capacities and thresholds.
   */
  forgetProjections() {
    this.projections.clear();
  }

  /** The live projection of an event. Keyed by the canonical (database) event id only. */
  async projection(eventId: string): Promise<OccupancyProjection> {
    const event = await this.repos.events.byId(eventId);
    if (!event) throw new ContractError("NOT_FOUND", "event not found");
    let p = this.projections.get(event.id);
    if (!p) {
      p = this.build(event);
      this.projections.set(event.id, p);
      p.catch(() => this.projections.delete(event.id));
    }
    return p;
  }

  private async build(event: EventRow): Promise<OccupancyProjection> {
    const eventId = event.id;
    const eventRooms = await this.repos.events.rooms(eventId);
    const roomRows = await this.repos.venues.roomsByIds(eventRooms.map((r) => r.room_id));
    const zones = await this.repos.venues.zonesOfVenue(event.venue_id);
    const meta = new Map<string, RoomMeta>();
    for (const r of roomRows) {
      const override = eventRooms.find((er) => er.room_id === r.id)?.capacity_override;
      meta.set(r.id, {
        id: r.id,
        zoneId: r.zone_id,
        capacity: override ?? r.capacity,
        warnAtPct: r.warn_at_pct,
        blockAtPct: r.block_at_pct,
        policy: r.capacity_policy,
        continuous: r.continuous_bool,
      });
    }
    const proj = new OccupancyProjection(eventId, meta, zones.map((z) => z.id));
    // Rebuild from the append-only log (derivability, 02 §4.4): scans and adjustments merged in time order.
    const checkpoints = new Map((await this.repos.venues.checkpointsOfVenue(event.venue_id)).map((c) => [c.id, c]));
    type Step = { at: number; scan?: ScanRow; adj?: OccupancyAdjustmentRow };
    const steps: Step[] = [
      ...(await this.repos.scans.forEvent(eventId)).map((s) => ({ at: s.occurred_at.getTime() + s.clock_offset_ms, scan: s })),
      ...(await this.repos.occupancy.adjustments(eventId)).map((a) => ({ at: a.at.getTime(), adj: a })),
    ].sort((a, b) => a.at - b.at);
    for (const { at, scan: s, adj } of steps) {
      if (adj) {
        if (adj.set_to !== null) proj.setAnchor(adj.room_id, adj.set_to, at);
        else proj.add(adj.room_id, adj.delta);
        continue;
      }
      const cp = s ? checkpoints.get(s.checkpoint_id) : undefined;
      if (!s || !cp || s.ephemeral_id === null) continue;
      if (s.result === "implied_exit") continue; // re-derived by applyMovement
      const eph = s.ephemeral_id;
      if (s.carrier_kind !== null) proj.lastRead.set(eph, { checkpointId: cp.id, atMs: at });
      if (isPassage(s.result)) {
        proj.lastPassage.set(`${eph}|${cp.id}`, at);
        if (s.result === "admitted") this.applyMovement(proj, eph, cp, s.direction, at, null, s.id);
        else this.notePresence(proj, eph, cp, s.id);
        if (s.carrier_kind === "qr_email" && s.direction === "in" && !proj.emailRedeemScan.has(eph)) proj.emailRedeemScan.set(eph, s.id);
      } else if (isDenial(s.result)) proj.recordDenial(eph, at);
    }
    this.telemetry.prime(eventId, proj.allRooms(), proj.allZones());
    return proj;
  }

  /** An `already_inside` passage: the holder is in this zone (and, at a perimeter, inside it). */
  private notePresence(proj: OccupancyProjection, eph: string, cp: CheckpointRow, scanId: string) {
    proj.zoneOf.set(eph, cp.zone_id);
    if (cp.perimeter_bool && !proj.perimeterOf.has(eph)) {
      proj.perimeterOf.set(eph, cp.zone_id);
      proj.perimeterEntry.set(eph, { checkpointId: cp.id, scanId });
    }
  }

  /**
   * Apply an admitted passage to presence, counts and perimeter state. Returns the room left by an
   * implied exit, if any.
   * - Late scans (older than the credential's last movement) are recorded but do not move anything.
   * - A count change older than the room's last anchor (recount / reset) is skipped: the anchor
   *   already includes it (02 §4.4). Live and rebuilt projections therefore agree.
   */
  private applyMovement(
    proj: OccupancyProjection,
    eph: string,
    cp: CheckpointRow,
    direction: "in" | "out",
    atMs: number,
    changed: Set<string> | null,
    scanId: string,
  ): { impliedExit: { roomId: string; checkpointId: string } | null; fault: boolean } {
    const last = proj.lastMoveAt.get(eph);
    if (last !== undefined && atMs < last) return { impliedExit: null, fault: false };
    proj.lastMoveAt.set(eph, atMs);
    let impliedExit: { roomId: string; checkpointId: string } | null = null;
    let fault = false;
    const current = proj.presence.get(eph);
    const leave = (roomId: string) => {
      if (proj.beforeAnchor(roomId, atMs)) return;
      fault = !proj.add(roomId, -1) || fault;
      changed?.add(roomId);
    };
    if (direction === "in") {
      proj.zoneOf.set(eph, cp.zone_id);
      if (cp.perimeter_bool) {
        if (!proj.perimeterOf.has(eph)) proj.perimeterEntry.set(eph, { checkpointId: cp.id, scanId });
        proj.perimeterOf.set(eph, cp.zone_id);
      }
      if (cp.room_id && proj.rooms.has(cp.room_id)) {
        if (current && current.roomId !== cp.room_id) {
          leave(current.roomId);
          impliedExit = current;
          proj.presence.delete(eph);
        }
        if (current?.roomId !== cp.room_id) {
          if (!proj.beforeAnchor(cp.room_id, atMs)) {
            proj.add(cp.room_id, 1);
            changed?.add(cp.room_id);
            proj.presence.set(eph, { roomId: cp.room_id, checkpointId: cp.id });
          } else if ((proj.anchorValue.get(cp.room_id) ?? 0) > 0) {
            // Already in the headcount the anchor recorded; a recount to zero would have un-counted them.
            proj.presence.set(eph, { roomId: cp.room_id, checkpointId: cp.id });
          }
        }
      }
    } else {
      if (cp.room_id && proj.rooms.has(cp.room_id)) {
        leave(cp.room_id);
        if (current?.roomId === cp.room_id) proj.presence.delete(eph);
      }
      if (cp.perimeter_bool) {
        // Leaving through the perimeter leaves every room and the zone.
        const still = proj.presence.get(eph);
        if (still && still.roomId !== cp.room_id) {
          leave(still.roomId);
          impliedExit = still;
        }
        proj.presence.delete(eph);
        proj.zoneOf.delete(eph);
        proj.perimeterOf.delete(eph);
        proj.perimeterEntry.delete(eph);
      }
    }
    return { impliedExit, fault };
  }

  /* ---------------------------------------------------------------- resolve */

  private async resolve(event: EventRow, p: ScanSubmission["presented"], atMs: number): Promise<Resolved> {
    const unknown = (reason: Extract<ResolvedToken, { known: false }>["reason"]): Resolved => ({
      token: { known: false, medium: p.medium, reason },
      credential: null,
      carrier: null,
      tier: null,
      subject: null,
    });

    let credential: CredentialRow | null = null;
    let carrier: CarrierRow | null = null;
    let carrierKind: "qr_portal" | "qr_email" | "nfc";
    let emailSpent = false;

    if (p.medium === "qr") {
      const v = await this.qr.verify(p.data, atMs);
      if (!v.ok) return unknown(v.reason);
      credential = await this.repos.credentials.byTokenHash(v.credentialRef);
      if (!credential) return unknown("unknown_credential");
      if (v.typ === "email") {
        carrierKind = "qr_email";
        carrier = await this.repos.carriers.byIdentifier("qr_email", sha256b64url(v.carrierCid));
        if (!carrier || carrier.credential_id !== credential.id) return unknown("unknown_carrier");
        // A resend retires the previous emailed code; a retired emailed code reads as spent.
        emailSpent = carrier.redeemed_at !== null || carrier.state === "retired";
      } else {
        carrierKind = "qr_portal";
      }
    } else {
      carrierKind = "nfc";
      carrier = await this.repos.carriers.byIdentifier("nfc", nfcIdentifier(p.uid));
      if (!carrier) return unknown("unknown_carrier");
      if (!carrier.credential_id || carrier.state === "stock" || carrier.state === "assigned") return unknown("carrier_unbound");
      credential = await this.repos.credentials.byId(carrier.credential_id);
      if (!credential) return unknown("unknown_credential");
    }

    let tier: AttendeeTier | null = null;
    let subject: Resolved["subject"] = null;
    if (credential.registration_id) {
      const reg = await this.repos.registrations.byId(credential.registration_id);
      if (!reg || reg.event_id !== event.id) return unknown("wrong_event");
      if (reg.state === "cancelled") return unknown("unknown_credential");
      tier = reg.tier;
      subject = { kind: "tier", value: reg.tier };
    } else if (credential.staff_user_id) {
      const user = await this.repos.users.byId(credential.staff_user_id);
      if (!user) return unknown("unknown_credential");
      subject = { kind: "role", value: user.role };
    }

    // Retired emailed QR is "spent", not "revoked": keep its carrier state out of step 3.
    const carrierState = carrierKind === "qr_email" ? null : (carrier?.state ?? null);
    return {
      token: { known: true, medium: p.medium, carrierKind, carrierState, emailSpent },
      credential,
      carrier,
      tier,
      subject,
    };
  }

  /* ----------------------------------------------------------------- ingest */

  async ingest(principal: AuthContext, req: ScanBatchRequest): Promise<ScanBatchResponse> {
    // Lock on the database's id, never the request string (a case variant must not get its own lock).
    const event = await this.repos.events.byId(req.event_id);
    if (!event) throw new ContractError("NOT_FOUND", "event not found");
    return this.mutex.run(event.id, () => this.ingestLocked(principal, event.id, req));
  }

  /**
   * What makes two submissions "the same scan" for idempotency, built only from stored columns
   * that do not depend on server time (the presented token itself is never stored).
   */
  private fingerprint(s: { checkpoint_id: string; occurred_at: number; offline: boolean; local_result: ScanResult | null }): string {
    return createHash("sha256").update(canonicalJson(s)).digest("hex");
  }
  private fpOfSubmission(s: ScanSubmission) {
    return this.fingerprint({
      checkpoint_id: s.checkpoint_id,
      occurred_at: Date.parse(s.occurred_at),
      offline: s.offline,
      local_result: s.local_result ?? null,
    });
  }
  private fpOfRow(r: ScanRow) {
    return this.fingerprint({
      checkpoint_id: r.checkpoint_id,
      occurred_at: r.occurred_at.getTime(),
      offline: r.offline_bool,
      local_result: r.local_result,
    });
  }

  private async ingestLocked(principal: AuthContext, eventId: string, req: ScanBatchRequest): Promise<ScanBatchResponse> {
    const receivedAt = this.clock.now();
    const event = await this.repos.events.byId(eventId);
    if (!event) throw new ContractError("NOT_FOUND", "event not found");
    if (event.state !== "live") throw new ContractError("EVENT_NOT_LIVE");

    // A fixed reader (O-17) is permanently assigned to its one checkpoint; it has no shift.
    const assignments =
      principal.kind === "device"
        ? principal.checkpointId
          ? [{ id: principal.sub, user_id: principal.sub, checkpoint_id: principal.checkpointId, shift_start: new Date(-8.64e15), shift_end: new Date(8.64e15) }]
          : []
        : await this.repos.staff.assignmentsFor(principal.sub);
    // A device is named by its authenticated id, never by what the request claims.
    const deviceId = principal.kind === "device" ? `device:${principal.sub}` : req.device_id;
    const staffUserId = principal.kind === "device" ? null : principal.sub;
    const checkpoints = new Map<string, CheckpointRow | null>();
    const results = new Map<string, ScanOutcome>();
    const rejected: ScanRejection[] = [];
    const rogue = new Map<string, { checkpointId: string; why: string }>();
    const accepted: Accepted[] = [];
    const seenInBatch = new Map<string, string>();

    const reject = (s: ScanSubmission, code: ErrorCode, message: string) => rejected.push({ idem_key: s.idem_key, code, message });

    for (const [i, s] of req.scans.entries()) {
      // Idempotency first: a replay of a stored scan returns its original outcome, whatever the time now.
      const fp = this.fpOfSubmission(s);
      const prior = seenInBatch.get(s.idem_key);
      if (prior !== undefined) {
        if (prior !== fp) reject(s, "IDEMPOTENCY_CONFLICT", "Another scan in this batch uses the same idem_key.");
        continue;
      }
      seenInBatch.set(s.idem_key, fp);
      const existing = await this.repos.scans.byIdemKey(event.id, s.idem_key);
      if (existing) {
        if (this.fpOfRow(existing) !== fp) {
          reject(s, "IDEMPOTENCY_CONFLICT", "A different scan was already stored with this idem_key.");
          continue;
        }
        const cp = await this.checkpointOf(checkpoints, existing.checkpoint_id);
        results.set(s.idem_key, { ...this.outcomeOf(existing, cp), replayed: true });
        continue;
      }

      const cp = await this.checkpointOf(checkpoints, s.checkpoint_id);
      if (!cp || cp.venue_id !== event.venue_id) {
        reject(s, "NOT_FOUND", "Checkpoint not found for this event.");
        continue;
      }
      if (cp.direction === "both" && !s.direction) {
        reject(s, "VALIDATION_FAILED", "direction is required at a two-way checkpoint.");
        continue;
      }

      // Time: receipt time is the authority.
      const rawAt = Date.parse(s.occurred_at) + s.clock_offset_ms;
      const drift = rawAt - receivedAt;
      if (Math.abs(drift) > MAX_CLOCK_DRIFT_MS && (!s.offline || drift > 0)) {
        reject(s, "VALIDATION_FAILED", "Device time is more than 24 hours from server time; resync the clock.");
        continue;
      }
      let at: number;
      let skewMs: number | null = null;
      if (!s.offline) {
        at = receivedAt; // an online scan happens now
        if (Math.abs(drift) > CLOCK_FAULT_MS) skewMs = drift;
      } else if (drift > CLOCK_FAULT_MS) {
        at = receivedAt; // nothing happens after it is received
        skewMs = drift;
      } else {
        at = Math.min(rawAt, receivedAt);
      }

      // Authorisation (03 §4): assigned to this checkpoint, inside the shift, synced in time.
      const mine = assignments.filter((a) => a.checkpoint_id === cp.id);
      if (mine.length === 0) {
        reject(s, "CHECKPOINT_NOT_ASSIGNED", "You are not assigned to this checkpoint.");
        rogue.set(`${cp.id}|not assigned`, { checkpointId: cp.id, why: "not assigned" });
        continue;
      }
      const grace = this.opts.offlineSyncGraceMs;
      const inShift = mine.some(
        (a) => at >= a.shift_start.getTime() && at < a.shift_end.getTime() && (!s.offline || receivedAt < a.shift_end.getTime() + grace),
      );
      if (!inShift) {
        const late = s.offline && mine.some((a) => at >= a.shift_start.getTime() && at < a.shift_end.getTime());
        reject(s, "OUTSIDE_SHIFT", late ? "Offline scans must be synced within the grace period after the shift." : "Not inside your assigned shift.");
        rogue.set(`${cp.id}|outside shift`, { checkpointId: cp.id, why: late ? "synced after shift grace" : "outside shift" });
        continue;
      }
      accepted.push({ s, i, cp, at, skewMs });
    }

    for (const { checkpointId, why } of rogue.values()) await this.rogueAlert(event.id, checkpointId, deviceId, why, receivedAt);

    const proj = await this.projection(event.id);
    const changed = new Set<string>();
    const zonesBefore = new Map(proj.allZones().map((z) => [z.zone_id, z.occupancy]));
    accepted.sort((a, b) => a.at - b.at || a.i - b.i);
    for (const item of accepted) {
      const out = await this.applyOne(event, item, receivedAt, deviceId, staffUserId, proj, changed);
      results.set(item.s.idem_key, out);
      // `/stream/scans`: no credential, no person, only what the gate showed.
      this.events.emit("scan", { scan_id: out.scan_id, event_id: event.id, checkpoint_id: item.cp.id, result: out.result, carrier_kind: out.carrier_kind, tier: out.tier, corrected_at: out.corrected_at, offline: item.s.offline });
    }

    // Telemetry: only what changed; the hub coalesces to ≤ 4 Hz.
    const zoneChanges = proj.allZones().filter((z) => zonesBefore.get(z.zone_id) !== z.occupancy);
    if (changed.size || zoneChanges.length) {
      this.telemetry.update(event.id, [...changed].filter((id) => proj.rooms.has(id)).map((id) => proj.roomView(id)), zoneChanges);
    }

    return {
      results: req.scans.filter((s) => results.has(s.idem_key)).map((s) => results.get(s.idem_key)!),
      rejected,
      server_time: new Date(this.clock.now()).toISOString(),
    };
  }

  private async checkpointOf(cache: Map<string, CheckpointRow | null>, id: string) {
    if (!cache.has(id)) cache.set(id, await this.repos.venues.checkpoint(id));
    return cache.get(id) ?? null;
  }

  /** At most one rogue_scanner alert per (event, checkpoint, device, reason) per window, however often it retries. */
  private async rogueAlert(eventId: string, checkpointId: string, deviceId: string, why: string, now: number) {
    const k = `${eventId}|${checkpointId}|${deviceId}|${why}`;
    const last = this.rogueAlerted.get(k);
    if (last !== undefined && now - last < ROGUE_ALERT_WINDOW_MS) return;
    this.rogueAlerted.set(k, now);
    await this.alerts.raise(
      { kind: "rogue_scanner", severity: "high", detail: `Scan refused: ${why} (device ${deviceId.slice(0, 32)})` },
      { eventId, checkpointId, credentialId: null, occurredAt: new Date(now) },
    );
  }

  private outcomeOf(row: ScanRow, cp: CheckpointRow | null): ScanOutcome {
    return (
      this.outcomeCache.get(row.id) ?? {
        idem_key: row.idem_key,
        scan_id: row.id,
        result: row.result,
        carrier_kind: row.carrier_kind,
        tier: null,
        room_id: cp?.room_id ?? null,
        corrected_at: new Date(row.occurred_at.getTime() + row.clock_offset_ms).toISOString(),
        replayed: false,
        alert_ids: [],
      }
    );
  }

  private async applyOne(
    event: EventRow,
    { s, cp, at, skewMs }: Accepted,
    receivedAt: number,
    deviceId: string,
    staffUserId: string | null,
    proj: OccupancyProjection,
    changed: Set<string>,
  ): Promise<ScanOutcome> {
    const scanId = randomUUID();
    const direction: "in" | "out" = cp.direction === "both" ? (s.direction ?? "in") : cp.direction;
    const r = await this.resolve(event, s.presented, at);
    // Projection key; only meaningful (and only persisted) when the credential is known.
    const eph = r.credential ? await this.repos.ephemeralIds.getOrCreate(event.id, r.credential.id) : `unknown:${scanId}`;
    const pendingAlerts: { spec: AlertSpec; credentialId: string | null; extraScanIds?: string[] }[] = [];

    // Gate health: clock offset (D-14). Online: measured against receipt; offline: as reported.
    const measuredOffset = s.offline ? s.clock_offset_ms : receivedAt - Date.parse(s.occurred_at);
    this.gates.set(cp.id, { checkpointId: cp.id, lastSeenAt: receivedAt, clockOffsetMs: measuredOffset, deviceId });
    const skew = skewMs ?? (Math.abs(s.clock_offset_ms) > CLOCK_FAULT_MS ? -s.clock_offset_ms : null);
    if (skew !== null && !this.skewAlerted.has(`${event.id}|${deviceId}`)) {
      this.skewAlerted.add(`${event.id}|${deviceId}`);
      pendingAlerts.push({
        spec: { kind: "clock_skew", severity: "low", detail: `Scanner clock off by ${Math.round(skew / 1000)} s` },
        credentialId: null,
      });
    }

    let credential = r.credential;
    // Impossible travel → suspend for review before deciding (01 §7, D-06).
    let travelDetected = false;
    if (credential && credential.state !== "suspended_review" && credential.state !== "revoked" && credential.state !== "replaced") {
      const prev = proj.lastRead.get(eph) ?? null;
      const transit = await this.transitLookup(event.venue_id);
      if (isImpossibleTravel(prev, { checkpointId: cp.id, atMs: at }, transit)) {
        travelDetected = true;
        credential = await this.repos.credentials.update(credential.id, { state: "suspended_review" });
        pendingAlerts.push({
          spec: {
            kind: "impossible_travel",
            severity: "high",
            detail: `Read at ${prev!.checkpointId} then ${cp.id} after ${Math.round((at - prev!.atMs) / 1000)} s`,
          },
          credentialId: credential.id,
        });
      }
    }

    const room = cp.room_id ? proj.rooms.get(cp.room_id) : undefined;
    const rules = r.subject ? await this.repos.events.accessRules(event.id) : [];
    const entitled =
      r.subject !== null &&
      (cp.room_id === null || proj.rooms.has(cp.room_id)) &&
      evaluateAccess(
        rules.map((x) => ({
          subject_kind: x.subject_kind,
          subject: x.subject,
          room_id: x.room_id,
          window_start: x.window_start?.getTime() ?? null,
          window_end: x.window_end?.getTime() ?? null,
          effect: x.effect,
        })),
        r.subject,
        cp.room_id,
        at,
      );

    // A scan older than the room's last recount is already in that headcount: no capacity judgement.
    const roomForDecision = room && !proj.beforeAnchor(room.id, at) ? room : undefined;
    const perimeterZone = proj.perimeterOf.get(eph);
    const decision = decide({
      token: r.token,
      credentialState: credential?.state ?? null,
      zoneState: perimeterZone !== undefined ? `INSIDE_${perimeterZone}` : "OUTSIDE",
      checkpoint: { perimeter: cp.perimeter_bool, zoneId: cp.zone_id, roomId: cp.room_id },
      direction,
      nowMs: at,
      lastPassageHereMs: proj.lastPassage.get(`${eph}|${cp.id}`) ?? null,
      entitled,
      currentRoomId: proj.presence.get(eph)?.roomId ?? null,
      room: roomForDecision
        ? {
            occupancy: proj.count(roomForDecision.id),
            capacity: roomForDecision.capacity,
            warnAtPct: roomForDecision.warnAtPct,
            blockAtPct: roomForDecision.blockAtPct,
            policy: roomForDecision.policy,
          }
        : null,
      recentDenials: credential ? proj.recentDenials(eph, at) : 0,
    });

    // Offline reconciliation (D-13): what happened at the gate is what is recorded; conflicts raise alerts.
    let recorded: ScanResult = decision.result;
    let passed = decision.passes;
    let alertsFromDecision = decision.alerts;
    let suspendForConflict = false;
    let conflictAdjustRoom: string | null = null;
    if (s.offline && decision.result !== "duplicate_read") {
      const localPassed = s.local_result === undefined || PASSING_LOCAL.has(s.local_result);
      if (!localPassed) {
        recorded = s.local_result!;
        passed = false;
        if (decision.passes) alertsFromDecision = [];
      } else if (!decision.passes) {
        // The gate let them in; the server would not have. They are inside: count them, and alert.
        recorded = "admitted";
        passed = true;
        alertsFromDecision = [];
        const kind =
          decision.result === "pass_spent"
            ? "offline_conflict_pass_reuse"
            : decision.result === "capacity_block"
              ? "offline_conflict_capacity"
              : decision.result === "suspended" && travelDetected
                ? null
                : "stale_allowlist";
        if (decision.result === "pass_spent") suspendForConflict = true;
        if (kind) {
          const earlier = kind === "offline_conflict_pass_reuse" ? proj.emailRedeemScan.get(eph) : undefined;
          pendingAlerts.push({
            spec: { kind, severity: "high", detail: `Offline gate admitted; server decision was ${decision.result}` },
            credentialId: credential?.id ?? null,
            extraScanIds: earlier ? [earlier] : [],
          });
        }
      } else if (decision.result === "already_inside" && cp.perimeter_bool) {
        // Pass-back across offline gates: inside through a different perimeter gate, never seen leaving.
        const entry = proj.perimeterEntry.get(eph);
        if (entry && entry.checkpointId !== cp.id) {
          suspendForConflict = true;
          conflictAdjustRoom = cp.room_id;
          pendingAlerts.push({
            spec: { kind: "offline_conflict_passback", severity: "high", detail: "Credential admitted again at a different offline gate while inside" },
            credentialId: credential?.id ?? null,
            extraScanIds: [entry.scanId],
          });
        }
      }
    }
    for (const a of alertsFromDecision) pendingAlerts.push({ spec: a, credentialId: credential?.id ?? null });

    // Persist the scan (append-only). clock_offset_ms is the offset the server applied, so
    // occurred_at + clock_offset_ms is exactly the time it was judged and ordered at.
    const occurredAt = Date.parse(s.occurred_at);
    const row: ScanRow = {
      id: scanId,
      event_id: event.id,
      checkpoint_id: cp.id,
      ephemeral_id: r.credential ? eph : null,
      carrier_kind: r.token.known ? r.token.carrierKind : null,
      result: recorded,
      occurred_at: new Date(occurredAt),
      received_at: new Date(receivedAt),
      clock_offset_ms: at - occurredAt,
      idem_key: s.idem_key,
      offline_bool: s.offline,
      direction,
      local_result: s.local_result ?? null,
      device_id: deviceId,
      staff_user_id: staffUserId,
    };
    await this.repos.scans.insert(row);
    const scanIds: string[] = [scanId];

    // Effects of a passage.
    if (credential && r.token.known) {
      proj.lastRead.set(eph, { checkpointId: cp.id, atMs: at });
    }
    if (credential && passed) {
      proj.lastPassage.set(`${eph}|${cp.id}`, at);
      if (recorded === "admitted") {
        const { impliedExit, fault } = this.applyMovement(proj, eph, cp, direction, at, changed, scanId);
        if (impliedExit) {
          // Recorded against the door they were counted in through, so the room is derivable from it.
          const exitRow: ScanRow = {
            ...row,
            id: randomUUID(),
            checkpoint_id: impliedExit.checkpointId,
            result: "implied_exit",
            direction: "out",
            local_result: null,
            idem_key: `${s.idem_key}~x`,
          };
          await this.repos.scans.insert(exitRow);
          scanIds.push(exitRow.id);
        }
        if (fault) {
          pendingAlerts.push({ spec: { kind: "reconciliation_fault", severity: "low", detail: "Occupancy would have gone negative; clamped to 0" }, credentialId: null });
        }
      } else {
        this.notePresence(proj, eph, cp, scanId);
      }
      if (conflictAdjustRoom && proj.rooms.has(conflictAdjustRoom)) {
        proj.add(conflictAdjustRoom, 1);
        changed.add(conflictAdjustRoom);
        await this.repos.occupancy.insertAdjustment({
          id: randomUUID(), event_id: event.id, room_id: conflictAdjustRoom, delta: 1, set_to: null, reason: "sync_conflict",
          actor_id: null, note: `pass-back at sync, scan ${scanId}`, at: new Date(receivedAt),
        });
      }
      // Credential bookkeeping. zone_state mirrors the perimeter state that drives anti-passback (02 §4.3).
      const perimeterNow = proj.perimeterOf.get(eph);
      const nextZone = perimeterNow !== undefined ? `INSIDE_${perimeterNow}` : "OUTSIDE";
      const patch: Partial<Pick<CredentialRow, "state" | "zone_state">> = {};
      if (nextZone !== credential.zone_state) patch.zone_state = nextZone;
      if (credential.state === "issued") patch.state = "active";
      if (recorded === "admitted" && direction === "in" && credential.registration_id) {
        await this.repos.registrations.markCheckedIn(credential.registration_id, new Date(at));
      }
      if (Object.keys(patch).length) credential = await this.repos.credentials.update(credential.id, patch);
      if (r.carrier?.kind === "nfc" && r.carrier.state === "bound") await this.repos.carriers.update(r.carrier.id, { state: "active" });
      if (r.carrier?.kind === "qr_email" && direction === "in") {
        if ((await this.repos.carriers.redeemOnce(r.carrier.id, new Date(at))) && !proj.emailRedeemScan.has(eph)) {
          proj.emailRedeemScan.set(eph, scanId);
        }
      }
    } else if (credential && isDenial(recorded)) {
      proj.recordDenial(eph, at);
    }
    if (suspendForConflict && credential && credential.state !== "revoked") {
      credential = await this.repos.credentials.update(credential.id, { state: "suspended_review" });
    }

    // Alerts carry the server's time; the scan's own time is on the scans they name.
    const alertIds: string[] = [];
    for (const a of pendingAlerts) {
      const created = await this.alerts.raise(a.spec, {
        eventId: event.id,
        checkpointId: cp.id,
        roomId: cp.room_id,
        credentialId: a.credentialId,
        occurredAt: new Date(receivedAt),
        scanIds: [...(a.extraScanIds ?? []), ...scanIds],
      });
      alertIds.push(created.id);
    }

    // D-16: per-gate, per-minute rate from the first scan.
    await this.repos.rollups.incrementGateRate(
      { event_id: event.id, checkpoint_id: cp.id, minute_start: new Date(Math.floor(at / 60_000) * 60_000) },
      {
        admitted: recorded === "admitted" || recorded === "already_inside" ? 1 : 0,
        denied: isDenial(recorded) ? 1 : 0,
        tier: r.tier ?? (r.credential?.staff_user_id ? "STAFF" : "UNKNOWN"),
        result: recorded,
      },
    );

    const outcome: ScanOutcome = {
      idem_key: s.idem_key,
      scan_id: scanId,
      result: recorded,
      carrier_kind: row.carrier_kind,
      tier: r.tier,
      room_id: cp.room_id,
      corrected_at: new Date(at).toISOString(),
      replayed: false,
      alert_ids: alertIds,
    };
    this.outcomeCache.set(scanId, outcome);
    return outcome;
  }

  private transitCache = new Map<string, Map<string, number>>();
  private async transitLookup(venueId: string): Promise<(from: string, to: string) => number | null> {
    let m = this.transitCache.get(venueId);
    if (!m) {
      m = new Map();
      for (const t of await this.repos.venues.transitTimes(venueId)) m.set(`${t.from_checkpoint_id}>${t.to_checkpoint_id}`, t.min_seconds);
      this.transitCache.set(venueId, m);
    }
    const table = m;
    return (from, to) => table.get(`${from}>${to}`) ?? table.get(`${to}>${from}`) ?? null;
  }

  /* --------------------------------------------------------- operator actions */

  /**
   * Manual recount (D-10): an anchor. The room's count becomes the headcount; scans from before it no
   * longer change the count; a recount to zero un-counts everyone in the room. Audited.
   */
  async recount(actor: AuthContext, eventIdIn: string, roomId: string, count: number, note?: string) {
    const event = await this.repos.events.byId(eventIdIn);
    if (!event) throw new ContractError("NOT_FOUND", "event not found");
    const eventId = event.id;
    return this.mutex.run(eventId, async () => {
      const proj = await this.projection(eventId);
      if (!proj.rooms.has(roomId)) throw new ContractError("NOT_FOUND", "room is not part of this event");
      const previous = proj.count(roomId);
      const at = new Date(this.clock.now());
      const adj: OccupancyAdjustmentRow = {
        id: randomUUID(), event_id: eventId, room_id: roomId, delta: count - previous, set_to: count, reason: "recount",
        actor_id: actor.sub, note: note ?? null, at,
      };
      await this.repos.occupancy.insertAdjustment(adj);
      proj.setAnchor(roomId, count, at.getTime());
      await this.audit.append({ actorId: actor.sub, action: "room.recount", target: `room:${roomId}`, meta: { event_id: eventId, previous, count, note: note ?? null } });
      this.telemetry.update(eventId, [proj.roomView(roomId)], []);
      return { room_id: roomId, previous, occupancy: proj.count(roomId), adjustment_id: adj.id };
    });
  }
}
