/**
 * Reports (docs/01 §10) and live summaries. Every report reads only data that survives the purge
 * (rollups, snapshots, registrations, alerts), so it returns the same figures before and after it.
 * Rollups are current after rebuildEventRollups(), which the purge runs; during an event run it on
 * a schedule (e.g. every 5 minutes) for reports to follow the live data.
 */
import { sql } from "drizzle-orm";
import {
  date,
  intervalOrNull,
  json,
  num,
  numOrNull,
  rows,
  tsOrNull,
  uuidOrNull,
  type DbOrTx,
  type Page,
  type PageQuery,
  type RangeQuery,
} from "./sqlrows";

const page = <T>(items: T[], raw: Record<string, unknown>[]): Page<T> => ({ items, total: raw.length ? num(raw[0]!.total_count) : 0 });

/* ----------------------------------------------------------------- attendance */

export interface AttendanceRow {
  tier: string;
  registered: number;
  pending: number;
  cancelled: number;
  checked_in: number;
  no_shows: number;
}
/** Registered, checked in, no-shows by tier. `checked_in` honours the time range. */
export async function reportAttendance(db: DbOrTx, eventId: string, range: RangeQuery = {}): Promise<AttendanceRow[]> {
  const r = await rows(db, sql`select * from public.report_attendance(${eventId}::uuid, ${tsOrNull(range.from)}, ${tsOrNull(range.to)})`);
  return r.map((x) => ({
    tier: String(x.tier),
    registered: num(x.registered),
    pending: num(x.pending),
    cancelled: num(x.cancelled),
    checked_in: num(x.checked_in),
    no_shows: num(x.no_shows),
  }));
}

export interface ArrivalsRow {
  bucket_start: Date;
  tier: string;
  arrivals: number;
}
/** First check-ins over time by tier. `bucket` is a Postgres interval, default "15 minutes". */
export async function reportArrivals(db: DbOrTx, eventId: string, q: RangeQuery & { bucket?: string } = {}): Promise<ArrivalsRow[]> {
  const r = await rows(
    db,
    sql`select * from public.report_arrivals(${eventId}::uuid, ${q.bucket ?? "15 minutes"}::interval, ${tsOrNull(q.from)}, ${tsOrNull(q.to)})`,
  );
  return r.map((x) => ({ bucket_start: date(x.bucket_start)!, tier: String(x.tier), arrivals: num(x.arrivals) }));
}

/* -------------------------------------------------------------- dwell and flow */

export interface DwellRow {
  zone_id: string;
  zone_name: string;
  floor: string | null;
  /** Null when suppressed (fewer than minCount visits, O-08). */
  visits: number | null;
  open_visits: number | null;
  avg_minutes: number | null;
  /** Visits in minute buckets [0,5) [5,15) [15,30) [30,60) [60,120) [120,∞). */
  dwell_histogram: number[] | null;
  suppressed: boolean;
}
export const DWELL_BUCKETS_MINUTES = [0, 5, 15, 30, 60, 120] as const;

/** Time per zone for the whole event. */
export async function reportDwell(db: DbOrTx, eventId: string, q: { minCount?: number } = {}): Promise<DwellRow[]> {
  const r = await rows(db, sql`select * from public.report_dwell(${eventId}::uuid, ${q.minCount ?? 5}::integer)`);
  return r.map((x) => ({
    zone_id: String(x.zone_id),
    zone_name: String(x.zone_name),
    floor: (x.floor as string | null) ?? null,
    visits: numOrNull(x.visits),
    open_visits: numOrNull(x.open_visits),
    avg_minutes: numOrNull(x.avg_minutes),
    dwell_histogram: x.dwell_histogram == null ? null : (x.dwell_histogram as unknown[]).map(num),
    suppressed: Boolean(x.suppressed),
  }));
}

export interface FlowRow {
  /** Null when not bucketed (totals over the range). */
  bucket_start: Date | null;
  /** Null = arrived from outside the venue. */
  from_zone_id: string | null;
  /** Null = left the venue. */
  to_zone_id: string | null;
  moves: number | null;
  suppressed: boolean;
}
/** Movement between zones. `bucket` null = totals; otherwise a multiple of one hour. */
export async function reportFlow(
  db: DbOrTx,
  eventId: string,
  q: RangeQuery & PageQuery & { bucket?: string | null; minCount?: number } = {},
): Promise<Page<FlowRow>> {
  const r = await rows(
    db,
    sql`select * from public.report_flow(${eventId}::uuid, ${tsOrNull(q.from)}, ${tsOrNull(q.to)}, ${intervalOrNull(q.bucket)},
          ${q.minCount ?? 5}::integer, ${q.limit ?? 500}::integer, ${q.offset ?? 0}::integer)`,
  );
  return page(
    r.map((x) => ({
      bucket_start: date(x.bucket_start),
      from_zone_id: (x.from_zone_id as string | null) ?? null,
      to_zone_id: (x.to_zone_id as string | null) ?? null,
      moves: numOrNull(x.moves),
      suppressed: Boolean(x.suppressed),
    })),
    r,
  );
}

