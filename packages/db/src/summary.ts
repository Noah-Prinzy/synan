/**
 * The post-event summary and the Excel workbook's data (D-21). Both come only from data that
 * survives the purge: rollups, registrations, alerts, the venue — and, for the attendee sheet's
 * names, the identity vault.
 */
import { inArray, sql } from "drizzle-orm";
import type { AnyDb, AnyTx } from "./client";
import { setVaultScope } from "./client";
import type { Cipher } from "./crypto/index";
import { reportArrivals, reportAttendance, reportBreach, reportDwell, reportFlow, reportPeakOccupancy } from "./reports";
import { attendees } from "./schema/vault";
import { decryptAttendeeRow } from "./secrets";
import { date, json, num, numOrNull, rows, tsOrNow } from "./sqlrows";

/* ------------------------------------------------------------------ summary */

export interface PostEventSummary {
  /** `starts_at` and `ends_at` are null only for a draft whose dates are not set. */
  event: { id: string; slug: string; title: string; state: string; starts_at: Date | null; ends_at: Date | null; timezone: string; closed_at: Date | null };
  /** True while the event is draft, published or live: figures so far. */
  provisional: boolean;
  computed_at: Date;
  /** When the rollups behind these figures were last rebuilt (null: never). */
  rollups_rebuilt_at: Date | null;
  /** True once the purge has frozen the summary; it no longer changes. */
  frozen: boolean;
  frozen_at: Date | null;
  headline: {
    registered: number;
    checked_in: number;
    no_shows: number;
    peak_on_site: number;
    peak_on_site_at: Date | null;
    rooms_at_capacity: number;
    alerts_total: number;
    alerts_by_severity: { low: number; medium: number; high: number; critical: number };
    ack_median_s: number | null;
    resolve_median_s: number | null;
  };
  attendance_by_tier: { tier: string; registered: number; checked_in: number; no_shows: number }[];
  onsite_curve: { bucket_minutes: number; points: { t: Date; on_site: number; peak: number }[] };
  busiest_rooms: { room_id: string; name: string; peak: number; peak_at: Date | null; capacity: number; pct: number | null; admissions: number; reached_block: boolean }[];
  busiest_gates: { checkpoint_id: string; label: string; scans: number; admitted: number; denied: number }[];
  purge: { purged: boolean; purged_at: Date | null; due_at: Date | null; scans_available: boolean };
}

type J = Record<string, unknown>;
function parseSummary(x: J): PostEventSummary {
  const e = x.event as J;
  const h = x.headline as J;
  const p = x.purge as J;
  const curve = x.onsite_curve as J;
  return {
    event: {
      id: String(e.id), slug: String(e.slug), title: String(e.title), state: String(e.state), starts_at: date(e.starts_at),
      ends_at: date(e.ends_at), timezone: String(e.timezone), closed_at: date(e.closed_at),
    },
    provisional: Boolean(x.provisional),
    computed_at: date(x.computed_at)!,
    rollups_rebuilt_at: date(x.rollups_rebuilt_at),
    frozen: Boolean(x.frozen),
    frozen_at: date(x.frozen_at),
    headline: {
      registered: num(h.registered), checked_in: num(h.checked_in), no_shows: num(h.no_shows), peak_on_site: num(h.peak_on_site),
      peak_on_site_at: date(h.peak_on_site_at), rooms_at_capacity: num(h.rooms_at_capacity), alerts_total: num(h.alerts_total),
      alerts_by_severity: h.alerts_by_severity as PostEventSummary["headline"]["alerts_by_severity"],
      ack_median_s: numOrNull(h.ack_median_s), resolve_median_s: numOrNull(h.resolve_median_s),
    },
    attendance_by_tier: ((x.attendance_by_tier as J[]) ?? []).map((t) => ({ tier: String(t.tier), registered: num(t.registered), checked_in: num(t.checked_in), no_shows: num(t.no_shows) })),
    onsite_curve: {
      bucket_minutes: num(curve.bucket_minutes),
      points: ((curve.points as J[]) ?? []).map((pt) => ({ t: date(pt.t)!, on_site: num(pt.on_site), peak: num(pt.peak) })),
    },
    busiest_rooms: ((x.busiest_rooms as J[]) ?? []).map((r) => ({
      room_id: String(r.room_id), name: String(r.name), peak: num(r.peak), peak_at: date(r.peak_at), capacity: num(r.capacity),
      pct: numOrNull(r.pct), admissions: num(r.admissions), reached_block: Boolean(r.reached_block),
    })),
    busiest_gates: ((x.busiest_gates as J[]) ?? []).map((g) => ({
      checkpoint_id: String(g.checkpoint_id), label: String(g.label), scans: num(g.scans), admitted: num(g.admitted), denied: num(g.denied),
    })),
    purge: { purged: Boolean(p.purged), purged_at: date(p.purged_at), due_at: date(p.due_at), scans_available: Boolean(p.scans_available) },
  };
}

