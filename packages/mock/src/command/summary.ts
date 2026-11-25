/**
 * D13c (D-21): the post-event summary, GET /events/:id/post-event-summary, and the export
 * jobs behind its downloads, POST /reports/:id/export. Built from aggregates only, as the
 * server builds it, so a closed event's summary reads the same after the purge.
 *
 * - A closed event (Founders Forum 2026) with a full, final summary, already purged.
 * - Live events: the same shape from the live mock, `provisional: true`.
 * - Published events: an empty, provisional summary (the screen's "no data yet" state).
 */
import type { MockClock } from "../clock";
import { createRng, idFor } from "../random";
import type { AttendeeTier, PostEventSummary, ReportKind } from "../types";
import type { EventServer } from "./server";

export type ReportRow = PostEventSummary["downloads"][number];
export type ExportFormat = ReportRow["format"];

/** The closed event. Serena Conference Centre, 18–19 Nov 2026, purged 72 h after close. */
export const CLOSED_EVENT = {
  slug: "founders-forum-2026",
  title: "Founders Forum 2026",
  venue_name: "Serena Conference Centre",
  starts_at: "2026-11-18T05:30:00.000Z",
  ends_at: "2026-11-19T15:00:00.000Z",
  closed_at: "2026-11-19T16:00:00.000Z",
  purged_at: "2026-11-22T16:00:00.000Z",
};

const TIERS: AttendeeTier[] = ["ORDINARY", "VIP", "PRIVATE_INVITE", "PUBLIC"];
const BUCKET_MS = 5 * 60_000;

function closedSummary(eventId: string, operatorId: string): PostEventSummary {
  const rng = createRng(20261119);
  const tiers = [
    { tier: "ORDINARY" as const, registered: 812, rate: 0.86 },
    { tier: "VIP" as const, registered: 64, rate: 0.95 },
    { tier: "PRIVATE_INVITE" as const, registered: 48, rate: 0.92 },
    { tier: "PUBLIC" as const, registered: 260, rate: 0.71 },
  ].map(({ tier, registered, rate }) => {
    const checked_in = Math.round(registered * rate);
    return { tier, registered, checked_in, no_shows: registered - checked_in };
  });
  const registered = tiers.reduce((s, t) => s + t.registered, 0);
  const checkedIn = tiers.reduce((s, t) => s + t.checked_in, 0);

  // Two days, doors 08:30–18:00 local (05:30–15:00Z); a morning ramp, lunch dip, afternoon tail.
  const curve: PostEventSummary["occupancy_curve"] = [];
  let peak = 0;
  let peakAt: string | null = null;
  for (const day of ["2026-11-18", "2026-11-19"]) {
    const open = Date.parse(`${day}T05:30:00.000Z`);
    const close = Date.parse(`${day}T15:00:00.000Z`);
    const dayScale = day === "2026-11-18" ? 1 : 0.86;
    for (let t = open; t <= close; t += BUCKET_MS) {
      const h = (t - open) / 3_600_000; // hours since doors
      const ramp = 1 - Math.exp(-h / 0.9);
      const lunch = 1 - 0.22 * Math.exp(-Math.pow((h - 4.2) / 0.6, 2));
      const tail = h > 7 ? Math.max(0, 1 - (h - 7) / 2.6) : 1;
      const onSite = Math.max(0, Math.round(checkedIn * 0.82 * dayScale * ramp * lunch * tail * (0.985 + rng() * 0.03)));
      const at = new Date(t).toISOString();
      curve.push({ at, on_site: onSite });
      if (onSite > peak) {
        peak = onSite;
        peakAt = at;
      }
    }
  }

  const room = (name: string, capacity: number, peakPct: number, at: string) => ({
    room_id: idFor(`room:Serena Conference Centre:${name}`),
    name,
    capacity,
    peak: Math.round(capacity * peakPct),
    peak_at: at,
  });
  const gate = (label: string, scans: number, denied: number) => ({
    checkpoint_id: idFor(`checkpoint:Serena Conference Centre:${label}`),
    label,
    scans,
    admitted: scans - denied,
    denied,
  });

  return {
    event_id: eventId,
    state: "closed",
    provisional: false,
    as_of: CLOSED_EVENT.closed_at,
    headline: {
      registered,
      checked_in: checkedIn,
      no_shows: registered - checkedIn,
      peak_on_site: peak,
      peak_on_site_at: peakAt,
      rooms_at_capacity: 2,
      alerts_raised: 22,
    },
    attendance_by_tier: tiers,
    occupancy_curve: curve,
    busiest_rooms: [
      room("Grand Ballroom", 200, 1.0, "2026-11-18T07:05:00.000Z"),
      room("Breakout Room 1", 100, 1.0, "2026-11-18T09:40:00.000Z"),
      room("Ballroom Foyer", 80, 0.91, "2026-11-18T06:20:00.000Z"),
      room("Breakout Room 2", 60, 0.78, "2026-11-19T08:15:00.000Z"),
      room("Operations Room", 20, 0.65, "2026-11-19T11:30:00.000Z"),
    ],
    busiest_gates: [
      gate("Gate 1 · Main", 2412, 61),
      gate("Gate 2 · Main", 1987, 44),
      gate("Gate 3 · Garden", 904, 19),
      gate("Grand Ballroom door", 3318, 37),
      gate("Breakout Room 1 door", 1406, 52),
    ],
    alerts: {
      by_severity: { critical: 1, high: 4, medium: 11, low: 6 },
      ack_p50_s: 94,
      resolve_p50_s: 1260,
    },
    downloads: [
      {
        id: idFor("report:founders:xlsx:1"),
        event_id: eventId,
        kind: "attendance",
        state: "ready",
        requested_by: operatorId,
        created_at: "2026-11-19T16:20:00.000Z",
        format: "xlsx",
        download_url: null,
      },
      // An export past its 7-day retention: the register says its file was deleted, so no link (03 §6).
      {
        id: idFor("report:founders:csv:attendance:0"),
        event_id: eventId,
        kind: "attendance",
        state: "ready",
        requested_by: operatorId,
        created_at: "2026-11-10T09:05:00.000Z",
        format: "csv",
        download_url: null,
        expired_at: "2026-11-17T09:05:00.000Z",
      },
    ],
    purge: { purged_at: CLOSED_EVENT.purged_at, due_at: CLOSED_EVENT.purged_at },
  };
}

