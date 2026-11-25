/**
 * DEVELOPMENT ONLY — the two living backgrounds of the direction mock-ups.
 *
 * GatheringField (Calm everywhere on the attendee side; Stage and Field on the calm screens):
 * points on a 24 px pitch that brighten where two slow "crowds" pass. The crowds travel along
 * an S-shaped seam (the Fit mark's geometry), one in ink, one in Daybreak, and now and then meet.
 * One canvas, capped at 24 fps, no layout work per frame, paused while the tab is hidden,
 * a single still frame under prefers-reduced-motion.
 *
 * SquareField (Field, attendee home only): soft squares that brighten faintly near the pointer
 * and fade back. No idle motion at all: the loop runs only while something is fading. Touch and
 * reduced motion get the still grid.
 */
import { useEffect, useRef } from "react";

const prefersReduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** "r g b" from a CSS custom property on the element (e.g. --dx-dot). */
function rgbVar(el: Element, name: string, fallback: string): [number, number, number] {
  const raw = getComputedStyle(el).getPropertyValue(name).trim() || fallback;
  const parts = raw.split(/[\s,]+/).map(Number);
  return [parts[0] ?? 255, parts[1] ?? 255, parts[2] ?? 255];
}

export interface QuietZone {
  /** Fractions of the viewport: where text sits; the field drops to `floor` there. */
  x: number;
  y: number;
  w: number;
  h: number;
  floor?: number;
}

export function GatheringField({
  strength = 1,
  still = false,
  quiet,
  mode,
}: {
  /** 1 in Calm, about 0.6 in Stage and Field. */
  strength?: number;
  still?: boolean;
  quiet?: QuietZone | undefined;
  /** Re-reads the colours when the theme flips. */
  mode: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const host = canvas.closest(".dx") ?? document.documentElement;
    const ink = rgbVar(host, "--dx-dot", "255 255 255");
    const tint = rgbVar(host, "--dx-tint", "138 180 255");
    const light = mode === "light";
    const PITCH = 24;
    const LEVELS = 24;
    // Light ground needs a little more weight for the same presence.
    const peak = (light ? 0.5 : 0.62) * strength;
    const base = (light ? 0.07 : 0.06) * strength;
    const inkStyles = Array.from({ length: LEVELS + 1 }, (_, i) => `rgba(${ink[0]},${ink[1]},${ink[2]},${((i / LEVELS) * peak).toFixed(3)})`);
    const tintStyles = Array.from({ length: LEVELS + 1 }, (_, i) => `rgba(${tint[0]},${tint[1]},${tint[2]},${((i / LEVELS) * peak).toFixed(3)})`);

    let w = 0;
    let h = 0;
    let dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    // A crowd's position along the seam: an S from upper left to lower right and back.
    const seam = (t: number, phase: number) => {
      const s = Math.sin(t + phase);
      const x = 0.5 + 0.42 * s;
      const y = 0.5 + 0.3 * Math.sin(2 * (t + phase)) * 0.9 + 0.12 * Math.cos(t * 0.7 + phase);
      return [x * w, y * h] as const;
    };

    const draw = (time: number) => {
      const t = time / 1000 / 18; // one full pass of the seam in about 2 minutes
      ctx.clearRect(0, 0, w, h);
      const r = Math.max(220, Math.min(w, h) * 0.42);
      const [ax, ay] = seam(t, 0);
      const [bx, by] = seam(t * 0.83, 2.4);
      const inv = 1 / (r * r);
      const qx0 = quiet ? quiet.x * w : -1;
      const qy0 = quiet ? quiet.y * h : -1;
      const qx1 = quiet ? (quiet.x + quiet.w) * w : -1;
      const qy1 = quiet ? (quiet.y + quiet.h) * h : -1;
      const floor = quiet?.floor ?? 0.25;
      const size = 2;
      const ox = (w % PITCH) / 2;
      const oy = (h % PITCH) / 2;
      for (let y = oy; y < h; y += PITCH) {
        for (let x = ox; x < w; x += PITCH) {
          const da = (x - ax) * (x - ax) + (y - ay) * (y - ay);
          const db = (x - bx) * (x - bx) + (y - by) * (y - by);
          let a = Math.exp(-da * inv * 2.2);
          let b = Math.exp(-db * inv * 2.2);
          let q = 1;
          if (quiet && x > qx0 && x < qx1 && y > qy0 && y < qy1) q = floor;
          a *= q;
          b *= q;
          const baseLevel = (base / peak) * q;
          if (b > a) {
            const li = Math.min(LEVELS, Math.round((b + baseLevel) * LEVELS));
            if (li > 0) {
              ctx.fillStyle = tintStyles[li]!;
              ctx.fillRect(x, y, size, size);
            }
          } else {
            const li = Math.min(LEVELS, Math.round((a + baseLevel) * LEVELS));
            if (li > 0) {
              ctx.fillStyle = inkStyles[li]!;
              ctx.fillRect(x, y, size, size);
            }
          }
        }
      }
    };

    const reduced = prefersReduced();
    if (still || reduced) {
      draw(42_000);
      const onResize = () => {
        resize();
        draw(42_000);
      };
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }

    let raf = 0;
    let last = 0;
    const start = performance.now() - 42_000;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 1000 / 24) return;
      last = now;
      draw(now - start);
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [strength, still, quiet, mode]);

  return <canvas ref={ref} className="dx-canvas" aria-hidden="true" />;
}

