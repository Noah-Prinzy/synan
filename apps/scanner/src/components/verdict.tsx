/**
 * VerdictPanel (docs/05 §7 ResultPanel, docs/06 S2): full-bleed ground, the verdict word as
 * large as the panel allows — 96px where the word fits on one line, 56 or 40 on a narrow
 * phone so it never breaks mid-word — the holder, the instruction, the identifier in mono.
 * Wording comes only from the contracts' scan-result copy. No interactive element.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SCAN_RESULT_COPY } from "@synan/contracts/copy";
import type { GateTone } from "@synan/contracts/enums";
import { DrawnCheck, RewardRule } from "@synan/ui/components";
import type { Scan } from "../data/store";
import { roomNames } from "../data/mock";

export const toneText: Record<GateTone, string> = {
  green: "text-success",
  amber: "text-warning",
  red: "text-destructive",
  none: "text-muted-foreground",
};
const toneRule: Record<GateTone, string> = {
  green: "bg-success",
  amber: "bg-warning",
  red: "bg-destructive",
  none: "bg-border",
};
export const toneGlyph: Record<GateTone, string> = { green: "✓", amber: "!", red: "✕", none: "·" };

const tierLabel = { VIP: "VIP", ORDINARY: "Ordinary", PRIVATE_INVITE: "Private Invitation", PUBLIC: "Public" } as const;

/** The type scale's display steps a verdict may use (docs/05 §4). */
const STEPS = [
  { px: 96, className: "text-96" },
  { px: 56, className: "text-56" },
  { px: 40, className: "text-40" },
] as const;

let canvas: HTMLCanvasElement | null = null;
function wordWidth(word: string, px: number): number {
  canvas ??= document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return word.length * px * 0.66;
  const family = getComputedStyle(document.documentElement).getPropertyValue("--type-ui") || "sans-serif";
  ctx.font = `600 ${px}px ${family}`;
  // tracking-tight is -0.025em per letter.
  return ctx.measureText(word).width - word.length * px * 0.025;
}

/** Lines the label takes at a size, packing words greedily into the width. */
function lineCount(words: string[], px: number, width: number): number {
  let lines = 1;
  let used = 0;
  const space = px * 0.25;
  for (const word of words) {
    const w = wordWidth(word, px);
    if (used > 0 && used + space + w > width) {
      lines++;
      used = w;
    } else used += (used > 0 ? space : 0) + w;
  }
  return lines;
}

/**
 * The largest step at which every word of the label fits the width (never broken mid-word)
 * and the word block still leaves room for the name and the instruction in the height.
 */
function useFittedStep(label: string, width: number, height: number): (typeof STEPS)[number]["className"] {
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let live = true;
    void document.fonts?.ready.then(() => live && setFontsReady(true));
    return () => {
      live = false;
    };
  }, []);
  if (width <= 0) return "text-56";
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1;
  const words = label.split(/\s+/);
  void fontsReady;
  // Room kept for the status line, the name and a two-line instruction.
  const reserved = 9.5 * 16 * rem;
  for (const step of STEPS) {
    const px = step.px * rem;
    if (!words.every((word) => wordWidth(word, px) <= width)) continue;
    if (height > 0 && lineCount(words, px, width) * px * 0.95 + reserved > height && step.px !== 40) continue;
    return step.className;
  }
  return "text-40";
}

function ago(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes < 1 ? "under a minute ago" : minutes === 1 ? "1 min ago" : `${minutes} min ago`;
}

export function VerdictPanel({
  scan,
  repeatNote,
  idleHint,
}: {
  scan: Scan | null;
  /** "Same pass read twice. Ignored." after a duplicate read, under the standing verdict. */
  repeatNote: string | null;
  idleHint: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setBox({ width: entry?.contentRect.width ?? 0, height: entry?.contentRect.height ?? 0 }),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const copy = scan ? SCAN_RESULT_COPY[scan.result] : null;
  const step = useFittedStep(copy?.label ?? "READY", box.width, box.height);

  return (
    <section
      ref={ref}
      aria-label="Verdict"
      className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-5 sm:px-6"
    >
      {/* Spoken once per verdict; the visual panel below is the same content. */}
      <p aria-live="assertive" className="sr-only">
        {copy && scan ? `${copy.label}. ${scan.name ?? ""}. ${copy.instruction}` : ""}
      </p>
      {/* my-auto, not justify-center: centred when it fits, scrolls from the top when not. */}
      <div aria-hidden={copy ? true : undefined} className="my-auto w-full">
        {copy && scan ? (
          <div key={scan.id}>
            <span aria-hidden="true" className={`rule-in absolute inset-x-0 top-0 h-0.5 ${toneRule[copy.tone]}`} />
            <p className={`flex items-center gap-2 font-mono text-13 uppercase tracking-[0.12em] ${toneText[copy.tone]}`}>
              {copy.tone === "green" ? <DrawnCheck className="size-4" /> : <span aria-hidden="true">{toneGlyph[copy.tone]}</span>}
              <span>{scan.medium === "nfc" ? "Wristband" : scan.identifier}</span>
              {scan.offline ? <span className="border border-current px-1.5 py-0.5 text-11">Local</span> : null}
            </p>
            <p className={`relative mt-2 inline-block pb-2 font-semibold leading-[0.95] tracking-tight ${step} ${toneText[copy.tone]}`}>
              <span className="settle-in block">{copy.label}</span>
              {scan.result === "admitted" ? <RewardRule /> : null}
            </p>
            {scan.name || scan.tier ? (
              <p className="mt-3 text-21 font-medium leading-snug">
                {scan.name}
                {scan.tier ? <span className="text-muted-foreground">{scan.name ? " · " : ""}{tierLabel[scan.tier]}</span> : null}
              </p>
            ) : null}
            <p className="mt-1 text-17 leading-snug text-muted-foreground">
              {copy.instruction}
              {scan.result === "already_inside" && scan.lastInAt ? ` Last in ${ago(scan.at - scan.lastInAt)}.` : ""}
            </p>
            {scan.result === "admitted" ? (
              <ul aria-label="Rooms this pass opens" className="mt-3 flex flex-wrap gap-1.5 [@media(max-height:700px)]:hidden">
                {roomNames(scan.rooms).map((room) => (
                  <li key={room} className="border border-border px-2 py-1 text-13 text-muted-foreground">
                    {room}
                  </li>
                ))}
              </ul>
            ) : null}
            {scan.medium === "nfc" ? <p className="mt-3 font-mono text-13 text-muted-foreground [@media(max-height:560px)]:hidden">uid {scan.identifier}</p> : null}
            {repeatNote ? <p className="fade-in mt-3 text-15 text-muted-foreground">{repeatNote}</p> : null}
          </div>
        ) : (
          <div>
            <p className="font-mono text-13 uppercase tracking-[0.12em] text-muted-foreground">Ready</p>
            <p className="mt-2 max-w-[32ch] text-21 leading-snug">{idleHint}</p>
          </div>
        )}
      </div>
    </section>
  );
}
