/**
 * Data rate is not frame rate (docs/02 §6, P-07). Telemetry arrives at ≤ 4 Hz; this
 * eases each displayed value toward its latest authoritative value on
 * requestAnimationFrame and writes the result straight to the DOM through bound
 * writers. React renders the map once; it never re-renders per frame (docs/02 §9).
 *
 * - The loop runs only while something is moving, then stops. Nothing idles.
 * - A value's first arrival is drawn as-is: no grow-from-zero entrance.
 * - Reduced motion, or a hidden tab, snaps to the target with no animation.
 * - Exponential approach (τ = 90 ms): ~94% of the way within one 250 ms data
 *   interval, so a steady 4 Hz stream reads as continuous motion, never a jump.
 */

export type Writer = (display: number, target: number) => void;

interface Track {
  known: boolean;
  target: number;
  display: number;
  writers: Set<Writer>;
}

const TAU_MS = 90;
const EPSILON = 0.02;

export class Interpolator {
  /** Development instrumentation: called after each frame that did work. */
  onFrame: ((workMs: number, writes: number) => void) | null = null;
  private tracks = new Map<string, Track>();
  private raf: number | null = null;
  private last = 0;
  private reduced = false;

  constructor() {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reduced = query.matches;
    query.addEventListener("change", (event) => {
      this.reduced = event.matches;
      if (this.reduced) this.snapAll();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.snapAll();
    });
  }

  /** Set the authoritative value for `key`. */
  set(key: string, target: number): void {
    const track = this.track(key);
    if (!track.known) {
      track.known = true;
      track.target = target;
      track.display = target;
      this.write(track);
      return;
    }
    if (track.target === target) return;
    track.target = target;
    if (this.reduced || document.hidden) {
      track.display = target;
      this.write(track);
      return;
    }
    this.wake();
  }

  /** The latest authoritative value (not the eased one). */
  target(key: string): number | undefined {
    const track = this.tracks.get(key);
    return track?.known ? track.target : undefined;
  }

  /** Attach a DOM writer to `key`. Called at once if the value is known. Returns unbind. */
  bind(key: string, writer: Writer): () => void {
    const track = this.track(key);
    track.writers.add(writer);
    if (track.known) writer(track.display, track.target);
    return () => track.writers.delete(writer);
  }

  /** Forget every value (a different event was opened). Writers stay bound. */
  reset(): void {
    for (const track of this.tracks.values()) track.known = false;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  private track(key: string): Track {
    let track = this.tracks.get(key);
    if (!track) {
      track = { known: false, target: 0, display: 0, writers: new Set() };
      this.tracks.set(key, track);
    }
    return track;
  }

  private write(track: Track): void {
    for (const writer of track.writers) writer(track.display, track.target);
  }

  private snapAll(): void {
    for (const track of this.tracks.values()) {
      if (!track.known || track.display === track.target) continue;
      track.display = track.target;
      this.write(track);
    }
  }

  private wake(): void {
    if (this.raf !== null) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.loop);
  }

  /**
   * Advance every moving value by `dt` ms and write it. The frame loop calls this; a
   * benchmark may call it directly to time a frame without depending on rAF.
   */
  step(dt: number): { moving: boolean; writes: number } {
    const k = 1 - Math.exp(-dt / TAU_MS);
    let moving = false;
    let writes = 0;
    for (const track of this.tracks.values()) {
      if (!track.known || track.display === track.target) continue;
      const gap = track.target - track.display;
      track.display = Math.abs(gap) < EPSILON ? track.target : track.display + gap * k;
      this.write(track);
      writes += track.writers.size;
      if (track.display !== track.target) moving = true;
    }
    return { moving, writes };
  }

  private loop = (now: number): void => {
    const started = this.onFrame ? performance.now() : 0;
    const dt = this.last ? Math.min(now - this.last, 100) : 16.7;
    this.last = now;
    const { moving, writes } = this.step(dt);
    this.raf = moving ? requestAnimationFrame(this.loop) : null;
    this.onFrame?.(performance.now() - started, writes);
  };
}