/* --------------------------------------------------------------- peak occupancy */

export interface PeakRow {
  room_id: string;
  room_name: string;
  zone_id: string;
  capacity: number;
  peak: number;
  /** Start of the first 5-minute bucket that reached the peak; null when the room stayed empty. */
  peak_at: Date | null;
  pct: number | null;
  admissions: number;
}
export async function reportPeakOccupancy(db: DbOrTx, eventId: string, q: RangeQuery & PageQuery = {}): Promise<Page<PeakRow>> {
  const r = await rows(
    db,
    sql`select * from public.report_peak_occupancy(${eventId}::uuid, ${tsOrNull(q.from)}, ${tsOrNull(q.to)},
          ${q.limit ?? 500}::integer, ${q.offset ?? 0}::integer)`,
  );
  return page(
    r.map((x) => ({
      room_id: String(x.room_id),
      room_name: String(x.room_name),
      zone_id: String(x.zone_id),
      capacity: num(x.capacity),
      peak: num(x.peak),
      peak_at: date(x.peak_at),
      pct: numOrNull(x.pct),
      admissions: num(x.admissions),
    })),
    r,
  );
}

/* ---------------------------------------------------------- breach and compliance */

export interface BreachRow {
  /** Null kind and severity = the total over the range. */
  kind: string | null;
  severity: string | null;
  total: number;
  open: number;
  acked: number;
  resolved: number;
  ack_avg_s: number | null;
  ack_p50_s: number | null;
  ack_p90_s: number | null;
  resolve_avg_s: number | null;
  resolve_p50_s: number | null;
  resolve_p90_s: number | null;
}
export async function reportBreach(db: DbOrTx, eventId: string, range: RangeQuery = {}): Promise<BreachRow[]> {
  const r = await rows(db, sql`select * from public.report_breach(${eventId}::uuid, ${tsOrNull(range.from)}, ${tsOrNull(range.to)})`);
  return r.map((x) => ({
    kind: (x.kind as string | null) ?? null,
    severity: (x.severity as string | null) ?? null,
    total: num(x.total),
    open: num(x.open),
    acked: num(x.acked),
    resolved: num(x.resolved),
    ack_avg_s: numOrNull(x.ack_avg_s),
    ack_p50_s: numOrNull(x.ack_p50_s),
    ack_p90_s: numOrNull(x.ack_p90_s),
    resolve_avg_s: numOrNull(x.resolve_avg_s),
    resolve_p50_s: numOrNull(x.resolve_p50_s),
    resolve_p90_s: numOrNull(x.resolve_p90_s),
  }));
}

/* ------------------------------------------------------------- gate throughput */

export interface GateThroughputRow {
  checkpoint_id: string;
  label: string;
  /** Null when not bucketed (totals per gate over the range). */
  bucket_start: Date | null;
  scans: number;
  admitted: number;
  denied: number;
  /** Physical reads by result code — the failure breakdown. */
  by_result: Record<string, number>;
  by_tier: Record<string, number>;
}
/** Scans per gate over time. `bucket` default "5 minutes"; null = totals per gate. */
export async function reportGateThroughput(
  db: DbOrTx,
  eventId: string,
  q: RangeQuery & PageQuery & { bucket?: string | null; checkpointId?: string | null } = {},
): Promise<Page<GateThroughputRow>> {
  const bucket = q.bucket === undefined ? "5 minutes" : q.bucket;
  const r = await rows(
    db,
    sql`select * from public.report_gate_throughput(${eventId}::uuid, ${intervalOrNull(bucket)}, ${tsOrNull(q.from)}, ${tsOrNull(q.to)},
          ${uuidOrNull(q.checkpointId)}, ${q.limit ?? 1000}::integer, ${q.offset ?? 0}::integer)`,
  );
  return page(
    r.map((x) => ({
      checkpoint_id: String(x.checkpoint_id),
      label: String(x.label),
      bucket_start: date(x.bucket_start),
      scans: num(x.scans),
      admitted: num(x.admitted),
      denied: num(x.denied),
      by_result: json<Record<string, number>>(x.by_result),
      by_tier: json<Record<string, number>>(x.by_tier),
    })),
    r,
  );
}

/* ---------------------------------------------------------------- summaries */

export interface EventSummaryRow {
  event_id: string;
  registered: number;
  checked_in: number;
  on_site: number;
  rooms_over_warn: number;
  rooms_at_block: number;
  open_alerts: number;
  acked_alerts: number;
  critical_open_alerts: number;
  by_tier: Record<string, { registered: number; checked_in: number; on_site: number }>;
  as_of: Date;
}
/** Live KPI strip for one event (GET /events/:id/summary). */
export async function eventSummary(db: DbOrTx, eventId: string): Promise<EventSummaryRow> {
  const x = (await rows(db, sql`select * from public.event_summary(${eventId}::uuid)`))[0]!;
  return {
    event_id: String(x.event_id),
    registered: num(x.registered),
    checked_in: num(x.checked_in),
    on_site: num(x.on_site),
    rooms_over_warn: num(x.rooms_over_warn),
    rooms_at_block: num(x.rooms_at_block),
    open_alerts: num(x.open_alerts),
    acked_alerts: num(x.acked_alerts),
    critical_open_alerts: num(x.critical_open_alerts),
    by_tier: json(x.by_tier),
    as_of: date(x.as_of)!,
  };
}

