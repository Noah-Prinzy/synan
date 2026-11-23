import { createHash } from "node:crypto";
import { asc } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { alertsPrune, auditPrune, auditVerify } from "../src/functions";
import * as s from "../src/schema/index";
import { createWebhookEndpoint, enqueueWebhookEvent } from "../src/webhooks";
import { attendeeWithCredential, devCipher, miniVenue } from "./fixtures";
import { createTestDb, q, rejects, type TestDb } from "./helpers";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

const entries = () => db.select().from(s.audit_log).orderBy(asc(s.audit_log.id));

/** Bypasses triggers (as a superuser or a compromised DBA would) to simulate tampering. */
async function asTamperer<T>(fn: () => Promise<T>): Promise<T> {
  await q(db, `set session_replication_role = replica`);
  try {
    return await fn();
  } finally {
    await q(db, `set session_replication_role = origin`);
  }
}

describe("audit_log hash chain", () => {
  it("links each entry to the previous one and assigns id, at and hashes itself", async () => {
    for (const [i, action] of ["tier.override", "credential.revoke", "band.rebind", "rules.republish"].entries()) {
      await db.insert(s.audit_log).values({
        actor_id: "00000000-0000-4000-8000-000000000001",
        action,
        target: `thing:${i}`,
        meta_jsonb: { i, note: "ünïcode ✓", nested: { b: 2, a: 1 } },
        // Caller-supplied `at` and ids are ignored: the database stamps them.
        at: new Date("1999-01-01T00:00:00Z"),
      });
    }
    const rows = await entries();
    expect(rows).toHaveLength(4);
    expect(rows[0]!.prev_hash).toBe("0".repeat(64));
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.prev_hash).toBe(rows[i - 1]!.hash);
    expect(rows.every((r) => r.at.getUTCFullYear() >= 2026)).toBe(true);
    expect(await auditVerify(db)).toEqual([]);
  });

  it("uses a hash that can be recomputed outside the database", async () => {
    const [r] = await entries();
    const epochUs = BigInt(r!.at.getTime()) * 1000n; // at has µs precision; JS Date has ms
    const raw = await q<{ us: string }>(db, `select (extract(epoch from at) * 1000000)::bigint::text us from audit_log where id = $1`, [r!.id]);
    expect(BigInt(raw[0]!.us) / 1000n).toBe(epochUs / 1000n);
    const canon = await q<{ j: string }>(
      db,
      `select jsonb_build_array(id, actor_id, action, target, meta_jsonb, (extract(epoch from at) * 1000000)::bigint)::text j from audit_log where id = $1`,
      [r!.id],
    );
    const h = createHash("sha256").update(r!.prev_hash + canon[0]!.j, "utf8").digest("hex");
    expect(h).toBe(r!.hash);
  });

  it("is append-only: UPDATE, DELETE and TRUNCATE are rejected", async () => {
    await rejects(q(db, `update audit_log set action = 'x'`), /append-only/);
    await rejects(q(db, `delete from audit_log`), /append-only/);
    await rejects(q(db, `truncate audit_log`), /append-only/);
    // The retention switch does not unlock recent entries.
    await rejects(
      db.$client.transaction(async (tx) => {
        await tx.query(`select set_config('app.audit_prune', 'on', true)`);
        await tx.query(`delete from audit_log`);
      }),
      /append-only/,
    );
    expect(await entries()).toHaveLength(4);
    expect(await auditVerify(db)).toEqual([]);
  });

  it("detects an altered entry", async () => {
    const rows = await entries();
    await asTamperer(() => q(db, `update audit_log set meta_jsonb = '{"i":1,"note":"edited"}' where id = $1`, [rows[1]!.id]));
    const problems = await auditVerify(db);
    expect(problems).toEqual([{ entry_id: rows[1]!.id, problem: expect.stringMatching(/altered/) }]);
    // Restore for the next tests.
    await asTamperer(() =>
      q(db, `update audit_log set meta_jsonb = $1 where id = $2`, [JSON.stringify(rows[1]!.meta_jsonb), rows[1]!.id]),
    );
    expect(await auditVerify(db)).toEqual([]);
  });

  it("detects a re-hashed alteration (attacker recomputes that entry's hash) via the next link", async () => {
    const rows = await entries();
    await asTamperer(() =>
      q(
        db,
        `update audit_log set target = 'thing:forged',
           hash = audit_entry_hash(prev_hash, id, actor_id, action, 'thing:forged', meta_jsonb, at) where id = $1`,
        [rows[1]!.id],
      ),
    );
    const problems = await auditVerify(db);
    expect(problems.map((p) => p.entry_id)).toEqual([rows[2]!.id]);
    expect(problems[0]!.problem).toMatch(/prev_hash/);
    await asTamperer(() =>
      q(db, `update audit_log set target = $1, hash = $2 where id = $3`, [rows[1]!.target, rows[1]!.hash, rows[1]!.id]),
    );
    expect(await auditVerify(db)).toEqual([]);
  });

  it("detects a removed entry in the middle and at the end", async () => {
    const rows = await entries();
    await asTamperer(() => q(db, `delete from audit_log where id = $1`, [rows[1]!.id]));
    expect((await auditVerify(db)).map((p) => p.entry_id)).toEqual([rows[2]!.id]);
    await asTamperer(() => q(db, `delete from audit_log where id = $1`, [rows[3]!.id]));
    const problems = await auditVerify(db);
    expect(problems.some((p) => /chain head/.test(p.problem))).toBe(true);
  });
});

