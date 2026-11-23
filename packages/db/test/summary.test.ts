import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { purgeEventMovementData, rebuildEventRollups } from "../src/functions";
import * as s from "../src/schema/index";
import { insertUser } from "../src/secrets";
import { collectWorkbookData, postEventSummary, type PostEventSummary } from "../src/summary";
import { attendeeWithCredential, devCipher, miniVenue, scan, type MiniVenue } from "./fixtures";
import { createTestDb, q, type TestDb } from "./helpers";

let db: TestDb;
let v: MiniVenue;
let roomC: string;
let cpCin: string;
let cpExit: string;
const T = (hhmm: string) => new Date(`2026-12-01T${hhmm}:00Z`);
const iso = (hhmm: string) => `2026-12-01T${hhmm}:00Z`;

/**
 * Same shape as the reports scenario: ground zone (A, B, main gate, exit) and Level 1 (room C,
 * capacity 2). On site: 1 @09:00, 2 @09:05, 3 @09:20, 4 @09:50, 5 @10:30 (peak), 4 @11:00.
 */
beforeAll(async () => {
  db = await createTestDb();
  v = await miniVenue(db);
  const [z] = await db.insert(s.zones).values({ venue_id: v.venueId, name: "Level 1", floor: "1" }).returning();
  const [c] = await db.insert(s.rooms).values({ venue_id: v.venueId, zone_id: z!.id, name: "Room C", capacity: 2 }).returning();
  roomC = c!.id;
  await db.insert(s.event_rooms).values({ event_id: v.eventId, room_id: roomC });
  const cps = await db.insert(s.checkpoints).values([
    { venue_id: v.venueId, zone_id: z!.id, room_id: roomC, direction: "in", label: "C in" },
    { venue_id: v.venueId, zone_id: v.zoneId, direction: "out", perimeter_bool: true, label: "Exit" },
  ]).returning();
  cpCin = cps[0]!.id;
  cpExit = cps[1]!.id;

  // Named attendees so the identity flag can be checked.
  const people: Awaited<ReturnType<typeof attendeeWithCredential>>[] = [];
  for (const [i, tier] of (["VIP", "VIP", "ORDINARY", "ORDINARY", "ORDINARY", "PUBLIC"] as const).entries()) {
    const p = await attendeeWithCredential(db, v.eventId, tier);
    if (tier !== "PUBLIC") {
      await q(db, `select set_config('app.vault_scope','system',false)`);
      const enc = (await import("../src/secrets")).encryptAttendeeColumns(devCipher, p.attendeeId, { email: `person${i}@example.test`, full_name: `Person ${i}` });
      await db.update(s.attendees).set(enc).where(eq(s.attendees.id, p.attendeeId));
      await q(db, `select set_config('app.vault_scope','',false)`);
    }
    people.push(p);
  }
  const e = (i: number) => people[i]!.ephemeralId;
  await scan(db, v, v.cpPerimeter, e(0), "admitted", iso("09:00"));
  await scan(db, v, v.cpAin, e(0), "admitted", iso("09:10"));
  await scan(db, v, v.cpAin, e(0), "implied_exit", iso("10:00"));
  await scan(db, v, cpCin, e(0), "admitted", iso("10:00"));
  await scan(db, v, cpExit, e(0), "admitted", iso("11:00"));
  await scan(db, v, v.cpPerimeter, e(1), "admitted", iso("09:05"));
  await scan(db, v, cpCin, e(1), "admitted", iso("09:30"));
  await scan(db, v, v.cpPerimeter, e(2), "admitted", iso("09:20"));
  await scan(db, v, cpCin, e(2), "denied_room", iso("09:40"));
  await scan(db, v, v.cpPerimeter, e(3), "admitted", iso("09:50"));
  await scan(db, v, v.cpPerimeter, e(5), "admitted", iso("10:30"));
  for (const [i, t] of [[0, "09:00"], [1, "09:05"], [2, "09:20"], [3, "09:50"], [5, "10:30"]] as const) {
    await db.update(s.registrations).set({ checked_in_at: T(t) }).where(eq(s.registrations.id, people[i]!.registrationId));
  }
  const op = await insertUser(db, devCipher, { email: "summary.op@example.test", role: "organiser" });
  await db.insert(s.breach_alerts).values([
    { event_id: v.eventId, severity: "high", kind: "unauthorised_tier", checkpoint_id: cpCin, occurred_at: T("09:40"), state: "resolved",
      acked_by: op, acked_at: new Date(T("09:40").getTime() + 60_000), resolved_by: op, resolved_at: new Date(T("09:40").getTime() + 600_000), resolution_note: "ok" },
    { event_id: v.eventId, severity: "critical", kind: "impossible_travel", checkpoint_id: cpCin, occurred_at: T("10:40"), state: "acked",
      acked_by: op, acked_at: new Date(T("10:40").getTime() + 180_000) },
    { event_id: v.eventId, severity: "low", kind: "clock_skew", checkpoint_id: v.cpPerimeter, occurred_at: T("12:00"), state: "open" },
  ]);
});

