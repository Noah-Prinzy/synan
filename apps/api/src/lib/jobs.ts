/**
 * Background jobs behind one small interface (D-17: pg-boss on PostgreSQL). Each job is a named
 * handler that is idempotent and safe to run concurrently with itself; it runs on its schedule and
 * whenever something `kick`s it (an export was requested, an alert was raised).
 *
 * InProcessJobs runs handlers in this process on timers. It is used by the memory backend and in
 * tests; a pg-boss implementation shares the same handlers.
 */
export interface JobDef {
  name: string;
  /** Run at least this often (ms). Omit for kick-only jobs. */
  everyMs?: number;
  run(): Promise<unknown>;
}

export interface Jobs {
  register(def: JobDef): void;
  /** Ask for a run soon (coalesced). */
  kick(name: string): void;
  /** Run one job now and wait (tests, operators). */
  runNow(name: string): Promise<void>;
  start(): void;
  stop(): Promise<void>;
}

export class InProcessJobs implements Jobs {
  private defs = new Map<string, JobDef>();
  private timers: NodeJS.Timeout[] = [];
  private running = new Map<string, Promise<void>>();
  private started = false;

  register(def: JobDef) {
    this.defs.set(def.name, def);
    if (this.started && def.everyMs) this.schedule(def);
  }

  private schedule(def: JobDef) {
    const t = setInterval(() => this.kick(def.name), def.everyMs);
    t.unref();
    this.timers.push(t);
  }

  kick(name: string) {
    if (!this.started) return;
    void this.runNow(name).catch(() => undefined);
  }

  runNow(name: string): Promise<void> {
    const def = this.defs.get(name);
    if (!def) return Promise.reject(new Error(`unknown job ${name}`));
    let p = this.running.get(name);
    if (!p) {
      p = def
        .run()
        .then(() => undefined, (e: unknown) => console.error(`[jobs] ${name} failed:`, e instanceof Error ? e.message : String(e)))
        .finally(() => this.running.delete(name));
      this.running.set(name, p);
    }
    return p;
  }

  start() {
    if (this.started) return;
    this.started = true;
    for (const d of this.defs.values()) if (d.everyMs) this.schedule(d);
  }

  async stop() {
    this.started = false;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    await Promise.allSettled([...this.running.values()]);
  }
}