/** Figures so far for a live event, in the same shape, marked provisional. */
function liveSummary(server: EventServer, now: number): PostEventSummary {
  const live = server.summary();
  const share = { ORDINARY: 0.75, VIP: 0.06, PRIVATE_INVITE: 0.04, PUBLIC: 0.15 } as const;
  const tiers = TIERS.map((tier) => {
    const registered = live.by_tier[tier] ?? 0;
    const checked_in = Math.min(registered, Math.round(live.checked_in * share[tier]));
    return { tier, registered, checked_in, no_shows: registered - checked_in };
  });
  const series = live.series;
  const from = Date.parse(series.from);
  const curve = series.on_site
    .map((on_site, i) => ({ at: new Date(from + i * series.bucket_ms).toISOString(), on_site }))
    .filter((_, i) => i % 5 === 0 || i === series.on_site.length - 1);
  let peakIndex = 0;
  curve.forEach((p, i) => {
    if (p.on_site > (curve[peakIndex]?.on_site ?? 0)) peakIndex = i;
  });
  const rooms = server.layout.rooms
    .map((room) => {
      const occupancy = server.rt.rooms.get(room.id)?.occupancy ?? 0;
      return { room_id: room.id, name: room.name, capacity: room.capacity, peak: occupancy, peak_at: new Date(now).toISOString() };
    })
    .sort((a, b) => b.peak / Math.max(1, b.capacity) - a.peak / Math.max(1, a.capacity))
    .slice(0, 5);
  const gates = server.layout.checkpoints
    .map((c) => {
      const perMinute = server.health.get(c.id)?.scans_last_minute ?? 0;
      const scans = perMinute * 165; // minutes since doors, roughly
      return { checkpoint_id: c.id, label: c.label, scans, admitted: Math.round(scans * 0.97), denied: scans - Math.round(scans * 0.97) };
    })
    .sort((a, b) => b.scans - a.scans)
    .slice(0, 5);
  const alerts = [...server.alerts.values()];
  return {
    event_id: server.event.id,
    state: "live",
    provisional: true,
    as_of: new Date(now).toISOString(),
    headline: {
      registered: live.registered,
      checked_in: live.checked_in,
      no_shows: live.registered - live.checked_in,
      peak_on_site: curve[peakIndex]?.on_site ?? 0,
      peak_on_site_at: curve[peakIndex]?.at ?? null,
      rooms_at_capacity: [...server.rt.rooms.values()].filter((r) => r.level === "block").length,
      alerts_raised: alerts.length,
    },
    attendance_by_tier: tiers,
    occupancy_curve: curve,
    busiest_rooms: rooms,
    busiest_gates: gates,
    alerts: {
      by_severity: {
        critical: alerts.filter((a) => a.severity === "critical").length,
        high: alerts.filter((a) => a.severity === "high").length,
        medium: alerts.filter((a) => a.severity === "medium").length,
        low: alerts.filter((a) => a.severity === "low").length,
      },
      ack_p50_s: alerts.some((a) => a.acked_at) ? 120 : null,
      resolve_p50_s: alerts.some((a) => a.state === "resolved") ? 1440 : null,
    },
    downloads: [],
    purge: { purged_at: null, due_at: null },
  };
}

