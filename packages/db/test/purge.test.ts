import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { withVaultScope } from "../src/client";
import { auditVerify, purgeEventMovementData, rebuildEventRollups, roomOccupancy, takeAttendanceSnapshot } from "../src/functions";
import * as s from "../src/schema/index";
import { attendeeWithCredential, miniVenue, scan, type MiniVenue } from "./fixtures";
import { createTestDb, q, rejects, type TestDb } from "./helpers";

let db: TestDb;
let v: MiniVenue; // the event that gets purged
let other: MiniVenue; // an unrelated live event that must be untouched
let alertCredentialId: string;

beforeAll(async () => {
  db = await createTestDb();
  v = await miniVenue(db);
  other = await miniVenue(db);

  const vip = await attendeeWithCredential(db, v.eventId, "VIP");
  const ord = await attendeeWithCredential(db, v.eventId, "ORDINARY");
  const pub = await attendeeWithCredential(db, v.eventId, "PUBLIC");
  alertCredentialId = pub.credentialId;
  // 10:00 minute: 3 reads at A-in (2 admitted, 1 denied). 10:01: VIP to B (implied exit from A).
  await scan(db, v, v.cpAin, vip.ephemeralId, "admitted", "2026-12-01T10:00:05Z");
  await scan(db, v, v.cpAin, ord.ephemeralId, "admitted", "2026-12-01T10:00:20Z");
  await scan(db, v, v.cpAin, pub.ephemeralId, "denied_room", "2026-12-01T10:00:40Z");
  await scan(db, v, v.cpAin, vip.ephemeralId, "implied_exit", "2026-12-01T10:01:00Z");
  await scan(db, v, v.cpBin, vip.ephemeralId, "admitted", "2026-12-01T10:01:00Z");
  await scan(db, v, v.cpAin, null, "unknown_token", "2026-12-01T10:01:30Z");
  await db.insert(s.breach_alerts).values({
    event_id: v.eventId, severity: "high", kind: "unauthorised_tier", checkpoint_id: v.cpAin,
    credential_id: pub.credentialId, occurred_at: new Date("2026-12-01T10:00:40Z"), detail: "PUBLIC at Room A",
  });
  await db.update(s.registrations).set({ checked_in_at: new Date("2026-12-01T10:00:05Z") }).where(eq(s.registrations.id, vip.registrationId));
  await db.insert(s.audit_log).values({ actor_id: null, action: "credential.lookup", target: `credential:${pub.credentialId}` });

  const o = await attendeeWithCredential(db, other.eventId);
  await scan(db, other, other.cpAin, o.ephemeralId, "admitted", "2026-12-01T10:00:00Z");
});

describe("rollups", () => {
  it("rebuild gate rates per minute with tier breakdown, excluding system implied exits", async () => {
    await rebuildEventRollups(db, v.eventId);
    const rows = await db.select().from(s.gate_rate_rollups).where(eq(s.gate_rate_rollups.event_id, v.eventId));
    const aMin0 = rows.find((r) => r.checkpoint_id === v.cpAin && r.minute_start.toISOString() === "2026-12-01T10:00:00.000Z")!;
    expect([aMin0.scans, aMin0.admitted, aMin0.denied]).toEqual([3, 2, 1]);
    expect(aMin0.by_tier_jsonb).toEqual({ VIP: 1, ORDINARY: 1, PUBLIC: 1 });
    const aMin1 = rows.find((r) => r.checkpoint_id === v.cpAin && r.minute_start.toISOString() === "2026-12-01T10:01:00.000Z")!;
    expect([aMin1.scans, aMin1.admitted, aMin1.denied]).toEqual([1, 0, 1]); // implied exit not counted
    expect(aMin1.by_tier_jsonb).toEqual({ UNKNOWN: 1 });
  });

  it("rebuild occupancy buckets with in/out counts and peak", async () => {
    const rows = await db.select().from(s.occupancy_rollups).where(eq(s.occupancy_rollups.event_id, v.eventId));
    const a = rows.find((r) => r.room_id === v.roomA)!;
    const b = rows.find((r) => r.room_id === v.roomB)!;
    expect(a.bucket_start.toISOString()).toBe("2026-12-01T10:00:00.000Z");
    expect([a.in_count, a.out_count, a.peak]).toEqual([2, 1, 2]);
    expect([b.in_count, b.out_count, b.peak]).toEqual([1, 0, 1]);
  });

  it("snapshot attendance by tier", async () => {
    const snap = await takeAttendanceSnapshot(db, v.eventId);
    expect([snap.registered, snap.checked_in]).toEqual([3, 1]);
    expect(snap.by_tier_jsonb.VIP).toEqual({ registered: 1, checked_in: 1, on_site: 0 });
  });
});

