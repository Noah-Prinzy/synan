import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  claimReport,
  completeReport,
  createJobs,
  enqueueInTransaction,
  failReport,
  installJobSchema,
  JOB_QUEUES,
  listReports,
  requestReport,
} from "../src/jobs";
import { reencryptSecrets } from "../src/secrets";
import * as s from "../src/schema/index";
import {
  claimWebhookDeliveries,
  createWebhookEndpoint,
  enqueueWebhookEvent,
  listWebhookDeliveries,
  readWebhookSecret,
  recordWebhookAttempt,
  rotateWebhookSecret,
  signWebhookBody,
} from "../src/webhooks";
import { devCipher, miniVenue, type MiniVenue } from "./fixtures";
import { createTestDb, jobTarget, q, rejects, type TestDb } from "./helpers";

let db: TestDb;
let v: MiniVenue;
const T0 = new Date("2026-12-01T09:00:00Z");
const at = (s: number) => new Date(T0.getTime() + s * 1000);

beforeAll(async () => {
  db = await createTestDb();
  v = await miniVenue(db);
});
afterAll(async () => {
  await q(db, "reset role");
});

describe("pg-boss under the roles", () => {
  it("installs as the owner, creates every queue, and hands the schema to app_jobs", async () => {
    await installJobSchema(jobTarget(db, "owner"));
    await installJobSchema(jobTarget(db, "owner")); // idempotent
    const queues = await q<{ name: string }>(db, `select name from pgboss.queue order by 1`);
    expect(queues.map((x) => x.name)).toEqual(Object.values(JOB_QUEUES).sort());
    const owners = await q<{ owner: string; n: number }>(
      db,
      `select pg_get_userbyid(c.relowner) owner, count(*)::int n from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'pgboss' and c.relkind in ('r','p') group by 1`,
    );
    expect(owners.map((o) => o.owner)).toEqual(["app_jobs"]);
  });

  it("lets app_api send (also inside its own transaction), fetch and complete — and nothing more", async () => {
    await q(db, "set role app_api");
    const boss = createJobs(jobTarget(db, "app_api"));
    boss.on("error", () => undefined);
    await boss.start();
    try {
      const id = await boss.send(JOB_QUEUES.reportExport, { report_id: "r1" });
      expect(id).toBeTruthy();
      // Transactional enqueue: rolled back with the transaction, kept when it commits.
      await rejects(
        db.transaction(async (tx) => {
          await enqueueInTransaction(boss, tx, JOB_QUEUES.email, { to: "rolled-back" });
          throw new Error("boom");
        }),
        /boom/,
      );
      await db.transaction(async (tx) => {
        await enqueueInTransaction(boss, tx, JOB_QUEUES.email, { to: "kept" });
      });
      const mail = await boss.fetch<{ to: string }>(JOB_QUEUES.email, { batchSize: 10 });
      expect(mail.map((j) => j.data.to)).toEqual(["kept"]);
      await boss.complete(JOB_QUEUES.email, mail[0]!.id);
      const jobs = await boss.fetch(JOB_QUEUES.reportExport);
      expect(jobs).toHaveLength(1);
      await boss.fail(JOB_QUEUES.reportExport, jobs[0]!.id, { reason: "test" });
      // No DDL for the application role.
      await rejects(q(db, `create table pgboss.intruder (x int)`), /permission denied/);
      await rejects(q(db, `drop table pgboss.queue`), /must be owner|permission denied/);
    } finally {
      await boss.stop({ graceful: false, wait: true } as never);
      await q(db, "reset role");
    }
  });

  it("lets app_jobs run maintenance (supervision)", async () => {
    await q(db, "set role app_jobs");
    const boss = createJobs({ ...jobTarget(db, "app_jobs"), mode: "maintenance" });
    const errors: string[] = [];
    boss.on("error", (e) => errors.push((e as Error).message));
    await boss.start();
    try {
      await boss.supervise();
      expect(errors).toEqual([]);
    } finally {
      await boss.stop({ graceful: false, wait: true } as never);
      await q(db, "reset role");
    }
  });
});

describe("report jobs", () => {
  it("queued → running (claimed once) → ready / failed, listed newest first", async () => {
    const a = await requestReport(db, { eventId: v.eventId, kind: "attendance", params: { from: "2026-12-01" } });
    const b = await requestReport(db, { eventId: v.eventId, kind: "gate_throughput" });
    const first = (await claimReport(db))!;
    expect(first).toMatchObject({ id: a, state: "running", params_jsonb: { from: "2026-12-01" } });
    const second = (await claimReport(db))!;
    expect(second.id).toBe(b);
    expect(await claimReport(db)).toBeNull();
    expect(await completeReport(db, a, { objectKey: "reports/a.csv", summaryObjectKey: "reports/a.pdf" })).toBe(true);
    expect(await completeReport(db, a, { objectKey: "again" })).toBe(false);
    expect(await failReport(db, b, "out of memory")).toBe(true);
    const list = await listReports(db, { eventId: v.eventId });
    expect(list.total).toBe(2);
    expect(Object.fromEntries(list.items.map((r) => [r.kind, r.state]))).toEqual({ attendance: "ready", gate_throughput: "failed" });
  });
});