/** An event that has not opened: every figure empty, flagged provisional. */
function emptySummary(eventId: string, state: PostEventSummary["state"], now: number): PostEventSummary {
  return {
    event_id: eventId,
    state,
    provisional: true,
    as_of: new Date(now).toISOString(),
    headline: { registered: 0, checked_in: 0, no_shows: 0, peak_on_site: 0, peak_on_site_at: null, rooms_at_capacity: 0, alerts_raised: 0 },
    attendance_by_tier: [],
    occupancy_curve: [],
    busiest_rooms: [],
    busiest_gates: [],
    alerts: { by_severity: { critical: 0, high: 0, medium: 0, low: 0 }, ack_p50_s: null, resolve_p50_s: null },
    downloads: [],
    purge: { purged_at: null, due_at: null },
  };
}

/** Export jobs: queued → running → ready, on the mock clock (≈ 1 s then ≈ 3 s). */
export class ReportJobs {
  private rows = new Map<string, ReportRow>();
  private seq = 0;

  constructor(
    private readonly clock: MockClock,
    private readonly operatorId: string,
  ) {}

  seed(rows: ReportRow[]): void {
    for (const row of rows) this.rows.set(row.id, row);
  }

  list(eventId: string): ReportRow[] {
    return [...this.rows.values()].filter((r) => r.event_id === eventId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  start(eventId: string, format: ExportFormat, kind?: ReportKind): ReportRow {
    const row: ReportRow = {
      id: idFor(`report:${eventId}:${format}:${kind ?? "all"}:${++this.seq}`),
      event_id: eventId,
      kind: kind ?? "attendance",
      state: "queued",
      requested_by: this.operatorId,
      created_at: new Date(this.clock.now()).toISOString(),
      format,
      download_url: null,
    };
    this.rows.set(row.id, row);
    const set = (patch: Partial<ReportRow>) => this.rows.set(row.id, { ...(this.rows.get(row.id) as ReportRow), ...patch });
    this.clock.setTimeout(() => set({ state: "running" }), 900);
    // The mock builds no file: `download_url` stays null and the screen says so.
    this.clock.setTimeout(() => set({ state: "ready" }), format === "xlsx" ? 3800 : 2200);
    return row;
  }
}

export function summaryFor(input: {
  eventId: string;
  state: PostEventSummary["state"];
  server: EventServer | null;
  closed: boolean;
  now: number;
  operatorId: string;
  jobs: ReportJobs;
}): PostEventSummary {
  let summary: PostEventSummary;
  if (input.closed) summary = closedSummary(input.eventId, input.operatorId);
  else if (input.server) summary = liveSummary(input.server, input.now);
  else summary = emptySummary(input.eventId, input.state, input.now);
  return { ...summary, downloads: input.jobs.list(input.eventId) };
}

export function closedSeedDownloads(eventId: string, operatorId: string): ReportRow[] {
  return closedSummary(eventId, operatorId).downloads;
}
