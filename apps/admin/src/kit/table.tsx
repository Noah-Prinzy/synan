/**
 * Tables (docs/05 §7 tier 3, `Table`; layout rules in kit/page.tsx): 13px rows of 40px (44px
 * under a coarse pointer), a 36px head in mono capitals, no row rules (D-37: rows are held apart by
 * their height; the row under the pointer is lifted on a tonal step), numbers in mono and
 * right-aligned, a sticky head inside a scrolling region. First and last cells line up with the
 * page gutter. A column that holds a short value (a number, a state, a date, an action) takes
 * `fit`, so it hugs its content and the text columns get the room. On a narrow screen the table
 * scrolls inside its own frame; the page never does.
 */
import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";
import { cn } from "@synan/ui/components";

export function Table({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  return (
    <div className={cn("min-w-0 overflow-x-auto", className)}>
      <table aria-label={label} className="w-full border-collapse text-13">
        {children}
      </table>
    </div>
  );
}

const edge = "first:pl-4 last:pr-4 sm:first:pl-6 sm:last:pr-6 2xl:first:pl-8 2xl:last:pr-8";

export function Th({
  className,
  numeric,
  fit,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean; fit?: boolean }) {
  return (
    <th
      scope="col"
      {...props}
      className={cn(
        "sticky top-0 z-[1] h-9 bg-background px-3 font-mono text-12 font-normal tracking-[0.08em] whitespace-nowrap text-muted-foreground uppercase",
        edge,
        numeric ? "text-right" : "text-left",
        fit && "w-px",
        className,
      )}
    />
  );
}

export function Td({
  className,
  numeric,
  fit,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean; fit?: boolean }) {
  return (
    <td
      {...props}
      className={cn(
        "h-10 px-3 align-middle pointer-coarse:h-11",
        edge,
        numeric && "text-right font-mono text-13 tabular-nums",
        fit && "w-px whitespace-nowrap",
        className,
      )}
    />
  );
}

/** Row hover: lifted on a tonal step, never a fill colour. */
export const rowClass = "hover:bg-surface-2";

/** A filter chip row (docs/05 `FilterChips`): square tonal chips; the chosen one is ink. */
export function FilterChips<V extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: V; label: string; count?: number }[];
  value: V;
  onChange: (value: V) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              const i = options.findIndex((o) => o.value === value);
              const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
              if (!next) return;
              event.preventDefault();
              const target = options[(i + next + options.length) % options.length];
              if (target) {
                onChange(target.value);
                const sibling = (event.currentTarget.parentElement?.children[(i + next + options.length) % options.length] as HTMLElement | undefined);
                sibling?.focus();
              }
            }}
            tabIndex={on ? 0 : -1}
            className={cn(
              "pressable inline-flex h-8 items-center gap-2 px-3 text-13 pointer-coarse:h-11",
              on ? "bg-foreground text-background" : "bg-surface-2 text-foreground hover:bg-surface-3",
            )}
          >
            {option.label}
            {option.count !== undefined ? <span className={cn("font-mono text-12 tabular-nums", on ? "text-background/70" : "text-muted-foreground")}>{option.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