const stable = (x: PostEventSummary) => {
  const { computed_at: _c, frozen: _f, frozen_at: _fa, purge: _p, rollups_rebuilt_at: _r, event, ...rest } = x;
  const { state: _s, closed_at: _ca, ...ev } = event;
  return { ...rest, event: ev };
};

describe("post-event summary", () => {
  it("gives provisional figures so far for a live event", async () => {
    const before = await postEventSummary(db, v.eventId, T("10:45"));
    expect(before!.provisional).toBe(true);
    expect(before!.headline.peak_on_site).toBe(0); // rollups not built yet
    await rebuildEventRollups(db, v.eventId);
    const s1 = (await postEventSummary(db, v.eventId, T("10:45")))!;
    expect(s1).toMatchObject({ provisional: true, frozen: false });
    expect(s1.rollups_rebuilt_at).toBeInstanceOf(Date);
    expect(s1.headline).toMatchObject({ registered: 6, checked_in: 5, no_shows: 1, peak_on_site: 5, rooms_at_capacity: 1 });
    expect(s1.headline.peak_on_site_at).toEqual(T("10:30"));
    // While live, the curve stops at "now".
    expect(s1.onsite_curve.points.at(-1)!.t).toEqual(T("10:45"));
  });

  it("gives the final figures for a closed event", async () => {
    await q(db, `update events set state = 'closed' where id = $1`, [v.eventId]);
    const s1 = (await postEventSummary(db, v.eventId, T("19:00")))!;
    expect(s1.provisional).toBe(false);
    expect(s1.headline).toMatchObject({
      registered: 6, checked_in: 5, no_shows: 1, peak_on_site: 5, rooms_at_capacity: 1, alerts_total: 3,
      alerts_by_severity: { low: 1, medium: 0, high: 1, critical: 1 }, ack_median_s: 120, resolve_median_s: 600,
    });
    expect(s1.attendance_by_tier.find((t) => t.tier === "ORDINARY")).toEqual({ tier: "ORDINARY", registered: 3, checked_in: 2, no_shows: 1 });
    const pts = s1.onsite_curve.points;
    expect(pts[0]!.t).toEqual(T("09:00")); // event start
    expect(pts.at(-1)!.t).toEqual(T("18:00")); // event end
    const at = (hhmm: string) => pts.find((p) => p.t.getTime() === T(hhmm).getTime())!;
    expect([at("09:20").on_site, at("09:25").on_site, at("10:30").peak, at("11:00").on_site, at("15:00").on_site]).toEqual([3, 3, 5, 4, 4]);
    expect(s1.busiest_rooms.map((r) => [r.name, r.peak, r.reached_block])).toEqual([["Room C", 2, true], ["Room A", 1, false]]);
    expect(s1.busiest_gates[0]).toMatchObject({ label: "Main gate", scans: 5, admitted: 5, denied: 0 });
    expect(s1.purge).toMatchObject({ purged: false, purged_at: null, scans_available: true });
    expect(s1.purge.due_at).toBeInstanceOf(Date);
  });

  it("is identical after the purge, and frozen", async () => {
    const wbBefore = await collectWorkbookData({ db, vault: db, cipher: devCipher }, v.eventId, { includeIdentity: true, now: T("19:00") });
    const before = (await postEventSummary(db, v.eventId, T("19:00")))!;
    await purgeEventMovementData(db, v.eventId, { force: true });
    const after = (await postEventSummary(db, v.eventId, T("23:00")))!;
    expect(after).toMatchObject({ frozen: true, provisional: false, purge: { purged: true, scans_available: false } });
    expect(after.frozen_at).toBeInstanceOf(Date);
    expect(stable(after)).toEqual(stable(before));
    // A later room edit does not change the frozen summary.
    await q(db, `update rooms set capacity = 500 where id = $1`, [roomC]);
    expect((await postEventSummary(db, v.eventId))!.headline.rooms_at_capacity).toBe(1);
    await q(db, `update rooms set capacity = 2 where id = $1`, [roomC]);
    // And the workbook's sheets are identical too.
    const wbAfter = await collectWorkbookData({ db, vault: db, cipher: devCipher }, v.eventId, { includeIdentity: true, now: T("19:00") });
    expect(wbAfter.sheets).toEqual(wbBefore.sheets);
  });
});

