import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { withVaultScope } from "../src/client";
import { auditVerify, purgeEventMovementData, roomOccupancy } from "../src/functions";
import * as s from "../src/schema/index";
import { seed, type SeedSummary } from "../src/seed/index";
import { createTestDb, q, rejects, type TestDb } from "./helpers";

let db: TestDb;
let summary: SeedSummary;
// Real time: the purge compares against the database clock (now()), so the dataset must be built
// around the actual present for the closed event to be past its grace period.
const NOW = new Date();

beforeAll(async () => {
  db = await createTestDb();
  const t0 = Date.now();
  summary = await seed(db, { now: NOW });
  console.log(`seed took ${Date.now() - t0} ms`, summary.counts);
}, 300_000);

describe("seed", () => {
  it("matches the docs/02 §8 scale direction", () => {
    const c = summary.counts;
    expect(c.venues).toBe(2);
    expect(c.rooms).toBe(60);
    expect(c["pii_vault.attendees"]).toBe(1400);
    expect(c.events).toBe(3);
    expect(c.scans).toBeGreaterThan(5000);
    expect(c.checkpoints).toBe(78);
  });

  it("covers all four tiers, with Public attendees carrying no personal data", async () => {
    const tiers = await q<{ tier: string; n: number }>(db, `select tier::text, count(*)::int n from registrations group by 1 order by 1`);
    expect(tiers.map((t) => t.tier).sort()).toEqual(["ORDINARY", "PRIVATE_INVITE", "PUBLIC", "VIP"]);
    const leaks = await withVaultScope(db, "system", async (tx) => {
      const r = await tx.execute(
        sql`select count(*)::int n from pii_vault.attendees a join registrations r on r.attendee_id = a.id
             where r.tier = 'PUBLIC' and (a.email is not null or a.full_name is not null)`,
      );
      return (r as unknown as { rows: { n: number }[] }).rows[0]!.n;
    });
    expect(leaks).toBe(0);
  });

  it("creates one scan partition per event and covers the result vocabulary", async () => {
    const parts = await q<{ n: number }>(db, `select count(*)::int n from pg_inherits where inhparent = 'public.scans'::regclass`);
    expect(parts[0]!.n).toBe(3);
    const results = await q<{ result: string }>(db, `select distinct result::text from scans order by 1`);
    expect(results.map((r) => r.result)).toEqual(
      expect.arrayContaining(["admitted", "implied_exit", "denied_room", "unknown_token", "duplicate_read", "revoked", "suspended", "wristband_required"]),
    );
    const offline = await q<{ n: number }>(db, `select count(*)::int n from scans where offline_bool and clock_offset_ms = 95000`);
    expect(offline[0]!.n).toBeGreaterThan(0);
  });

  it("produces sane live occupancy (no negatives, every room of the event)", async () => {
    const t0 = performance.now();
    const occ = await roomOccupancy(db, summary.events.live, NOW);
    console.log(`room_occupancy over ${summary.counts.scans} scans: ${(performance.now() - t0).toFixed(1)} ms (PGlite/WASM)`);
    expect(occ).toHaveLength(36);
    expect(occ.every((r) => r.occupancy >= 0)).toBe(true);
    expect(occ.reduce((a, r) => a + r.occupancy, 0)).toBeGreaterThan(50);
    expect(occ.filter((r) => r.reconciliation_fault).length).toBeLessThanOrEqual(1);
  });

  it("leaves an intact audit chain and rollups for both events with scans", async () => {
    expect(await auditVerify(db)).toEqual([]);
    const g = await q<{ event_id: string }>(db, `select distinct event_id::text from gate_rate_rollups`);
    expect(g.map((x) => x.event_id).sort()).toEqual([summary.events.live, summary.events.closed].sort());
  });

  it("leaves the closed event purgeable", async () => {
    const res = await purgeEventMovementData(db, summary.events.closed);
    expect(res.scans_dropped).toBeGreaterThan(500);
    expect(res.ephemeral_ids_deleted).toBeGreaterThan(200);
    expect(await auditVerify(db)).toEqual([]);
  });

  it("fills venues.city and signing_keys.qr_kid", async () => {
    const v = await q<{ city: string | null }>(db, `select city from venues order by city`);
    expect(v.map((x) => x.city)).toEqual(["Bristol", "London"]);
    const k = await q<{ qr_kid: string }>(db, `select qr_kid from signing_keys`);
    expect(k.every((x) => /^[0-9a-f]{8}$/.test(x.qr_kid))).toBe(true);
  });

  it("refuses to run twice", async () => {
    await rejects(seed(db, { now: NOW }), /already has data/);
    void s;
  });
});