describe("webhooks", () => {
  it("store the signing secret encrypted, readable and rotatable through the cipher", async () => {
    const ep = await createWebhookEndpoint(db, devCipher, { orgId: v.orgId, url: "https://hooks.example.test/a", events: ["alert.raised"] });
    const [row] = await db.select().from(s.webhook_endpoints).where(eq(s.webhook_endpoints.id, ep.id));
    expect(row!.secret.startsWith("ev1.")).toBe(true);
    expect(row!.secret).not.toContain(ep.secret);
    expect(await readWebhookSecret(db, devCipher, ep.id)).toBe(ep.secret);
    const s2 = await rotateWebhookSecret(db, devCipher, ep.id);
    expect(await readWebhookSecret(db, devCipher, ep.id)).toBe(s2);
    await rejects(q(db, `update webhook_endpoints set secret = 'plain' where id = $1`, [ep.id]), /webhook_endpoints_secret_encrypted/);
    expect((await reencryptSecrets({ db, cipher: devCipher }))["webhook_endpoints.secret"]).toEqual({ updated: 0, raced: 0 });
    expect(signWebhookBody("k", "{}", new Date(1_700_000_000_000))).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
  });

  it("fan out to subscribed endpoints, lease, retry with backoff, and go dead after the last attempt", async () => {
    const org = (await miniVenue(db)).orgId;
    const a = await createWebhookEndpoint(db, devCipher, { orgId: org, url: "https://a.example.test", events: ["alert.raised"] });
    await createWebhookEndpoint(db, devCipher, { orgId: org, url: "https://b.example.test", events: ["*"] });
    await createWebhookEndpoint(db, devCipher, { orgId: org, url: "https://c.example.test", events: ["alert.resolved"] });
    await createWebhookEndpoint(db, devCipher, { orgId: org, url: "https://d.example.test", events: ["*"], active: false });
    expect(await enqueueWebhookEvent(db, { orgId: org, event: "alert.raised", payload: { id: "al1" }, now: T0 })).toBe(2);

    const claimed = await claimWebhookDeliveries(db, devCipher, { limit: 10, leaseSeconds: 60, now: T0 });
    expect(claimed.map((c) => c.url).sort()).toEqual(["https://a.example.test", "https://b.example.test"]);
    expect(claimed.find((c) => c.endpoint_id === a.id)!.secret).toBe(a.secret);
    expect(await claimWebhookDeliveries(db, devCipher, { now: at(30) })).toHaveLength(0); // leased
    const one = claimed.find((c) => c.endpoint_id === a.id)!;
    const two = claimed.find((c) => c.endpoint_id !== a.id)!;
    expect(await recordWebhookAttempt(db, { deliveryId: two.delivery_id, ok: true, responseCode: 204, durationMs: 40, now: at(1) })).toMatchObject({ state: "succeeded", attempt: 1 });

    const f1 = await recordWebhookAttempt(db, { deliveryId: one.delivery_id, ok: false, responseCode: 503, error: "unavailable", maxAttempts: 3, now: at(1) });
    expect(f1).toMatchObject({ state: "pending", attempt: 1 });
    expect(f1.next_attempt_at).toEqual(at(31));
    expect(await claimWebhookDeliveries(db, devCipher, { now: at(30) })).toHaveLength(0); // not due yet
    expect(await claimWebhookDeliveries(db, devCipher, { now: at(31) })).toHaveLength(1);
    const f2 = await recordWebhookAttempt(db, { deliveryId: one.delivery_id, ok: false, error: "timeout", maxAttempts: 3, now: at(32) });
    expect(f2.next_attempt_at).toEqual(at(92)); // 60 s
    // A worker that dies mid-send: the lease lapses and the delivery is claimed again.
    expect(await claimWebhookDeliveries(db, devCipher, { leaseSeconds: 10, now: at(92) })).toHaveLength(1);
    expect(await claimWebhookDeliveries(db, devCipher, { now: at(101) })).toHaveLength(0);
    expect(await claimWebhookDeliveries(db, devCipher, { now: at(103) })).toHaveLength(1);
    expect(await recordWebhookAttempt(db, { deliveryId: one.delivery_id, ok: false, responseCode: 500, maxAttempts: 3, now: at(104) })).toMatchObject({ state: "dead", attempt: 3 });

    const log = await listWebhookDeliveries(db, { endpointId: a.id });
    expect(log.items[0]).toMatchObject({ state: "dead", attempt: 3, response_code: 500 });
    expect((log.items[0]!.attempts_jsonb as unknown[]).length).toBe(3);
    void sql;
  });
});