export function SquareField({ still = false, mode }: { still?: boolean; mode: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const host = canvas.closest(".dx") ?? document.documentElement;
    const ink = rgbVar(host, "--dx-dot", "255 255 255");
    const tint = rgbVar(host, "--dx-tint", "138 180 255");
    const light = mode === "light";
    const PITCH = 28;
    const SIZE = 22;
    const RADIUS = 5;
    const REACH = 170;
    const PEAK = light ? 0.12 : 0.11;
    const BASE = light ? 0.035 : 0.03;

    let w = 0;
    let h = 0;
    let cols = 0;
    let rows = 0;
    let energy = new Float32Array(0);
    const baseLayer = document.createElement("canvas");

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = window.innerWidth;
      h = window.innerHeight;
      cols = Math.ceil(w / PITCH) + 1;
      rows = Math.ceil(h / PITCH) + 1;
      energy = new Float32Array(cols * rows);
      for (const c of [canvas, baseLayer]) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const b = baseLayer.getContext("2d");
      if (!b) return;
      b.setTransform(dpr, 0, 0, dpr, 0, 0);
      b.clearRect(0, 0, w, h);
      b.fillStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},${BASE})`;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          b.beginPath();
          b.roundRect(c * PITCH + (PITCH - SIZE) / 2, r * PITCH + (PITCH - SIZE) / 2, SIZE, SIZE, RADIUS);
          b.fill();
        }
      }
      paint();
    };

    const paint = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(baseLayer, 0, 0, w, h);
      for (let i = 0; i < energy.length; i++) {
        const e = energy[i]!;
        if (e < 0.02) continue;
        const c = i % cols;
        const r = (i - c) / cols;
        ctx.fillStyle = `rgba(${tint[0]},${tint[1]},${tint[2]},${(e * PEAK).toFixed(3)})`;
        ctx.beginPath();
        ctx.roundRect(c * PITCH + (PITCH - SIZE) / 2, r * PITCH + (PITCH - SIZE) / 2, SIZE, SIZE, RADIUS);
        ctx.fill();
      }
    };

    resize();
    const reduced = prefersReduced();
    if (still || reduced) {
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }

    let raf = 0;
    let running = false;
    let lastTime = 0;
    let px = -9999;
    let py = -9999;

    const step = (now: number) => {
      const dt = Math.min(64, now - lastTime || 16);
      lastTime = now;
      const decay = Math.pow(0.5, dt / 220);
      let alive = false;
      for (let i = 0; i < energy.length; i++) {
        const e = energy[i]! * decay;
        energy[i] = e < 0.01 ? 0 : e;
        if (e >= 0.01) alive = true;
      }
      if (px > -9000) {
        const c0 = Math.max(0, Math.floor((px - REACH) / PITCH));
        const c1 = Math.min(cols - 1, Math.ceil((px + REACH) / PITCH));
        const r0 = Math.max(0, Math.floor((py - REACH) / PITCH));
        const r1 = Math.min(rows - 1, Math.ceil((py + REACH) / PITCH));
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const dx = c * PITCH + PITCH / 2 - px;
            const dy = r * PITCH + PITCH / 2 - py;
            const d = Math.sqrt(dx * dx + dy * dy) / REACH;
            if (d >= 1) continue;
            const target = (1 - d) * (1 - d);
            const i = r * cols + c;
            if (energy[i]! < target) energy[i] = energy[i]! + (target - energy[i]!) * 0.35;
          }
        }
        alive = true;
      }
      paint();
      if (alive && !document.hidden) raf = requestAnimationFrame(step);
      else running = false;
    };
    const kick = () => {
      if (running || document.hidden) return;
      running = true;
      lastTime = performance.now();
      raf = requestAnimationFrame(step);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      px = event.clientX;
      py = event.clientY;
      kick();
    };
    const onLeave = () => {
      px = -9999;
      py = -9999;
      kick();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", resize);
    };
  }, [still, mode]);

  return <canvas ref={ref} className="dx-canvas" aria-hidden="true" />;
}
