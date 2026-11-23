/**
 * Background jobs behind one small interface (D-17: pg-boss on PostgreSQL). Each job is a named
 * handler that is idempotent and safe to run concurrently with itself; it runs on its schedule and
 * whenever something `kick`s it (an export was requested, an alert was raised), or for one queued
 * item (`enqueue`, whose payload carries ids only — never addresses, tokens or other personal data).
 *
 * InProcessJobs runs handlers in this process on timers. It is used by the memory backend and in
 * tests; a pg-boss implementation shares the same handlers.
 */
import type { TxScope } from "../repo/types.js";

export interface JobDef {
  name: string;
  /** Run at least this often (ms). Omit for kick-only jobs. */
  everyMs?: number;
  /** `data` is the queued payload when run for one item; absent for scheduled runs and kicks. */
  run(data?: Record<string, unknown>): Promise<unknown>;
}

export interface Jobs {
  register(def: JobDef): void;
  /** Ask for a run soon (coalesced). */
  kick(name: string): void;
  /**
   * Queue one item. Inside a unit of work the job exists only if it commits: pg-boss writes it in
   * the same transaction; in process it is kicked after commit (the handler then drains what is due).
   */
  enqueue(name: string, data: Record<string, unknown>, scope?: TxScope | null): Promise<void>;
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
  private again = new Set<string>();

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
    // A kick during a run asks for one more run after it, so work queued mid-run is not left for the timer.
    if (this.running.has(name)) {
      this.again.add(name);
      return;
    }
    void this.runNow(name).catch(() => undefined);
  }

  async enqueue(name: string, _data: Record<string, unknown>, scope?: TxScope | null) {
    // The handler finds the item itself (it drains what is due), so the payload is not kept here.
    if (scope) scope.afterCommit(() => this.kick(name));
    else this.kick(name);
  }

  runNow(name: string): Promise<void> {
    const def = this.defs.get(name);
    if (!def) return Promise.reject(new Error(`unknown job ${name}`));
    let p = this.running.get(name);
    if (!p) {
      p = def
        .run()
        .then(() => undefined, (e: unknown) => console.error(`[jobs] ${name} failed:`, e instanceof Error ? e.message : String(e)))
        .finally(() => {
          this.running.delete(name);
          if (this.again.delete(name)) this.kick(name);
        });
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
