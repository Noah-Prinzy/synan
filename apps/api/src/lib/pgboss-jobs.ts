/**
 * Jobs on pg-boss (D-17), for the PostgreSQL backend. This process is a worker: it works the queues
 * (as app_api) and sends `kick`s; the one maintenance process per deployment (createJobs mode
 * "maintenance", member of app_jobs) supervises and runs the cron schedules (scheduleDefaultJobs).
 * Handlers are the same idempotent functions the in-process runner uses.
 *
 * NOT VERIFIED: there is no PostgreSQL server on the development machine; this path typechecks but
 * has not run. The in-process runner is what the test suites exercise.
 */
import { enqueueInTransaction, type createJobs, type JobQueue } from "@synan/db";
import type { TxScope } from "../repo/types.js";
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

  /**
   * One queued item. Inside a unit of work the job row is written in the caller's transaction
   * (enqueueInTransaction), so it exists only if the state change commits. Failed runs are retried
   * by pg-boss with exponential backoff; the handler's own attempt limit decides when an item is dead.
   */
  async enqueue(name: string, data: Record<string, unknown>, scope?: TxScope | null) {
    const options = { retryLimit: 6, retryDelay: 30, retryBackoff: true };
    if (scope?.handle) {
      await enqueueInTransaction(this.boss, scope.handle as never, name as JobQueue, data, options);
      return;
    }
    await (this.boss as unknown as { send(n: string, d: object, o: object): Promise<unknown> }).send(name, data, options);
  }

  async runNow(name: string) {
    const d = this.defs.get(name);
    if (!d) throw new Error(`unknown job ${name}`);
    await d.run();
  }

  start() {
    if (this.started) return;
    this.started = true;
    type Job = { data?: Record<string, unknown> | null };
    const boss = this.boss as unknown as {
      start(): Promise<unknown>;
      work(n: string, f: (jobs: Job[]) => Promise<unknown>): Promise<unknown>;
      on(e: string, f: (e: unknown) => void): void;
    };
    boss.on("error", (e) => console.error("[jobs] pg-boss:", e instanceof Error ? e.message : String(e)));
    void boss
      .start()
      .then(async () => {
        // A queued item carries its payload (ids only); cron runs and kicks carry none and drain what is due.
        // One queue that cannot be worked (e.g. not created by this schema version) must not stop the others.
        for (const d of this.defs.values()) {
          await boss
            .work(d.name, async (jobs) => {
              for (const j of jobs) await d.run(j.data && Object.keys(j.data).length ? j.data : undefined);
            })
            .catch((e: unknown) => console.error(`[jobs] cannot work ${d.name}:`, e instanceof Error ? e.message : String(e)));
        }
      })
      .catch((e: unknown) => console.error("[jobs] pg-boss start failed:", e instanceof Error ? e.message : String(e)));
  }

  async stop() {
    this.started = false;
    await (this.boss as unknown as { stop(o: object): Promise<unknown> }).stop({ graceful: true, wait: true });
  }
}
