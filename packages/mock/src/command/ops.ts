/**
 * The response side of the mock (docs/06 D9, D10, D12, D12b): the scan log behind the access
 * log, per-gate activity behind gate health, one gate's detail, and the context an alert's
 * detail sheet shows. One `OpsLog` per live event, kept by its EventServer.
 *
 * The log starts with a deterministic hour of plausible traffic before the mock's start, then
 * records every scan the realtime mock emits (a server-side tap, so it sees scans that a
 * disconnected client missed). Gate link changes are recorded the same way.
 *
 * Shapes follow contracts' `ScanRecord`; the additions are marked NOT IN CONTRACTS and are
 * proposals to the backend. General scan lists never carry a per-person id (03 §5):
 * `ephemeral_id` is always null here.
 */
import type { MockClock } from "../clock";
import { createRng, hashString, uuidFrom, type Rng } from "../random";
import type { MockRealtime } from "../realtime";
import type {
  AttendeeTier,
  BreachAlert,
  CarrierKind,
  Checkpoint,
  CredentialState,
  GateHealth,
  GateLinkState,
  ScanRecord,
  ScanResult,
} from "../types";
import type { VenueLayout } from "./venues";

/* -------------------------------------------------------------------- types */

/**
 * A scan as the access log shows it: contracts' `ScanRecord` plus three fields that are
 * NOT IN CONTRACTS — `tier` (the scan.result stream already carries it), `corrected_at` (the
 * time the server ordered the scan by; ScanOutcome has it) and `latency_ms` (the gate's decision
 * time; null for a scan decided offline).
 */
export interface OpsScan extends ScanRecord {
  tier: AttendeeTier | null;
  corrected_at: string;
  latency_ms: number | null;
}

/** GET /scans query, with NOT IN CONTRACTS extras (several checkpoints, text search, cursor). */
export interface ScanLogQuery {
  /** Only these checkpoints (a gate, or every door of a room). */
  checkpoint_ids?: string[];
  result?: ScanResult;
  /** Matched against the checkpoint label and the result, case-insensitively. */
  q?: string;
  /** `next_cursor` from the previous page. */
  cursor?: string | null;
  /** Default 100, at most 200. */
  limit?: number;
}

export interface ScanPage {
  /** Newest first, by corrected time. */
  items: OpsScan[];
  next_cursor: string | null;
  /** How many scans match the query in the whole log. */
  total: number;
  /** The oldest scan the log holds (the mock keeps an hour before it started, plus what followed). */
  oldest_at: string | null;
}

/** NOT IN CONTRACTS — per-gate activity for D12 (GateHealth has `last_scan_at` and `scans_last_15m`; this adds the per-minute series). */
export interface GateActivity {
  checkpoint_id: string;
  /** The last heartbeat the server heard; null when never heard. */
  heartbeat_at: string | null;
  last_scan_at: string | null;
  /** Scans per minute for the last 15 minutes, oldest first (implied exits excluded). */
  per_minute: number[];
  scans_last_15m: number;
}

export interface LinkChange {
  at: string;
  link_state: GateLinkState;
  queue_depth: number;
}

/** NOT IN CONTRACTS — D12b in one call (GET /checkpoints/:id/scans covers the last 50 scans only). */
export interface GateDetail {
  checkpoint_id: string;
  /** Link changes since the shift began, oldest first. */
  link_history: LinkChange[];
  /** Scans per 5-minute bucket over the last hour, oldest first (implied exits excluded). */
  throughput: { from: string; bucket_ms: number; counts: number[] };
  /** Every result seen in the last hour, most frequent first. */
  results: { result: ScanResult; count: number }[];
  last_scans: OpsScan[];
}

/**
 * NOT IN CONTRACTS — a synthetic read at a gate. Not an attendance scan: nothing is logged,
 * counted or streamed. Rejects with `GATE_UNREACHABLE` when the gate is offline.
 */
export interface TestRead {
  checkpoint_id: string;
  at: string;
  /** Round trip from the console to the reader and back. */
  round_trip_ms: number;
  reader: "camera" | "nfc";
  /** What the gate would have shown for the test token. */
  result: ScanResult;
}

/** The credential an alert is about, as the alert sheet shows it. NOT IN CONTRACTS as one shape. */
export interface AlertCredential {
  registration_id: string;
  credential_id: string | null;
  state: CredentialState | null;
  tier: AttendeeTier;
  full_name: string | null;
  band_hint: string | null;
}

