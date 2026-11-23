/**
 * Scan ingest (POST /scans): online scans and offline sync, batch and idempotent.
 *
 * Per event, batches are serialised. Within a batch, new scans are applied in
 * corrected-time order (occurred_at + clock_offset_ms, D-14). Each scan:
 *   resolve token → impossible-travel check → decide() → reconcile offline conflicts →
 *   persist scan → apply movement (implied exit, presence, zone state) → alerts →
 *   gate_rate_rollups → telemetry.
 */
import { createHash, randomUUID } from "node:crypto";
import { ContractError } from "@synan/contracts/errors";
import type { AttendeeTier, ScanResult } from "@synan/contracts/enums";
import type { ScanBatchRequest, ScanBatchResponse, ScanOutcome, ScanSubmission } from "@synan/contracts/rest";
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
import { sha256b64url, sha256hex } from "../lib/crypto.js";
import type { Clock } from "../lib/clock.js";
import { KeyedMutex } from "../lib/mutex.js";
import type { CarrierRow, CheckpointRow, CredentialRow, EventRow, OccupancyAdjustmentRow, Repos, ScanRow } from "../repo/types.js";
import type { TelemetryHub } from "../realtime/telemetry-hub.js";

const PASSING_LOCAL: ReadonlySet<ScanResult> = new Set(["admitted", "already_inside", "offline_queued"]);

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
  clockOffsetMs: number;
  deviceId: string;
}

export class ScanService {
  private mutex = new KeyedMutex();
  private projections = new Map<string, Promise<OccupancyProjection>>();
  private outcomeCache = new Map<string, ScanOutcome>();
  private skewAlerted = new Set<string>();
  readonly gates = new Map<string, GateStat>();

  constructor(
    private readonly repos: Repos,
    private readonly qr: QrService,
    private readonly alerts: AlertService,
    private readonly audit: AuditService,
    private readonly telemetry: TelemetryHub,
    private readonly clock: Clock,
  ) {}

  /* ------------------------------------------------------------ projection */

  projection(eventId: string): Promise<OccupancyProjection> {
    let p = this.projections.get(eventId);
    if (!p) {
      p = this.build(eventId);
      this.projections.set(eventId, p);
      p.catch(() => this.projections.delete(eventId));
    }
    return p;
  }

  private async build(eventId: string): Promise<OccupancyProjection> {
    const event = await this.repos.events.byId(eventId);
    if (!event) throw new ContractError("NOT_FOUND", "event not found");
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
    this.checkpointCache.set(event.venue_id, checkpoints);
    type Step = { at: number; scan?: ScanRow; adj?: OccupancyAdjustmentRow };
    const steps: Step[] = [
      ...(await this.repos.scans.forEvent(eventId)).map((s) => ({ at: s.occurred_at.getTime() + s.clock_offset_ms, scan: s })),
      ...(await this.repos.occupancy.adjustments(eventId)).map((a) => ({ at: a.at.getTime(), adj: a })),
    ].sort((a, b) => a.at - b.at);
    for (const { at, scan: s, adj } of steps) {
      if (adj) {
        if (adj.set_to !== null) proj.roomCount.set(adj.room_id, adj.set_to);
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
        if (s.result === "admitted") this.applyMovement(proj, eph, cp, s.direction, at, null);
        else proj.zoneOf.set(eph, cp.zone_id);
      } else if (isDenial(s.result)) proj.recordDenial(eph, at);
    }
    this.telemetry.prime(eventId, proj.allRooms(), proj.allZones());
    return proj;
  }

  private checkpointCache = new Map<string, Map<string, CheckpointRow>>();

