import { beforeAll, describe, expect, it } from "vitest";
import { lastCountedRoom, roomOccupancy } from "../src/functions";
import * as s from "../src/schema/index";
import { attendeeWithCredential, miniVenue, scan, type MiniVenue } from "./fixtures";
import { createTestDb, q, type TestDb } from "./helpers";

let db: TestDb;
const FAR = new Date("2030-01-01T00:00:00Z");
beforeAll(async () => {
  db = await createTestDb();
});

const occ = async (v: MiniVenue, asOf?: string) => {
  const rows = await roomOccupancy(db, v.eventId, asOf ? new Date(asOf) : new Date("2030-01-01T00:00:00Z"));
  return Object.fromEntries(rows.map((r) => [r.room_id === v.roomA ? "A" : "B", r]));
};

/** The API's admission flow (D-10): write the implied exit for the room they were counted in. */
async function admitWithImpliedExit(v: MiniVenue, checkpointId: string, eph: string, at: string) {
  const prev = await lastCountedRoom(db, v.eventId, eph, new Date(at));
  const target = (await q<{ room_id: string }>(db, `select room_id from checkpoints where id = $1`, [checkpointId]))[0]!.room_id;
  if (prev && prev.room_id !== target) await scan(db, v, prev.checkpoint_id, eph, "implied_exit", at);
  await scan(db, v, checkpointId, eph, "admitted", at);
}

