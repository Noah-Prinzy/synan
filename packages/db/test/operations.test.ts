import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { replaceAccessRules } from "../src/access-rules";
import { roomOccupancy } from "../src/functions";
import {
  applySessionResets,
  authenticateDevice,
  currentAssignments,
  deviceTokenVersion,
  duplicateEvent,
  eventReadiness,
  eventsDueForPurge,
  gateHealth,
  handOverShift,
  recordHeartbeat,
  registerDevice,
  rotateDeviceToken,
  rotateDeviceTokenVersioned,
  setDeviceState,
  shiftHandoverSummary,
  staffOnDuty,
} from "../src/operations";
import * as s from "../src/schema/index";
import { insertUser } from "../src/secrets";
import { attendeeWithCredential, devCipher, miniVenue, scan, type MiniVenue } from "./fixtures";
import { createTestDb, q, rejects, type TestDb } from "./helpers";

let db: TestDb;
let v: MiniVenue;
let guard: string;
let assignment: string;
const T = (hhmm: string) => new Date(`2026-12-01T${hhmm}:00Z`);

beforeAll(async () => {
  db = await createTestDb();
  v = await miniVenue(db);
  guard = await insertUser(db, devCipher, { email: "guard@example.test", role: "security_staff", display_name: "Gia Guard" });
  const [a] = await db
    .insert(s.staff_assignments)
    .values([
      { user_id: guard, checkpoint_id: v.cpAin, event_id: v.eventId, shift_start: T("08:00"), shift_end: T("12:00") },
      { user_id: guard, checkpoint_id: v.cpBin, event_id: v.eventId, shift_start: T("12:00"), shift_end: T("16:00") },
    ])
    .returning();
  assignment = a!.id;
});

describe("staff", () => {
  it("knows who is on a gate and a user's current and next shifts", async () => {
    expect((await staffOnDuty(db, v.cpAin, T("09:00"))).map((x) => [x.display_name, x.role])).toEqual([["Gia Guard", "security_staff"]]);
    expect(await staffOnDuty(db, v.cpAin, T("12:00"))).toEqual([]);
    const cur = await currentAssignments(db, guard, { at: T("11:00"), horizon: "2 hours" });
    expect(cur.map((x) => [x.checkpoint_label, x.current])).toEqual([["A in", true], ["B in", false]]);
  });

  it("summarises a shift and hands it over once, audited", async () => {
    const p = await attendeeWithCredential(db, v.eventId);
    const base = { staff_user_id: guard };
    await scan(db, v, v.cpAin, p.ephemeralId, "admitted", "2026-12-01T09:00:00Z", base);
    await scan(db, v, v.cpAin, p.ephemeralId, "duplicate_read", "2026-12-01T09:00:10Z", base);
    await scan(db, v, v.cpAin, null, "unknown_token", "2026-12-01T09:30:00Z", base);
    await scan(db, v, v.cpAin, p.ephemeralId, "already_inside", "2026-12-01T10:00:00Z", { ...base, offline_bool: true, received_at: T("12:30") });
    await scan(db, v, v.cpAin, p.ephemeralId, "admitted", "2026-12-01T13:00:00Z", base); // after the shift
    const sum = (await shiftHandoverSummary(db, assignment))!;
    expect(sum).toMatchObject({ scans: 4, let_through: 2, refused: 1, duplicates: 1, offline: 1, late_synced: 1 });
    expect(sum.by_result).toEqual({ admitted: 1, duplicate_read: 1, unknown_token: 1, already_inside: 1 });
    const h = await handOverShift(db, assignment, { actorId: guard, now: T("11:30") });
    expect(h.period_end).toEqual(T("11:30"));
    expect(h.scans).toBe(4);
    await rejects(handOverShift(db, assignment, { now: T("11:31") }), /already handed over/);
    expect(await staffOnDuty(db, v.cpAin, T("11:45"))).toEqual([]);
    const audit = await q<{ n: number }>(db, `select count(*)::int n from audit_log where action = 'staff.handover'`);
    expect(audit[0]!.n).toBe(1);
  });

  it("leaves undone admissions out of let_through and by_result and counts them as undone (0034)", async () => {
    const other = await insertUser(db, devCipher, { email: "guard2@example.test", role: "security_staff" });
    const [a] = await db.insert(s.staff_assignments).values({ user_id: other, checkpoint_id: v.cpBin, event_id: v.eventId, shift_start: T("08:00"), shift_end: T("10:00") }).returning();
    const base = { staff_user_id: other };
    const kept: string[] = [];
    for (const m of ["08:10", "08:20", "08:30"]) {
      const p = await attendeeWithCredential(db, v.eventId);
      kept.push((await scan(db, v, v.cpBin, p.ephemeralId, "admitted", `2026-12-01T${m}:00Z`, base)).id);
    }
    await db.insert(s.scan_voids).values([kept[0]!, kept[2]!].map((scan_id) => ({ event_id: v.eventId, scan_id, voided_by: other, reason: "wrong person" })));
    const sum = (await shiftHandoverSummary(db, a!.id))!;
    expect(sum).toMatchObject({ scans: 3, let_through: 1, undone: 2 });
    expect(sum.by_result).toEqual({ admitted: 1 });
    const h = await handOverShift(db, a!.id, { actorId: other, now: T("09:00") });
    expect(h).toMatchObject({ let_through: 1, undone: 2 });
    const meta = await q<{ m: { undone: number; let_through: number } }>(db, `select meta_jsonb m from audit_log where action = 'staff.handover' and target = 'staff_assignment:${a!.id}'`);
    expect(meta[0]!.m).toMatchObject({ undone: 2, let_through: 1 });
  });
});

