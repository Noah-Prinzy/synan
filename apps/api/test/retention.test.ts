/**
 * Retention (03 §6, D-03): the daily audit and alert prunes. Entries older than 12 months go, the
 * audit chain still verifies afterwards (and keeps verifying as new entries are appended), and each
 * prune that removed something is itself audited.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { entryHash } from "../src/domain/audit.js";
import { JOB } from "../src/jobs.js";
import type { MemoryTables } from "../src/repo/memory.js";
import { sqlAsOwner, startHarness, type Harness } from "./helpers.js";

const MONTH = 30 * 24 * 3600_000;

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
  await h.app.ctx.jobs.stop(); // run the jobs by hand
});
afterAll(async () => h.close());


/**
 * Age the oldest `n` audit entries to 13 months and re-hash the chain consistently, as if the store
 * had simply been running that long (SQL: the same approach as @synan/db's own retention test).
 */
async function ageOldest(n: number) {
  if (h.app.ctx.repos.kind === "memory") {
    const t = (h.app.ctx.repos as unknown as { tables: MemoryTables }).tables;
    const old = new Date(h.clock.now() - 13 * MONTH);
    let prev = t.auditHead.prunedAnchor;
    t.audit.forEach((r, i) => {
      if (i < n) r.at = old;
      r.prev_hash = prev;
      r.hash = entryHash(prev, r);
      prev = r.hash;
    });
    t.auditHead.lastHash = prev;
    return;
  }
  await sqlAsOwner(h, `
    set session_replication_role = replica;
    update audit_log set at = now() - interval '13 months' where id in (select id from audit_log order by id limit ${n});
    do $$
    declare r record; prev text := coalesce((select pruned_anchor_hash from audit_chain_head), repeat('0', 64));
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
}

describe("audit retention (03 §6)", () => {
  it("the daily job deletes entries older than 12 months; the chain verifies before, after and on later appends", async () => {
    const { repos, audit } = h.app.ctx;
    for (let i = 0; i < 3; i++) await audit.append({ actorId: null, action: "test.old", target: `t:${i}`, meta: { i } });
    const all = await repos.audit.all();
    const oldCount = all.length; // the seed's entries and the three above
    await audit.append({ actorId: null, action: "test.recent", target: "t:recent" });
    await ageOldest(oldCount);
    expect(await repos.audit.verify()).toBe(-1);

    await h.app.ctx.jobs.runNow(JOB.auditPrune);
    const left = await repos.audit.all();
    expect(left.some((r) => r.action === "test.old")).toBe(false);
    expect(left.map((r) => r.action)).toEqual(["test.recent", "retention.audit_pruned"]);
    expect(left[1]!.meta_jsonb).toMatchObject({ deleted: oldCount, months: 12 });
    expect(await repos.audit.verify()).toBe(-1);

    // Nothing more to prune; appending continues the chain from the pruned anchor.
    expect(await repos.audit.prune(new Date(h.clock.now()))).toBe(0);
    await audit.append({ actorId: null, action: "test.after", target: "t:after" });
    expect(await repos.audit.verify()).toBe(-1);
    await h.app.ctx.jobs.runNow(JOB.auditPrune);
    expect((await repos.audit.all()).filter((r) => r.action === "retention.audit_pruned")).toHaveLength(1); // a no-op prune is not audited
  });

  it("tampering after a prune is still detected", async () => {
    const { repos } = h.app.ctx;
    if (repos.kind !== "memory") return; // SQL tampering is covered by @synan/db's audit tests
    const t = (repos as unknown as { tables: MemoryTables }).tables;
    const saved = structuredClone(t.audit);
    t.audit[0]!.target = "t:forged";
    expect(await repos.audit.verify()).toBe(0);
    t.audit = structuredClone(saved);
    t.audit.pop(); // trailing entry removed
    expect(await repos.audit.verify()).not.toBe(-1);
    t.audit = saved;
    expect(await repos.audit.verify()).toBe(-1);
  });
});

describe("alert retention (03 §6)", () => {
  it("the same daily job deletes alerts that occurred more than 12 months ago, keeps newer ones, and audits the run", async () => {
    const { repos } = h.app.ctx;
    const base = {
      event_id: h.seed.eventId, severity: "high" as const, kind: "rogue_scanner" as const, checkpoint_id: null, room_id: null, credential_id: null,
      state: "open" as const, acked_by: null, acked_at: null, resolved_by: null, resolved_at: null, resolution_note: null, scan_ids: [], detail: "retention test",
    };
    const oldId = randomUUID();
    const recentId = randomUUID();
    const now = h.clock.now();
    await repos.alerts.insert({ ...base, id: oldId, occurred_at: new Date(now - 13 * MONTH) });
    await repos.alerts.insert({ ...base, id: recentId, occurred_at: new Date(now - 11 * MONTH) });

    await h.app.ctx.jobs.runNow(JOB.auditPrune);
    expect(await repos.alerts.byId(oldId)).toBeNull();
    expect(await repos.alerts.byId(recentId)).not.toBeNull();
    const entries = (await repos.audit.all()).filter((r) => r.action === "retention.alerts_pruned");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.meta_jsonb).toMatchObject({ deleted: 1, months: 12 });
    expect(await repos.audit.verify()).toBe(-1);
    // Shorter than the policy is refused on both backends.
    await expect(repos.alerts.prune({ olderThanMonths: 6, now: new Date(now) })).rejects.toThrow();
  });
});
