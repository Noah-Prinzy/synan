/**
 * Layout pieces the workspace tabs and the event summary share, on top of the kit (kit/page.tsx),
 * so every tab lines up the same way:
 *
 *   HEAD_BLEED  a SectionHead that spans a full-bleed column sits on the page gutter (GUTTER_X),
 *               so its title lines up with the page title above and the table's first cell below.
 *   RAIL_X      content in an aside lines up with the aside's SectionHead (16px, 20px from 640).
 *   Toolbar     a band under a section head for filters on the left and the tab's one primary
 *               action on the right; never a filled button squeezed into a 40px head.
 *   RailNote    the quiet explanation at the foot of an aside.
 *   Meter       a 4px hairline bar for a share, when the exact figure sits beside it or is not needed.
 *   Duration    "1 h 30 min" with the figures in mono and the units in the UI sans.
 */
import type { ReactNode } from "react";
import { cn } from "@synan/ui/components";
import { GUTTER_X, PROSE } from "../../kit";

/** SectionHead's own padding is 16/20; in a full-bleed column it takes the page gutter. */
export const HEAD_BLEED = "sm:px-6! 2xl:px-8!";

/** Horizontal padding of anything inside an aside, matching the aside's SectionHead. */
export const RAIL_X = "px-4 sm:px-5";

/** A list row in an aside: 40px, 13px, the name taking the room. */
export const RAIL_ROW = cn("grid min-h-10 items-center gap-3 py-1.5 text-13", RAIL_X);

export function Toolbar({ children, actions, className }: { children?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-3 py-3", GUTTER_X, className)}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 text-13 text-muted-foreground">{children}</div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function RailNote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("py-4 text-12 leading-relaxed text-muted-foreground", RAIL_X, PROSE, className)}>{children}</p>;
}

export function Meter({ value, tone = "bg-foreground/60", className }: { value: number; tone?: string; className?: string }) {
  const share = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return (
    <span aria-hidden="true" className={cn("relative block h-1 bg-surface-3", className)}>
      <span className={cn("absolute inset-0 origin-left", tone)} style={{ transform: `scaleX(${share})` }} />
    </span>
  );
}

/** "1 h 30 min" → figures in mono, units in the UI sans, so a column of durations reads calmly. */
export function Duration({ ms, className }: { ms: number; className?: string }) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const unit = "font-sans text-12 text-muted-foreground";
  return (
    <span className={cn("font-mono tabular-nums whitespace-nowrap", className)}>
      {h > 0 ? (
        <>
          {h}
          <span className={unit}> h</span>
        </>
      ) : null}
      {h > 0 && m > 0 ? " " : null}
      {m > 0 || h === 0 ? (
        <>
          {m}
          <span className={unit}> min</span>
        </>
      ) : null}
    </span>
  );
}