describe("purge_event_movement_data", () => {
  it("refuses a live event and an event inside its grace period", async () => {
    await rejects(purgeEventMovementData(db, v.eventId), /only closed or archived events can be purged/);
    await q(db, `update events set state = 'closed' where id = $1`, [v.eventId]);
    await rejects(purgeEventMovementData(db, v.eventId), /inside its grace period/);
  });

  it("drops the scan partition and the ephemeral mapping, keeps aggregates, alerts and audit", async () => {
    // Grace period over: closed 73 h ago (default grace 72 h).
    await q(db, `update events set closed_at = now() - interval '73 hours' where id = $1`, [v.eventId]);
    const before = await q<{ n: number }>(db, `select count(*)::int n from scans where event_id = $1`, [v.eventId]);
    expect(before[0]!.n).toBe(6);

    const res = await purgeEventMovementData(db, v.eventId);
    expect(res).toEqual({ scans_dropped: 6, ephemeral_ids_deleted: 3 });

    // Partition is gone (dropped, not emptied).
    const part = await q<{ r: string | null }>(db, `select to_regclass('public.scans_' || replace($1::text, '-', ''))::text r`, [v.eventId]);
    expect(part[0]!.r).toBeNull();
    expect((await q<{ n: number }>(db, `select count(*)::int n from scans where event_id = $1`, [v.eventId]))[0]!.n).toBe(0);
    const eph = await withVaultScope(db, "system", (tx) =>
      tx.select().from(s.ephemeral_ids).where(eq(s.ephemeral_ids.event_id, v.eventId)),
    );
    expect(eph).toHaveLength(0);

    // Kept.
    expect((await db.select().from(s.occupancy_rollups).where(eq(s.occupancy_rollups.event_id, v.eventId))).length).toBeGreaterThan(0);
    expect((await db.select().from(s.gate_rate_rollups).where(eq(s.gate_rate_rollups.event_id, v.eventId))).length).toBeGreaterThan(0);
    expect((await db.select().from(s.attendance_snapshots).where(eq(s.attendance_snapshots.event_id, v.eventId))).length).toBe(1);
    const alerts = await db.select().from(s.breach_alerts).where(eq(s.breach_alerts.event_id, v.eventId));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.credential_id).toBe(alertCredentialId); // O-11
    const purgeAudit = await db.select().from(s.audit_log).where(eq(s.audit_log.action, "event.purge"));
    expect(purgeAudit).toHaveLength(1);
    expect(purgeAudit[0]!.meta_jsonb).toEqual({ scans_dropped: 6, ephemeral_ids_deleted: 3, forced: false });
    expect(await auditVerify(db)).toEqual([]);
    const [ev] = await db.select().from(s.events).where(eq(s.events.id, v.eventId));
    expect(ev!.purged_at).toBeInstanceOf(Date);
    // Registrations and credentials survive (identity records follow their own policy).
    expect((await db.select().from(s.registrations).where(eq(s.registrations.event_id, v.eventId))).length).toBe(3);

    // Occupancy is now all zeros for that event.
    expect((await roomOccupancy(db, v.eventId)).every((r) => r.occupancy === 0)).toBe(true);
  });

  it("leaves other events untouched", async () => {
    expect((await q<{ n: number }>(db, `select count(*)::int n from scans where event_id = $1`, [other.eventId]))[0]!.n).toBe(1);
    const eph = await withVaultScope(db, "system", (tx) =>
      tx.select().from(s.ephemeral_ids).where(eq(s.ephemeral_ids.event_id, other.eventId)),
    );
    expect(eph).toHaveLength(1);
  });

  it("is idempotent and blocks late scans, partition re-creation and rollup rebuilds afterwards", async () => {
    expect(await purgeEventMovementData(db, v.eventId)).toEqual({ scans_dropped: 0, ephemeral_ids_deleted: 0 });
    await rejects(scan(db, v, v.cpAin, null, "unknown_token", "2026-12-01T10:05:00Z"), /no partition/);
    await rejects(q(db, `select create_scan_partition($1)`, [v.eventId]), /has been purged/);
    await rejects(rebuildEventRollups(db, v.eventId), /has been purged/);
    await rejects(q(db, `update events set purged_at = null where id = $1`, [v.eventId]), /purged_at cannot be changed/);
  });

  it("can be forced inside the grace period", async () => {
    const e = await miniVenue(db);
    const p = await attendeeWithCredential(db, e.eventId);
    await scan(db, e, e.cpAin, p.ephemeralId, "admitted", "2026-12-01T10:00:00Z");
    await q(db, `update events set state = 'closed' where id = $1`, [e.eventId]);
    expect(await purgeEventMovementData(db, e.eventId, { force: true })).toEqual({ scans_dropped: 1, ephemeral_ids_deleted: 1 });
  });
});
