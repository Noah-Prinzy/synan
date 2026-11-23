/**
 * Development-only frame sampler (docs/02 §9: "≥ 55 FPS with 60 rooms at 4 Hz",
 * measured, not asserted). Two independent measurements:
 *
 *   frames   rAF-to-rAF intervals over a window → FPS, p95 and worst frame time.
 *            Depends on the browser actually running rAF at display rate; an
 *            automated or background tab may throttle it.
 *   work     time the interpolator spends per frame writing the map and rail
 *            (main-thread cost of the live data), independent of throttling.
 *
 * Exposed as `window.__synanPerf` so a test harness can start, stop and read it.
 */
import { store } from "../live/context";

export interface PerfReport {
  seconds: number;
  frames: number;
  fps: number;
  p50Ms: number;
  p95Ms: number;
  worstMs: number;
  over20Ms: number;
  workFrames: number;
  workP95Ms: number;
  workWorstMs: number;
  writesPerFrame: number;
  visibility: DocumentVisibilityState;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number;
}

export class FrameSampler {
  private intervals: number[] = [];
  private work: number[] = [];
  private writes = 0;
  private raf: number | null = null;
  private last = 0;
  private started = 0;

  start(): void {
    this.stop();
    this.intervals = [];
    this.work = [];
    this.writes = 0;
    this.last = 0;
    this.started = performance.now();
    store.interp.onFrame = (ms, writes) => {
      this.work.push(ms);
      this.writes += writes;
    };
    const tick = (now: number) => {
      if (this.last) this.intervals.push(now - this.last);
      this.last = now;
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): PerfReport {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    store.interp.onFrame = null;
    return this.report();
  }

  /** The last `windowMs` of intervals, for the live overlay. */
  report(windowMs?: number): PerfReport {
    let intervals = this.intervals;
    if (windowMs) {
      let sum = 0;
      let i = intervals.length - 1;
      for (; i >= 0 && sum < windowMs; i--) sum += intervals[i] as number;
      intervals = intervals.slice(i + 1);
    }
    const sorted = [...intervals].sort((a, b) => a - b);
    const total = intervals.reduce((s, v) => s + v, 0);
    const work = [...this.work].sort((a, b) => a - b);
    return {
      seconds: Math.round((performance.now() - this.started) / 100) / 10,
      frames: intervals.length,
      fps: total > 0 ? Math.round((intervals.length / total) * 1000 * 10) / 10 : 0,
      p50Ms: Math.round(quantile(sorted, 0.5) * 10) / 10,
      p95Ms: Math.round(quantile(sorted, 0.95) * 10) / 10,
      worstMs: Math.round((sorted[sorted.length - 1] ?? 0) * 10) / 10,
      over20Ms: intervals.filter((v) => v > 20).length,
      workFrames: work.length,
      workP95Ms: Math.round(quantile(work, 0.95) * 100) / 100,
      workWorstMs: Math.round((work[work.length - 1] ?? 0) * 100) / 100,
      writesPerFrame: work.length > 0 ? Math.round(this.writes / work.length) : 0,
      visibility: document.visibilityState,
    };
  }

  running(): boolean {
    return this.raf !== null;
  }
}

export const sampler = new FrameSampler();

export interface BenchReport {
  rooms: number;
  deltas: number;
  framesPerDelta: number;
  /** One telemetry delta: store update, React render, style and layout. ms. */
  delta: { p50: number; p95: number; max: number };
  /** One interpolated frame: DOM writes, style and layout. ms. */
  frame: { p50: number; p95: number; max: number };
  /** The same frames, script only (interpolation and DOM writes, before style/layout). */
  frameScriptOnly: { p50: number; p95: number; max: number };
  /** Worst-case main-thread ms in one 250 ms interval at 60 fps: one delta + 15 frames. */
  perIntervalP95: number;
}

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const r = (v: number) => Math.round(v * 100) / 100;
  return { p50: r(quantile(sorted, 0.5)), p95: r(quantile(sorted, 0.95)), max: r(sorted[sorted.length - 1] ?? 0) };
}

/**
 * A throttle-independent cost measurement: feed `deltas` worst-case telemetry
 * deltas (every room changes) into the store, and after each, step the interpolator
 * through `framesPerDelta` 16.7 ms frames by hand. Style and layout are forced after
 * each step, so the time includes them; paint and compositing are not included (the
 * bars are transforms, composited off the main thread).
 */
export async function bench(deltas = 40, framesPerDelta = 15): Promise<BenchReport> {
  const layout = store.layout.get();
  const event = store.currentEvent();
  if (!layout || !event) throw new Error("Open a live event first");
  const thresholds = new Map(layout.rooms.map((r) => [r.id, r]));
  const deltaCost: number[] = [];
  const frameCost: number[] = [];
  const frameJs: number[] = [];
  const force = () => document.body.getBoundingClientRect();
  const ingest = (store as unknown as { onTelemetry(message: unknown): void }).onTelemetry.bind(store);
  for (let d = 0; d < deltas; d++) {
    const rooms = [...store.rooms.get().values()].map((room, i) => {
      const occupancy = Math.max(0, room.occupancy + (((d * 7 + i * 3) % 5) - 2));
      const spec = thresholds.get(room.id);
      const pct = room.capacity > 0 ? (occupancy / room.capacity) * 100 : 0;
      const level = pct >= (spec?.block_at_pct ?? 100) ? "block" : pct >= (spec?.warn_at_pct ?? 85) ? "warn" : "ok";
      return { room_id: room.id, zone_id: spec?.zone_id ?? "", occupancy, capacity: room.capacity, level };
    });
    let t0 = performance.now();
    ingest({ id: `bench-${d}`, type: "occupancy.delta", at: new Date().toISOString(), data: { event_id: event.id, rooms, zones: [] } });
    // React flushes useSyncExternalStore updates in a microtask queued during ingest.
    await Promise.resolve();
    await Promise.resolve();
    force();
    deltaCost.push(performance.now() - t0);
    for (let f = 0; f < framesPerDelta; f++) {
      t0 = performance.now();
      store.interp.step(16.7);
      const t1 = performance.now();
      force();
      frameCost.push(performance.now() - t0);
      frameJs.push(t1 - t0);
    }
  }
  const delta = stats(deltaCost);
  const frame = stats(frameCost);
  return {
    rooms: store.rooms.get().size,
    deltas,
    framesPerDelta,
    delta,
    frame,
    frameScriptOnly: stats(frameJs),
    perIntervalP95: Math.round((delta.p95 + frame.p95 * framesPerDelta) * 100) / 100,
  };
}

declare global {
  interface Window {
    __synanPerf?: {
      start: () => void;
      stop: () => PerfReport;
      report: (windowMs?: number) => PerfReport;
      bench: (deltas?: number, framesPerDelta?: number) => Promise<BenchReport>;
    };
  }
}

window.__synanPerf = {
  start: () => sampler.start(),
  stop: () => sampler.stop(),
  report: (windowMs) => sampler.report(windowMs),
  bench,
};
