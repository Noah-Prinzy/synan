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

/**
 * The cell sizes to its own width (a container query), not the viewport: a numeral is 40px
 * where the cell's content is at least 9rem wide and 28px below, and the sparkline only shows where
 * there is room for a line worth reading (11rem), so a narrow strip never clips its figures.
 */
export function KpiCell({ label, value, valueClassName, delta, spark, className }: KpiCellProps) {
  return (
    <div className={cn("@container flex min-w-0 flex-col gap-2 bg-background px-4 py-3 sm:py-4", className)}>
      <dt className="flex items-center gap-2 truncate text-13 text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "truncate font-mono text-28 leading-none tracking-tight tabular-nums contain-content @min-[9rem]:text-40",
          valueClassName,
        )}
      >
        {value}
      </dd>
      {delta || spark ? (
        // The line under the figure is words (figures inside it set their own mono).
        <dd className="flex min-h-5 min-w-0 items-center gap-3">
          <span className="min-w-0 truncate text-13 text-muted-foreground">{delta}</span>
          {spark ? <span className="hidden min-w-0 flex-1 @min-[11rem]:block">{spark}</span> : null}
        </dd>
      ) : null}
    </div>
  );
}
