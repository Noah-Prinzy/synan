/**
 * Jobs on pg-boss (D-17), for the PostgreSQL backend. This process is a worker: it works the queues
 * (as app_api) and sends `kick`s; the one maintenance process per deployment (createJobs mode
 * "maintenance", member of app_jobs) supervises and runs the cron schedules (scheduleDefaultJobs).
 * Handlers are the same idempotent functions the in-process runner uses.
 *
 * NOT VERIFIED: there is no PostgreSQL server on the development machine; this path typechecks but
 * has not run. The in-process runner is what the test suites exercise.
 */
import type { createJobs } from "@synan/db";
import type { JobDef, Jobs } from "./jobs.js";

type Boss = ReturnType<typeof createJobs>;

export class PgBossJobs implements Jobs {
  private defs = new Map<string, JobDef>();
  private started = false;

  constructor(private readonly boss: Boss) {}

  register(def: JobDef) {
    this.defs.set(def.name, def);
  }

  kick(name: string) {
    if (!this.started) return;
    // One pending kick per queue is enough: the handler drains everything that is due.
    void (this.boss as unknown as { send(n: string, d: object, o: object): Promise<unknown> })
      .send(name, {}, { singletonKey: name, singletonSeconds: 2 })
      .catch((e: unknown) => console.error(`[jobs] kick ${name} failed:`, e instanceof Error ? e.message : String(e)));
  }

  async runNow(name: string) {
    const d = this.defs.get(name);
    if (!d) throw new Error(`unknown job ${name}`);
    await d.run();
  }

  start() {
    if (this.started) return;
    this.started = true;
    const boss = this.boss as unknown as { start(): Promise<unknown>; work(n: string, f: () => Promise<unknown>): Promise<unknown>; on(e: string, f: (e: unknown) => void): void };
    boss.on("error", (e) => console.error("[jobs] pg-boss:", e instanceof Error ? e.message : String(e)));
    void boss
      .start()
      .then(async () => {
        for (const d of this.defs.values()) await boss.work(d.name, async () => void (await d.run()));
      })
      .catch((e: unknown) => console.error("[jobs] pg-boss start failed:", e instanceof Error ? e.message : String(e)));
  }

  async stop() {
    this.started = false;
    await (this.boss as unknown as { stop(o: object): Promise<unknown> }).stop({ graceful: true, wait: true });
  }
}
