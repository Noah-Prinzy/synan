import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { insertUser } from "../src/secrets";
import { purgeEventMovementData, rebuildEventRollups } from "../src/functions";
import {
  dashboardSummary,
  eventSummary,
  reportArrivals,
  reportAttendance,
  reportBreach,
  reportDwell,
  reportFlow,
  reportGateThroughput,
  reportPeakOccupancy,
  runReport,
} from "../src/reports";
import * as s from "../src/schema/index";
import { attendeeWithCredential, devCipher, miniVenue, scan, type MiniVenue } from "./fixtures";
import { createTestDb, q, type TestDb } from "./helpers";

let db: TestDb;
let v: MiniVenue;
let zoneL1: string;
let roomC: string;
let cpCin: string;
let cpExit: string;
const T = (hhmm: string) => `2026-12-01T${hhmm}:00Z`;

/**
 * Two zones: ground (miniVenue: rooms A, B, perimeter gate) and Level 1 (room C), plus a perimeter
 * exit. Six people:
 *   p1 VIP  09:00 gate → 09:10 A → 10:00 C (implied exit A) → 11:00 exit (leaves)
 *   p2 VIP  09:05 gate → 09:30 C (stays)
 *   p3 ORD  09:20 gate → 09:40 denied at C → 09:45 already_inside at gate
 *   p4 ORD  09:50 gate (stays in ground zone)
 *   p5 ORD  registered, never arrives
 *   p6 PUB  10:30 gate
 * plus one pending VIP, one cancelled ORDINARY, an unknown token, and three alerts.
 */
beforeAll(async () => {
  db = await createTestDb();
  v = await miniVenue(db);
  const [z] = await db.insert(s.zones).values({ venue_id: v.venueId, name: "Level 1", floor: "1" }).returning();
  zoneL1 = z!.id;
  const [c] = await db.insert(s.rooms).values({ venue_id: v.venueId, zone_id: zoneL1, name: "Room C", capacity: 3 }).returning();
  roomC = c!.id;
  await db.insert(s.event_rooms).values({ event_id: v.eventId, room_id: roomC });
  const cps = await db
    .insert(s.checkpoints)
    .values([
      { venue_id: v.venueId, zone_id: zoneL1, room_id: roomC, direction: "in", label: "C in" },
      { venue_id: v.venueId, zone_id: v.zoneId, direction: "out", perimeter_bool: true, label: "Exit" },
    ])
    .returning();
  cpCin = cps[0]!.id;
  cpExit = cps[1]!.id;

  const p = [
    await attendeeWithCredential(db, v.eventId, "VIP"),
    await attendeeWithCredential(db, v.eventId, "VIP"),
    await attendeeWithCredential(db, v.eventId, "ORDINARY"),
    await attendeeWithCredential(db, v.eventId, "ORDINARY"),
    await attendeeWithCredential(db, v.eventId, "ORDINARY"),
    await attendeeWithCredential(db, v.eventId, "PUBLIC"),
  ];
  const extra1 = await attendeeWithCredential(db, v.eventId, "VIP");
  const extra2 = await attendeeWithCredential(db, v.eventId, "ORDINARY");
  await db.update(s.registrations).set({ state: "pending_approval" }).where(eq(s.registrations.id, extra1.registrationId));
  await db.update(s.registrations).set({ state: "cancelled" }).where(eq(s.registrations.id, extra2.registrationId));

  const e = (i: number) => p[i]!.ephemeralId;
  await scan(db, v, v.cpPerimeter, e(0), "admitted", T("09:00"));
  await scan(db, v, v.cpAin, e(0), "admitted", T("09:10"));
  await scan(db, v, v.cpAin, e(0), "implied_exit", T("10:00"));
  await scan(db, v, cpCin, e(0), "admitted", T("10:00"));
  await scan(db, v, cpExit, e(0), "admitted", T("11:00"));
  await scan(db, v, v.cpPerimeter, e(1), "admitted", T("09:05"));
  await scan(db, v, cpCin, e(1), "admitted", T("09:30"));
  await scan(db, v, v.cpPerimeter, e(2), "admitted", T("09:20"));
  await scan(db, v, cpCin, e(2), "denied_room", T("09:40"));
  await scan(db, v, v.cpPerimeter, e(2), "already_inside", T("09:45"));
  await scan(db, v, v.cpPerimeter, e(3), "admitted", T("09:50"));
  await scan(db, v, v.cpPerimeter, e(5), "admitted", T("10:30"));
  await scan(db, v, v.cpPerimeter, null, "unknown_token", T("09:01"));
  const arrived: [number, string][] = [[0, "09:00"], [1, "09:05"], [2, "09:20"], [3, "09:50"], [5, "10:30"]];
  for (const [i, t] of arrived) await db.update(s.registrations).set({ checked_in_at: new Date(T(t)) }).where(eq(s.registrations.id, p[i]!.registrationId));
  await db.update(s.credentials).set({ zone_state: `INSIDE_${zoneL1}` }).where(eq(s.credentials.id, p[1]!.credentialId));

  const op = await insertUser(db, devCipher, { email: "op@example.test", role: "organiser" });
  const at = (t: string, plusS: number) => new Date(new Date(T(t)).getTime() + plusS * 1000);
  await db.insert(s.breach_alerts).values([
    { event_id: v.eventId, severity: "high", kind: "unauthorised_tier", checkpoint_id: cpCin, occurred_at: new Date(T("09:40")), state: "resolved",
      acked_by: op, acked_at: at("09:40", 60), resolved_by: op, resolved_at: at("09:40", 600), resolution_note: "ok" },
    { event_id: v.eventId, severity: "high", kind: "unauthorised_tier", checkpoint_id: cpCin, occurred_at: new Date(T("10:40")), state: "acked",
      acked_by: op, acked_at: at("10:40", 180) },
    { event_id: v.eventId, severity: "low", kind: "clock_skew", checkpoint_id: v.cpPerimeter, occurred_at: new Date(T("12:00")), state: "open" },
  ]);
  await rebuildEventRollups(db, v.eventId);
});

