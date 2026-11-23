/**
 * Navigation inside a screen: route tabs (real subroutes, docs/06 §2.1, so a tab link can be
 * pasted into a chat) and the stepper for multi-step flows (D0, D5). Active is a 2px brand
 * rule — blue marks where you are acting (docs/05 §3, §5).
 */
import { NavLink } from "react-router-dom";
import { cn } from "@synan/ui/components";

export interface TabItem {
  to: string;
  label: string;
  /** A small count or note after the label. */
  badge?: string | number;
  end?: boolean;
}

/** Horizontal tabs as links. Scrolls sideways on a narrow screen instead of wrapping. */
export function RouteTabs({ items, label, className }: { items: TabItem[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={cn("overflow-x-auto border-b border-border [scrollbar-width:none]", className)}>
      <ul className="flex min-w-max px-2 sm:px-4">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "relative flex h-10 items-center gap-2 px-3 text-13 whitespace-nowrap transition-colors duration-120 ease-standard motion-reduce:transition-none pointer-coarse:h-11",
                  "after:absolute after:inset-x-3 after:-bottom-px after:h-0.5",
                  isActive ? "text-foreground after:bg-brand" : "text-muted-foreground after:bg-transparent hover:text-foreground",
                )
              }
            >
              {item.label}
              {item.badge !== undefined ? (
                <span className="font-mono text-11 text-muted-foreground tabular-nums">{item.badge}</span>
              ) : null}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export interface StepItem {
  key: string;
  label: string;
}

/**
 * A row of ruled step cells: number, label; the current step carries the brand rule, done steps
 * a check. Steps the user has reached are buttons (resumable); later ones are inert.
 */
export function Stepper({
  steps,
  current,
  reached,
  onStep,
  label = "Steps",
  className,
}: {
  steps: StepItem[];
  current: string;
  /** Index of the furthest step reached; steps up to it can be revisited. */
  reached: number;
  onStep?: (key: string) => void;
  label?: string;
  className?: string;
}) {
  const currentIndex = steps.findIndex((s) => s.key === current);
  return (
    <nav aria-label={label} className={cn("border-b border-border", className)}>
      <ol className="grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((step, index) => {
          const isCurrent = index === currentIndex;
          const done = index < currentIndex || (index <= reached && index !== currentIndex && index < reached);
          const reachable = index <= reached && !isCurrent && onStep;
          const body = (
            <>
              <span className="font-mono text-11 tabular-nums text-muted-foreground">
                {done ? (
                  <svg viewBox="0 0 16 16" aria-hidden="true" className="inline size-3 text-brand">
                    <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="1.75" />
                  </svg>
                ) : (
                  String(index + 1).padStart(2, "0")
                )}
              </span>
              <span className="hidden truncate sm:inline">{step.label}</span>
              <span className="sr-only sm:hidden">{step.label}</span>
              {done ? <span className="sr-only">, done</span> : null}
            </>
          );
          const cell = cn(
            "relative flex h-11 w-full min-w-0 items-center gap-2 border-l border-border px-3 text-left text-13 first:border-l-0 sm:px-4",
            "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5",
            isCurrent ? "text-foreground after:bg-brand" : "after:bg-transparent",
            !isCurrent && (reachable ? "text-muted-foreground hover:text-foreground" : "text-muted-foreground/60"),
          );
          return (
            <li key={step.key} className="min-w-0 border-l border-border first:border-l-0">
              {reachable ? (
                <button type="button" className={cn(cell, "border-l-0 transition-colors duration-120 ease-standard")} onClick={() => onStep(step.key)}>
                  {body}
                </button>
              ) : (
                <span aria-current={isCurrent ? "step" : undefined} className={cn(cell, "border-l-0")}>
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
