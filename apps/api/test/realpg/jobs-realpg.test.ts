/**
 * Job runner smoke test on a real PostgreSQL server (roadmap 5.1: "the job runner processes one job
 * of each queue"; queue a job, run it, schedule one). pg-boss needs several connections at once, so
 * PGlite cannot run this. It lives in test/realpg/, which only the realpg mode includes
 * (vitest.config.ts), and there it must run: without REAL_PG_ADMIN_URL it fails, it never skips.
 * Root `corepack pnpm test:realpg` (suite realpg-api) runs it with the rest of the API suite; alone:
 *
 *   corepack pnpm --filter @synan/api exec vitest run --mode realpg test/realpg/jobs-realpg.test.ts
 *
 * Beside it, test/realpg/jobs-effects-realpg.test.ts checks each job's effect through the app's own
 * wiring; this file is the runner's smoke test, with logins of its own.
 *
 * Like packages/db/test/real-postgres.test.ts, it creates a throwaway database and one LOGIN role per
 * pool (app_api, app_vault, app_scan, and app_jobs for the maintenance process), migrates as the
 * admin (which also installs pg-boss and hands it to app_jobs), and drops everything afterwards.
 *
 *  1. The API's pg-boss runner (PgBossJobs, as app_api) works one queued job of every queue, and a
 *     job enqueued inside a transaction exists only if the transaction commits.
 *  2. The maintenance process (createJobs mode "maintenance", as app_jobs) registers every default
 *     schedule, supervises, and a cron schedule fires a job that the worker runs.
 *  3. The API itself on REPO=postgres: its real handlers complete one job of every queue.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, createJobs, enqueueInTransaction, JOB_QUEUES, JOB_SCHEDULES, runMigrations, scheduleDefaultJobs, type Db } from "@synan/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, type RunningApp } from "../../src/app.js";
import { PgBossJobs } from "../../src/lib/pgboss-jobs.js";

const ADMIN = process.env.REAL_PG_ADMIN_URL;
// Included in the realpg mode only, where it must run: a missing server is a failure, not a skip.
if (!ADMIN) throw new Error("realpg mode: REAL_PG_ADMIN_URL is not set");
const suffix = randomBytes(4).toString("hex");
const dbName = `jobs_${suffix}`;
const logins = { api: `jobs_api_${suffix}`, vault: `jobs_vault_${suffix}`, scan: `jobs_scan_${suffix}`, jobs: `jobs_jobs_${suffix}` };
const password = randomBytes(12).toString("base64url");
const urlFor = (base: string, user?: string) => {
  const u = new URL(base);
  u.pathname = `/${dbName}`;
  if (user) {
    u.username = user;
    u.password = password;
  }
  return u.toString();
};
const QUEUES = Object.values(JOB_QUEUES);
type Boss = ReturnType<typeof createJobs>;

/** Polls until `done()` is true or the time is up; returns whether it became true. */
async function until(done: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await done()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return done();
}

async function stopBoss(b: Boss | undefined) {
  await b?.stop({ graceful: false, wait: true } as never).catch(() => undefined);
}

