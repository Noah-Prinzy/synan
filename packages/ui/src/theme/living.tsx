/**
 * The engine for the Attendee Portal's living background (D-37): one full-screen canvas behind
 * the page, with every guard built in, so a scene only has to say how to draw a frame.
 *
 *   - No frame loop: a timer asks for one frame at FPS frames a second at most.
 *   - Paused while the tab is hidden or the canvas is off screen.
 *   - One still frame (Scene.still) under prefers-reduced-motion, followed live.
 *   - Speed is one number, the CSS custom property --bg-motion on <html> (theme.css; 1 = gentle):
 *     virtual time runs at that rate.
 *   - Calmer behind the page's words: env.calm(x, y) is 0.25 behind headings, paragraphs, fields,
 *     buttons and pictures (with a soft edge) and 1 elsewhere, re-read every second and after a
 *     scroll. A scene multiplies its strength by it.
 *   - Colours are theme tokens (--field-dot, --field-tint), re-read when the theme changes.
 *   - Loaded after first paint, in its own chunk (index.ts, LivingBackground): never on the
 *     pass screen's critical path.
 *
 * To use it: write a Scene, export `function MyScene() { return <LivingCanvas scene={myScene} /> }`
 * as this module's default export, and point the slot in index.ts at this module.
 */
import { useEffect, useRef, type CSSProperties } from "react";

const FPS = 12;

/** What the scene calms behind: the page's words, fields, buttons and pictures. */
const CALM_SELECTOR = "h1,h2,h3,h4,p,label,input,textarea,select,button,a,li,dt,dd,img,figure,[data-calm]";
const CALM_CELL = 16;
const CALM_FLOOR = 0.25;
const CALM_SOFT = 40;

export type RGB = [number, number, number];
export interface Env {
  w: number;
  h: number;
  light: boolean;
  ink: RGB;
  tint: RGB;
  /** Virtual seconds since the scene began (scaled by --bg-motion). */
  t: number;
  /** Where the pointer (or the last touch) is, and when it last moved, in real seconds. */
  pointer: { x: number; y: number; at: number } | null;
  now: number;
  /** Strength at a point: 0.25 behind the page's text and 1 elsewhere. */
  calm: (x: number, y: number) => number;
}
export interface Scene<S> {
  init(env: Env): S;
  draw(ctx: CanvasRenderingContext2D, s: S, env: Env): void;
  /** The virtual time of the still frame shown under reduced motion. */
  still: number;
  /** Listen to the pointer and touches (env.pointer). */
  pointer?: boolean;
}

export const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function rgbVar(name: string, fallback: RGB): RGB {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const p = raw.split(/[s,]+/).map(Number);
  return p.length >= 3 && p.every(Number.isFinite) ? [p[0]!, p[1]!, p[2]!] : fallback;
}

/* ====================================================================== engine */

