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

/**
 * Per-key counts in minute buckets of a given timestamp (not of arrival), for limits on what one gate
 * did per minute (03 §4). An offline backlog synced at once lands in the minutes it happened in, so
 * a gate's real rate is what is limited, not the size of its sync. Refusals are counted per minute.
 * In-process, like RateLimiter.
 */
export class MinuteBuckets {
  private keys = new Map<string, Map<number, { used: number; refused: number }>>();
  private lastSweep = 0;

  constructor(private readonly retainMs: number) {}

  /** One unit for `key` in the minute of `atMs`. False (and counted as refused) when that minute already holds `limit`. */
  take(key: string, atMs: number, limit: number, nowMs: number): boolean {
    this.sweep(nowMs);
    let minutes = this.keys.get(key);
    if (!minutes) this.keys.set(key, (minutes = new Map()));
    const m = Math.floor(atMs / 60_000);
    let b = minutes.get(m);
    if (!b) minutes.set(m, (b = { used: 0, refused: 0 }));
    if (b.used >= limit) {
      b.refused++;
      return false;
    }
    b.used++;
    return true;
  }

  /** Refusals for `key` in minutes overlapping [fromMs, toMs]. */
  refused(key: string, fromMs: number, toMs: number): number {
    const minutes = this.keys.get(key);
    if (!minutes) return 0;
    const lo = Math.floor(fromMs / 60_000);
    const hi = Math.floor(toMs / 60_000);
    let n = 0;
    for (const [m, b] of minutes) if (m >= lo && m <= hi) n += b.refused;
    return n;
  }

  private sweep(nowMs: number) {
    if (nowMs - this.lastSweep < 60_000) return;
    this.lastSweep = nowMs;
    const oldest = Math.floor((nowMs - this.retainMs) / 60_000);
    for (const [k, minutes] of this.keys) {
      for (const m of minutes.keys()) if (m < oldest) minutes.delete(m);
      if (minutes.size === 0) this.keys.delete(k);
    }
  }
}
