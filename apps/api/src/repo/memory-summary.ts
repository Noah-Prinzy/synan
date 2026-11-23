/**
 * Post-event summary and workbook data for the in-memory backend, mirroring @synan/db summary.ts:
 * the same eleven sheets, column keys, headers, types and totals, and a summary frozen by the purge.
 */
import type { MemoryTables } from "./memory.js";
import { cmp, percentile, round1 } from "./memory-reports.js";
import type { DbPostEventSummary, WorkbookData } from "./types.js";

type Cell = string | number | Date | boolean | null;
type WCol = WorkbookData["sheets"][number]["columns"][number];
const RESULTS = ["admitted", "already_inside", "duplicate_read", "denied_room", "capacity_block", "revoked", "suspended", "unknown_token", "wristband_required", "pass_spent"] as const;
const wc = (key: string, header: string, type: WCol["type"], total?: "sum"): WCol => ({ key, header, type, ...(total ? { total } : {}) });
async function* once(rows: Cell[][]) {
  yield rows;
}
const d = (v: unknown) => (v == null ? null : v instanceof Date ? v : new Date(String(v)));
const nn = (v: unknown) => (v == null ? null : Number(v));
type Rows = (kind: string, section: string, eventId: string, bucketMs?: number) => Record<string, unknown>[];

