/**
 * The Synan identity: the "Fit" mark and the "[S]ynan" logotype, drawn once as
 * geometric primitives. Everything else reads from here — the React components
 * (mark.tsx, wordmark.tsx), the exported files in ./assets and the app
 * icons in ./public (both written by ./export-assets.mjs). No imports and no JSX, so
 * Node can run the exporter against this file directly.
 *
 * THE MARK. A 24-unit square (4..28 on a 32 grid) cut by one S-shaped seam into two
 * pieces that only make sense together. The seam's centre-line is two stacked
 * semicircles of radius r (round the left of the upper, the right of the lower), meeting
 * tangentially at the centre, and it leaves through the square's top-right and
 * bottom-left edges — so the square itself is notched into an S. The ink piece is
 * upper-left, the blue piece lower-right.
 *
 * THE LOGOTYPE. The mark stands in for the capital S. "ynan" is drawn from the mark's
 * logic: one stroke weight, semicircular rings like the seam, flat terminals, ink-trap
 * notches where an arch leaves a stem (the seam again), letter spacing equal to the
 * seam, and a y whose tail turns and runs out flat, as the seam does along the bottom
 * edge. Cap height = the square (24), x-height 17, baseline on the square's bottom edge.
 */

export type Role = "ink" | "accent";

export type Primitive =
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  /** Ring segment from a0 to a1 degrees, clockwise on screen (0° = +x, 90° = down). */
  | { kind: "ring"; cx: number; cy: number; ro: number; ri: number; a0: number; a1: number }
  /** The two pieces of the mark: seam half-width g, square at (ox, oy), side s (default 24). */
  | { kind: "fitInk"; g: number; ox: number; oy: number; s?: number }
  | { kind: "fitAccent"; g: number; ox: number; oy: number; s?: number };

export interface Part {
  shape: Primitive;
  role: Role;
}

export interface Drawing {
  width: number;
  height: number;
  parts: Part[];
}

/** Seam half-width: full drawing, and the simplified drawing for ≤ 24px. */
export const SEAM = { full: 1.3, small: 1.7 } as const;

/* ------------------------------------------------------------------ geometry */

function fitGeometry(g: number, ox: number, oy: number, s = 24) {
  const r = (s - 2 * g) / 4; // centre-line radius: two circles fill the square exactly
  return { r, c1: oy + g + r, c2: oy + s - g - r, mx: ox + s / 2, x0: ox, y0: oy, x1: ox + s, y1: oy + s };
}

const f = (n: number) => Number(n.toFixed(3));
const rad = (d: number) => (d * Math.PI) / 180;

/** SVG path data for a primitive. */
export function pathOf(shape: Primitive): string {
  switch (shape.kind) {
    case "rect":
      return `M${f(shape.x)} ${f(shape.y)}h${f(shape.w)}v${f(shape.h)}h${f(-shape.w)}Z`;
    case "ring": {
      const { cx, cy, ro, ri, a0, a1 } = shape;
      const p = (r: number, a: number) => `${f(cx + r * Math.cos(rad(a)))} ${f(cy + r * Math.sin(rad(a)))}`;
      const large = a1 - a0 > 180 ? 1 : 0;
      if (a1 - a0 >= 360) {
        return `M${f(cx - ro)} ${f(cy)}A${ro} ${ro} 0 1 0 ${f(cx + ro)} ${f(cy)}A${ro} ${ro} 0 1 0 ${f(cx - ro)} ${f(cy)}ZM${f(cx - ri)} ${f(cy)}A${ri} ${ri} 0 1 1 ${f(cx + ri)} ${f(cy)}A${ri} ${ri} 0 1 1 ${f(cx - ri)} ${f(cy)}Z`;
      }
      return `M${p(ro, a0)}A${ro} ${ro} 0 ${large} 1 ${p(ro, a1)}L${p(ri, a1)}A${ri} ${ri} 0 ${large} 0 ${p(ri, a0)}Z`;
    }
    case "fitInk": {
      const { r, c1, c2, mx, x0, y0 } = fitGeometry(shape.g, shape.ox, shape.oy, shape.s);
      const ro = f(r + shape.g), ri = f(r - shape.g);
      return `M${x0} ${y0}H${mx}A${ro} ${ro} 0 0 0 ${mx} ${f(c1 + r + shape.g)}A${ri} ${ri} 0 0 1 ${mx} ${f(c2 + r - shape.g)}H${x0}Z`;
    }
    case "fitAccent": {
      const { r, c1, mx, x1, y0, y1 } = fitGeometry(shape.g, shape.ox, shape.oy, shape.s);
      const ro = f(r + shape.g), ri = f(r - shape.g);
      return `M${x1} ${f(y0 + 2 * shape.g)}H${mx}A${ri} ${ri} 0 0 0 ${mx} ${f(c1 + r - shape.g)}A${ro} ${ro} 0 0 1 ${mx} ${y1}H${x1}Z`;
    }
  }
}

