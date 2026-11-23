/**
 * Reports for the in-memory backend, mirroring @synan/db's report_* functions: the same sections,
 * columns, ordering, cursor format and suppression (dwell and flow figures below 5 are withheld).
 * Reports read aggregates only: registrations, alerts, gate-rate rollups, and the peak / dwell /
 * flow rollups computed by rebuildRollups(), which the purge runs before destroying scans.
 */
import { randomUUID } from "node:crypto";
import { ATTENDEE_TIER_VALUES } from "@synan/contracts/enums";
import type { MemoryTables } from "./memory.js";
import { memorySummaryAndWorkbook } from "./memory-summary.js";
import { REPORT_SECTION_NAMES, type ReportCell, type ReportRow, type ReportsRepo, type ScanRow } from "./types.js";

type Col = { key: string; type: "string" | "number" | "datetime" | "boolean" | "json" | "number[]" };
const c = (key: string, type: Col["type"]): Col => ({ key, type });
export const REPORT_COLUMNS: Record<string, Col[]> = {
  by_tier: [c("tier", "string"), c("registered", "number"), c("pending", "number"), c("cancelled", "number"), c("checked_in", "number"), c("no_shows", "number")],
  arrivals: [c("bucket_start", "datetime"), c("tier", "string"), c("arrivals", "number")],
  dwell: [c("zone_id", "string"), c("zone_name", "string"), c("floor", "string"), c("visits", "number"), c("open_visits", "number"),
    c("avg_minutes", "number"), c("dwell_histogram", "number[]"), c("suppressed", "boolean")],
  flow: [c("bucket_start", "datetime"), c("from_zone_id", "string"), c("to_zone_id", "string"), c("moves", "number"), c("suppressed", "boolean")],
  peaks: [c("room_id", "string"), c("room_name", "string"), c("zone_id", "string"), c("capacity", "number"), c("peak", "number"),
    c("peak_at", "datetime"), c("pct", "number"), c("admissions", "number")],
  alerts: [c("kind", "string"), c("severity", "string"), c("total", "number"), c("open", "number"), c("acked", "number"), c("resolved", "number"),
    c("ack_avg_s", "number"), c("ack_p50_s", "number"), c("ack_p90_s", "number"), c("resolve_avg_s", "number"), c("resolve_p50_s", "number"), c("resolve_p90_s", "number")],
  throughput: [c("checkpoint_id", "string"), c("label", "string"), c("bucket_start", "datetime"), c("scans", "number"), c("admitted", "number"),
    c("denied", "number"), c("by_result", "json"), c("by_tier", "json")],
};

/** A report row object → contract cells, by column type. Shared by both backends. */
export function toCells(columns: readonly Col[], rows: readonly Record<string, unknown>[]): ReportCell[][] {
  return rows.map((r) =>
    columns.map(({ key, type }) => {
      const v = r[key];
      if (v === null || v === undefined) return null;
      if (type === "datetime") return (v instanceof Date ? v : new Date(String(v))).toISOString();
      if (type === "number") return Number(v);
      if (type === "boolean") return v ? "true" : "false";
      if (type === "json" || type === "number[]") return JSON.stringify(v);
      return String(v);
    }),
  );
}

const encodeCursor = (kind: string, section: string, offset: number) => Buffer.from(JSON.stringify({ k: kind, s: section, o: offset }), "utf8").toString("base64url");
function decodeCursor(cursor: string | null | undefined, kind: string, section: string): number {
  if (!cursor) return 0;
  try {
    const x = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { k: string; s: string; o: number };
    if (x.k !== kind || x.s !== section || !Number.isInteger(x.o) || x.o < 0) throw new Error();
    return x.o;
  } catch {
    throw new Error("invalid report cursor");
  }
}

const bin = (ms: number, step: number) => new Date(Math.floor(ms / step) * step);
export const round1 = (x: number) => Math.round(x * 10) / 10;
export function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return round1(sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo));
}
export const cmp = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1);
const corrected = (s: ScanRow) => s.occurred_at.getTime() + s.clock_offset_ms;

interface Snapshot {
  flowHourly: Record<string, unknown>[];
  rebuiltAt: Date;
  curve: { at: Date; on_site: number }[];
  peaks: Record<string, unknown>[];
  dwell: Record<string, unknown>[];
  flow: Record<string, unknown>[];
}