describe("devices and gate health", () => {
  it("registers devices, authenticates fixed readers by token, rotates tokens", async () => {
    const reader = await registerDevice(db, { venueId: v.venueId, kind: "fixed_reader", label: "Reader A", hardwareId: "FR-1", checkpointId: v.cpAin });
    expect(reader.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await authenticateDevice(db, reader.token!))!.id).toBe(reader.id);
    const fresh = await rotateDeviceToken(db, reader.id);
    expect(await authenticateDevice(db, reader.token!)).toBeNull();
    expect((await authenticateDevice(db, fresh))!.id).toBe(reader.id);
    const phone = await registerDevice(db, { venueId: v.venueId, kind: "scanner", label: "Phone 1", hardwareId: "PH-1" });
    expect(phone.token).toBeNull();
    await rejects(registerDevice(db, { venueId: v.venueId, kind: "fixed_reader", label: "x", hardwareId: "FR-2" }), /devices_fixed_reader_checkpoint/);
    await rejects(registerDevice(db, { venueId: v.venueId, kind: "scanner", label: "dup", hardwareId: "PH-1" }), /devices_hardware_id_uq/);
  });

  it("versions device tokens: rotation and leaving active bump the version, whoever writes", async () => {
    const at = T("07:00");
    const d = await registerDevice(db, { venueId: v.venueId, kind: "kiosk", label: "Kiosk", hardwareId: "KS-1", now: at });
    expect(d.token_version).toBe(1);
    const [row] = await db.select().from(s.devices).where(eq(s.devices.id, d.id));
    expect(row!.created_at).toEqual(at);
    expect(row!.token_rotated_at).toEqual(at);
    expect(await deviceTokenVersion(db, d.id)).toEqual({ token_version: 1, state: "active" });
    const r = (await rotateDeviceTokenVersioned(db, d.id, { now: T("07:30") }))!;
    expect(r.token_version).toBe(2);
    expect((await authenticateDevice(db, r.token))!.token_version).toBe(2);
    await rotateDeviceToken(db, d.id, { now: T("07:40") });
    expect((await deviceTokenVersion(db, d.id))!.token_version).toBe(3);
    // A heartbeat (or any unrelated update) leaves the version alone; a direct write cannot set it.
    await recordHeartbeat(db, { deviceId: d.id, now: T("07:45") });
    await q(db, `update devices set token_version = 99, label = 'Kiosk 1' where id = $1`, [d.id]);
    expect((await deviceTokenVersion(db, d.id))!.token_version).toBe(3);
    expect(await setDeviceState(db, d.id, "maintenance")).toEqual({ token_version: 4 });
    expect(await setDeviceState(db, d.id, "active")).toEqual({ token_version: 4 });
    expect(await rotateDeviceTokenVersioned(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await deviceTokenVersion(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
    const phone = await registerDevice(db, { venueId: v.venueId, kind: "scanner", label: "Phone 2", hardwareId: "PH-2" });
    expect(phone.token_version).toBe(0);
  });

  it("reports link state, clock faults and queue depth from heartbeats, faults first", async () => {
    const [reader] = await db.select().from(s.devices).where(eq(s.devices.hardware_id, "FR-1"));
    expect(await recordHeartbeat(db, { deviceId: reader!.id, clockOffsetMs: 150_000, queueDepth: 182, ip: "203.0.113.9", now: T("10:00") })).toBe("ok");
    const [phone] = await db.select().from(s.devices).where(eq(s.devices.hardware_id, "PH-1"));
    await recordHeartbeat(db, { deviceId: phone!.id, checkpointId: v.cpBin, clockOffsetMs: 200, now: T("10:00") });
    await q(db, `update checkpoints set last_heartbeat_at = $1 where id = $2`, [new Date(T("10:00").getTime() + 50_000), v.cpBin]);
    const h = await gateHealth(db, v.venueId, { eventId: v.eventId, now: new Date(T("10:00").getTime() + 90_000) });
    const byLabel = Object.fromEntries(h.map((x) => [x.label, x]));
    expect(byLabel["A in"]).toMatchObject({ link_state: "offline", heartbeat_age_s: 90, clock_fault: true, queue_depth: 182 });
    expect(byLabel["B in"]).toMatchObject({ link_state: "online", heartbeat_age_s: 40, clock_fault: false });
    expect(byLabel["Main gate"]!.link_state).toBe("unknown");
    expect(h.findIndex((x) => x.label === "B in")).toBeGreaterThan(h.findIndex((x) => x.label === "A in")); // faults first
    expect(byLabel["A in"]!.last_scan_at).not.toBeNull();
    await q(db, `update devices set state = 'retired' where id = $1`, [phone!.id]);
    expect(await recordHeartbeat(db, { deviceId: phone!.id })).toBe("not_active");
  });
});

describe("events", () => {
  it("duplicate an event as a shifted draft with rooms, sessions and rules but no people", async () => {
    await db.insert(s.sessions).values({ event_id: v.eventId, room_id: v.roomA, title: "Talk", starts_at: T("10:00"), ends_at: T("11:00") });
    await replaceAccessRules(db, v.eventId, 0, [
      { subject_kind: "tier", subject: "ORDINARY", room_id: v.roomA, window_start: T("10:00"), window_end: T("11:00"), effect: "permit" },
    ]);
    const newStart = new Date(T("09:00").getTime() + 7 * 86_400_000);
    const id = await duplicateEvent(db, { eventId: v.eventId, slug: "repeat-next-week", title: "Repeat", startsAt: newStart, actorId: guard });
    const [e] = await db.select().from(s.events).where(eq(s.events.id, id));
    expect(e).toMatchObject({ state: "draft", slug: "repeat-next-week", venue_id: v.venueId });
    expect(e!.starts_at).toEqual(newStart);
    const [sess] = await db.select().from(s.sessions).where(eq(s.sessions.event_id, id));
    expect(sess!.starts_at).toEqual(new Date(T("10:00").getTime() + 7 * 86_400_000));
    const [rule] = await db.select().from(s.access_rules).where(eq(s.access_rules.event_id, id));
    expect(rule!.window_end).toEqual(new Date(T("11:00").getTime() + 7 * 86_400_000));
    expect(await db.select().from(s.registrations).where(eq(s.registrations.event_id, id))).toHaveLength(0);
    expect((await db.select().from(s.event_rooms).where(eq(s.event_rooms.event_id, id))).length).toBe(2);
  });

  it("produce the readiness checklist with blocking and warning checks", async () => {
    const draft = await miniVenue(db, { eventState: "draft" });
    const r = await eventReadiness(db, draft.eventId, T("08:00"));
    const byName = Object.fromEntries(r.checks.map((c) => [c.check_name, c]));
    expect(byName.rooms).toMatchObject({ ok: true, blocking: true });
    expect(byName.pass_template).toMatchObject({ ok: true, blocking: true });
    expect(byName.access_rules).toMatchObject({ ok: false, blocking: false });
    expect(byName.staff_assigned!.ok).toBe(false);
    expect(byName.perimeter_gate!.ok).toBe(true);
    expect(r.ready).toBe(true); // only warnings fail
    await q(db, `update events set pass_template_jsonb = null where id = $1`, [draft.eventId]);
    expect((await eventReadiness(db, draft.eventId, T("08:00"))).ready).toBe(false);
  });

  it("apply session-end resets idempotently, skipping continuous rooms", async () => {
    const e = await miniVenue(db);
    await q(db, `update rooms set continuous_bool = true where id = $1`, [e.roomB]);
    await db.insert(s.sessions).values([
      { event_id: e.eventId, room_id: e.roomA, title: "S1", starts_at: T("09:00"), ends_at: T("10:00") },
      { event_id: e.eventId, room_id: e.roomB, title: "Lounge", starts_at: T("09:00"), ends_at: T("10:00") },
      { event_id: e.eventId, room_id: e.roomA, title: "S2", starts_at: T("10:30"), ends_at: T("11:30") },
    ]);
    for (let i = 0; i < 3; i++) {
      const p = await attendeeWithCredential(db, e.eventId);
      await scan(db, e, e.cpAin, p.ephemeralId, "admitted", "2026-12-01T09:10:00Z");
      await scan(db, e, e.cpBin, p.ephemeralId, "admitted", "2026-12-01T09:20:00Z", {});
    }
    const resets = await applySessionResets(db, e.eventId, T("10:15"));
    // No implied exits were written, so all three are still counted in A when its session ends.
    expect(resets.map((r) => [r.room_id === e.roomA ? "A" : "B", r.delta])).toEqual([["A", -3]]);
    expect(await applySessionResets(db, e.eventId, T("10:20"))).toEqual([]);
    expect(await applySessionResets(db, e.eventId, T("11:30"))).toHaveLength(1);
    const occ = Object.fromEntries((await roomOccupancy(db, e.eventId, T("11:45"))).map((r) => [r.room_id === e.roomA ? "A" : "B", r.occupancy]));
    expect(occ).toEqual({ A: 0, B: 3 });
  });

  it("list events due for purge", async () => {
    const e = await miniVenue(db);
    await q(db, `update events set state = 'closed' where id = $1`, [e.eventId]);
    await q(db, `update events set closed_at = $2 where id = $1`, [e.eventId, T("18:00")]);
    expect((await eventsDueForPurge(db, { now: new Date(T("18:00").getTime() + 71 * 3600_000) })).map((x) => x.event_id)).not.toContain(e.eventId);
    const later = await eventsDueForPurge(db, { now: new Date(T("18:00").getTime() + 73 * 3600_000) });
    expect(later.find((x) => x.event_id === e.eventId)).toMatchObject({ due: true, due_at: new Date(T("18:00").getTime() + 72 * 3600_000) });
    const all = await eventsDueForPurge(db, { now: T("19:00"), dueOnly: false, orgId: e.orgId });
    expect(all).toEqual([expect.objectContaining({ event_id: e.eventId, due: false })]);
  });
});

describe("venue rule", () => {
  it("refuses a room's door placed in another zone", async () => {
    const [z2] = await db.insert(s.zones).values({ venue_id: v.venueId, name: "Upstairs" }).returning();
    await rejects(
      db.insert(s.checkpoints).values({ venue_id: v.venueId, zone_id: z2!.id, room_id: v.roomA, direction: "in", label: "wrong zone door" }),
      /checkpoints_room_same_zone_fk/,
    );
    await db.insert(s.checkpoints).values({ venue_id: v.venueId, zone_id: z2!.id, direction: "in", label: "zone gate, no room" });
  });
});

describe("checkpoint position (GridPoint)", () => {
  it("stores, updates and clears a gate's grid position, typed in Drizzle and returned by gateHealth", async () => {
    const e = await miniVenue(db);
    const [c] = await db
      .insert(s.checkpoints)
      .values({ venue_id: e.venueId, zone_id: e.zoneId, direction: "in", perimeter_bool: true, label: "North gate", position_jsonb: { x: 120, y: 0, side: "n" } })
      .returning();
    expect(c!.position_jsonb).toEqual({ x: 120, y: 0, side: "n" });
    const [u] = await db.update(s.checkpoints).set({ position_jsonb: { x: 10_000, y: 45, side: "e" } }).where(eq(s.checkpoints.id, c!.id)).returning();
    expect(u!.position_jsonb).toEqual({ x: 10_000, y: 45, side: "e" });
    const [read] = await db.select({ p: s.checkpoints.position_jsonb }).from(s.checkpoints).where(eq(s.checkpoints.id, c!.id));
    expect(read!.p).toEqual({ x: 10_000, y: 45, side: "e" });

    const h = await gateHealth(db, e.venueId);
    expect(h.find((x) => x.checkpoint_id === c!.id)!.position).toEqual({ x: 10_000, y: 45, side: "e" });
    expect(h.find((x) => x.checkpoint_id === e.cpAin)!.position).toBeNull(); // not placed

    await db.update(s.checkpoints).set({ position_jsonb: null }).where(eq(s.checkpoints.id, c!.id));
    expect((await gateHealth(db, e.venueId)).find((x) => x.checkpoint_id === c!.id)!.position).toBeNull();
  });

  it("refuses anything that is not a GridPoint", async () => {
    const e = await miniVenue(db);
    const bad: unknown[] = [
      [1, 2, "n"], "n", 5, {}, { x: 1, y: 2 }, { x: 1, side: "n" }, { y: 1, side: "n" },
      { x: 1, y: 2, side: "north" }, { x: 1, y: 2, side: "N" }, { x: 1, y: 2, side: 1 },
      { x: -1, y: 2, side: "n" }, { x: 1, y: 10_001, side: "s" }, { x: 1.5, y: 2, side: "w" },
      { x: "1", y: 2, side: "n" }, { x: 1, y: null, side: "n" }, { x: 1, y: 2, side: "n", z: 3 },
    ];
    for (const p of bad) {
      await rejects(
        q(db, `update checkpoints set position_jsonb = $1::jsonb where id = $2`, [JSON.stringify(p), e.cpAin]),
        /checkpoints_position_grid_point/,
      );
    }
    for (const ok of [{ x: 0, y: 0, side: "w" }, { x: 10_000, y: 10_000, side: "s" }, { side: "e", y: 3, x: 2.0 }]) {
      await q(db, `update checkpoints set position_jsonb = $1::jsonb where id = $2`, [JSON.stringify(ok), e.cpAin]);
    }
    // A JSON null is refused too; "not placed" is SQL NULL.
    await rejects(q(db, `update checkpoints set position_jsonb = 'null'::jsonb where id = $1`, [e.cpAin]), /checkpoints_position_grid_point/);
  });
});
