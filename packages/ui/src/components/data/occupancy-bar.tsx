import type { Ref } from "react";
import { cn } from "../../lib/cn";

/**
 * A room's occupancy as a bar (docs/05 §3): neutral while under the warning
 * threshold, warning past `warn_at_pct`, stop past `block_at_pct` with a hatched cap
 * at 100%. The bar grows with `transform: scaleX` only (docs/02 §9), never `width`.
 *
 * Live screens drive it without React: keep `rootRef` and `fillRef` and call
 * `writeOccupancyBar` from the frame loop. The colour follows `data-level`, so a level
 * change is one attribute write.
 */
export type OccupancyLevel = "ok" | "warn" | "block";

export interface OccupancyBarProps {
  /** occupancy ÷ capacity. Anything at or over 1 draws a full bar. */
  ratio: number;
  level: OccupancyLevel;
  rootRef?: Ref<HTMLSpanElement>;
  fillRef?: Ref<HTMLSpanElement>;
  className?: string;
}

export function clampRatio(ratio: number): number {
  return Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
}

export function OccupancyBar({ ratio, level, rootRef, fillRef, className }: OccupancyBarProps) {
  return (
    <span
      ref={rootRef}
      data-level={level}
      aria-hidden="true"
      className={cn("group/bar relative block h-1 overflow-hidden bg-border", className)}
    >
      <span
        ref={fillRef}
        className="absolute inset-0 origin-left bg-muted-foreground will-change-transform group-data-[level=block]/bar:bg-destructive group-data-[level=warn]/bar:bg-warning"
        style={{ transform: `scaleX(${clampRatio(ratio)})` }}
      />
      <span className="hatch-cap absolute inset-y-0 right-0 hidden w-3 group-data-[level=block]/bar:block" />
    </span>
  );
}

/** Frame-loop update for a bar rendered by `OccupancyBar`. Writes only what changed. */
export function writeOccupancyBar(
  root: HTMLElement | null,
  fill: HTMLElement | null,
  ratio: number,
  level: OccupancyLevel,
): void {
  if (fill) fill.style.transform = `scaleX(${clampRatio(ratio)})`;
  if (root && root.dataset.level !== level) root.dataset.level = level;
}