describe("workbook data", () => {
  it("has every sheet with typed cells: numbers as numbers, times as dates", async () => {
    const wb = await collectWorkbookData({ db, vault: db, cipher: devCipher }, v.eventId, { includeIdentity: true });
    expect(wb.sheets.map((s) => s.name)).toEqual([
      "Summary", "Attendance", "Arrivals", "On site", "Dwell", "Flow", "Peak occupancy", "Alerts", "Alert log", "Gate throughput", "Attendees",
    ]);
    for (const sheet of wb.sheets) {
      for (const row of sheet.rows) {
        expect(row).toHaveLength(sheet.columns.length);
        row.forEach((cell, i) => {
          if (cell === null) return;
          const t = sheet.columns[i]!.type;
          if (t === "number") expect(typeof cell, `${sheet.name}.${sheet.columns[i]!.key}`).toBe("number");
          if (t === "datetime") expect(cell, `${sheet.name}.${sheet.columns[i]!.key}`).toBeInstanceOf(Date);
          if (t === "text") expect(typeof cell).toBe("string");
          if (t === "boolean") expect(typeof cell).toBe("boolean");
        });
      }
    }
    const gates = wb.sheets.find((s) => s.name === "Gate throughput")!;
    const main = gates.rows.filter((r) => r[0] === "Main gate");
    expect(main.reduce((a, r) => a + (r[2] as number), 0)).toBe(5);
    expect(wb.sheets.find((s) => s.name === "Alert log")!.rows).toHaveLength(3);
  });

  it("includes name and email only when identity is allowed", async () => {
    const withId = await collectWorkbookData({ db, vault: db, cipher: devCipher }, v.eventId, { includeIdentity: true, chunkSize: 2 });
    const sheet = withId.sheets.find((s) => s.name === "Attendees")!;
    expect(sheet.columns.map((c) => c.key)).toEqual(["registration", "name", "email", "tier", "state", "checked_in", "first_check_in", "registered_at"]);
    expect(sheet.rows).toHaveLength(6); // read in chunks of 2
    // The fixture names every attendee "Test Person"; the five non-Public ones were renamed above.
    expect(sheet.rows.map((r) => r[1]).sort()).toEqual(["Person 0", "Person 1", "Person 2", "Person 3", "Person 4", "Test Person"]);
    expect(sheet.rows.filter((r) => r[2] !== null)).toHaveLength(5);
    const noId = await collectWorkbookData({ db }, v.eventId, { includeIdentity: false });
    expect(noId.includes_identity).toBe(false);
    const sheet2 = noId.sheets.find((s) => s.name === "Attendees")!;
    expect(sheet2.columns.map((c) => c.key)).toEqual(["registration", "tier", "state", "checked_in", "first_check_in", "registered_at"]);
    expect(JSON.stringify(noId)).not.toMatch(/Person \d|@example\.test/);
    await expect(collectWorkbookData({ db }, v.eventId, { includeIdentity: true })).rejects.toThrow(/needs the vault connection/);
  });
});