const all = async () => ({
  attendance: await reportAttendance(db, v.eventId),
  attendanceMorning: await reportAttendance(db, v.eventId, { from: new Date(T("09:00")), to: new Date(T("10:00")) }),
  arrivals: await reportArrivals(db, v.eventId, { bucket: "1 hour" }),
  dwell: await reportDwell(db, v.eventId, { minCount: 1 }),
  dwellK: await reportDwell(db, v.eventId),
  flow: await reportFlow(db, v.eventId, { minCount: 1 }),
  flowHourly: await reportFlow(db, v.eventId, { bucket: "1 hour", minCount: 1 }),
  peak: await reportPeakOccupancy(db, v.eventId),
  breach: await reportBreach(db, v.eventId),
  gates: await reportGateThroughput(db, v.eventId, { bucket: "1 hour" }),
  gateTotals: await reportGateThroughput(db, v.eventId, { bucket: null }),
});

describe("reports", () => {
  it("attendance: registered, checked in, no-shows by tier; the range filters check-ins", async () => {
    const r = Object.fromEntries((await reportAttendance(db, v.eventId)).map((x) => [x.tier, x]));
    expect(r.VIP).toEqual({ tier: "VIP", registered: 2, pending: 1, cancelled: 0, checked_in: 2, no_shows: 0 });
    expect(r.ORDINARY).toEqual({ tier: "ORDINARY", registered: 3, pending: 0, cancelled: 1, checked_in: 2, no_shows: 1 });
    expect(r.PUBLIC).toMatchObject({ registered: 1, checked_in: 1, no_shows: 0 });
    expect(r.PRIVATE_INVITE).toMatchObject({ registered: 0, checked_in: 0 });
    const morning = await reportAttendance(db, v.eventId, { from: new Date(T("09:00")), to: new Date(T("10:00")) });
    expect(morning.reduce((a, x) => a + x.checked_in, 0)).toBe(4);
    const arrivals = await reportArrivals(db, v.eventId, { bucket: "1 hour" });
    expect(arrivals.map((x) => [x.bucket_start.toISOString().slice(11, 16), x.tier, x.arrivals])).toEqual([
      ["09:00", "ORDINARY", 2], ["09:00", "VIP", 2], ["10:00", "PUBLIC", 1],
    ]);
  });

  it("dwell: time per zone from the rolled-up visits, with k-anonymity", async () => {
    const d = Object.fromEntries((await reportDwell(db, v.eventId, { minCount: 1 })).map((x) => [x.zone_name, x]));
    // Ground: p1 60 min, p2 25 min, p3 09:20→18:00, p4 09:50→18:00, p6 10:30→18:00 (open).
    expect(d.Ground).toMatchObject({ visits: 5, open_visits: 3, suppressed: false });
    expect(d.Ground!.avg_minutes).toBeCloseTo((60 + 25 + 520 + 490 + 450) / 5, 1);
    expect(d.Ground!.dwell_histogram).toEqual([0, 0, 1, 0, 1, 3]);
    // Level 1: p1 10:00→11:00 (left), p2 09:30→18:00 (open).
    expect(d["Level 1"]).toMatchObject({ visits: 2, open_visits: 1, avg_minutes: (60 + 510) / 2 });
    const k = Object.fromEntries((await reportDwell(db, v.eventId)).map((x) => [x.zone_name, x]));
    expect(k["Level 1"]).toMatchObject({ suppressed: true, visits: null, avg_minutes: null });
    expect(k.Ground).toMatchObject({ suppressed: false, visits: 5 });
  });

  it("flow: movements between zones, arrivals from and departures to outside", async () => {
    const f = await reportFlow(db, v.eventId, { minCount: 1 });
    const m = Object.fromEntries(f.items.map((x) => [`${x.from_zone_id ?? "outside"}>${x.to_zone_id ?? "outside"}`, x.moves]));
    expect(m).toEqual({ [`outside>${v.zoneId}`]: 5, [`${v.zoneId}>${zoneL1}`]: 2, [`${zoneL1}>outside`]: 1 });
    expect(f.total).toBe(3);
    const hourly = await reportFlow(db, v.eventId, { bucket: "1 hour", minCount: 1, from: new Date(T("10:00")), to: new Date(T("12:00")) });
    expect(hourly.items.map((x) => [x.bucket_start!.toISOString().slice(11, 16), x.moves])).toEqual([["10:00", 1], ["10:00", 1], ["11:00", 1]]);
    expect((await reportFlow(db, v.eventId)).items.every((x) => x.suppressed === (x.moves === null))).toBe(true);
  });

  it("peak occupancy: per room, value and when", async () => {
    const p = await reportPeakOccupancy(db, v.eventId);
    const byName = Object.fromEntries(p.items.map((x) => [x.room_name, x]));
    expect(byName["Room C"]).toMatchObject({ peak: 2, capacity: 3, pct: 66.7, admissions: 2 });
    expect(byName["Room C"]!.peak_at!.toISOString()).toBe(T("10:00").replace(":00Z", ":00.000Z"));
    expect(byName["Room A"]).toMatchObject({ peak: 1, admissions: 1 });
    expect(byName["Room B"]).toMatchObject({ peak: 0, peak_at: null });
    expect(p.total).toBe(3);
    const page2 = await reportPeakOccupancy(db, v.eventId, { limit: 1, offset: 1 });
    expect(page2.items).toHaveLength(1);
    expect(page2.total).toBe(3);
  });

  it("breach and compliance: by kind and severity, with times to acknowledge and resolve", async () => {
    const b = await reportBreach(db, v.eventId);
    const tier = b.find((x) => x.kind === "unauthorised_tier")!;
    expect(tier).toMatchObject({ severity: "high", total: 2, open: 0, acked: 1, resolved: 1, ack_avg_s: 120, ack_p50_s: 120, resolve_avg_s: 600 });
    const total = b.find((x) => x.kind === null)!;
    expect(total).toMatchObject({ total: 3, open: 1, acked: 1, resolved: 1 });
    expect((await reportBreach(db, v.eventId, { from: new Date(T("11:00")) })).find((x) => x.kind === null)!.total).toBe(1);
  });

  it("gate throughput: per gate over time with the failure breakdown", async () => {
    const t = await reportGateThroughput(db, v.eventId, { bucket: null });
    const gate = t.items.find((x) => x.label === "Main gate")!;
    expect(gate).toMatchObject({ scans: 7, admitted: 6, denied: 1 }); // already_inside counts as let through
    expect(gate.by_result).toEqual({ admitted: 5, already_inside: 1, unknown_token: 1 });
    expect(gate.by_tier).toEqual({ VIP: 2, ORDINARY: 3, PUBLIC: 1, UNKNOWN: 1 });
    const c = t.items.find((x) => x.label === "C in")!;
    expect(c.by_result).toEqual({ admitted: 2, denied_room: 1 });
    const hourly = await reportGateThroughput(db, v.eventId, { bucket: "1 hour", checkpointId: v.cpPerimeter });
    expect(hourly.items.map((x) => [x.bucket_start!.toISOString().slice(11, 16), x.scans])).toEqual([["09:00", 6], ["10:00", 1]]);
  });

  it("live summaries: event KPI strip and organisation dashboard", async () => {
    const e = await eventSummary(db, v.eventId);
    expect(e).toMatchObject({ registered: 6, checked_in: 5, on_site: 1, open_alerts: 1, acked_alerts: 1, critical_open_alerts: 0 });
    expect(e.by_tier.VIP).toEqual({ registered: 2, checked_in: 2, on_site: 1 });
    const d = await dashboardSummary(db, v.orgId);
    expect(d).toMatchObject({ live_events: 1, registered: 6, checked_in: 5, on_site: 1, open_alerts: 1 });
  });

  it("page any report uniformly through runReport: columns, rows, next_cursor", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const p = await runReport(db, "gate_throughput", v.eventId, { bucket: "1 hour", limit: 1, cursor });
      expect(p.columns.map((c) => c.key)).toContain("by_result");
      seen.push(...p.rows.map((r) => `${r.label}@${(r.bucket_start as Date).toISOString()}`));
      cursor = p.next_cursor;
      pages++;
    } while (cursor);
    // Main gate 09h, 10h; C in 09h, 10h; A in 09h; Exit 11h.
    expect(pages).toBe(6);
    expect(new Set(seen).size).toBe(6);
    const dwell = await runReport(db, "dwell_flow", v.eventId, { section: "dwell", minCount: 1 });
    expect(dwell.rows).toHaveLength(2);
    expect(dwell.next_cursor).toBeNull();
    const att = await runReport(db, "attendance", v.eventId, { limit: 3 });
    expect([att.rows.length, att.total, att.next_cursor !== null]).toEqual([3, 4, true]);
    const rest = await runReport(db, "attendance", v.eventId, { limit: 3, cursor: att.next_cursor });
    expect([rest.rows.length, rest.next_cursor]).toEqual([1, null]);
    await expect(runReport(db, "attendance", v.eventId, { cursor: dwell.next_cursor ?? "bogus" })).rejects.toThrow(/invalid report cursor/);
  });

  it("return exactly the same figures after the purge", async () => {
    const before = await all();
    await q(db, `update events set state = 'closed' where id = $1`, [v.eventId]);
    const res = await purgeEventMovementData(db, v.eventId, { force: true });
    expect(res.scans_dropped).toBe(13);
    expect((await q<{ n: number }>(db, `select count(*)::int n from scans where event_id = $1`, [v.eventId]))[0]!.n).toBe(0);
    const after = await all();
    expect(after).toEqual(before);
  });
});
