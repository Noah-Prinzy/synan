import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * One figure in a KPI strip (docs/06 §2.3 D1): label, a 40px mono numeral, then the
 * delta and a sparkline beneath. Cells sit in a `<dl>` divided by hairlines; the
 * strip owns the dividers, the cell owns its content.
 */
export interface KpiCellProps {
  label: ReactNode;
  value: ReactNode;
  /** Text colour class for the numeral, only when the figure is itself a state. */
  valueClassName?: string;
  delta?: ReactNode;
  spark?: ReactNode;
  className?: string;
}

export function KpiCell({ label, value, valueClassName, delta, spark, className }: KpiCellProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2 bg-background px-4 pt-3 pb-3", className)}>
      <dt className="flex items-center gap-2 truncate text-12 text-muted-foreground">{label}</dt>
      <dd className={cn("font-mono text-40 leading-none tracking-tight tabular-nums contain-content", valueClassName)}>{value}</dd>
      <dd className="flex min-w-0 items-center gap-3">
        <span className="shrink-0 font-mono text-12 text-muted-foreground tabular-nums">{delta}</span>
        <span className="min-w-0 flex-1">{spark}</span>
      </dd>
    </div>
  );
}
