/**
 * A controllable clock (docs/02 §8). Virtual time runs at `rate` × real time from an
 * anchor, and can be set, advanced or paused, so event states, QR rotation and
 * retention windows are testable. Timers scheduled through the clock fire in
 * virtual time, including when time is jumped forward.
 */

export interface Clock {
  /** Epoch milliseconds, virtual. */
  now(): number;
}

type Listener = () => void;

interface Timer {
  id: number;
  due: number;
  fn: () => void;
}

export class MockClock implements Clock {
  private anchorReal = Date.now();
  private anchorVirtual: number;
  private rate = 1;
  private timers: Timer[] = [];
  private running = false;
  private cancelled = new Set<number>();
  private nextId = 1;
  private handle: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();

  constructor(start: number | string | Date = Date.now()) {
    this.anchorVirtual = new Date(start).getTime();
  }

  now(): number {
    return this.anchorVirtual + (Date.now() - this.anchorReal) * this.rate;
  }

  /** Jump to an absolute time. Timers that become due fire immediately, in order. */
  set(time: number | string | Date): void {
    this.reanchor(new Date(time).getTime());
    this.flush();
  }

  advance(ms: number): void {
    this.set(this.now() + ms);
  }

  /** 0 pauses, 1 is real time, 60 runs a minute per second. */
  setRate(rate: number): void {
    this.reanchor(this.now());
    this.rate = Math.max(0, rate);
    this.flush();
  }

  getRate(): number {
    return this.rate;
  }

  /** Called on every set, advance, or rate change (not on the passage of time). */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setTimeout(fn: () => void, ms: number): number {
    const timer: Timer = { id: this.nextId++, due: this.now() + Math.max(0, ms), fn };
    // Binary insertion after any timer due at the same instant (FIFO for ties). A
    // scenario schedules hundreds of timers at once; re-sorting per insert was quadratic.
    let lo = 0;
    let hi = this.timers.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((this.timers[mid] as Timer).due <= timer.due) lo = mid + 1;
      else hi = mid;
    }
    this.timers.splice(lo, 0, timer);
    // Only the head decides the next wake-up.
    if (lo === 0) this.schedule();
    return timer.id;
  }

  clearTimeout(id: number): void {
    const index = this.timers.findIndex((timer) => timer.id === id);
    if (index === -1) {
      // Possibly in the batch flush() is running right now.
      if (this.running) this.cancelled.add(id);
      return;
    }
    this.timers.splice(index, 1);
    if (index === 0) this.schedule();
  }

  /** Cancels every pending timer. */
  reset(): void {
    this.timers = [];
    this.schedule();
  }

  private reanchor(virtual: number): void {
    this.anchorReal = Date.now();
    this.anchorVirtual = virtual;
    for (const listener of this.listeners) listener();
  }

  private flush(): void {
    const now = this.now();
    // Take every due timer in one splice; timers they schedule land in `this.timers`
    // and are picked up by the loop if already due.
    while (this.timers.length > 0 && (this.timers[0] as Timer).due <= now) {
      let count = 0;
      while (count < this.timers.length && (this.timers[count] as Timer).due <= now) count++;
      const due = this.timers.splice(0, count);
      this.running = true;
      try {
        for (const timer of due) {
          if (this.cancelled.delete(timer.id)) continue;
          timer.fn();
        }
      } finally {
        this.running = false;
        this.cancelled.clear();
      }
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.handle !== null) clearTimeout(this.handle);
    this.handle = null;
    const next = this.timers[0];
    if (!next || this.rate === 0) return;
    const realDelay = Math.max(0, (next.due - this.now()) / this.rate);
    this.handle = setTimeout(() => this.flush(), Math.min(realDelay, 2 ** 31 - 1));
  }
}
