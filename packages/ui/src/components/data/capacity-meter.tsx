import { cn } from "../../lib/cn";
import { formatNumber, formatPercent } from "./format";
import { OccupancyBar, type OccupancyLevel } from "./occupancy-bar";

/**
 * Count against capacity, with the room's two thresholds marked on the bar: a tick
 * at `warn_at_pct` and one at `block_at_pct` (01 §7). For a room card or detail,
 * where the reader needs the numbers and the rule, not just the bar.
 */
export interface CapacityMeterProps {
  occupancy: number;
  capacity: number;
  warnAtPct: number;
  blockAtPct: number;
  level: OccupancyLevel;
  size?: "sm" | "lg";
  className?: string;
}

const levelText: Record<OccupancyLevel, string> = {
  ok: "text-foreground",
  warn: "text-warning",
  block: "text-destructive",
};

export function CapacityMeter({
  occupancy,
  capacity,
  warnAtPct,
  blockAtPct,
  level,
  size = "sm",
  className,
}: CapacityMeterProps) {
  const ratio = capacity > 0 ? occupancy / capacity : 0;
  // The scale runs to the higher of 100% and the block threshold, so both ticks fit.
  const scale = Math.max(100, blockAtPct);
  const ticks = [
    { pct: warnAtPct, label: `${warnAtPct}%` },
    { pct: blockAtPct, label: `${blockAtPct}%` },
  ];
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono tabular-nums">
          <span className={cn(size === "lg" ? "text-40 leading-none tracking-tight" : "text-15", levelText[level])}>
            {formatNumber(occupancy)}
          </span>
          <span className={cn("text-muted-foreground", size === "lg" ? "text-15" : "text-13")}>
            {" "}/ {formatNumber(capacity)}
          </span>
        </span>
        <span className={cn("font-mono text-13 tabular-nums", levelText[level])}>{formatPercent(ratio)}</span>
      </div>
      <div className="relative mt-2">
        <OccupancyBar ratio={(ratio * 100) / scale} level={level} className="h-1.5" />
        {ticks.map((tick) => (
          <span
            key={tick.label}
            aria-hidden="true"
            className="absolute -inset-y-1 w-px bg-foreground/60"
            style={{ left: `${(tick.pct / scale) * 100}%` }}
          />
        ))}
      </div>
      <p className="mt-1.5 text-11 text-muted-foreground" aria-hidden="true">
        Ticks: warn <span className="font-mono tabular-nums">{warnAtPct}%</span> · stop{" "}
        <span className="font-mono tabular-nums">{blockAtPct}%</span>
      </p>
      <p className="sr-only">
        {formatNumber(occupancy)} of {formatNumber(capacity)}, {formatPercent(ratio)}. Warning at {warnAtPct}%, stop at{" "}
        {blockAtPct}%.
      </p>
    </div>
  );
}