/**
 * The one-page post-event summary (GET /events/:id/post-event-summary). Frozen by the purge; before
 * that, computed from the rollups (as current as `rollups_rebuilt_at`) and flagged `provisional`
 * for an event that is not closed. Null when the event does not exist.
 */
export async function postEventSummary(db: AnyDb | AnyTx, eventId: string, now?: Date): Promise<PostEventSummary | null> {
  const r = await rows<{ s: unknown }>(db, sql`select public.post_event_summary(${eventId}::uuid, ${tsOrNow(now)}) as s`);
  return r[0]?.s ? parseSummary(json<J>(r[0].s)) : null;
}

/* ----------------------------------------------------------------- workbook */

export type Cell = number | string | Date | boolean | null;
export interface WorkbookColumn {
  key: string;
  header: string;
  /** Write as a real number, date-time, text or boolean cell. */
  type: "number" | "datetime" | "text" | "boolean";
  /** Columns a totals row should sum. */
  total?: "sum";
}
export interface WorkbookSheet {
  name: string;
  columns: WorkbookColumn[];
  /** Rows in chunks (each row's cells in column order). Read inside withWorkbookData's callback. */
  rows(): AsyncGenerator<Cell[][]>;
}
export interface WorkbookData {
  event: PostEventSummary["event"];
  summary: PostEventSummary;
  generated_at: Date;
  provisional: boolean;
  /** False when the caller asked for no identity: the attendee sheet has no name or email columns. */
  includes_identity: boolean;
  sheets: WorkbookSheet[];
}
export interface WorkbookOptions {
  /** Name and email on the attendee sheet. Requires `vault` (the identity connection). */
  includeIdentity: boolean;
  chunkSize?: number;
  /** Gate throughput bucket, default "15 minutes". */
  gateBucket?: string;
  /** k-anonymity threshold for dwell and flow (O-08), default 5. */
  minCount?: number;
  now?: Date;
}

const RESULTS = ["admitted", "already_inside", "duplicate_read", "denied_room", "capacity_block", "revoked", "suspended", "unknown_token", "wristband_required", "pass_spent"] as const;
const col = (key: string, header: string, type: WorkbookColumn["type"], total?: "sum"): WorkbookColumn => ({ key, header, type, ...(total ? { total } : {}) });
async function* once(rowsIn: Cell[][]): AsyncGenerator<Cell[][]> {
  yield rowsIn;
}

/**
 * Runs `consume` with every sheet of the event workbook, read in one consistent snapshot (a
 * REPEATABLE READ, read-only transaction on `db`). Large sheets (gate throughput, alert log,
 * attendees) are read in chunks of `chunkSize` rows, so memory holds one chunk at a time when the
 * caller writes each chunk out as it arrives (e.g. a streaming .xlsx writer). Identity for the
 * attendee sheet is read through `vault` (the same snapshot when vault is the same connection).
 */
