/**
 * The Attendee Portal's living background (D-37): "Arrivals" (./arrivals.ts, the artist's drawing
 * code), wired to the app. This file holds only the wiring, so the drawing can be replaced by a
 * new version of arrivals.ts without touching it:
 *
 *   - one fixed layer behind the page, edge to edge (position: fixed; inset: 0; z-index -10);
 *   - colours per theme (the artist's values), re-applied when the theme changes;
 *   - speed from the CSS custom property --bg-motion (theme.css; 1 = gentle, 0.5 calm, 1.7 lively);
 *   - calm behind every run of the page's text, and behind fields, buttons and pictures (the pass's
 *     code card among them): their rectangles are read after a resize, a scroll or a change in the
 *     page, at most once a frame and never as part of drawing;
 *   - the artist's guards: a still frame under prefers-reduced-motion, paused while the tab is
 *     hidden or the layer is off screen, 15 frames a second (12 on a phone) stepping down to 10
 *     and 8 on a slow device, asked for by a timer (see arrivals.ts);
 *   - it holds still while someone is typing or scrolling, and resumes a moment after, so it never
 *     competes with input.
 *
 * Loaded after first paint, in its own chunk, through the slot in ./index.ts (LivingBackground).
 */
import { useEffect, useRef, type CSSProperties } from "react";
import { createArrivals } from "./arrivals";

/** The artist's colours: glyph ink, the accent, and the strongest glyph opacity. */
const THEMES = {
  dark: { ink: "#FAFAFA", accent: "#8AB4FF", alpha: 0.7 },
  light: { ink: "#121110", accent: "#2F62D9", alpha: 0.6 },
} as const;

/** How much the scene calms behind the page's words (every text run), and behind controls and
 *  pictures (1 = nothing drawn there). */
const CALM_TEXT = 0.9;
const CALM_BOXES: [selector: string, strength: number][] = [
  ["input,textarea,select,button,[data-calm]", 0.9],
  ["img,figure,[data-calm-strong]", 0.95],
];

interface Arrivals {
  start(): void;
  stop(): void;
  setTheme(t: { ink: string; accent: string; alpha: number }): void;
  setMotion(m: number): void;
  setCalm(rects: { left: number; top: number; right: number; bottom: number; strength: number }[]): void;
  destroy(): void;
}

const STYLE: CSSProperties = { position: "fixed", inset: 0, overflow: "hidden", zIndex: -10, pointerEvents: "none" };

export default function LivingArrivals() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const root = document.documentElement;
    const theme = () => THEMES[root.dataset.theme === "light" ? "light" : "dark"];
    const motion = () => {
      const v = parseFloat(getComputedStyle(root).getPropertyValue("--bg-motion"));
      return Number.isFinite(v) && v >= 0 ? v : 1;
    };
    const bg = createArrivals(host, { ...theme(), motion: motion(), fps: 0 }) as Arrivals;

    const rects = () => {
      const out: { left: number; top: number; right: number; bottom: number; strength: number }[] = [];
      const h = window.innerHeight;
      const w = window.innerWidth;
      const add = (list: DOMRectList, strength: number) => {
        for (const r of list) {
          if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > h || r.width > w * 0.98) continue;
          out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, strength });
        }
      };
      // Every run of text, wherever it sits (a heading, a paragraph, a bare line in a div).
      const walker = document.createTreeWalker(document.getElementById("root") ?? document.body, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent?.trim() || n.parentElement?.closest("[aria-hidden='true']")) continue;
        range.selectNodeContents(n);
        add(range.getClientRects(), CALM_TEXT);
      }
      for (const [selector, strength] of CALM_BOXES) for (const el of document.querySelectorAll(selector)) add(el.getClientRects(), strength);
      return out;
    };
    let pending = 0;
    const sync = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        bg.setCalm(rects());
      });
    };
    const page = new MutationObserver(sync);
    page.observe(document.getElementById("root") ?? document.body, { childList: true, subtree: true, characterData: true });
    const themeWatch = new MutationObserver(() => {
      bg.setTheme(theme());
      bg.setMotion(motion());
    });
    themeWatch.observe(root, { attributes: true, attributeFilter: ["data-theme", "style"] });
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, { passive: true, capture: true });
    void document.fonts?.ready.then(sync);
    sync();
    bg.start();
    // Hold still while someone types or scrolls; resume 700 ms after the last key or scroll.
    let rest = 0;
    const hold = () => {
      if (!rest) bg.stop();
      window.clearTimeout(rest);
      rest = window.setTimeout(() => {
        rest = 0;
        bg.start();
      }, 700);
    };
    window.addEventListener("keydown", hold, { passive: true, capture: true });
    window.addEventListener("scroll", hold, { passive: true, capture: true });
    window.addEventListener("touchmove", hold, { passive: true });
    return () => {
      window.clearTimeout(rest);
      window.removeEventListener("keydown", hold, { capture: true });
      window.removeEventListener("scroll", hold, { capture: true });
      window.removeEventListener("touchmove", hold);
      cancelAnimationFrame(pending);
      page.disconnect();
      themeWatch.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, { capture: true });
      bg.destroy();
    };
  }, []);
  return <div ref={ref} aria-hidden="true" style={STYLE} />;
}
