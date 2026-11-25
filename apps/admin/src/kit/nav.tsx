/**
 * Navigation inside a screen: route tabs (real subroutes, docs/06 §2.1, so a tab link can be
 * pasted into a chat) and the stepper for multi-step flows (D0, D5). No rules (D-37): the current
 * one is ink with a short accent mark under it; blue marks where you are acting (docs/05 §3, §5).
 */
import type { CSSProperties, ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { cn } from "@synan/ui/components";

export interface TabItem {
  to: string;
  label: string;
  /** A small count or note after the label. */
  badge?: string | number;
  end?: boolean;
}

/**
 * Horizontal tabs as links. Scrolls sideways on a narrow screen instead of wrapping. The first
 * label sits on the page gutter (GUTTER_X: 16 · 24 · 32, less each tab's 12px padding), so it
 * lines up with the page title above. Hover lays a tonal step; active is foreground text with a
 * short accent mark under it, as in the top bar.
 */
export function RouteTabs({ items, label, className }: { items: TabItem[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={cn("overflow-x-auto [scrollbar-width:none]", className)}>
      <ul className="flex min-w-max gap-1 px-1 sm:px-3 2xl:px-5">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "relative flex h-11 items-center gap-2 px-3 text-15 whitespace-nowrap focus-visible:-outline-offset-2",
                  "after:absolute after:bottom-1 after:left-1/2 after:h-0.5 after:w-4 after:-translate-x-1/2",
                  isActive
                    ? "font-medium text-foreground after:bg-brand"
                    : "text-muted-foreground after:bg-transparent hover:bg-surface-2 hover:text-foreground",
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

/**
 * A link one level up, above a page title: a chevron and the parent's name, muted, turning to
 * the foreground on hover. The chevron's stroke (not its box) sits on the title's left edge;
 * under a coarse pointer the hit area grows to 44px without moving anything.
 */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="relative -ml-1.5 inline-flex items-center gap-0.5 text-12 text-muted-foreground hover:text-foreground pointer-coarse:before:absolute pointer-coarse:before:-inset-x-2 pointer-coarse:before:-inset-y-3.5"
    >
      <ChevronLeft size={16} strokeWidth={1.5} aria-hidden="true" />
      {children}
    </Link>
  );
}

export interface StepItem {
  key: string;
  label: string;
}

/**
 * A row of tonal step cells: number, label; the current step is lifted and carries the short accent
 * mark, done steps a check. Steps the user has reached are buttons (resumable); later ones are inert.
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
    <nav aria-label={label} className={className}>
      {/* Equal cells from 640; on a phone the current step takes the room to show its label and
          the others close to their number. */}
      <ol
        className="grid grid-cols-(--steps-phone) gap-1 sm:grid-cols-(--steps)"
        style={
          {
            "--steps": `repeat(${steps.length}, minmax(0, 1fr))`,
            "--steps-phone": steps.map((_, i) => (i === currentIndex ? "minmax(0, 1fr)" : "auto")).join(" "),
          } as CSSProperties
        }
      >
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
              {isCurrent ? (
                <span className="truncate">{step.label}</span>
              ) : (
                <>
                  <span className="hidden truncate sm:inline">{step.label}</span>
                  <span className="sr-only sm:hidden">{step.label}</span>
                </>
              )}
              {done ? <span className="sr-only">, done</span> : null}
            </>
          );
          const cell = cn(
            "relative flex h-11 w-full min-w-0 items-center gap-2 px-3 text-left text-13 sm:px-4",
            "after:absolute after:bottom-1 after:left-3 after:h-0.5 after:w-4 sm:after:left-4",
            isCurrent ? "bg-surface-3 font-medium text-foreground after:bg-brand" : "bg-surface-2 after:bg-transparent",
            !isCurrent && (reachable ? "text-muted-foreground hover:bg-surface-3 hover:text-foreground" : "text-muted-foreground"),
          );
          return (
            <li key={step.key} className="min-w-0">
              {reachable ? (
                <button type="button" className={cell} onClick={() => onStep(step.key)}>
                  {body}
                </button>
              ) : (
                <span aria-current={isCurrent ? "step" : undefined} className={cell}>
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