  /**
   * Apply an admitted passage to presence and counts. Returns the room left by an implied exit, if any.
   * Late scans (older than the credential's last movement) are recorded but do not move presence.
   */
  private applyMovement(
    proj: OccupancyProjection,
    eph: string,
    cp: CheckpointRow,
    direction: "in" | "out",
    atMs: number,
    changed: Set<string> | null,
  ): { impliedExit: { roomId: string; checkpointId: string } | null; fault: boolean } {
    const last = proj.lastMoveAt.get(eph);
    if (last !== undefined && atMs < last) return { impliedExit: null, fault: false };
    proj.lastMoveAt.set(eph, atMs);
    let impliedExit: { roomId: string; checkpointId: string } | null = null;
    let fault = false;
    const current = proj.presence.get(eph);
    if (direction === "in") {
      proj.zoneOf.set(eph, cp.zone_id);
      if (cp.room_id && proj.rooms.has(cp.room_id)) {
        if (current && current.roomId !== cp.room_id) {
          fault = !proj.add(current.roomId, -1) || fault;
          impliedExit = current;
          changed?.add(current.roomId);
        }
        if (current?.roomId !== cp.room_id) {
          proj.add(cp.room_id, 1);
          proj.presence.set(eph, { roomId: cp.room_id, checkpointId: cp.id });
          changed?.add(cp.room_id);
        }
      }
    } else {
      if (cp.room_id && proj.rooms.has(cp.room_id)) {
        fault = !proj.add(cp.room_id, -1) || fault;
        changed?.add(cp.room_id);
        if (current?.roomId === cp.room_id) proj.presence.delete(eph);
      }
      if (cp.perimeter_bool) {
        // Leaving through the perimeter leaves every room and the zone.
        if (current && current.roomId !== cp.room_id) {
          fault = !proj.add(current.roomId, -1) || fault;
          impliedExit = current;
          changed?.add(current.roomId);
        }
        proj.presence.delete(eph);
        proj.zoneOf.delete(eph);
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
        carrier = await this.repos.carriers.byIdentifier("qr_email", sha256hex(v.carrierCid));
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
    return this.mutex.run(req.event_id, () => this.ingestLocked(principal, req));
  }

  /**
   * What makes two submissions "the same scan" for idempotency, built only from stored columns
   * (the presented token itself is never stored).
   */
  private fingerprint(s: { checkpoint_id: string; occurred_at: number; clock_offset_ms: number; offline: boolean; local_result: ScanResult | null }): string {
    return createHash("sha256").update(canonicalJson(s)).digest("hex");
  }
  private fpOfSubmission(s: ScanSubmission) {
    return this.fingerprint({
      checkpoint_id: s.checkpoint_id,
      occurred_at: Date.parse(s.occurred_at),
      clock_offset_ms: s.clock_offset_ms,
      offline: s.offline,
      local_result: s.local_result ?? null,
    });
  }
  private fpOfRow(r: ScanRow) {
    return this.fingerprint({
      checkpoint_id: r.checkpoint_id,
      occurred_at: r.occurred_at.getTime(),
      clock_offset_ms: r.clock_offset_ms,
      offline: r.offline_bool,
      local_result: r.local_result,
    });
  }

  private async ingestLocked(principal: AuthContext, req: ScanBatchRequest): Promise<ScanBatchResponse> {
    const receivedAt = this.clock.now();
    const event = await this.repos.events.byId(req.event_id);
    if (!event) throw new ContractError("NOT_FOUND", "event not found");
    if (event.state !== "live") throw new ContractError("EVENT_NOT_LIVE");

    // Authorise every scan before applying any: checkpoint in this venue, assigned, inside shift (03 §4).
    const checkpoints = new Map<string, CheckpointRow>();
    const assignments = await this.repos.staff.assignmentsFor(principal.sub);
    for (const s of req.scans) {
      let cp = checkpoints.get(s.checkpoint_id);
      if (!cp) {
        const found = await this.repos.venues.checkpoint(s.checkpoint_id);
        if (!found || found.venue_id !== event.venue_id) throw new ContractError("NOT_FOUND", "checkpoint not found for this event");
        cp = found;
        checkpoints.set(cp.id, cp);
      }
      const at = Date.parse(s.occurred_at) + s.clock_offset_ms;
      const mine = assignments.filter((a) => a.checkpoint_id === s.checkpoint_id);
      if (mine.length === 0) {
        await this.rogue(event.id, s.checkpoint_id, req.device_id, "not assigned");
        throw new ContractError("CHECKPOINT_NOT_ASSIGNED");
      }
      if (!mine.some((a) => at >= a.shift_start.getTime() && at < a.shift_end.getTime())) {
        await this.rogue(event.id, s.checkpoint_id, req.device_id, "outside shift");
        throw new ContractError("OUTSIDE_SHIFT");
      }
      if (cp.direction === "both" && !s.direction) {
        throw new ContractError("VALIDATION_FAILED", "direction is required at a two-way checkpoint", [
          { path: "scans.direction", message: "required at a `both` checkpoint" },
        ]);
      }
    }

    // Idempotency: replays return the original outcome; a reused key with a different payload is a 409.
    const results = new Map<string, ScanOutcome>();
    const fresh: ScanSubmission[] = [];
    const seenInBatch = new Map<string, string>();
    for (const s of req.scans) {
      const fp = this.fpOfSubmission(s);
      const prior = seenInBatch.get(s.idem_key);
      if (prior !== undefined) {
        if (prior !== fp) throw new ContractError("IDEMPOTENCY_CONFLICT");
        continue;
      }
      seenInBatch.set(s.idem_key, fp);
      const existing = await this.repos.scans.byIdemKey(event.id, s.idem_key);
      if (existing) {
        if (this.fpOfRow(existing) !== fp) throw new ContractError("IDEMPOTENCY_CONFLICT");
        results.set(s.idem_key, { ...this.outcomeOf(existing, checkpoints.get(existing.checkpoint_id) ?? null), replayed: true });
      } else fresh.push(s);
    }

    const proj = await this.projection(event.id);
    const changed = new Set<string>();
    const zonesBefore = new Map(proj.allZones().map((z) => [z.zone_id, z.occupancy]));
    const ordered = fresh
      .map((s, i) => ({ s, i, at: Date.parse(s.occurred_at) + s.clock_offset_ms }))
      .sort((a, b) => a.at - b.at || a.i - b.i);
    for (const { s, at } of ordered) {
      const cp = checkpoints.get(s.checkpoint_id)!;
      const outcome = await this.applyOne(event, cp, s, at, receivedAt, req.device_id, principal.sub, proj, changed);
      results.set(s.idem_key, outcome);
    }

    // Telemetry: only what changed; the hub coalesces to ≤ 4 Hz.
    const zoneChanges = proj.allZones().filter((z) => zonesBefore.get(z.zone_id) !== z.occupancy);
    if (changed.size || zoneChanges.length) {
      this.telemetry.update(event.id, [...changed].filter((id) => proj.rooms.has(id)).map((id) => proj.roomView(id)), zoneChanges);
    }

    return {
      results: req.scans.map((s) => results.get(s.idem_key)!),
      server_time: new Date(this.clock.now()).toISOString(),
    };
  }

  private async rogue(eventId: string, checkpointId: string, deviceId: string, why: string) {
    await this.alerts.raise(
      { kind: "rogue_scanner", severity: "high", detail: `Scan refused: ${why} (device ${deviceId.slice(0, 32)})` },
      { eventId, checkpointId, credentialId: null },
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
    cp: CheckpointRow,
    s: ScanSubmission,
    at: number,
    receivedAt: number,
    deviceId: string,
    staffUserId: string,
    proj: OccupancyProjection,
    changed: Set<string>,
  ): Promise<ScanOutcome> {
    const scanId = randomUUID();
    const direction: "in" | "out" = cp.direction === "both" ? (s.direction ?? "in") : cp.direction;
    const r = await this.resolve(event, s.presented, at);
    // Projection key; only meaningful (and only persisted) when the credential is known.
    const eph = r.credential ? await this.repos.ephemeralIds.getOrCreate(event.id, r.credential.id) : `unknown:${scanId}`;
    const pendingAlerts: { spec: AlertSpec; credentialId: string | null }[] = [];

    // Gate health: clock offset (D-14).
    this.gates.set(cp.id, { checkpointId: cp.id, lastSeenAt: receivedAt, clockOffsetMs: s.clock_offset_ms, deviceId });
    if (Math.abs(s.clock_offset_ms) > CLOCK_FAULT_MS && !this.skewAlerted.has(`${event.id}|${deviceId}`)) {
      this.skewAlerted.add(`${event.id}|${deviceId}`);
      pendingAlerts.push({
        spec: { kind: "clock_skew", severity: "low", detail: `Scanner clock off by ${Math.round(s.clock_offset_ms / 1000)} s` },
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

    const decision = decide({
      token: r.token,
      credentialState: credential?.state ?? null,
      zoneState: proj.zoneOf.has(eph) ? `INSIDE_${proj.zoneOf.get(eph)}` : "OUTSIDE",
      checkpoint: { perimeter: cp.perimeter_bool, zoneId: cp.zone_id, roomId: cp.room_id },
      direction,
      nowMs: at,
      lastPassageHereMs: proj.lastPassage.get(`${eph}|${cp.id}`) ?? null,
      entitled,
      currentRoomId: proj.presence.get(eph)?.roomId ?? null,
      room: room
        ? { occupancy: proj.count(room.id), capacity: room.capacity, warnAtPct: room.warnAtPct, blockAtPct: room.blockAtPct, policy: room.policy }
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
          pendingAlerts.push({
            spec: { kind, severity: "high", detail: `Offline gate admitted; server decision was ${decision.result}` },
            credentialId: credential?.id ?? null,
          });
        }
      } else if (decision.result === "already_inside" && cp.perimeter_bool) {
        // Pass-back across offline gates: entered this zone elsewhere and was not seen leaving.
        if (!proj.lastPassage.has(`${eph}|${cp.id}`)) {
          suspendForConflict = true;
          conflictAdjustRoom = cp.room_id;
          pendingAlerts.push({
            spec: { kind: "offline_conflict_passback", severity: "high", detail: "Credential admitted again at a different offline gate while inside" },
            credentialId: credential?.id ?? null,
          });
        }
      }
    }
    for (const a of alertsFromDecision) pendingAlerts.push({ spec: a, credentialId: credential?.id ?? null });

    // Persist the scan (append-only).
    const row: ScanRow = {
      id: scanId,
      event_id: event.id,
      checkpoint_id: cp.id,
      ephemeral_id: r.credential ? eph : null,
      carrier_kind: r.token.known ? r.token.carrierKind : null,
      result: recorded,
      occurred_at: new Date(s.occurred_at),
      received_at: new Date(receivedAt),
      clock_offset_ms: s.clock_offset_ms,
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
        const { impliedExit, fault } = this.applyMovement(proj, eph, cp, direction, at, changed);
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
        proj.zoneOf.set(eph, cp.zone_id);
      }
      if (conflictAdjustRoom && proj.rooms.has(conflictAdjustRoom)) {
        proj.add(conflictAdjustRoom, 1);
        changed.add(conflictAdjustRoom);
        await this.repos.occupancy.insertAdjustment({
          id: randomUUID(), event_id: event.id, room_id: conflictAdjustRoom, delta: 1, set_to: null, reason: "sync_conflict",
          actor_id: null, note: `pass-back at sync, scan ${scanId}`, at: new Date(receivedAt),
        });
      }
      // Credential bookkeeping.
      const nextZone = proj.zoneOf.has(eph) ? `INSIDE_${proj.zoneOf.get(eph)}` : "OUTSIDE";
      const patch: Partial<Pick<CredentialRow, "state" | "zone_state">> = {};
      if (nextZone !== credential.zone_state) patch.zone_state = nextZone;
      if (credential.state === "issued") patch.state = "active";
      if (recorded === "admitted" && direction === "in" && credential.registration_id) {
        await this.repos.registrations.markCheckedIn(credential.registration_id, new Date(at));
      }
      if (Object.keys(patch).length) credential = await this.repos.credentials.update(credential.id, patch);
      if (r.carrier?.kind === "nfc" && r.carrier.state === "bound") await this.repos.carriers.update(r.carrier.id, { state: "active" });
      if (r.carrier?.kind === "qr_email" && direction === "in") await this.repos.carriers.redeemOnce(r.carrier.id, new Date(at));
    } else if (credential && isDenial(recorded)) {
      proj.recordDenial(eph, at);
    }
    if (suspendForConflict && credential && credential.state !== "revoked") {
      credential = await this.repos.credentials.update(credential.id, { state: "suspended_review" });
    }

    // Alerts.
    const alertIds: string[] = [];
    for (const a of pendingAlerts) {
      const created = await this.alerts.raise(a.spec, {
        eventId: event.id,
        checkpointId: cp.id,
        roomId: cp.room_id,
        credentialId: a.credentialId,
        occurredAt: new Date(at),
        scanIds,
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

  /** Manual recount (D-10): sets a room's count to a headcount, audited. */
  async recount(actor: AuthContext, eventId: string, roomId: string, count: number, note?: string) {
    return this.mutex.run(eventId, async () => {
      const proj = await this.projection(eventId);
      if (!proj.rooms.has(roomId)) throw new ContractError("NOT_FOUND", "room is not part of this event");
      const previous = proj.count(roomId);
      const delta = count - previous;
      const adj: OccupancyAdjustmentRow = {
        id: randomUUID(), event_id: eventId, room_id: roomId, delta, set_to: count, reason: "recount",
        actor_id: actor.sub, note: note ?? null, at: new Date(this.clock.now()),
      };
      await this.repos.occupancy.insertAdjustment(adj);
      proj.roomCount.set(roomId, count);
      await this.audit.append({ actorId: actor.sub, action: "room.recount", target: `room:${roomId}`, meta: { event_id: eventId, previous, count, note: note ?? null } });
      this.telemetry.update(eventId, [proj.roomView(roomId)], []);
      return { room_id: roomId, previous, occupancy: proj.count(roomId), adjustment_id: adj.id };
    });
  }
}