export function LivingCanvas<S>({ scene }: { scene: Scene<S> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const root = document.documentElement;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");

    // The calm map: one value per CALM_CELL square of the viewport.
    let cols = 0;
    let rows = 0;
    let calmMap = new Float32Array(0);
    let calmDirty = true;
    let calmAt = 0;
    const env: Env = {
      w: 0,
      h: 0,
      light: false,
      ink: [255, 255, 255],
      tint: [138, 180, 255],
      t: scene.still,
      pointer: null,
      now: 0,
      calm: (x, y) => calmMap[clamp(Math.floor(y / CALM_CELL), 0, rows - 1) * cols + clamp(Math.floor(x / CALM_CELL), 0, cols - 1)] ?? 1,
    };
    const measureCalm = () => {
      calmDirty = false;
      calmAt = performance.now();
      cols = Math.ceil(env.w / CALM_CELL);
      rows = Math.ceil(env.h / CALM_CELL);
      calmMap = new Float32Array(cols * rows).fill(1);
      const rects: DOMRect[] = [];
      for (const el of document.querySelectorAll(CALM_SELECTOR)) {
        if (el.closest("[data-calm-ignore]")) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2 || r.bottom < -CALM_SOFT || r.top > env.h + CALM_SOFT || r.width > env.w * 0.98) continue;
        rects.push(r);
      }
      for (const r of rects) {
        const c0 = Math.max(0, Math.floor((r.left - CALM_SOFT) / CALM_CELL));
        const c1 = Math.min(cols - 1, Math.ceil((r.right + CALM_SOFT) / CALM_CELL));
        const r0 = Math.max(0, Math.floor((r.top - CALM_SOFT) / CALM_CELL));
        const r1 = Math.min(rows - 1, Math.ceil((r.bottom + CALM_SOFT) / CALM_CELL));
        for (let j = r0; j <= r1; j++) {
          const cy = (j + 0.5) * CALM_CELL;
          const dy = Math.max(r.top - cy, 0, cy - r.bottom);
          for (let i = c0; i <= c1; i++) {
            const cx = (i + 0.5) * CALM_CELL;
            const dx = Math.max(r.left - cx, 0, cx - r.right);
            const d = Math.hypot(dx, dy);
            const v = CALM_FLOOR + (1 - CALM_FLOOR) * clamp(d / CALM_SOFT, 0, 1);
            const k = j * cols + i;
            if (v < calmMap[k]!) calmMap[k] = v;
          }
        }
      }
    };

    let state = null as S | null;
    let speed = 1;
    const readMotion = () => {
      const v = parseFloat(getComputedStyle(root).getPropertyValue("--bg-motion"));
      speed = Number.isFinite(v) && v >= 0 ? v : 1;
    };
    const setup = () => {
      env.light = root.dataset.theme === "light";
      env.ink = rgbVar("--field-dot", env.light ? [18, 17, 16] : [255, 255, 255]);
      env.tint = rgbVar("--field-tint", env.light ? [47, 98, 217] : [138, 180, 255]);
      env.w = window.innerWidth;
      env.h = window.innerHeight;
      const k = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(env.w * k);
      canvas.height = Math.round(env.h * k);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      state = scene.init(env);
      calmDirty = true;
    };
    const paint = () => {
      if (calmDirty || performance.now() - calmAt > 1000) measureCalm();
      if (state !== null) scene.draw(ctx, state, env);
    };

    let raf = 0;
    let timer = 0;
    let last = 0;
    let onScreen = true;
    const frame = (ms: number) => {
      const real = ms / 1000;
      const dt = last ? Math.min(real - last, 0.25) : 0;
      last = real;
      env.now = real;
      env.t += dt * speed;
      paint();
      timer = window.setTimeout(() => {
        raf = requestAnimationFrame(frame);
      }, 1000 / FPS);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      raf = timer = 0;
      last = 0;
    };
    const sync = () => {
      stop();
      if (reduced?.matches) {
        env.t = scene.still;
        paint();
      } else if (!document.hidden && onScreen) raf = requestAnimationFrame(frame);
    };

    readMotion();
    setup();
    // The page settles after first paint (fonts, data): measure where its words are again soon.
    const settle = window.setTimeout(() => {
      calmDirty = true;
      if (reduced?.matches) paint();
    }, 600);
    paint();
    sync();

    const onResize = () => {
      setup();
      paint();
    };
    const onScroll = () => {
      calmDirty = true;
      if (reduced?.matches) paint();
    };
    const watch = new MutationObserver(() => {
      readMotion();
      setup();
      paint();
    });
    watch.observe(root, { attributes: true, attributeFilter: ["data-theme", "style"] });
    const io =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            onScreen = entries.some((e) => e.isIntersecting);
            sync();
          })
        : null;
    io?.observe(canvas);
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType === "touch" && e.type === "pointermove") return;
      env.pointer = { x: e.clientX, y: e.clientY, at: performance.now() / 1000 };
    };
    if (scene.pointer) {
      window.addEventListener("pointermove", onPointer, { passive: true });
      window.addEventListener("pointerdown", onPointer, { passive: true });
    }
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    document.addEventListener("visibilitychange", sync);
    reduced?.addEventListener("change", sync);
    return () => {
      stop();
      window.clearTimeout(settle);
      watch.disconnect();
      io?.disconnect();
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("visibilitychange", sync);
      reduced?.removeEventListener("change", sync);
    };
  }, [scene]);
  return <canvas ref={ref} aria-hidden="true" style={STYLE} />;
}

const STYLE: CSSProperties = { position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: -10, pointerEvents: "none" };