describe("room occupancy", () => {
  it("counts admissions at in-doors minus exits at out-doors; other results do not count", async () => {
    const v = await miniVenue(db);
    const people = await Promise.all([1, 2, 3].map(() => attendeeWithCredential(db, v.eventId)));
    for (const [i, p] of people.entries()) await scan(db, v, v.cpAin, p.ephemeralId, "admitted", `2026-12-01T10:0${i}:00Z`);
    await scan(db, v, v.cpAout, people[0]!.ephemeralId, "admitted", "2026-12-01T10:10:00Z");
    await scan(db, v, v.cpAin, people[1]!.ephemeralId, "already_inside", "2026-12-01T10:11:00Z");
    await scan(db, v, v.cpAin, people[1]!.ephemeralId, "duplicate_read", "2026-12-01T10:11:30Z");
    await scan(db, v, v.cpAin, null, "unknown_token", "2026-12-01T10:12:00Z");
    await scan(db, v, v.cpAin, people[2]!.ephemeralId, "denied_room", "2026-12-01T10:13:00Z");
    await scan(db, v, v.cpPerimeter, people[0]!.ephemeralId, "admitted", "2026-12-01T10:14:00Z"); // no room
    const o = await occ(v);
    expect(o.A!.occupancy).toBe(2);
    expect(o.B!.occupancy).toBe(0);
    expect(o.A!.status).toBe("ok");
    expect(o.A!.reconciliation_fault).toBe(false);
    // As-of: before the exit there were 3.
    expect((await occ(v, "2026-12-01T10:05:00Z")).A!.occupancy).toBe(3);
  });

  it("applies implied exits: entering B removes the person from A (D-10)", async () => {
    const v = await miniVenue(db);
    const p = await attendeeWithCredential(db, v.eventId);
    const q2 = await attendeeWithCredential(db, v.eventId);
    await admitWithImpliedExit(v, v.cpAin, p.ephemeralId, "2026-12-01T10:00:00Z");
    await admitWithImpliedExit(v, v.cpAin, q2.ephemeralId, "2026-12-01T10:00:30Z");
    expect((await lastCountedRoom(db, v.eventId, p.ephemeralId, FAR))!.room_id).toBe(v.roomA);

    await admitWithImpliedExit(v, v.cpBin, p.ephemeralId, "2026-12-01T10:30:00Z");
    let o = await occ(v);
    expect([o.A!.occupancy, o.B!.occupancy]).toEqual([1, 1]);
    expect((await lastCountedRoom(db, v.eventId, p.ephemeralId, FAR))!.room_id).toBe(v.roomB);
    const implied = await q<{ n: number }>(db, `select count(*)::int n from scans where event_id = $1 and result = 'implied_exit'`, [v.eventId]);
    expect(implied[0]!.n).toBe(1);

    // Back to A: implied exit from B.
    await admitWithImpliedExit(v, v.cpAin, p.ephemeralId, "2026-12-01T11:00:00Z");
    o = await occ(v);
    expect([o.A!.occupancy, o.B!.occupancy]).toEqual([2, 0]);

    // After tapping out of A they are counted nowhere, so entering B writes no implied exit.
    await scan(db, v, v.cpAout, p.ephemeralId, "admitted", "2026-12-01T11:30:00Z");
    expect(await lastCountedRoom(db, v.eventId, p.ephemeralId, FAR)).toBeNull();
    await admitWithImpliedExit(v, v.cpBin, p.ephemeralId, "2026-12-01T11:45:00Z");
    o = await occ(v);
    expect([o.A!.occupancy, o.B!.occupancy]).toEqual([1, 1]);
  });

  it("uses scans.direction at a `both` door and ignores an admitted scan there without one", async () => {
    const v = await miniVenue(db);
    const p = await attendeeWithCredential(db, v.eventId);
    await scan(db, v, v.cpBboth, p.ephemeralId, "admitted", "2026-12-01T10:00:00Z", { direction: "in" });
    await scan(db, v, v.cpBboth, p.ephemeralId, "admitted", "2026-12-01T10:01:00Z"); // no direction: no effect
    expect((await occ(v)).B!.occupancy).toBe(1);
    await scan(db, v, v.cpBboth, p.ephemeralId, "admitted", "2026-12-01T10:02:00Z", { direction: "out" });
    expect((await occ(v)).B!.occupancy).toBe(0);
  });

  it("applies a recount / session-end reset as an anchor, and late scans before it no longer matter", async () => {
    const v = await miniVenue(db);
    const ps = await Promise.all([1, 2, 3, 4].map(() => attendeeWithCredential(db, v.eventId)));
    for (const p of ps) await scan(db, v, v.cpAin, p.ephemeralId, "admitted", "2026-12-01T10:00:00Z");
    // Operator headcount: 7 at 11:00.
    await db.insert(s.occupancy_adjustments).values({
      event_id: v.eventId, room_id: v.roomA, delta: 3, set_to: 7, reason: "recount", at: new Date("2026-12-01T11:00:00Z"),
    });
    expect((await occ(v)).A!.occupancy).toBe(7);
    // A late offline scan whose *device* clock said 11:08 but which was 10 minutes fast: corrected 10:58,
    // i.e. before the recount, so the recount already includes it.
    await scan(db, v, v.cpAin, ps[0]!.ephemeralId, "admitted", "2026-12-01T11:08:00Z", {
      clock_offset_ms: -600_000, offline_bool: true, local_result: "admitted",
    });
    expect((await occ(v)).A!.occupancy).toBe(7);
    // A scan after the recount counts.
    await scan(db, v, v.cpAout, ps[1]!.ephemeralId, "admitted", "2026-12-01T11:05:00Z");
    expect((await occ(v)).A!.occupancy).toBe(6);

    // Session end at 12:00: reset to zero. Anyone counted in A before then is no longer counted
    // there, so their next admission elsewhere must not write an implied exit against A.
    await db.insert(s.occupancy_adjustments).values({
      event_id: v.eventId, room_id: v.roomA, delta: -6, set_to: 0, reason: "session_end", at: new Date("2026-12-01T12:00:00Z"),
    });
    expect((await occ(v)).A!.occupancy).toBe(0);
    expect(await lastCountedRoom(db, v.eventId, ps[2]!.ephemeralId, FAR)).toBeNull();
    expect((await lastCountedRoom(db, v.eventId, ps[2]!.ephemeralId, new Date("2026-12-01T11:59:00Z")))!.room_id).toBe(v.roomA);
    // As-of queries still see history.
    expect((await occ(v, "2026-12-01T10:30:00Z")).A!.occupancy).toBe(4);
  });

  it("un-counts individuals after a recount to zero, but not after a recount to a non-zero headcount", async () => {
    const v = await miniVenue(db);
    const p = await attendeeWithCredential(db, v.eventId);
    await scan(db, v, v.cpAin, p.ephemeralId, "admitted", "2026-12-01T10:00:00Z");
    await db.insert(s.occupancy_adjustments).values({
      event_id: v.eventId, room_id: v.roomA, delta: 4, set_to: 5, reason: "recount", at: new Date("2026-12-01T10:30:00Z"),
    });
    expect((await lastCountedRoom(db, v.eventId, p.ephemeralId, FAR))!.room_id).toBe(v.roomA);
    await db.insert(s.occupancy_adjustments).values({
      event_id: v.eventId, room_id: v.roomA, delta: -5, set_to: 0, reason: "recount", at: new Date("2026-12-01T11:00:00Z"),
    });
    expect(await lastCountedRoom(db, v.eventId, p.ephemeralId, FAR)).toBeNull();
  });

  it("applies relative (sync_conflict) deltas", async () => {
    const v = await miniVenue(db);
    const ps = await Promise.all([1, 2, 3].map(() => attendeeWithCredential(db, v.eventId)));
    for (const p of ps) await scan(db, v, v.cpBin, p.ephemeralId, "admitted", "2026-12-01T10:00:00Z", { offline_bool: true });
    await db.insert(s.occupancy_adjustments).values({
      event_id: v.eventId, room_id: v.roomB, delta: -1, reason: "sync_conflict", at: new Date("2026-12-01T10:05:00Z"),
    });
    const o = await occ(v);
    expect(o.B!.occupancy).toBe(2);
    expect(o.B!.status).toBe("warn"); // 2 / 4 = 50 % ≥ warn_at_pct 50
  });

  it("never goes negative: clamps at zero at each step and flags a reconciliation fault", async () => {
    const v = await miniVenue(db);
    const p = await attendeeWithCredential(db, v.eventId);
    await scan(db, v, v.cpAin, p.ephemeralId, "admitted", "2026-12-01T10:00:00Z");
    for (const m of [1, 2, 3]) await scan(db, v, v.cpAout, p.ephemeralId, "admitted", `2026-12-01T10:0${m}:00Z`);
    let o = await occ(v);
    expect(o.A!.occupancy).toBe(0);
    expect(o.A!.reconciliation_fault).toBe(true);
    // After the clamp, two entries give 2 — not 0 (which an unclamped sum −2 + 2 would give).
    await scan(db, v, v.cpAin, p.ephemeralId, "admitted", "2026-12-01T10:10:00Z");
    await scan(db, v, v.cpAin, p.ephemeralId, "admitted", "2026-12-01T10:11:00Z");
    o = await occ(v);
    expect(o.A!.occupancy).toBe(2);
  });

  it("reports capacity status against the effective capacity (event override wins)", async () => {
    const v = await miniVenue(db);
    await q(db, `update event_rooms set capacity_override = 2 where event_id = $1 and room_id = $2`, [v.eventId, v.roomA]);
    const ps = await Promise.all([1, 2].map(() => attendeeWithCredential(db, v.eventId)));
    await scan(db, v, v.cpAin, ps[0]!.ephemeralId, "admitted", "2026-12-01T10:00:00Z");
    let o = await occ(v);
    expect([o.A!.capacity, o.A!.pct, o.A!.status]).toEqual([2, 50, "ok"]);
    await scan(db, v, v.cpAin, ps[1]!.ephemeralId, "admitted", "2026-12-01T10:01:00Z");
    o = await occ(v);
    expect([o.A!.pct, o.A!.status]).toEqual([100, "block"]);
  });

  it("orders scans by corrected time (D-14), not by arrival or device time", async () => {
    const v = await miniVenue(db);
    const p = await attendeeWithCredential(db, v.eventId);
    // Exit synced first, from a correct clock at 10:05.
    await scan(db, v, v.cpAout, p.ephemeralId, "admitted", "2026-12-01T10:05:00Z");
    // Entry synced later from a device 2 h slow: device 08:00, offset +2 h → corrected 10:00.
    await scan(db, v, v.cpAin, p.ephemeralId, "admitted", "2026-12-01T08:00:00Z", { clock_offset_ms: 7_200_000, offline_bool: true });
    const o = await occ(v);
    expect(o.A!.occupancy).toBe(0);
    expect(o.A!.reconciliation_fault).toBe(false); // entry then exit: never negative
  });

  it("exposes live events through the current_room_occupancy view", async () => {
    const live = await miniVenue(db);
    const draft = await miniVenue(db, { eventState: "draft" });
    const p = await attendeeWithCredential(db, live.eventId);
    await scan(db, live, live.cpAin, p.ephemeralId, "admitted", new Date(Date.now() - 60_000).toISOString());
    const rows = await q<{ event_id: string; room_id: string; occupancy: number }>(
      db,
      `select event_id, room_id, occupancy from current_room_occupancy where event_id in ($1, $2)`,
      [live.eventId, draft.eventId],
    );
    expect(rows.every((r) => r.event_id === live.eventId)).toBe(true);
    expect(rows.find((r) => r.room_id === live.roomA)!.occupancy).toBe(1);
  });

  it("matches a step-by-step reference model on 300 random operations", async () => {
    const v = await miniVenue(db);
    const ps = await Promise.all(Array.from({ length: 6 }, () => attendeeWithCredential(db, v.eventId)));
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    type Op = { t: number; prio: number; room: "A" | "B"; d: number; setTo?: number };
    const ops: Op[] = [];
    const base = Date.parse("2026-12-01T09:00:00Z");
    for (let i = 0; i < 300; i++) {
      const t = base + Math.floor(rnd() * 8 * 3600 * 1000);
      const r = rnd();
      const p = ps[Math.floor(rnd() * ps.length)]!;
      const at = new Date(t).toISOString();
      if (r < 0.35) {
        await scan(db, v, v.cpAin, p.ephemeralId, "admitted", at);
        ops.push({ t, prio: 0, room: "A", d: 1 });
      } else if (r < 0.6) {
        await scan(db, v, v.cpAout, p.ephemeralId, "admitted", at);
        ops.push({ t, prio: 0, room: "A", d: -1 });
      } else if (r < 0.75) {
        await scan(db, v, v.cpBin, p.ephemeralId, "admitted", at);
        ops.push({ t, prio: 0, room: "B", d: 1 });
      } else if (r < 0.85) {
        await scan(db, v, v.cpBin, p.ephemeralId, "implied_exit", at);
        ops.push({ t, prio: 0, room: "B", d: -1 });
      } else if (r < 0.9) {
        await scan(db, v, v.cpAin, p.ephemeralId, "denied_room", at);
      } else if (r < 0.95) {
        const setTo = Math.floor(rnd() * 5);
        await db.insert(s.occupancy_adjustments).values({ event_id: v.eventId, room_id: v.roomA, delta: 0, set_to: setTo, reason: "recount", at: new Date(t) });
        ops.push({ t, prio: 2, room: "A", d: 0, setTo });
      } else {
        const d = rnd() < 0.5 ? -1 : 1;
        await db.insert(s.occupancy_adjustments).values({ event_id: v.eventId, room_id: v.roomB, delta: d, reason: "sync_conflict", at: new Date(t) });
        ops.push({ t, prio: 1, room: "B", d });
      }
    }
    // Reference: process in time order (ties: scans, then deltas, then anchors), clamp at each step.
    // A same-room, same-priority tie would make the order ambiguous (the SQL breaks it by id), so
    // assert this seed produced none.
    const sorted = [...ops].sort((a, b) => a.t - b.t || a.prio - b.prio);
    const ties = sorted.some((o, i) => i > 0 && o.t === sorted[i - 1]!.t && o.room === sorted[i - 1]!.room && o.prio === sorted[i - 1]!.prio);
    expect(ties).toBe(false);
    const level = { A: 0, B: 0 };
    for (const o of sorted) level[o.room] = o.setTo !== undefined ? o.setTo : Math.max(0, level[o.room] + o.d);
    const got = await occ(v);
    expect({ A: got.A!.occupancy, B: got.B!.occupancy }).toEqual(level);
  });
});
