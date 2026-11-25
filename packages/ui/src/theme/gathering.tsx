/**
 * The Gathering field (D-37): the Attendee Portal's living background. Points on a 24 px pitch
 * brighten where two slow crowds pass; the crowds travel along an S-shaped seam (the Fit mark's
 * geometry), one in ink, one in blue, and now and then meet. It is atmosphere, never a surface:
 * quiet under text.
 *
 * Cost (docs/05 §5). The canvas holds one pixel per point (about 600 on a phone), so a frame is
 * a few hundred small sums and one tiny image upload; the browser scales it up square-edged and a
 * CSS mask cuts it into 2 px points. Nothing is laid out. It redraws GATHERING_FPS times a second
 * at most, and only while it can be seen: paused while the tab is hidden or the canvas is off
 * screen, one still frame under prefers-reduced-motion (followed live). Its colours are theme
 * tokens (--field-dot, --field-tint), re-read when the theme changes.
 *
 * This module is its own chunk: apps import it lazily, after the first paint, so it is never on
 * a screen's critical path (the pass screen's size budget does not carry it).
 */
import { useEffect, useRef, type CSSProperties } from "react";

/** Frames a second, at most. Chosen from measurement: see docs/05 §5. */
export const GATHERING_FPS = 8;

const PITCH = 24;

export interface QuietZone {
  /** Fractions of the viewport where text sits; the field drops to `floor` there. */
  x: number;
  y: number;
  w: number;
  h: number;
  floor?: number;
}

function rgbVar(name: string, fallback: [number, number, number]): [number, number, number] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parts = raw.split(/[\s,]+/).map(Number);
  return parts.length >= 3 && parts.every((n) => Number.isFinite(n)) ? [parts[0]!, parts[1]!, parts[2]!] : fallback;
}

/** Each cell of the scaled-up canvas shows only its top-left 2 px square: the point. */
const MASK = `conic-gradient(at 2px 2px, #0000 75%, #000 0) 0 0 / ${PITCH}px ${PITCH}px`;
const STYLE: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  zIndex: -10,
  pointerEvents: "none",
  imageRendering: "pixelated",
  WebkitMask: MASK,
  mask: MASK,
};

export default function GatheringField({ quiet, strength = 1 }: { quiet?: QuietZone; strength?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const root = document.documentElement;
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

    let ink: [number, number, number] = [255, 255, 255];
    let tint: [number, number, number] = [138, 180, 255];
    let peak = 0.62;
    let base = 0.06;
    const readColours = () => {
      const light = root.dataset.theme === "light";
      peak = (light ? 0.5 : 0.62) * strength;
      base = (light ? 0.07 : 0.06) * strength;
      ink = rgbVar("--field-dot", light ? [18, 17, 16] : [255, 255, 255]);
      tint = rgbVar("--field-tint", light ? [47, 98, 217] : [138, 180, 255]);
    };

    let cols = 0;
    let rows = 0;
    let w = 0;
    let h = 0;
    let image: ImageData | null = null;
    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      cols = Math.ceil(w / PITCH) + 1;
      rows = Math.ceil(h / PITCH) + 1;
      canvas.width = cols;
      canvas.height = rows;
      canvas.style.width = `${cols * PITCH}px`;
      canvas.style.height = `${rows * PITCH}px`;
      image = ctx.createImageData(cols, rows);
    };

    // A crowd's place along the seam: an S from upper left to lower right and back.
    const seam = (t: number, phase: number): [number, number] => [
      (0.5 + 0.42 * Math.sin(t + phase)) * w,
      (0.5 + 0.27 * Math.sin(2 * (t + phase)) + 0.12 * Math.cos(t * 0.7 + phase)) * h,
    ];

    const draw = (time: number) => {
      if (!image) return;
      const t = time / 18_000; // one pass of the seam in about two minutes
      const r = Math.max(220, Math.min(w, h) * 0.42);
      const inv = 2.2 / (r * r);
      const [ax, ay] = seam(t, 0);
      const [bx, by] = seam(t * 0.83, 2.4);
      const qx0 = quiet ? quiet.x * w : 0;
      const qy0 = quiet ? quiet.y * h : 0;
      const qx1 = quiet ? (quiet.x + quiet.w) * w : -1;
      const qy1 = quiet ? (quiet.y + quiet.h) * h : -1;
      const floor = quiet?.floor ?? 0.25;
      const data = image.data;
      let i = 0;
      for (let row = 0; row < rows; row++) {
        const y = row * PITCH + 1;
        const dya = (y - ay) * (y - ay);
        const dyb = (y - by) * (y - by);
        for (let col = 0; col < cols; col++, i += 4) {
          const x = col * PITCH + 1;
          const q = x > qx0 && x < qx1 && y > qy0 && y < qy1 ? floor : 1;
          const a = Math.exp(-((x - ax) * (x - ax) + dya) * inv);
          const b = Math.exp(-((x - bx) * (x - bx) + dyb) * inv);
          const c = b > a ? tint : ink;
          data[i] = c[0];
          data[i + 1] = c[1];
          data[i + 2] = c[2];
          data[i + 3] = Math.round(Math.min(1, (Math.max(a, b) * peak + base) * q) * 255);
        }
      }
      ctx.putImageData(image, 0, 0);
    };

    const STILL_AT = 42_000;
    const start = performance.now() - STILL_AT;
    // A timer between frames, not a running requestAnimationFrame loop: an idle loop would still
    // make the browser prepare a frame on every screen refresh (60 or more a second).
    let raf = 0;
    let timer = 0;
    let onScreen = true;
    const frame = (now: number) => {
      draw(now - start);
      timer = window.setTimeout(() => {
        raf = requestAnimationFrame(frame);
      }, 1000 / GATHERING_FPS);
    };
    const still = () => Boolean(motion?.matches);
    const stop = () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      raf = 0;
      timer = 0;
    };
    const sync = () => {
      stop();
      if (still()) draw(STILL_AT);
      else if (!document.hidden && onScreen) raf = requestAnimationFrame(frame);
    };
    const redraw = () => draw(still() ? STILL_AT : performance.now() - start);

    readColours();
    resize();
    redraw();
    sync();

    const onResize = () => {
      resize();
      redraw();
    };
    const themeWatch = new MutationObserver(() => {
      readColours();
      redraw();
    });
    themeWatch.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    const io =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            onScreen = entries.some((e) => e.isIntersecting);
            sync();
          })
        : null;
    io?.observe(canvas);
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", sync);
    motion?.addEventListener("change", sync);
    return () => {
      stop();
      themeWatch.disconnect();
      io?.disconnect();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", sync);
      motion?.removeEventListener("change", sync);
    };
  }, [quiet, strength]);

  return <canvas ref={ref} aria-hidden="true" style={STYLE} />;
}