export function memoryReports(t: MemoryTables, audit?: (e: { actor_id: string | null; action: string; target: string; meta_jsonb: Record<string, unknown>; at: Date }) => unknown): ReportsRepo {
  const snapshots = new Map<string, Snapshot>();
  const jobs = new Map<string, ReportRow & { seq: number }>();
  let seq = 0;

  const rebuild = (eventId: string) => {
    const e = t.events.get(eventId);
    if (!e) return;
    const scans = [...t.scans.values()].filter((s) => s.event_id === eventId).sort((a, b) => corrected(a) - corrected(b));
    const roomIds = t.eventRooms.filter((r) => r.event_id === eventId).map((r) => r.room_id);
    // Peaks: replay admissions, exits and implied exits per room in 5-minute buckets.
    const level = new Map<string, number>();
    const bucketPeak = new Map<string, number>();
    const peak = new Map<string, { peak: number; at: Date | null; admissions: number }>();
    for (const id of roomIds) peak.set(id, { peak: 0, at: null, admissions: 0 });
    const roomOf = (s: ScanRow) => t.checkpoints.get(s.checkpoint_id)?.room_id ?? null;
    for (const s of scans) {
      const room = roomOf(s);
      if (!room || !peak.has(room)) continue;
      let d = 0;
      if (s.result === "admitted" && s.direction === "in") d = 1;
      else if (s.result === "implied_exit" || (s.result === "admitted" && s.direction === "out")) d = -1;
      if (!d) continue;
      const n = Math.max(0, (level.get(room) ?? 0) + d);
      level.set(room, n);
      const bk = `${room}|${bin(corrected(s), 300_000).getTime()}`;
      bucketPeak.set(bk, Math.max(bucketPeak.get(bk) ?? 0, n));
      const p = peak.get(room)!;
      if (d > 0) p.admissions++;
      if (n > p.peak) Object.assign(p, { peak: n, at: bin(corrected(s), 300_000) });
    }
    const peaks = roomIds
      .map((id) => {
        const r = t.rooms.get(id)!;
        const cap = t.eventRooms.find((x) => x.event_id === eventId && x.room_id === id)?.capacity_override ?? r.capacity;
        const p = peak.get(id)!;
        return { room_id: id, room_name: r.name, zone_id: r.zone_id, capacity: cap, peak: p.peak, peak_at: p.at, pct: cap ? round1((100 * p.peak) / cap) : null, admissions: p.admissions };
      })
      .sort((a, b) => b.peak - a.peak || cmp(a.room_name, b.room_name));
    // Dwell and flow per zone, from the zone each holder was admitted into, in order.
    const zones = [...t.zones.values()].filter((z) => z.venue_id === e.venue_id);
    const lastZone = new Map<string, { zone: string; at: number }>();
    const visits = new Map<string, number[]>();
    const open = new Map<string, number>();
    const moves = new Map<string, number>();
    const movesHourly = new Map<string, number>();
    for (const s of scans) {
      if (s.result !== "admitted" || !s.ephemeral_id || s.direction !== "in") continue;
      const zone = t.checkpoints.get(s.checkpoint_id)?.zone_id;
      if (!zone) continue;
      const prev = lastZone.get(s.ephemeral_id);
      if (prev?.zone === zone) continue;
      if (prev) (visits.get(prev.zone) ?? visits.set(prev.zone, []).get(prev.zone)!).push((corrected(s) - prev.at) / 60_000);
      const k = `${prev?.zone ?? ""}>${zone}`;
      moves.set(k, (moves.get(k) ?? 0) + 1);
      const hk = `${bin(corrected(s), 3_600_000).getTime()}|${k}`;
      movesHourly.set(hk, (movesHourly.get(hk) ?? 0) + 1);
      lastZone.set(s.ephemeral_id, { zone, at: corrected(s) });
    }
    for (const { zone } of lastZone.values()) open.set(zone, (open.get(zone) ?? 0) + 1);
    const dwell = zones
      .map((z) => {
        const v = visits.get(z.id) ?? [];
        const total = v.length + (open.get(z.id) ?? 0);
        const hidden = total < 5;
        const hist = [0, 5, 15, 30, 60, 120].map((lo, i, a) => v.filter((m) => m >= lo && (i === a.length - 1 || m < a[i + 1]!)).length);
        return {
          zone_id: z.id, zone_name: z.name, floor: z.floor, visits: hidden ? null : total, open_visits: hidden ? null : open.get(z.id) ?? 0,
          avg_minutes: hidden || !v.length ? null : round1(v.reduce((x, y) => x + y, 0) / v.length), dwell_histogram: hidden ? null : hist, suppressed: hidden,
        };
      })
      .sort((a, b) => cmp(a.zone_name, b.zone_name));
    const flow = [...moves.entries()]
      .map(([k, n]) => {
        const [from, to] = k.split(">");
        return { bucket_start: null, from_zone_id: from || null, to_zone_id: to || null, moves: n < 5 ? null : n, suppressed: n < 5 };
      })
      .sort((a, b) => cmp(a.from_zone_id, b.from_zone_id) || cmp(a.to_zone_id, b.to_zone_id));
    const curveMap = new Map<number, number>();
    for (const [k, n] of bucketPeak) {
      const at = Number(k.split("|")[1]);
      curveMap.set(at, (curveMap.get(at) ?? 0) + n);
    }
    const curve = [...curveMap.entries()].sort((a, b) => a[0] - b[0]).map(([at, on_site]) => ({ at: new Date(at), on_site }));
    const flowHourly = [...movesHourly.entries()]
      .map(([k, n]) => {
        const [hour, pair] = k.split("|") as [string, string];
        const [from, to] = pair.split(">");
        return { bucket_start: new Date(Number(hour)), from_zone_id: from || null, to_zone_id: to || null, moves: n < 5 ? null : n, suppressed: n < 5 };
      })
      .sort((a, b) => a.bucket_start.getTime() - b.bucket_start.getTime() || cmp(a.from_zone_id, b.from_zone_id) || cmp(a.to_zone_id, b.to_zone_id));
    snapshots.set(eventId, { curve, peaks, dwell, flow, flowHourly, rebuiltAt: new Date() });
  };

  const sectionRows = (kind: string, section: string, eventId: string, bucketMs = 300_000): Record<string, unknown>[] => {
    const regs = [...t.registrations.values()].filter((r) => r.event_id === eventId);
    const snap = snapshots.get(eventId) ?? { curve: [], peaks: [], dwell: [], flow: [], flowHourly: [], rebuiltAt: new Date(0) };
    switch (section) {
      case "by_tier":
        return ATTENDEE_TIER_VALUES.map((tier) => {
          const rs = regs.filter((r) => r.tier === tier);
          return {
            tier, registered: rs.filter((r) => r.state === "confirmed").length, pending: rs.filter((r) => r.state === "pending_approval").length,
            cancelled: rs.filter((r) => r.state === "cancelled").length, checked_in: rs.filter((r) => r.checked_in_at).length,
            no_shows: rs.filter((r) => r.state === "confirmed" && !r.checked_in_at).length,
          };
        });
      case "arrivals": {
        const m = new Map<string, { bucket_start: Date; tier: string; arrivals: number }>();
        for (const r of regs) {
          if (!r.checked_in_at) continue;
          const b = bin(r.checked_in_at.getTime(), 900_000);
          const k = `${b.toISOString()}|${r.tier}`;
          (m.get(k) ?? m.set(k, { bucket_start: b, tier: r.tier, arrivals: 0 }).get(k)!).arrivals++;
        }
        const order = (x: string) => ATTENDEE_TIER_VALUES.indexOf(x as never);
        return [...m.values()].sort((a, b) => a.bucket_start.getTime() - b.bucket_start.getTime() || order(a.tier) - order(b.tier));
      }
      case "alerts": {
        const as = [...t.alerts.values()].filter((a) => a.event_id === eventId);
        const agg = (list: typeof as, kind: string | null, severity: string | null) => {
          const ack = list.filter((a) => a.acked_at).map((a) => (a.acked_at!.getTime() - a.occurred_at.getTime()) / 1000).sort((x, y) => x - y);
          const res = list.filter((a) => a.resolved_at).map((a) => (a.resolved_at!.getTime() - a.occurred_at.getTime()) / 1000).sort((x, y) => x - y);
          const avg = (v: number[]) => (v.length ? round1(v.reduce((x, y) => x + y, 0) / v.length) : null);
          return {
            kind, severity, total: list.length, open: list.filter((a) => a.state === "open").length, acked: list.filter((a) => a.state === "acked").length,
            resolved: list.filter((a) => a.state === "resolved").length, ack_avg_s: avg(ack), ack_p50_s: percentile(ack, 0.5), ack_p90_s: percentile(ack, 0.9),
            resolve_avg_s: avg(res), resolve_p50_s: percentile(res, 0.5), resolve_p90_s: percentile(res, 0.9),
          };
        };
        const groups = new Map<string, typeof as>();
        for (const a of as) (groups.get(`${a.kind}|${a.severity}`) ?? groups.set(`${a.kind}|${a.severity}`, []).get(`${a.kind}|${a.severity}`)!).push(a);
        const rows = [...groups.entries()].map(([k, list]) => agg(list, k.split("|")[0]!, k.split("|")[1]!));
        rows.sort((a, b) => cmp(a.kind, b.kind) || cmp(a.severity, b.severity));
        return [...rows, agg(as, null, null)];
      }
      case "throughput": {
        const m = new Map<string, { checkpoint_id: string; label: string; bucket_start: Date; scans: number; admitted: number; denied: number; by_result: Record<string, number>; by_tier: Record<string, number> }>();
        for (const g of t.gateRates.values()) {
          if (g.event_id !== eventId) continue;
          const b = bin(g.minute_start.getTime(), bucketMs);
          const k = `${g.checkpoint_id}|${b.toISOString()}`;
          const row = m.get(k) ?? m.set(k, { checkpoint_id: g.checkpoint_id, label: t.checkpoints.get(g.checkpoint_id)?.label ?? "", bucket_start: b, scans: 0, admitted: 0, denied: 0, by_result: {}, by_tier: {} }).get(k)!;
          row.scans += g.scans;
          row.admitted += g.admitted;
          row.denied += g.denied;
          for (const [x, n] of Object.entries(g.by_result_jsonb)) row.by_result[x] = (row.by_result[x] ?? 0) + n;
          for (const [x, n] of Object.entries(g.by_tier_jsonb)) row.by_tier[x] = (row.by_tier[x] ?? 0) + (n ?? 0);
        }
        return [...m.values()].sort((a, b) => cmp(a.label, b.label) || a.bucket_start.getTime() - b.bucket_start.getTime());
      }
      case "flow_hourly":
        return snap.flowHourly;
      default:
        return (snap as unknown as Record<string, Record<string, unknown>[]>)[section] ?? [];
    }
  };

  const sw = memorySummaryAndWorkbook(t, sectionRows, (id) => snapshots.get(id));

  return {
    async run(kind, eventId, { section, cursor, limit }) {
      const sections = REPORT_SECTION_NAMES[kind] as readonly string[];
      const sec = section ?? sections[0]!;
      if (!sections.includes(sec)) throw new Error("invalid report section");
      const offset = decodeCursor(cursor, kind, sec);
      const all = sectionRows(kind, sec, eventId);
      const items = all.slice(offset, offset + limit);
      const next = offset + items.length < all.length ? encodeCursor(kind, sec, offset + items.length) : null;
      return { section: sec, columns: REPORT_COLUMNS[sec]!.map((x) => x.key), rows: toCells(REPORT_COLUMNS[sec]!, items), next_cursor: next, total: all.length };
    },
    async rebuildRollups(eventId) {
      rebuild(eventId);
    },
    async purge(eventId, actorId) {
      rebuild(eventId);
      sw.freeze(eventId, new Date());
      for (const [k, s] of t.scans) if (s.event_id === eventId) t.scans.delete(k);
      for (const k of [...t.scansByIdem.keys()]) if (k.startsWith(`${eventId}:`)) t.scansByIdem.delete(k);
      for (const k of [...t.ephemeralIds.keys()]) if (k.startsWith(`${eventId}:`)) t.ephemeralIds.delete(k);
      t.purgedEvents.set(eventId, new Date());
      audit?.({ actor_id: actorId, action: "event.purge", target: `event:${eventId}`, meta_jsonb: {}, at: new Date() });
    },
    async request({ eventId, kind, format, includeIdentity, requestedBy, params }) {
      if (format === "csv" && !kind) throw new Error("a csv export needs a report kind");
      const id = randomUUID();
      jobs.set(id, { id, event_id: eventId, kind, format, include_identity: format === "xlsx" && includeIdentity, state: "queued", object_key: null, requested_by: requestedBy, params, error: null, created_at: new Date(), completed_at: null, seq: seq++ });
      return id;
    },
    async claim() {
      const j = [...jobs.values()].filter((x) => x.state === "queued").sort((a, b) => a.seq - b.seq)[0];
      if (!j) return null;
      j.state = "running";
      const { seq: _s, ...row } = j;
      return structuredClone(row);
    },
    async complete(id, objectKey, now) {
      const j = jobs.get(id);
      if (!j || j.state !== "running") return false;
      Object.assign(j, { state: "ready", object_key: objectKey, completed_at: now, error: null });
      return true;
    },
    async fail(id, error, now) {
      const j = jobs.get(id);
      if (!j || j.state !== "running") return false;
      Object.assign(j, { state: "failed", error: error.slice(0, 1000), completed_at: now });
      return true;
    },
    async occupancyCurve(eventId) {
      return structuredClone(snapshots.get(eventId)?.curve ?? []);
    },
    postEventSummary: (eventId, now) => sw.postEventSummary(eventId, now),
    workbook: (eventId, opts, consume) => sw.workbook(eventId, opts, consume),
    async purgedAt(eventId) {
      return t.purgedEvents.get(eventId) ?? null;
    },
    async list({ eventId, offset, limit }) {
      return [...jobs.values()]
        .filter((j) => !eventId || j.event_id === eventId)
        .sort((a, b) => b.seq - a.seq)
        .slice(offset, offset + limit)
        .map(({ seq: _s, ...row }) => structuredClone(row));
    },
  };
}