/** Is point (x, y) inside the primitive? Used by the exporter to rasterise PNGs. */
export function contains(shape: Primitive, x: number, y: number): boolean {
  switch (shape.kind) {
    case "rect":
      return x >= shape.x && x <= shape.x + shape.w && y >= shape.y && y <= shape.y + shape.h;
    case "ring": {
      const d = Math.hypot(x - shape.cx, y - shape.cy);
      if (d < shape.ri || d > shape.ro) return false;
      if (shape.a1 - shape.a0 >= 360) return true;
      let a = (Math.atan2(y - shape.cy, x - shape.cx) * 180) / Math.PI;
      while (a < shape.a0) a += 360;
      return a <= shape.a1;
    }
    case "fitInk":
    case "fitAccent": {
      const { r, c1, c2, mx, x0, x1, y0, y1 } = fitGeometry(shape.g, shape.ox, shape.oy, shape.s);
      const g = shape.g;
      if (x < x0 || x > x1 || y < y0 || y > y1) return false;
      const d1 = Math.hypot(x - mx, y - c1);
      const d2 = Math.hypot(x - mx, y - c2);
      const ink = (x <= mx && y <= c2 + r - g && d1 >= r + g) || (x > mx && d2 < r - g);
      if (shape.kind === "fitInk") return ink;
      return (x >= mx && y >= y0 + 2 * g && d2 >= r + g) || (x < mx && d1 < r - g);
    }
  }
}

/* ---------------------------------------------------------------- the mark */

/** The mark on its 32-unit grid (square 4..28). `small` is the ≤ 24px drawing. */
export function markDrawing(small = false): Drawing {
  const g = small ? SEAM.small : SEAM.full;
  return {
    width: 32,
    height: 32,
    parts: [
      { shape: { kind: "fitInk", g, ox: 4, oy: 4 }, role: "ink" },
      { shape: { kind: "fitAccent", g, ox: 4, oy: 4 }, role: "accent" },
    ],
  };
}

/* ----------------------------------------------------------- the logotype */
// Logotype units: the mark's square is 0..24, baseline y 24, x-height top y 7,
// descender to y 31. One stroke T. Letter spacing = the seam (2.6), plus optical
// corrections against round shapes. Round tops overshoot by 0.4.

const T = 4;
const BASE = 24;
const XH = 7;
const OVER = 0.4;
const SEAM_GAP = 2 * SEAM.full;
/** Ink-trap notch where an arch leaves a stem — the seam, in the letters. */
const TRAP = 16;

function letterY(x: number): Part[] {
  const w = 15;
  const R = w / 2;
  const cx = x + R;
  const cy = BASE - R + OVER; // the bowl overshoots the baseline
  const tR = 5.6; // the tail's turn
  return [
    { shape: { kind: "rect", x, y: XH, w: T, h: cy - XH }, role: "ink" },
    { shape: { kind: "ring", cx, cy, ro: R, ri: R - T, a0: 0, a1: 180 }, role: "ink" },
    { shape: { kind: "rect", x: x + w - T, y: XH, w: T, h: 26 - XH }, role: "ink" },
    // Tail: turns left under the bowl and runs out flat, like the seam's bottom rule.
    { shape: { kind: "ring", cx: x + w - tR, cy: 26, ro: tR, ri: tR - T, a0: 0, a1: 90 }, role: "ink" },
    { shape: { kind: "rect", x: x + 2.6, y: 26 + tR - T, w: w - tR - 2.6, h: T }, role: "ink" },
  ];
}

function letterN(x: number): Part[] {
  const w = 15;
  const R = w / 2;
  const cx = x + R;
  const cy = XH + R - OVER;
  return [
    { shape: { kind: "rect", x, y: XH, w: T, h: BASE - XH }, role: "ink" },
    { shape: { kind: "ring", cx, cy, ro: R, ri: R - T, a0: 180 + TRAP, a1: 360 }, role: "ink" },
    { shape: { kind: "rect", x: x + w - T, y: cy, w: T, h: BASE - cy }, role: "ink" },
  ];
}