/** NOT IN CONTRACTS — what D10's detail sheet needs beyond the BreachAlert row. */
export interface AlertContext {
  alert_id: string;
  /** The rule that fired, in one or two plain sentences, with its parameters. */
  rule: string;
  /** The scans named by the alert (`scan_ids`), in corrected-time order. */
  scans: (OpsScan & { checkpoint_label: string })[];
  /** When the alert names no scan: scans at its checkpoint in the minute before it fired. */
  nearby: (OpsScan & { checkpoint_label: string })[];
  credential: AlertCredential | null;
  /** The acknowledging operator's display name. */
  acked_by_name: string | null;
}

/* ------------------------------------------------------------------ the log */

const MINUTE = 60_000;
const BACKLOG_MINUTES = 60;
const PAGE_DEFAULT = 100;
const PAGE_MAX = 200;

/** Compare newest first: corrected time, then id. */
function newerFirst(a: OpsScan, b: OpsScan): number {
  return b.corrected_at.localeCompare(a.corrected_at) || b.id.localeCompare(a.id);
}

/** The cursor that pages on from `scan` (older scans). Opaque to callers. */
export function scanCursor(scan: Pick<OpsScan, "corrected_at" | "id">): string {
  return `${scan.corrected_at}|${scan.id}`;
}

/** True when `scan` comes after (is older than) the cursor in newest-first order. */
function olderThan(scan: OpsScan, cursor: string): boolean {
  const [at = "", id = ""] = cursor.split("|");
  return scan.corrected_at < at || (scan.corrected_at === at && scan.id < id);
}

export class OpsLog {
  /** Newest first. */
  private scans: OpsScan[] = [];
  private readonly ids = new Set<string>();
  private readonly links = new Map<string, LinkChange[]>();
  private readonly byId: Map<string, Checkpoint>;

  constructor(
    private readonly layout: VenueLayout,
    private readonly rt: MockRealtime,
    private readonly clock: MockClock,
    private readonly health: ReadonlyMap<string, GateHealth>,
    eventId: string,
    shiftStart: number,
  ) {
    this.byId = new Map(layout.checkpoints.map((c) => [c.id, c]));
    const start = clock.now();
    this.scans = backlog(layout, eventId, start);
    for (const scan of this.scans) this.ids.add(scan.id);

    // Link history: every gate came up at the start of the shift; Gate 2 dropped for two
    // minutes earlier this hour (the resolved "Gate offline" alert the server seeds).
    for (const checkpoint of layout.checkpoints) {
      this.links.set(checkpoint.id, [{ at: new Date(Math.min(shiftStart, start - BACKLOG_MINUTES * MINUTE)).toISOString(), link_state: "online", queue_depth: 0 }]);
    }
    const second = layout.checkpoints[1];
    if (second) {
      this.links.get(second.id)?.push(
        { at: new Date(start - 48 * MINUTE).toISOString(), link_state: "offline", queue_depth: 0 },
        { at: new Date(start - 46 * MINUTE).toISOString(), link_state: "online", queue_depth: 0 },
      );
    }

    rt.tap("/stream/scans", (message) => {
      if (message.type !== "scan.result") return;
      const data = message.data;
      if (this.ids.has(data.scan_id)) return;
      const gate = this.health.get(data.checkpoint_id);
      // A device with a wrong clock reported a device time off by its offset; the server corrected it.
      const offset = gate?.clock_fault && gate.clock_offset_ms !== null ? gate.clock_offset_ms : 0;
      const corrected = Date.parse(data.corrected_at);
      const received = Date.parse(message.at);
      const seed = hashString(data.scan_id);
      this.insert({
        id: data.scan_id,
        event_id: data.event_id,
        checkpoint_id: data.checkpoint_id,
        ephemeral_id: null,
        carrier_kind: data.carrier_kind,
        result: data.result,
        occurred_at: new Date(corrected + offset).toISOString(),
        received_at: new Date(Math.max(received, corrected)).toISOString(),
        clock_offset_ms: -offset,
        offline: data.offline,
        tier: data.tier,
        corrected_at: data.corrected_at,
        latency_ms: data.offline ? null : 38 + (seed % 170),
      });
    });

    rt.tap("/stream/alerts", (message) => {
      if (message.type !== "gate.health") return;
      const history = this.links.get(message.data.checkpoint_id);
      if (!history) return;
      const last = history[history.length - 1];
      if (last?.link_state === message.data.link_state) return;
      history.push({ at: message.at, link_state: message.data.link_state, queue_depth: message.data.queue_depth });
    });
  }

