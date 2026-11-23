/**
 * Fixed-window rate limiter (03 §3 "per-IP and per-token limits on authentication and
 * scan endpoints"). In-process; v1 runs one API instance (D-17). With several instances
 * this moves to PostgreSQL, not Redis.
 */
export class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  private lastSweep = 0;

  constructor(private readonly now: () => number) {}

  /** Records one hit. Returns null if allowed, or seconds until the window resets. */
  hit(key: string, limit: number, windowMs: number): number | null {
    const now = this.now();
    this.sweep(now, windowMs);
    let w = this.windows.get(key);
    if (!w || now - w.start >= windowMs) {
      w = { start: now, count: 0 };
      this.windows.set(key, w);
    }
    w.count++;
    if (w.count > limit) return Math.max(1, Math.ceil((w.start + windowMs - now) / 1000));
    return null;
  }

  /** Seconds until reset if `key` has already used up `limit` in the window; null otherwise. Does not record a hit. */
  blocked(key: string, limit: number, windowMs: number): number | null {
    const now = this.now();
    const w = this.windows.get(key);
    if (!w || now - w.start >= windowMs || w.count < limit) return null;
    return Math.max(1, Math.ceil((w.start + windowMs - now) / 1000));
  }

  clear(key: string) {
    this.windows.delete(key);
  }

  private sweep(now: number, windowMs: number) {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [k, w] of this.windows) if (now - w.start >= Math.max(windowMs, 3_600_000)) this.windows.delete(k);
  }

  reset() {
    this.windows.clear();
  }
}