export interface DashboardSummaryRow {
  live_events: number;
  published_events: number;
  registered: number;
  checked_in: number;
  on_site: number;
  rooms_over_warn: number;
  open_alerts: number;
  critical_open_alerts: number;
  as_of: Date;
}
/** Organisation dashboard (GET /dashboard): totals over live events. */
export async function dashboardSummary(db: DbOrTx, orgId: string): Promise<DashboardSummaryRow> {
  const x = (await rows(db, sql`select * from public.dashboard_summary(${orgId}::uuid)`))[0]!;
  return {
    live_events: num(x.live_events),
    published_events: num(x.published_events),
    registered: num(x.registered),
    checked_in: num(x.checked_in),
    on_site: num(x.on_site),
    rooms_over_warn: num(x.rooms_over_warn),
    open_alerts: num(x.open_alerts),
    critical_open_alerts: num(x.critical_open_alerts),
    as_of: date(x.as_of)!,
  };
}

/* ------------------------------------------------- uniform paging over every report */

/** The report kinds of the contracts' ReportKind, each with one or more sections. */
export const REPORT_SECTIONS = {
  attendance: ["by_tier", "arrivals"],
  dwell_flow: ["flow", "dwell"],
  peak_occupancy: ["peaks"],
  breach_compliance: ["alerts"],
  gate_throughput: ["throughput"],
} as const;
export type ReportKindName = keyof typeof REPORT_SECTIONS;
export type ReportSection = (typeof REPORT_SECTIONS)[ReportKindName][number];

export interface ReportColumn {
  key: string;
  type: "string" | "number" | "datetime" | "boolean" | "json" | "number[]";
}

export interface ReportPage {
  kind: ReportKindName;
  section: ReportSection;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  /** Opaque; pass back as `cursor` for the next page. Null on the last page. */
  next_cursor: string | null;
  total: number;
}

const c = (key: string, type: ReportColumn["type"]): ReportColumn => ({ key, type });
const COLUMNS: Record<ReportSection, ReportColumn[]> = {
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

/**
 * Cursor = an opaque offset into the report's fixed ordering. Reports read only rollups, which do
 * not change after the event (or between rebuilds), so the ordering is stable while paging.
 */
const encodeCursor = (kind: string, section: string, offset: number) =>
  Buffer.from(JSON.stringify({ k: kind, s: section, o: offset }), "utf8").toString("base64url");
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

/**
 * One page of any report: `(eventId, cursor, limit) → { columns, rows, next_cursor }`.
 * `section` defaults to the kind's first section. Range, `bucket` and `minCount` as for the
 * individual report helpers.
 */
export async function runReport(
  db: DbOrTx,
  kind: ReportKindName,
  eventId: string,
  opts: RangeQuery & { section?: ReportSection; cursor?: string | null; limit?: number; bucket?: string | null; minCount?: number } = {},
): Promise<ReportPage> {
  const sections = REPORT_SECTIONS[kind] as readonly ReportSection[];
  const section = opts.section ?? sections[0]!;
  if (!sections.includes(section)) throw new Error(`report ${kind} has no section ${section}`);
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 5000);
  const offset = decodeCursor(opts.cursor, kind, section);
  const range = { from: opts.from, to: opts.to };
  let all: { items: unknown[]; total: number };
  switch (section) {
    case "by_tier": {
      const r = await reportAttendance(db, eventId, range);
      all = { items: r.slice(offset, offset + limit), total: r.length };
      break;
    }
    case "arrivals": {
      const r = await reportArrivals(db, eventId, { ...range, bucket: opts.bucket ?? undefined });
      all = { items: r.slice(offset, offset + limit), total: r.length };
      break;
    }
    case "dwell": {
      const r = await reportDwell(db, eventId, { minCount: opts.minCount });
      all = { items: r.slice(offset, offset + limit), total: r.length };
      break;
    }
    case "alerts": {
      const r = await reportBreach(db, eventId, range);
      all = { items: r.slice(offset, offset + limit), total: r.length };
      break;
    }
    case "flow":
      all = await reportFlow(db, eventId, { ...range, bucket: opts.bucket ?? null, minCount: opts.minCount, limit, offset });
      break;
    case "peaks":
      all = await reportPeakOccupancy(db, eventId, { ...range, limit, offset });
      break;
    case "throughput":
      all = await reportGateThroughput(db, eventId, { ...range, bucket: opts.bucket === undefined ? "5 minutes" : opts.bucket, limit, offset });
      break;
  }
  const next = offset + all.items.length < all.total ? encodeCursor(kind, section, offset + all.items.length) : null;
  return { kind, section, columns: COLUMNS[section], rows: all.items as Record<string, unknown>[], next_cursor: next, total: all.total };
}