function letterA(x: number): Part[] {
  // Single-storey a: a full bowl and a stem, with ink traps where the bowl meets it.
  const R = (BASE - XH) / 2 + OVER;
  const cx = x + R;
  const cy = (BASE + XH) / 2;
  const stemX = cx + R - T;
  return [
    { shape: { kind: "ring", cx, cy, ro: R, ri: R - T, a0: 20 + TRAP / 2, a1: 340 - TRAP / 2 }, role: "ink" },
    { shape: { kind: "rect", x: stemX, y: XH, w: T, h: BASE - XH }, role: "ink" },
  ];
}

/** The seam as a letter: lowercase s for the stacked lockup — the mark's S, stroked. */
function letterS(x: number): Part[] {
  const t = 3.6;
  const r = (BASE - XH - t) / 4;
  const half = r + t / 2; // the rules end where the rings' outer edges are, as the seam's rules end at the square
  const cx = x + half;
  const c1 = XH + t / 2 + r;
  const c2 = BASE - t / 2 - r;
  return [
    { shape: { kind: "rect", x: cx, y: XH, w: half, h: t }, role: "ink" },
    { shape: { kind: "ring", cx, cy: c1, ro: half, ri: r - t / 2, a0: 90, a1: 270 }, role: "ink" },
    { shape: { kind: "ring", cx, cy: c2, ro: half, ri: r - t / 2, a0: 270, a1: 450 }, role: "ink" },
    { shape: { kind: "rect", x: cx - half, y: BASE - t, w: half, h: t }, role: "ink" },
  ];
}

const N_W = 15;
const A_W = 2 * ((BASE - XH) / 2 + OVER);

/** "[S]ynan": the mark (square 0..24) then the drawn letters. `small` thickens the seam. */
export function lockupDrawing(small = false): Drawing {
  const g = small ? SEAM.small : SEAM.full;
  const yX = 24 + 3.4; // optical: a square against the y's open top wants a little more air
  const n1 = yX + 15 + SEAM_GAP + 0.2;
  const a = n1 + N_W + SEAM_GAP - 0.2; // round against straight: slightly tighter
  const n2 = a + A_W + SEAM_GAP;
  const parts: Part[] = [
    { shape: { kind: "fitInk", g, ox: 0, oy: 0 }, role: "ink" },
    { shape: { kind: "fitAccent", g, ox: 0, oy: 0 }, role: "accent" },
    ...letterY(yX),
    ...letterN(n1),
    ...letterA(a),
    ...letterN(n2),
  ];
  return { width: n2 + N_W, height: 32, parts };
}

/** Stacked: the mark above, "synan" below (its s is the seam, drawn as a letter). */
export function stackedDrawing(): Drawing {
  const sW = 2 * ((BASE - XH - 3.6) / 4 + 1.8);
  const yX = sW + SEAM_GAP;
  const n1 = yX + 15 + SEAM_GAP + 0.2;
  const a = n1 + N_W + SEAM_GAP - 0.2;
  const n2 = a + A_W + SEAM_GAP;
  const wordW = n2 + N_W;
  const markSize = 30;
  const wordTop = markSize + 9 - XH; // 9 units between the mark and the x-height
  const shift = (shape: Primitive, dx: number, dy: number): Primitive =>
    shape.kind === "rect"
      ? { ...shape, x: shape.x + dx, y: shape.y + dy }
      : shape.kind === "ring"
        ? { ...shape, cx: shape.cx + dx, cy: shape.cy + dy }
        : { ...shape, ox: shape.ox + dx, oy: shape.oy + dy };
  const word = [...letterS(0), ...letterY(yX), ...letterN(n1), ...letterA(a), ...letterN(n2)].map((part) => ({
    ...part,
    shape: shift(part.shape, 0, wordTop),
  }));
  const markX = (wordW - markSize) / 2;
  return {
    width: wordW,
    height: wordTop + 32,
    parts: [
      { shape: { kind: "fitInk", g: SEAM.full * (markSize / 24), ox: markX, oy: 0, s: markSize }, role: "ink" },
      { shape: { kind: "fitAccent", g: SEAM.full * (markSize / 24), ox: markX, oy: 0, s: markSize }, role: "accent" },
      ...word,
    ],
  };
}

export const BRAND_COLOURS = {
  ground: "#0A0A0A",
  ink: "#FAFAFA",
  accent: "#8AB4FF",
  /** On light grounds the accent darkens to keep ≥ 3:1 as a graphic. */
  lightGround: "#F7F5F0",
  lightInk: "#0A0A0A",
  lightAccent: "#2F62D9",
} as const;
