import { useId } from "react";
import { cn } from "../../lib/cn";

/**
 * A hairline trend. No fill, no axis, no dots along the line — one 1px stroke and a
 * square at the latest value, so the eye lands on "now". Re-rendered when its series
 * changes (once a bucket), never per frame.
 */
export interface SparklineProps {
  values: readonly number[];
  /** What the line shows, for screen readers: "Checked in, last 60 minutes". */
  label: string;
  /** Text colour class for the stroke. Defaults to muted. */
  toneClassName?: string;
  className?: string;
}

const W = 100;
const H = 20;

export function Sparkline({ values, label, toneClassName = "text-muted-foreground/60", className }: SparklineProps) {
  const id = useId();
  if (values.length < 2) {
    return <span className={cn("block h-5", className)} role="img" aria-label={`${label}: not enough data yet`} />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 2;
  const y = (v: number) => (max === min ? H / 2 : pad + (1 - (v - min) / span) * (H - pad * 2));
  const step = W / (values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const last = values[values.length - 1] as number;
  const first = values[0] as number;
  return (
    <span className={cn("relative block h-5", toneClassName, className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="absolute inset-0 size-full overflow-visible"
        role="img"
        aria-labelledby={id}
      >
        <title id={id}>{`${label}: from ${first} to ${last}`}</title>
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      </svg>
      <span
        aria-hidden="true"
        className="absolute right-0 size-1 translate-x-1/2 -translate-y-1/2 bg-current"
        style={{ top: `${(y(last) / H) * 100}%` }}
      />
    </span>
  );
}