  private insert(scan: OpsScan): void {
    this.ids.add(scan.id);
    const first = this.scans[0];
    if (!first || newerFirst(scan, first) <= 0) {
      this.scans.unshift(scan);
      return;
    }
    // An offline scan synced late: its corrected time puts it further down.
    let lo = 0;
    let hi = this.scans.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (newerFirst(this.scans[mid] as OpsScan, scan) < 0) lo = mid + 1;
      else hi = mid;
    }
    this.scans.splice(lo, 0, scan);
  }

  label(checkpointId: string): string {
    return this.byId.get(checkpointId)?.label ?? "Unknown gate";
  }

  find(scanId: string): OpsScan | undefined {
    return this.scans.find((scan) => scan.id === scanId);
  }

  page(query: ScanLogQuery, resultLabel: (result: ScanResult) => string): ScanPage {
    const limit = Math.min(PAGE_MAX, Math.max(1, query.limit ?? PAGE_DEFAULT));
    const gates = query.checkpoint_ids && query.checkpoint_ids.length > 0 ? new Set(query.checkpoint_ids) : null;
    const q = query.q?.trim().toLowerCase() ?? "";
    const matches = (scan: OpsScan) =>
      (!gates || gates.has(scan.checkpoint_id)) &&
      (!query.result || scan.result === query.result) &&
      (!q ||
        this.label(scan.checkpoint_id).toLowerCase().includes(q) ||
        scan.result.replace(/_/g, " ").includes(q) ||
        resultLabel(scan.result).toLowerCase().includes(q));
    const all = this.scans.filter(matches);
    const start = query.cursor ? all.findIndex((scan) => olderThan(scan, query.cursor as string)) : 0;
    const items = start < 0 ? [] : all.slice(start, start + limit);
    const last = items[items.length - 1];
    const more = start >= 0 && start + limit < all.length;
    return {
      items: structuredClone(items),
      next_cursor: more && last ? scanCursor(last) : null,
      total: all.length,
      oldest_at: this.scans[this.scans.length - 1]?.corrected_at ?? null,
    };
  }

  activity(): GateActivity[] {
    const now = this.clock.now();
    const from = now - 15 * MINUTE;
    const out = new Map<string, GateActivity>();
    for (const checkpoint of this.layout.checkpoints) {
      const health = this.health.get(checkpoint.id);
      let heartbeat: string | null = health?.last_heartbeat_at ?? null;
      if (health && health.link_state !== "offline") {
        // Devices heartbeat every 15 s; the mock's health rows are only rewritten by scenarios.
        const phase = hashString(checkpoint.id) % 15_000;
        heartbeat = new Date(now - ((now + phase) % 15_000)).toISOString();
      }
      out.set(checkpoint.id, {
        checkpoint_id: checkpoint.id,
        heartbeat_at: heartbeat,
        last_scan_at: null,
        per_minute: Array.from({ length: 15 }, () => 0),
        scans_last_15m: 0,
      });
    }
    for (const scan of this.scans) {
      const row = out.get(scan.checkpoint_id);
      if (!row) continue;
      const at = Date.parse(scan.corrected_at);
      if (row.last_scan_at === null && at <= now) row.last_scan_at = scan.corrected_at;
      if (at < from) continue;
      if (scan.result === "implied_exit" || at > now) continue;
      const index = Math.min(14, Math.floor((at - from) / MINUTE));
      row.per_minute[index] = (row.per_minute[index] ?? 0) + 1;
      row.scans_last_15m += 1;
    }
    return [...out.values()];
  }

  detail(checkpointId: string): GateDetail | null {
    if (!this.byId.has(checkpointId)) return null;
    const now = this.clock.now();
    const bucket = 5 * MINUTE;
    const last = Math.floor(now / bucket);
    const first = last - 11;
    const counts = Array.from({ length: 12 }, () => 0);
    const results = new Map<ScanResult, number>();
    const lastScans: OpsScan[] = [];
    for (const scan of this.scans) {
      if (scan.checkpoint_id !== checkpointId) continue;
      if (lastScans.length < 50) lastScans.push(scan);
      const at = Date.parse(scan.corrected_at);
      if (at < first * bucket) continue;
      results.set(scan.result, (results.get(scan.result) ?? 0) + 1);
      if (scan.result === "implied_exit") continue;
      const index = Math.floor(at / bucket) - first;
      if (index >= 0 && index < 12) counts[index] = (counts[index] ?? 0) + 1;
    }
    return {
      checkpoint_id: checkpointId,
      link_history: structuredClone(this.links.get(checkpointId) ?? []),
      throughput: { from: new Date(first * bucket).toISOString(), bucket_ms: bucket, counts },
      results: [...results].map(([result, count]) => ({ result, count })).sort((a, b) => b.count - a.count),
      last_scans: structuredClone(lastScans),
    };
  }

  testRead(checkpointId: string): TestRead {
    const checkpoint = this.byId.get(checkpointId);
    const health = this.health.get(checkpointId);
    if (!checkpoint) throw new Error("NOT_FOUND");
    // NOT IN CONTRACTS: no error code says "the device did not answer"; proposed GATE_UNREACHABLE.
    if (!health || health.link_state === "offline") throw new Error("GATE_UNREACHABLE");
    const now = this.clock.now();
    return {
      checkpoint_id: checkpointId,
      at: new Date(now).toISOString(),
      round_trip_ms: 24 + ((now >>> 4) % 60) + (health.link_state === "degraded" ? 180 : 0),
      reader: checkpoint.perimeter ? "camera" : "nfc",
      result: "admitted",
    };
  }

  context(alert: BreachAlert): Pick<AlertContext, "rule" | "scans" | "nearby"> {
    const withLabel = (scan: OpsScan) => ({ ...structuredClone(scan), checkpoint_label: this.label(scan.checkpoint_id) });
    const scans = alert.scan_ids
      .map((id) => this.find(id))
      .filter((scan): scan is OpsScan => scan !== undefined)
      .sort((a, b) => a.corrected_at.localeCompare(b.corrected_at))
      .map(withLabel);
    let nearby: AlertContext["nearby"] = [];
    if (scans.length === 0 && alert.checkpoint_id) {
      const at = Date.parse(alert.occurred_at);
      nearby = this.scans
        .filter((scan) => {
          if (scan.checkpoint_id !== alert.checkpoint_id) return false;
          const t = Date.parse(scan.corrected_at);
          return t <= at + 2_000 && t >= at - MINUTE;
        })
        .slice(0, 5)
        .map(withLabel);
    }
    return { rule: this.rule(alert), scans, nearby };
  }

  private rule(alert: BreachAlert): string {
    const checkpoint = alert.checkpoint_id ? this.byId.get(alert.checkpoint_id) : undefined;
    const room = checkpoint?.room_id ? this.layout.rooms.find((r) => r.id === checkpoint.room_id) : undefined;
    switch (alert.kind) {
      case "impossible_travel":
        return "Fires when one credential is read at two checkpoints faster than the shortest walk between them allows. The credential is suspended: gates refuse it until a supervisor clears or revokes it.";
      case "capacity_warn":
        return room
          ? `Fires when a room passes its warning threshold: ${room.name} warns at ${room.warn_at_pct}% of ${room.capacity}.`
          : "Fires when a room passes its warning threshold.";
      case "capacity_exceeded":
        return room
          ? `Fires when a room that admits with an alert goes past its blocking threshold: ${room.name} blocks at ${room.block_at_pct}% of ${room.capacity}.`
          : "Fires when a room that admits with an alert goes past its blocking threshold.";
      case "unauthorised_tier":
        return "Fires when a pass is presented at a room its tier may not enter. The gate refused entry; the alert asks someone to check the person is not trying again.";
      case "invalid_qr":
        return "Fires when a QR code fails its signature, has expired, or was never issued for this event.";
      case "pass_replayed":
        return "Fires when a single-use emailed QR code is presented after it has already been used.";
      case "offline_conflict_pass_reuse":
        return "Fires at sync when two gates that were offline both accepted the same single-use pass. Both scans stand; the times shown are corrected for each scanner's clock.";
      case "offline_conflict_passback":
        return "Fires at sync when a pass already inside was admitted again at another gate while that gate was offline.";
      case "offline_conflict_capacity":
        return "Fires at sync when gates that were offline together admitted more people than the room allows.";
      case "clock_skew":
        return "Fires when a scanner's clock is more than two minutes from server time. Its scans are re-ordered by corrected time, so counts stay right; the device clock still needs fixing.";
      case "gate_offline":
        return "Fires when a gate sends no heartbeat for more than 60 seconds. The gate keeps scanning on its offline allowlist and queues the scans until it reconnects.";
      case "rogue_scanner":
        return "Fires when a scanner tries a checkpoint or a time outside its staff assignment. Its scans were refused.";
      case "stale_allowlist":
        return "Fires when an offline gate admits on an allowlist more than 15 minutes old.";
      case "reconciliation_fault":
        return "Fires when a room's count would have gone below zero. It was held at zero; a recount puts it right.";
      case "band_reported_lost":
        return "Fires when a holder reports their wristband lost. Gates refuse the band from then on; the desk binds a new one, and the pass in the app keeps working.";
    }
  }
}

