/**
 * BRAND BOARD — identity options (throwaway).
 *
 * Three complete identity proposals for Synan, as data. The dev-only brand board
 * (apps/attendee/src/screens/brand-board.tsx) is the only importer. When the owner
 * picks one, its palette and fonts move into ../../styles/theme.css, its mark and
 * wordmark into ../mark.tsx and ../wordmark.tsx, its icons into ../public/, and this
 * folder is deleted.
 */
import type { ComponentType } from "react";
import {
  LongTableMark,
  LongTableWordmark,
  MeetingPointMark,
  MeetingPointWordmark,
  OpenDoorMark,
  OpenDoorWordmark,
} from "./marks";

export type OptionId = "meeting-point" | "open-door" | "long-table";

/** Rule changes an option needs, from the owner's list (Attendee Portal only). */
export type RuleChange = "warm-ground" | "paper-theme" | "accent-fill";

export const RULE_CHANGE_TEXT: Record<RuleChange, string> = {
  "warm-ground": "(a) Warm-tinted ground instead of neutral black",
  "paper-theme": "(b) Light paper theme for the Attendee Portal",
  "accent-fill": "(c) Brand accent as the fill of the one primary action",
};

export interface Palette {
  ground: string;
  surface: string;
  text: string;
  muted: string;
  /** Hairline, as an rgba over the ground. */
  hairline: string;
  accent: string;
  /** Text on an accent fill, when the option fills the primary action. */
  onAccent?: string;
  /** Signals as used on this ground (hue kept; lightness adjusted on paper). */
  success: string;
  warning: string;
  destructive: string;
}

export interface TypeFace {
  family: string;
  /** CSS font-family value. */
  stack: string;
  /** npm package (Fontsource). */
  pkg: string;
}

export interface IdentityOption {
  id: OptionId;
  number: 1 | 2 | 3;
  name: string;
  idea: string;
  says: string;
  sources: string[];
  ruleChanges: RuleChange[];
  palette: Palette;
  accentName: string;
  type: { display: TypeFace; ui: TypeFace; data: TypeFace };
  Mark: ComponentType<{ className?: string; title?: string }>;
  Wordmark: ComponentType<{ className?: string }>;
  /** The instruments (Admin, Scanner) take only accent and type, on the neutral dark ground. */
  instrumentAccent: string;
  /** Accent used inside the mark on dark and on light grounds (each ≥ 3:1 there). */
  markAccent: { dark: string; light: string };
}

const SIGNALS_DARK = { success: "#43C07A", warning: "#E7B643", destructive: "#FF6467" };

export const OPTIONS: IdentityOption[] = [
  {
    id: "meeting-point",
    number: 1,
    name: "Meeting point",
    idea: "Two paths arrive from opposite corners and meet at one point — the S of Synan drawn as a coming-together.",
    says: "Synan is where people's routes converge; calm, exact, open in every direction.",
    sources: [
      "Sample site: the hairline construction arc and square node dots, used here as the mark's own geometry",
      "Fonts In Use / Typewolf: Bricolage Grotesque as a warm contemporary grotesque",
      "Realtime Colors: accent checked on the real dark layout",
    ],
    ruleChanges: [],
    accentName: "Daybreak blue",
    palette: {
      ground: "#0A0A0A",
      surface: "#171717",
      text: "#FAFAFA",
      muted: "#A1A1A1",
      hairline: "rgba(255,255,255,0.10)",
      accent: "#8AB4FF",
      ...SIGNALS_DARK,
    },
    type: {
      display: { family: "Bricolage Grotesque", stack: '"Bricolage Grotesque Variable", ui-sans-serif, sans-serif', pkg: "@fontsource-variable/bricolage-grotesque" },
      ui: { family: "Instrument Sans", stack: '"Instrument Sans Variable", ui-sans-serif, system-ui, sans-serif', pkg: "@fontsource-variable/instrument-sans" },
      data: { family: "Geist Mono", stack: '"Geist Mono Variable", ui-monospace, monospace', pkg: "@fontsource-variable/geist-mono" },
    },
    Mark: MeetingPointMark,
    Wordmark: MeetingPointWordmark,
    instrumentAccent: "#8AB4FF",
    markAccent: { dark: "#8AB4FF", light: "#2F62D9" },
  },
  {
    id: "open-door",
    number: 2,
    name: "Open door",
    idea: "A doorway with the door already swung open toward you: you are expected.",
    says: "Synan is the host at the door — warm light, an editorial voice, a welcome rather than a check.",
    sources: [
      "Typewolf: Newsreader (optical sizes) with a friendly geometric sans for UI",
      "Another Graphic: the doorway as a symbol of welcome, reduced to two shapes",
      "Realtime Colors: espresso ground and orchid accent checked on a real layout",
    ],
    ruleChanges: ["warm-ground"],
    accentName: "Lantern orchid",
    palette: {
      ground: "#14100D",
      surface: "#1E1814",
      text: "#F6EFE6",
      muted: "#B9AC9C",
      hairline: "rgba(246,239,230,0.12)",
      accent: "#E58CC0",
      ...SIGNALS_DARK,
    },
    type: {
      display: { family: "Newsreader", stack: '"Newsreader Variable", ui-serif, Georgia, serif', pkg: "@fontsource-variable/newsreader" },
      ui: { family: "Figtree", stack: '"Figtree Variable", ui-sans-serif, system-ui, sans-serif', pkg: "@fontsource-variable/figtree" },
      data: { family: "Martian Mono", stack: '"Martian Mono Variable", ui-monospace, monospace', pkg: "@fontsource-variable/martian-mono" },
    },
    Mark: OpenDoorMark,
    Wordmark: OpenDoorWordmark,
    instrumentAccent: "#E58CC0",
    markAccent: { dark: "#E58CC0", light: "#A9397B" },
  },
  {
    id: "long-table",
    number: 3,
    name: "Long table",
    idea: "One long table with people on both sides and a place already laid for you.",
    says: "Synan is a gathering on paper — like a printed programme in your hand, with one clear thing to do.",
    sources: [
      "Fonts In Use: Instrument Serif for display, DM Sans/DM Mono for the working text",
      "awesome-design-md (getdesign.md): editorial paper palettes, here without radii or shadows",
      "Realtime Colors: paper ground and cobalt checked, including signals darkened for paper",
    ],
    ruleChanges: ["paper-theme", "accent-fill"],
    accentName: "Cobalt",
    palette: {
      ground: "#F4F0E8",
      surface: "#FBF8F2",
      text: "#1C1B18",
      muted: "#5F5B53",
      hairline: "rgba(28,27,24,0.14)",
      accent: "#2B45D4",
      onAccent: "#FFFFFF",
      success: "#1E7A49",
      warning: "#8C5A00",
      destructive: "#C4302B",
    },
    type: {
      display: { family: "Instrument Serif", stack: '"Instrument Serif", ui-serif, Georgia, serif', pkg: "@fontsource/instrument-serif" },
      ui: { family: "DM Sans", stack: '"DM Sans Variable", ui-sans-serif, system-ui, sans-serif', pkg: "@fontsource-variable/dm-sans" },
      data: { family: "DM Mono", stack: '"DM Mono", ui-monospace, monospace', pkg: "@fontsource/dm-mono" },
    },
    Mark: LongTableMark,
    Wordmark: LongTableWordmark,
    instrumentAccent: "#7D8FFF",
    markAccent: { dark: "#7D8FFF", light: "#2B45D4" },
  },
];