export function memorySummaryAndWorkbook(t: MemoryTables, sectionRows: Rows, snapshot: (eventId: string) => { curve: { at: Date; on_site: number }[]; rebuiltAt: Date } | undefined) {
  const frozen = new Map<string, { at: Date; summary: DbPostEventSummary }>();

  const compute = (eventId: string, now: Date): DbPostEventSummary | null => {
    const e = t.events.get(eventId);
    if (!e) return null;
    const tiers = sectionRows("attendance", "by_tier", eventId);
    const peaks = sectionRows("peak_occupancy", "peaks", eventId);
    const gates = sectionRows("gate_throughput", "throughput", eventId);
    const alerts = [...t.alerts.values()].filter((a) => a.event_id === eventId);
    const snap = snapshot(eventId);
    const curve = snap?.curve ?? [];
    const peak = curve.reduce<{ n: number; at: Date | null }>((m, c) => (c.on_site > m.n ? { n: c.on_site, at: c.at } : m), { n: 0, at: null });
    const sum = (k: string) => tiers.reduce((x, r) => x + Number(r[k] ?? 0), 0);
    const med = (v: number[]) => percentile([...v].sort((a, b) => a - b), 0.5);
    const reached = (p: Record<string, unknown>) => p.pct != null && Number(p.pct) >= (t.rooms.get(String(p.room_id))?.block_at_pct ?? 100);
    const byGate = new Map<string, { checkpoint_id: string; label: string; scans: number; admitted: number; denied: number }>();
    for (const g of gates) {
      const k = String(g.checkpoint_id);
      const x = byGate.get(k) ?? byGate.set(k, { checkpoint_id: k, label: String(g.label), scans: 0, admitted: 0, denied: 0 }).get(k)!;
      x.scans += Number(g.scans);
      x.admitted += Number(g.admitted);
      x.denied += Number(g.denied);
    }
    const purgedAt = t.purgedEvents.get(eventId) ?? null;
    const sev = (s: string) => alerts.filter((a) => a.severity === s).length;
    return {
      event: { id: e.id, slug: e.slug, title: e.title, state: e.state, starts_at: e.starts_at, ends_at: e.ends_at, timezone: e.timezone, closed_at: e.closed_at },
      provisional: e.state === "draft" || e.state === "published" || e.state === "live",
      computed_at: now,
      rollups_rebuilt_at: snap?.rebuiltAt ?? null,
      frozen: false,
      frozen_at: null,
      headline: {
        registered: sum("registered"), checked_in: sum("checked_in"), no_shows: sum("no_shows"), peak_on_site: peak.n, peak_on_site_at: peak.at,
        rooms_at_capacity: peaks.filter(reached).length, alerts_total: alerts.length,
        alerts_by_severity: { low: sev("low"), medium: sev("medium"), high: sev("high"), critical: sev("critical") },
        ack_median_s: med(alerts.filter((a) => a.acked_at).map((a) => (a.acked_at!.getTime() - a.occurred_at.getTime()) / 1000)),
        resolve_median_s: med(alerts.filter((a) => a.resolved_at).map((a) => (a.resolved_at!.getTime() - a.occurred_at.getTime()) / 1000)),
      },
      attendance_by_tier: tiers.map((r) => ({ tier: String(r.tier), registered: Number(r.registered), checked_in: Number(r.checked_in), no_shows: Number(r.no_shows) })),
      onsite_curve: { bucket_minutes: 5, points: curve.map((c) => ({ t: c.at, on_site: c.on_site, peak: c.on_site })) },
      busiest_rooms: [...peaks]
        .sort((a, b) => Number(b.peak) - Number(a.peak) || cmp(String(a.room_name), String(b.room_name)))
        .slice(0, 5)
        .map((p) => ({
          room_id: String(p.room_id), name: String(p.room_name), peak: Number(p.peak), peak_at: d(p.peak_at), capacity: Number(p.capacity), pct: nn(p.pct),
          admissions: Number(p.admissions), reached_block: reached(p),
        })),
      busiest_gates: [...byGate.values()].sort((a, b) => b.scans - a.scans || cmp(a.label, b.label)).slice(0, 5),
      purge: { purged: purgedAt !== null, purged_at: purgedAt, due_at: e.closed_at ? new Date(e.closed_at.getTime() + e.grace_buffer * 3600_000) : null, scans_available: purgedAt === null },
    };
  };

  const api = {
    /** Called by the purge, after the rollups are rebuilt: the summary stops changing. */
    freeze(eventId: string, at: Date) {
      const s = compute(eventId, at);
      if (s) frozen.set(eventId, { at, summary: s });
    },
    async postEventSummary(eventId: string, now: Date): Promise<DbPostEventSummary | null> {
      const f = frozen.get(eventId);
      if (!f) return compute(eventId, now);
      const e = t.events.get(eventId)!;
      return structuredClone({
        ...f.summary, event: { ...f.summary.event, state: e.state }, frozen: true, frozen_at: f.at, computed_at: now,
        purge: { ...f.summary.purge, purged: true, purged_at: t.purgedEvents.get(eventId) ?? null, scans_available: false },
      });
    },
    async workbook<T>(eventId: string, opts: { includeIdentity: boolean; now: Date }, consume: (wb: WorkbookData) => Promise<T>): Promise<T> {
      const summary = await api.postEventSummary(eventId, opts.now);
      if (!summary) throw new Error(`event ${eventId} does not exist`);
      const h = summary.headline;
      const zone = (id: unknown) => (id ? t.zones.get(String(id))?.name ?? String(id) : "Outside");
      const rows = (kind: string, section: string, bucketMs?: number) => sectionRows(kind, section, eventId, bucketMs);
      const alerts = [...t.alerts.values()].filter((a) => a.event_id === eventId).sort((a, b) => a.occurred_at.getTime() - b.occurred_at.getTime() || cmp(a.id, b.id));
      const regs = [...t.registrations.values()].filter((r) => r.event_id === eventId).sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || cmp(a.id, b.id));
      const secs = (a: Date | null, b: Date) => (a ? round1((a.getTime() - b.getTime()) / 1000) : null);
      const sheets: WorkbookData["sheets"] = [
        {
          name: "Summary", columns: [wc("figure", "Figure", "text"), wc("value", "Value", "number"), wc("at", "When", "datetime")],
          rows: () => once([
            ["Registered", h.registered, null], ["Checked in", h.checked_in, null], ["No-shows", h.no_shows, null], ["Peak on site", h.peak_on_site, h.peak_on_site_at],
            ["Rooms that reached capacity", h.rooms_at_capacity, null], ["Alerts raised", h.alerts_total, null], ["Alerts: critical", h.alerts_by_severity.critical, null],
            ["Alerts: high", h.alerts_by_severity.high, null], ["Alerts: medium", h.alerts_by_severity.medium, null], ["Alerts: low", h.alerts_by_severity.low, null],
            ["Median time to acknowledge (s)", h.ack_median_s, null], ["Median time to resolve (s)", h.resolve_median_s, null],
          ]),
        },
        {
          name: "Attendance",
          columns: [wc("tier", "Tier", "text"), wc("registered", "Registered", "number", "sum"), wc("pending", "Pending", "number", "sum"),
            wc("cancelled", "Cancelled", "number", "sum"), wc("checked_in", "Checked in", "number", "sum"), wc("no_shows", "No-shows", "number", "sum")],
          rows: () => once(rows("attendance", "by_tier").map((r) => [String(r.tier), Number(r.registered), Number(r.pending), Number(r.cancelled), Number(r.checked_in), Number(r.no_shows)])),
        },
        {
          name: "Arrivals", columns: [wc("bucket_start", "From", "datetime"), wc("tier", "Tier", "text"), wc("arrivals", "Arrivals", "number", "sum")],
          rows: () => once(rows("attendance", "arrivals").map((r) => [d(r.bucket_start), String(r.tier), Number(r.arrivals)])),
        },
        {
          name: "On site", columns: [wc("t", "From", "datetime"), wc("on_site", "On site", "number"), wc("peak", "Peak", "number")],
          rows: () => once(summary.onsite_curve.points.map((p) => [p.t, p.on_site, p.peak])),
        },
        {
          name: "Dwell",
          columns: [wc("zone", "Zone", "text"), wc("floor", "Floor", "text"), wc("visits", "Visits", "number", "sum"), wc("open_visits", "Still inside at end", "number", "sum"),
            wc("avg_minutes", "Average minutes", "number"), wc("m0_5", "< 5 min", "number", "sum"), wc("m5_15", "5–15 min", "number", "sum"),
            wc("m15_30", "15–30 min", "number", "sum"), wc("m30_60", "30–60 min", "number", "sum"), wc("m60_120", "1–2 h", "number", "sum"),
            wc("m120", "> 2 h", "number", "sum"), wc("suppressed", "Withheld (fewer than k)", "boolean")],
          rows: () => once(rows("dwell_flow", "dwell").map((r) => [String(r.zone_name), (r.floor as string | null) ?? null, nn(r.visits), nn(r.open_visits), nn(r.avg_minutes),
            ...(((r.dwell_histogram as number[] | null) ?? [null, null, null, null, null, null]) as Cell[]), Boolean(r.suppressed)])),
        },
        {
          name: "Flow",
          columns: [wc("hour", "Hour", "datetime"), wc("from", "From zone", "text"), wc("to", "To zone", "text"), wc("moves", "Moves", "number", "sum"), wc("suppressed", "Withheld (fewer than k)", "boolean")],
          rows: () => once(rows("dwell_flow", "flow_hourly").map((r) => [d(r.bucket_start), zone(r.from_zone_id), zone(r.to_zone_id), nn(r.moves), Boolean(r.suppressed)])),
        },
        {
          name: "Peak occupancy",
          columns: [wc("room", "Room", "text"), wc("capacity", "Capacity", "number"), wc("peak", "Peak", "number"), wc("peak_at", "Peak at", "datetime"),
            wc("pct", "Peak % of capacity", "number"), wc("admissions", "Admissions", "number", "sum")],
          rows: () => once(rows("peak_occupancy", "peaks").map((r) => [String(r.room_name), Number(r.capacity), Number(r.peak), d(r.peak_at), nn(r.pct), Number(r.admissions)])),
        },
        {
          name: "Alerts",
          columns: [wc("kind", "Kind", "text"), wc("severity", "Severity", "text"), wc("total", "Raised", "number", "sum"), wc("open", "Open", "number", "sum"),
            wc("acked", "Acknowledged", "number", "sum"), wc("resolved", "Resolved", "number", "sum"), wc("ack_avg_s", "Acknowledge avg (s)", "number"),
            wc("ack_p50_s", "Acknowledge median (s)", "number"), wc("ack_p90_s", "Acknowledge p90 (s)", "number"), wc("resolve_avg_s", "Resolve avg (s)", "number"),
            wc("resolve_p50_s", "Resolve median (s)", "number"), wc("resolve_p90_s", "Resolve p90 (s)", "number")],
          rows: () => once(rows("breach_compliance", "alerts").filter((r) => r.kind !== null).map((r) => [String(r.kind), String(r.severity), Number(r.total), Number(r.open),
            Number(r.acked), Number(r.resolved), nn(r.ack_avg_s), nn(r.ack_p50_s), nn(r.ack_p90_s), nn(r.resolve_avg_s), nn(r.resolve_p50_s), nn(r.resolve_p90_s)])),
        },
        {
          name: "Alert log",
          columns: [wc("occurred_at", "Occurred", "datetime"), wc("kind", "Kind", "text"), wc("severity", "Severity", "text"), wc("state", "State", "text"),
            wc("room", "Room", "text"), wc("checkpoint", "Gate", "text"), wc("detail", "Detail", "text"), wc("acked_at", "Acknowledged", "datetime"),
            wc("resolved_at", "Resolved", "datetime"), wc("ack_s", "To acknowledge (s)", "number"), wc("resolve_s", "To resolve (s)", "number")],
          rows: () => once(alerts.map((a) => [
            a.occurred_at, a.kind, a.severity, a.state, a.room_id ? (t.rooms.get(a.room_id)?.name ?? null) : null,
            a.checkpoint_id ? (t.checkpoints.get(a.checkpoint_id)?.label ?? null) : null, a.detail, a.acked_at, a.resolved_at, secs(a.acked_at, a.occurred_at), secs(a.resolved_at, a.occurred_at),
          ])),
        },
        {
          name: "Gate throughput",
          columns: [wc("gate", "Gate", "text"), wc("bucket_start", "From", "datetime"), wc("scans", "Scans", "number", "sum"), wc("admitted", "Let through", "number", "sum"),
            wc("denied", "Refused", "number", "sum"), ...RESULTS.map((k) => wc(`r_${k}`, k, "number", "sum"))],
          rows: () => once(rows("gate_throughput", "throughput", 900_000).map((g) => {
            const by = g.by_result as Record<string, number>;
            return [String(g.label), d(g.bucket_start), Number(g.scans), Number(g.admitted), Number(g.denied), ...RESULTS.map((k) => by[k] ?? 0)];
          })),
        },
        {
          name: "Attendees",
          columns: [wc("registration", "Registration", "text"), ...(opts.includeIdentity ? [wc("name", "Name", "text"), wc("email", "Email", "text")] : []),
            wc("tier", "Tier", "text"), wc("state", "Registration state", "text"), wc("checked_in", "Checked in", "boolean"),
            wc("first_check_in", "First check-in", "datetime"), wc("registered_at", "Registered", "datetime")],
          rows: () => once(regs.map((r) => {
            const a = t.attendees.get(r.attendee_id);
            return [r.id, ...(opts.includeIdentity ? [a?.full_name ?? null, a?.email ?? null] : []), r.tier, r.state, r.checked_in_at !== null, r.checked_in_at, r.created_at];
          })),
        },
      ];
      return consume({ event: summary.event, summary, generated_at: opts.now, provisional: summary.provisional, includes_identity: opts.includeIdentity, sheets });
    },
  };
  return api;
}