/* ------------------------------------------------------------ the backlog */

interface GateProfile {
  /** Mean scans per minute. */
  rate: number;
  pick: (rng: Rng) => { result: ScanResult; tier: AttendeeTier | null; carrier: CarrierKind | null };
}

function tierOf(rng: Rng): AttendeeTier {
  const roll = rng();
  return roll < 0.06 ? "VIP" : roll < 0.1 ? "PRIVATE_INVITE" : roll < 0.25 ? "PUBLIC" : "ORDINARY";
}

function perimeterCarrier(rng: Rng): CarrierKind {
  const roll = rng();
  return roll < 0.5 ? "qr_portal" : roll < 0.65 ? "qr_email" : "nfc";
}

function profileFor(checkpoint: Checkpoint): GateProfile {
  if (checkpoint.perimeter && checkpoint.direction === "out") {
    return { rate: 5, pick: (rng) => ({ result: "admitted", tier: tierOf(rng), carrier: "nfc" }) };
  }
  if (checkpoint.perimeter) {
    return {
      rate: 12 + (checkpoint.label.length % 5),
      pick: (rng) => {
        const roll = rng();
        const carrier = perimeterCarrier(rng);
        if (roll < 0.885) return { result: "admitted", tier: tierOf(rng), carrier };
        if (roll < 0.925) return { result: "already_inside", tier: tierOf(rng), carrier };
        if (roll < 0.955) return { result: "duplicate_read", tier: tierOf(rng), carrier };
        if (roll < 0.97) return { result: "unknown_token", tier: null, carrier: null };
        if (roll < 0.985) return { result: "pass_spent", tier: tierOf(rng), carrier: "qr_email" };
        if (roll < 0.995) return { result: "revoked", tier: tierOf(rng), carrier };
        return { result: "suspended", tier: tierOf(rng), carrier };
      },
    };
  }
  return {
    rate: 2 + (checkpoint.label.length % 4),
    pick: (rng) => {
      const roll = rng();
      if (roll < 0.8) return { result: "admitted", tier: tierOf(rng), carrier: "nfc" };
      if (roll < 0.85) return { result: "implied_exit", tier: tierOf(rng), carrier: "nfc" };
      if (roll < 0.89) return { result: "denied_room", tier: rng() < 0.7 ? "PUBLIC" : "ORDINARY", carrier: "nfc" };
      if (roll < 0.92) return { result: "already_inside", tier: tierOf(rng), carrier: "nfc" };
      if (roll < 0.95) return { result: "duplicate_read", tier: tierOf(rng), carrier: "nfc" };
      if (roll < 0.98) return { result: "wristband_required", tier: tierOf(rng), carrier: "qr_portal" };
      return { result: "capacity_block", tier: tierOf(rng), carrier: "nfc" };
    },
  };
}