describe("audit retention prune", () => {
  it("deletes only entries older than 12 months and keeps the remainder verifiable", async () => {
    const fresh = await createTestDb();
    for (let i = 0; i < 5; i++) await fresh.insert(s.audit_log).values({ action: "x", target: `t:${i}` });
    // Age the first three entries to 13 months and re-hash the chain consistently, as if the
    // database had simply been running that long.
    await fresh.$client.exec(`
      set session_replication_role = replica;
      update audit_log set at = now() - interval '13 months' where id in (select id from audit_log order by id limit 3);
      do $$
      declare r record; prev text := repeat('0', 64);
      begin
        for r in select * from audit_log order by id loop
          update audit_log set prev_hash = prev,
            hash = audit_entry_hash(prev, r.id, r.actor_id, r.action, r.target, r.meta_jsonb, r.at) where id = r.id
          returning hash into prev;
        end loop;
        update audit_chain_head set last_hash = prev;
      end $$;
      set session_replication_role = origin;
    `);
    expect(await auditVerify(fresh)).toEqual([]);
    expect(await auditPrune(fresh)).toBe(3);
    const left = await fresh.select().from(s.audit_log);
    expect(left.map((r) => r.target).sort()).toEqual(["t:3", "t:4"]);
    expect(await auditVerify(fresh)).toEqual([]);
    expect(await auditPrune(fresh)).toBe(0);
    await fresh.insert(s.audit_log).values({ action: "y", target: "t:5" });
    expect(await auditVerify(fresh)).toEqual([]);
  });

  it("the anchor makes a pruned chain verifiable, and tampering with what remains is still caught", async () => {
    const fresh = await createTestDb();
    for (let i = 0; i < 4; i++) await fresh.insert(s.audit_log).values({ action: "x", target: `t:${i}` });
    await fresh.$client.exec(`
      set session_replication_role = replica;
      update audit_log set at = now() - interval '13 months' where id in (select id from audit_log order by id limit 2);
      do $$
      declare r record; prev text := repeat('0', 64);
      begin
        for r in select * from audit_log order by id loop
          update audit_log set prev_hash = prev,
            hash = audit_entry_hash(prev, r.id, r.actor_id, r.action, r.target, r.meta_jsonb, r.at) where id = r.id
          returning hash into prev;
        end loop;
        update audit_chain_head set last_hash = prev;
      end $$;
      set session_replication_role = origin;
    `);
    const before = await fresh.select().from(s.audit_log).orderBy(asc(s.audit_log.id));
    expect(await auditPrune(fresh)).toBe(2);
    const [head] = await q<{ pruned_through_id: string; pruned_anchor_hash: string }>(fresh, `select pruned_through_id, pruned_anchor_hash from audit_chain_head`);
    // The anchor is the hash of the last pruned entry; pruned_through_id is the cutoff (ids may have gaps).
    expect(head!.pruned_anchor_hash).toBe(before[1]!.hash);
    expect(Number(head!.pruned_through_id)).toBeGreaterThanOrEqual(before[1]!.id);
    expect(Number(head!.pruned_through_id)).toBeLessThan(before[2]!.id);
    expect(await auditVerify(fresh)).toEqual([]);
    // Removing the first surviving entry is detected against the anchor.
    await fresh.$client.exec(`set session_replication_role = replica; delete from audit_log where id = ${before[2]!.id}; set session_replication_role = origin;`);
    expect((await auditVerify(fresh)).map((p) => p.entry_id)).toEqual([before[3]!.id]);
    await fresh.$client.close();
  });
});