describe("job runner on real PostgreSQL (pg-boss)", () => {
  let admin: Db;
  let ownerUrl: string;

  beforeAll(async () => {
    admin = createDb(ADMIN!, { max: 1 });
    await admin.$client.query(`create database ${dbName}`);
    ownerUrl = urlFor(process.env.REAL_PG_MIGRATOR_URL ?? ADMIN!);
    await runMigrations(ownerUrl); // also installs pg-boss as the migrating role and hands it to app_jobs
    for (const [k, login] of Object.entries(logins)) {
      const role = k === "jobs" ? "app_jobs, app_api" : `app_${k}`;
      await admin.$client.query(`create role ${login} login password '${password}' in role ${role}`);
    }
  }, 300_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.$client.query(`drop database if exists ${dbName} with (force)`).catch(() => undefined);
    for (const login of Object.values(logins)) await admin.$client.query(`drop role if exists ${login}`).catch(() => undefined);
    await admin.$client.end();
  });

  it("the worker (app_api) runs one queued job of every queue, and a transactional enqueue only when committed", async () => {
    const seen = new Map<string, Record<string, unknown> | undefined>();
    const workerBoss = createJobs({ connectionString: urlFor(ADMIN!, logins.api) });
    const runner = new PgBossJobs(workerBoss);
    for (const q of QUEUES) runner.register({ name: q, run: async (data) => void seen.set(q, data) });
    runner.start();
    await workerBoss.start(); // resolves when the runner's own start has finished
    const sender = createJobs({ connectionString: urlFor(ADMIN!, logins.api) });
    sender.on("error", () => undefined);
    const apiDb = createDb(urlFor(ADMIN!, logins.api), { max: 2 });
    try {
      await sender.start();
      // Queued items (enqueue outside a unit of work), one per queue.
      for (const q of QUEUES) await runner.enqueue(q, { probe: q });
      const allRan = await until(() => QUEUES.every((q) => seen.get(q)?.probe === q), 60_000);
      expect(QUEUES.filter((q) => seen.get(q)?.probe !== q), "queues whose job did not run").toEqual([]);
      expect(allRan).toBe(true);

      // Transactional enqueue (enqueueInTransaction on node-postgres): rolled back → never runs; committed → runs.
      seen.delete(JOB_QUEUES.email);
      await expect(
        apiDb.transaction(async (tx) => {
          await enqueueInTransaction(sender, tx, JOB_QUEUES.email, { probe: "rolled-back" });
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      await apiDb.transaction(async (tx) => {
        await enqueueInTransaction(sender, tx, JOB_QUEUES.email, { probe: "committed" });
      });
      expect(await until(() => seen.get(JOB_QUEUES.email)?.probe === "committed", 30_000)).toBe(true);
      await new Promise((r) => setTimeout(r, 3_000)); // a rolled-back job would have been fetched by now
      expect(seen.get(JOB_QUEUES.email)?.probe).toBe("committed");
    } finally {
      await runner.stop();
      await stopBoss(sender);
      await apiDb.$client.end();
    }
  }, 180_000);

  it("the maintenance process (app_jobs) registers every schedule, supervises, and a cron schedule fires", async () => {
    const maint = createJobs({ connectionString: urlFor(ADMIN!, logins.jobs), mode: "maintenance" });
    const worker = createJobs({ connectionString: urlFor(ADMIN!, logins.api) });
    const errors: string[] = [];
    maint.on("error", (e) => errors.push(`maintenance: ${(e as Error).message}`));
    worker.on("error", (e) => errors.push(`worker: ${(e as Error).message}`));
    const fired: unknown[] = [];
    try {
      await maint.start();
      await worker.start();
      await scheduleDefaultJobs(maint);
      const schedules = await maint.getSchedules();
      for (const s of JOB_SCHEDULES) {
        expect(schedules.find((x) => x.name === s.queue && x.cron === s.cron), `schedule ${s.queue} ${s.cron}`).toBeTruthy();
      }
      await maint.supervise();

      // A schedule due every minute, on its own key so the default one on the queue stays as it is.
      const queue = JOB_QUEUES.invitationExpiry;
      await maint.schedule(queue, "* * * * *", { probe: "cron" }, { key: "ci-smoke" });
      await worker.work<{ probe?: string }>(queue, async (jobs) => {
        for (const j of jobs) if (j.data?.probe === "cron") fired.push(j.data);
      });
      // Next minute boundary + one cron pass (30 s by default) + polling: well under 150 s.
      expect(await until(() => fired.length > 0, 150_000), "the every-minute schedule did not fire within 150 s").toBe(true);
      await maint.unschedule(queue, "ci-smoke");
      expect(errors).toEqual([]);
    } finally {
      await stopBoss(worker);
      await stopBoss(maint);
    }
  }, 240_000);

  it("the API on REPO=postgres completes one job of every queue with its real handlers", async () => {
    const storage = mkdtempSync(join(tmpdir(), "synan-jobs-"));
    let app: RunningApp | undefined;
    const sender = createJobs({ connectionString: urlFor(ADMIN!, logins.api) });
    sender.on("error", () => undefined);
    try {
      app = await createApp({
        seed: false,
        config: {
          repo: "postgres",
          databaseUrl: urlFor(ADMIN!, logins.api),
          databaseVaultUrl: urlFor(ADMIN!, logins.vault),
          databaseScanUrl: urlFor(ADMIN!, logins.scan),
          reportStorageDir: storage,
        },
      });
      await sender.start();
      const ids = new Map<string, string>();
      for (const q of QUEUES) {
        const id = await sender.send(q, {});
        expect(id, `send ${q}`).toBeTruthy();
        ids.set(q, id!);
      }
      const state = async () => {
        const out = new Map<string, { state: string; output: unknown }>();
        for (const [q, id] of ids) {
          const j = await sender.getJobById(q, id);
          out.set(q, { state: String(j?.state), output: j?.output });
        }
        return out;
      };
      await until(async () => [...(await state()).values()].every((s) => s.state === "completed" || s.state === "failed"), 90_000);
      const final = await state();
      const notCompleted = [...final].filter(([, s]) => s.state !== "completed").map(([q, s]) => `${q}: ${s.state} ${JSON.stringify(s.output ?? null)}`);
      expect(notCompleted, "jobs not completed by the API's handlers").toEqual([]);
    } finally {
      await stopBoss(sender);
      await app?.close();
      rmSync(storage, { recursive: true, force: true });
    }
  }, 180_000);
});