export async function withWorkbookData<T>(
  c: { db: AnyDb; vault?: AnyDb; cipher?: Cipher },
  eventId: string,
  opts: WorkbookOptions,
  consume: (wb: WorkbookData) => Promise<T>,
): Promise<T> {
  if (opts.includeIdentity && (!c.vault || !c.cipher)) throw new Error("includeIdentity needs the vault connection and the cipher");
  const chunk = opts.chunkSize ?? 5000;
  return c.db.transaction(
    async (tx) => {
      const summary = await postEventSummary(tx, eventId, opts.now);
      if (!summary) throw new Error(`event ${eventId} does not exist`);
      const zoneNames = new Map(
        (await rows<{ id: string; name: string }>(tx, sql`select id::text, name from public.zones where venue_id = (select venue_id from public.events where id = ${eventId}::uuid)`)).map(
          (z) => [z.id, z.name] as const,
        ),
      );
      const h = summary.headline;
      const sheets: WorkbookSheet[] = [
        {
          name: "Summary",
          columns: [col("figure", "Figure", "text"), col("value", "Value", "number"), col("at", "When", "datetime")],
          rows: () =>
            once([
              ["Registered", h.registered, null],
              ["Checked in", h.checked_in, null],
              ["No-shows", h.no_shows, null],
              ["Peak on site", h.peak_on_site, h.peak_on_site_at],
              ["Rooms that reached capacity", h.rooms_at_capacity, null],
              ["Alerts raised", h.alerts_total, null],
              ["Alerts: critical", h.alerts_by_severity.critical, null],
              ["Alerts: high", h.alerts_by_severity.high, null],
              ["Alerts: medium", h.alerts_by_severity.medium, null],
              ["Alerts: low", h.alerts_by_severity.low, null],
              ["Median time to acknowledge (s)", h.ack_median_s, null],
              ["Median time to resolve (s)", h.resolve_median_s, null],
            ]),
        },
        {
          name: "Attendance",
          columns: [col("tier", "Tier", "text"), col("registered", "Registered", "number", "sum"), col("pending", "Pending", "number", "sum"),
            col("cancelled", "Cancelled", "number", "sum"), col("checked_in", "Checked in", "number", "sum"), col("no_shows", "No-shows", "number", "sum")],
          rows: async function* () {
            yield (await reportAttendance(tx, eventId)).map((r) => [r.tier, r.registered, r.pending, r.cancelled, r.checked_in, r.no_shows]);
          },
        },
        {
          name: "Arrivals",
          columns: [col("bucket_start", "From", "datetime"), col("tier", "Tier", "text"), col("arrivals", "Arrivals", "number", "sum")],
          rows: async function* () {
            yield (await reportArrivals(tx, eventId, { bucket: "15 minutes" })).map((r) => [r.bucket_start, r.tier, r.arrivals]);
          },
        },
        {
          name: "On site",
          columns: [col("t", "From", "datetime"), col("on_site", "On site", "number"), col("peak", "Peak", "number")],
          rows: () => once(summary.onsite_curve.points.map((p) => [p.t, p.on_site, p.peak])),
        },
        {
          name: "Dwell",
          columns: [col("zone", "Zone", "text"), col("floor", "Floor", "text"), col("visits", "Visits", "number", "sum"), col("open_visits", "Still inside at end", "number", "sum"),
            col("avg_minutes", "Average minutes", "number"), col("m0_5", "< 5 min", "number", "sum"), col("m5_15", "5–15 min", "number", "sum"),
            col("m15_30", "15–30 min", "number", "sum"), col("m30_60", "30–60 min", "number", "sum"), col("m60_120", "1–2 h", "number", "sum"),
            col("m120", "> 2 h", "number", "sum"), col("suppressed", "Withheld (fewer than k)", "boolean")],
          rows: async function* () {
            yield (await reportDwell(tx, eventId, { minCount: opts.minCount })).map((r) => [
              r.zone_name, r.floor, r.visits, r.open_visits, r.avg_minutes, ...(r.dwell_histogram ?? [null, null, null, null, null, null]), r.suppressed,
            ]);
          },
        },
        {
          name: "Flow",
          columns: [col("hour", "Hour", "datetime"), col("from", "From zone", "text"), col("to", "To zone", "text"), col("moves", "Moves", "number", "sum"),
            col("suppressed", "Withheld (fewer than k)", "boolean")],
          rows: async function* () {
            for (let off = 0; ; off += chunk) {
              const p = await reportFlow(tx, eventId, { bucket: "1 hour", minCount: opts.minCount, limit: chunk, offset: off });
              yield p.items.map((r) => [
                r.bucket_start, r.from_zone_id ? (zoneNames.get(r.from_zone_id) ?? r.from_zone_id) : "Outside",
                r.to_zone_id ? (zoneNames.get(r.to_zone_id) ?? r.to_zone_id) : "Outside", r.moves, r.suppressed,
              ]);
              if (off + p.items.length >= p.total) return;
            }
          },
        },
        {
          name: "Peak occupancy",
          columns: [col("room", "Room", "text"), col("capacity", "Capacity", "number"), col("peak", "Peak", "number"), col("peak_at", "Peak at", "datetime"),
            col("pct", "Peak % of capacity", "number"), col("admissions", "Admissions", "number", "sum")],
          rows: async function* () {
            for (let off = 0; ; off += chunk) {
              const p = await reportPeakOccupancy(tx, eventId, { limit: chunk, offset: off });
              yield p.items.map((r) => [r.room_name, r.capacity, r.peak, r.peak_at, r.pct, r.admissions]);
              if (off + p.items.length >= p.total) return;
            }
          },
        },
        {
          name: "Alerts",
          columns: [col("kind", "Kind", "text"), col("severity", "Severity", "text"), col("total", "Raised", "number", "sum"), col("open", "Open", "number", "sum"),
            col("acked", "Acknowledged", "number", "sum"), col("resolved", "Resolved", "number", "sum"), col("ack_avg_s", "Acknowledge avg (s)", "number"),
            col("ack_p50_s", "Acknowledge median (s)", "number"), col("ack_p90_s", "Acknowledge p90 (s)", "number"), col("resolve_avg_s", "Resolve avg (s)", "number"),
            col("resolve_p50_s", "Resolve median (s)", "number"), col("resolve_p90_s", "Resolve p90 (s)", "number")],
          rows: async function* () {
            yield (await reportBreach(tx, eventId)).filter((r) => r.kind !== null).map((r) => [
              r.kind, r.severity, r.total, r.open, r.acked, r.resolved, r.ack_avg_s, r.ack_p50_s, r.ack_p90_s, r.resolve_avg_s, r.resolve_p50_s, r.resolve_p90_s,
            ]);
          },
        },
        {
          name: "Alert log",
          columns: [col("occurred_at", "Occurred", "datetime"), col("kind", "Kind", "text"), col("severity", "Severity", "text"), col("state", "State", "text"),
            col("room", "Room", "text"), col("checkpoint", "Gate", "text"), col("detail", "Detail", "text"), col("acked_at", "Acknowledged", "datetime"),
            col("resolved_at", "Resolved", "datetime"), col("ack_s", "To acknowledge (s)", "number"), col("resolve_s", "To resolve (s)", "number")],
          rows: async function* () {
            for (let off = 0; ; off += chunk) {
              const r = await rows(tx, sql`select * from public.workbook_alert_log(${eventId}::uuid, ${chunk}::integer, ${off}::integer)`);
              yield r.map((a) => [
                date(a.occurred_at), String(a.kind), String(a.severity), String(a.state), (a.room as string | null) ?? null, (a.checkpoint as string | null) ?? null,
                String(a.detail ?? ""), date(a.acked_at), date(a.resolved_at), numOrNull(a.ack_s), numOrNull(a.resolve_s),
              ]);
              if (r.length < chunk) return;
            }
          },
        },
        {
          name: "Gate throughput",
          columns: [col("gate", "Gate", "text"), col("bucket_start", "From", "datetime"), col("scans", "Scans", "number", "sum"), col("admitted", "Let through", "number", "sum"),
            col("denied", "Refused", "number", "sum"), ...RESULTS.map((k) => col(`r_${k}`, k, "number", "sum"))],
          rows: async function* () {
            for (let off = 0; ; off += chunk) {
              const r = await rows(
                tx,
                sql`select * from public.report_gate_throughput(${eventId}::uuid, ${opts.gateBucket ?? "15 minutes"}::interval, NULL, NULL, NULL, ${chunk}::integer, ${off}::integer)`,
              );
              yield r.map((g) => {
                const by = json<Record<string, number>>(g.by_result);
                return [String(g.label), date(g.bucket_start), num(g.scans), num(g.admitted), num(g.denied), ...RESULTS.map((k) => num(by[k] ?? 0))];
              });
              if (r.length < chunk) return;
            }
          },
        },
        {
          name: "Attendees",
          columns: [
            col("registration", "Registration", "text"),
            ...(opts.includeIdentity ? [col("name", "Name", "text"), col("email", "Email", "text")] : []),
            col("tier", "Tier", "text"), col("state", "Registration state", "text"), col("checked_in", "Checked in", "boolean"),
            col("first_check_in", "First check-in", "datetime"), col("registered_at", "Registered", "datetime"),
          ],
          rows: async function* () {
            for (let off = 0; ; off += chunk) {
              const r = await rows(tx, sql`select * from public.workbook_attendees(${eventId}::uuid, ${chunk}::integer, ${off}::integer)`);
              let identity = new Map<string, { name: string | null; email: string | null }>();
              if (opts.includeIdentity && r.length) {
                const ids = r.map((a) => String(a.attendee_id));
                const read = async (conn: AnyDb | AnyTx) => {
                  await setVaultScope(conn, "operator");
                  return conn.select().from(attendees).where(inArray(attendees.id, ids));
                };
                // Same connection (single-role setups, PGlite): read inside this snapshot; else the vault pool.
                const found = c.vault === c.db ? await read(tx) : await c.vault!.transaction((vt) => read(vt));
                identity = new Map(found.map((row) => {
                  const a = decryptAttendeeRow(c.cipher!, row);
                  return [a.id, { name: a.full_name, email: a.email }] as const;
                }));
              }
              yield r.map((a) => {
                const id = identity.get(String(a.attendee_id));
                return [
                  String(a.registration_id),
                  ...(opts.includeIdentity ? [id?.name ?? null, id?.email ?? null] : []),
                  String(a.tier), String(a.state), Boolean(a.checked_in), date(a.first_check_in), date(a.registered_at),
                ];
              });
              if (r.length < chunk) return;
            }
          },
        },
      ];
      return consume({
        event: summary.event,
        summary,
        generated_at: opts.now ?? new Date(),
        provisional: summary.provisional,
        includes_identity: opts.includeIdentity,
        sheets,
      });
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/** withWorkbookData, fully read into memory (fine for one event; see the README for sizes). */
export async function collectWorkbookData(
  c: { db: AnyDb; vault?: AnyDb; cipher?: Cipher },
  eventId: string,
  opts: WorkbookOptions,
): Promise<Omit<WorkbookData, "sheets"> & { sheets: { name: string; columns: WorkbookColumn[]; rows: Cell[][] }[] }> {
  return withWorkbookData(c, eventId, opts, async (wb) => {
    const sheets = [];
    for (const s of wb.sheets) {
      const all: Cell[][] = [];
      for await (const part of s.rows()) all.push(...part);
      sheets.push({ name: s.name, columns: s.columns, rows: all });
    }
    return { ...wb, sheets };
  });
}