describe("breach-alert retention prune (alertsPrune)", () => {
  const NOW = new Date("2027-12-15T00:00:00Z");
  const alert = (f: TestDb, eventId: string, occurred_at: Date, credential_id?: string) =>
    f.insert(s.breach_alerts).values({ event_id: eventId, severity: "high", kind: "pass_replayed", occurred_at, credential_id: credential_id ?? null }).returning({ id: s.breach_alerts.id }).then((r) => r[0]!.id);

  it("deletes alerts older than 12 months with their finished webhook deliveries, keeps the rest, and audits the run", async () => {
    const f = await createTestDb();
    const v = await miniVenue(f);
    const who = await attendeeWithCredential(f, v.eventId);
    const old1 = await alert(f, v.eventId, new Date("2026-12-01T10:00:00Z"), who.credentialId);
    const old2 = await alert(f, v.eventId, new Date("2026-12-14T23:59:59Z"));
    const edge = await alert(f, v.eventId, new Date("2026-12-15T00:00:00Z")); // exactly 12 months: kept
    const recent = await alert(f, v.eventId, new Date("2027-11-01T00:00:00Z"));
    const pending = await alert(f, v.eventId, new Date("2026-12-02T00:00:00Z"));
    await createWebhookEndpoint(f, devCipher, { orgId: v.orgId, url: "https://hooks.example.test/x", events: ["*"] });
    for (const a of [old1, pending, recent]) await enqueueWebhookEvent(f, { orgId: v.orgId, event: "alert.raised", payload: { alert_id: a }, alertId: a });
    await q(f, `update webhook_deliveries set state = 'succeeded' where alert_id = $1`, [old1]);
    await q(f, `update webhook_deliveries set state = 'dead' where alert_id = $1`, [recent]);

    expect(await alertsPrune(f, { now: NOW })).toBe(2);
    const left = (await f.select({ id: s.breach_alerts.id }).from(s.breach_alerts)).map((x) => x.id).sort();
    expect(left).toEqual([edge, recent, pending].sort()); // pending still has a delivery to send
    const deliveries = await q<{ alert_id: string }>(f, `select alert_id from webhook_deliveries order by alert_id`);
    expect(deliveries.map((x) => x.alert_id).sort()).toEqual([pending, recent].sort());

    const [entry] = await q<{ action: string; target: string; meta_jsonb: Record<string, unknown> }>(
      f, `select action, target, meta_jsonb from audit_log where action = 'retention.alerts_pruned'`,
    );
    expect(entry).toMatchObject({ target: "breach_alerts", meta_jsonb: { deleted: 2, webhook_deliveries: 1, months: 12 } });
    expect(new Date(String(entry!.meta_jsonb.occurred_before))).toEqual(new Date("2026-12-15T00:00:00Z"));
    expect(await auditVerify(f)).toEqual([]);

    // The delivery finishes; the next run takes that alert. Nothing left to do → 0 and no audit entry.
    await q(f, `update webhook_deliveries set state = 'dead' where alert_id = $1`, [pending]);
    expect(await alertsPrune(f, { now: NOW })).toBe(1);
    expect(await alertsPrune(f, { now: NOW })).toBe(0);
    expect(await q(f, `select 1 from audit_log where action = 'retention.alerts_pruned'`)).toHaveLength(2);
    // A longer retention keeps more; a shorter one than 12 months is refused.
    expect(await alertsPrune(f, { olderThanMonths: 24, now: new Date("2029-01-01T00:00:00Z") })).toBe(1);
    expect(await alertsPrune(f, { olderThanMonths: 13, now: new Date("2029-01-01T00:00:00Z") })).toBe(1);
    await rejects(alertsPrune(f, { olderThanMonths: 11, now: NOW }), /kept at least 12 months/);
    await f.$client.close();
  });

  it("is executable by app_api (the job workers' role) but not by PUBLIC", async () => {
    const r = await q<{ api: boolean; pub: boolean; vault: boolean }>(
      db,
      `select has_function_privilege('app_api', 'public.alerts_prune(integer, timestamptz)', 'EXECUTE') as api,
              has_function_privilege('public', 'public.alerts_prune(integer, timestamptz)', 'EXECUTE') as pub,
              has_function_privilege('app_vault', 'public.alerts_prune(integer, timestamptz)', 'EXECUTE') as vault`,
    );
    expect(r[0]).toEqual({ api: true, pub: false, vault: false });
    const v = await miniVenue(db);
    await alert(db, v.eventId, new Date("2020-01-01T00:00:00Z"));
    await q(db, "set role app_api");
    try {
      expect(await alertsPrune(db)).toBeGreaterThanOrEqual(1);
      expect(await auditPrune(db)).toBe(0);
    } finally {
      await q(db, "reset role");
    }
  });
});