export function optionById(id: string | null | undefined): IdentityOption | undefined {
  return OPTIONS.find((option) => option.id === id);
}

/* ------------------------------------------------------------ contrast (WCAG 2.1) */

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function parse(color: string): [number, number, number, number] {
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(1) as [number, number, number, number];
  }
  const parts = color.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1];
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
}

/** Composite a possibly translucent colour over an opaque ground. */
export function over(color: string, ground: string): [number, number, number] {
  const [r, g, b, a] = parse(color);
  const [gr, gg, gb] = parse(ground);
  return [r * a + gr * (1 - a), g * a + gg * (1 - a), b * a + gb * (1 - a)];
}

function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(foreground: string, background: string): number {
  const l1 = luminance(over(foreground, background));
  const l2 = luminance(over(background, background));
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 10) / 10;
}

/* ------------------------------------------------------------- applying tokens */

/**
 * The CSS custom properties that re-skin the shared theme for an option (the same
 * names theme.css declares). Applied to <html> by the board's preview frames only.
 */
export function identityTokens(option: IdentityOption): Record<string, string> {
  const p = option.palette;
  const light = option.ruleChanges.includes("paper-theme");
  return {
    "--background": p.ground,
    "--foreground": p.text,
    "--card": p.surface,
    "--card-foreground": p.text,
    "--popover": p.surface,
    "--popover-foreground": p.text,
    "--muted": light ? "rgba(28,27,24,0.08)" : p.surface,
    "--muted-foreground": p.muted,
    "--border": p.hairline,
    "--input": light ? "rgba(28,27,24,0.22)" : p.hairline.replace(/0\.1\d?\)/, "0.18)"),
    "--brand": p.accent,
    "--ring": p.accent,
    "--success": p.success,
    "--warning": p.warning,
    "--destructive": p.destructive,
    "--scrim": light ? "rgba(28,27,24,0.35)" : "rgba(0,0,0,0.6)",
    "--action": option.ruleChanges.includes("accent-fill") ? p.accent : p.text,
    "--action-foreground": option.ruleChanges.includes("accent-fill") ? (p.onAccent ?? "#FFFFFF") : p.ground,
    "--type-display": option.type.display.stack,
    "--type-ui": option.type.ui.stack,
    "--type-data": option.type.data.stack,
    "color-scheme": light ? "light" : "dark",
  };
}

export function applyIdentity(option: IdentityOption, root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(identityTokens(option))) root.style.setProperty(name, value);
  root.dataset.identity = option.id;
}

export { LongTableMark, MeetingPointMark, OpenDoorMark } from "./marks";