/** An hour of traffic before `start`, deterministic per venue and event. Newest first. */
function backlog(layout: VenueLayout, eventId: string, start: number): OpsScan[] {
  const rng = createRng(hashString(`scan-backlog:${eventId}`));
  const out: OpsScan[] = [];
  const outageGate = layout.checkpoints[1]?.id;
  const outageFrom = start - 48 * MINUTE;
  const outageTo = start - 46 * MINUTE;
  layout.checkpoints.forEach((checkpoint) => {
    const profile = profileFor(checkpoint);
    for (let m = BACKLOG_MINUTES; m >= 1; m--) {
      const minuteStart = start - m * MINUTE;
      // A gentle wave across the hour, so the sparklines have shape.
      const wave = 0.75 + 0.35 * Math.sin((m / BACKLOG_MINUTES) * Math.PI * 2 + checkpoint.label.length);
      const count = Math.max(0, Math.round(profile.rate * wave * (0.6 + rng() * 0.8)));
      for (let i = 0; i < count; i++) {
        const at = minuteStart + Math.floor(rng() * MINUTE);
        const { result, tier, carrier } = profile.pick(rng);
        const offline = checkpoint.id === outageGate && at >= outageFrom && at < outageTo;
        const latency = offline ? null : 40 + Math.floor(rng() * 220);
        const iso = new Date(at).toISOString();
        out.push({
          id: uuidFrom(rng),
          event_id: eventId,
          checkpoint_id: checkpoint.id,
          ephemeral_id: null,
          carrier_kind: carrier,
          result,
          occurred_at: iso,
          received_at: new Date(offline ? outageTo + 3_000 + Math.floor(rng() * 4_000) : at + (latency ?? 0)).toISOString(),
          clock_offset_ms: 0,
          offline,
          tier,
          corrected_at: iso,
          latency_ms: latency,
        });
      }
    }
  });
  return out.sort(newerFirst);
}
