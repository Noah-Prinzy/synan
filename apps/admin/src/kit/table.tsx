/**
 * Dense tables (docs/05 §7 tier 3, `Table` dense): 13px rows of 36px, sans header in 11px,
 * hairline row rules, numbers in mono and right-aligned, a sticky head inside a scrolling
 * region. On a narrow screen the table scrolls inside its own frame; the page never does.
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

export function Th({ className, numeric, ...props }: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      {...props}
      className={cn(
        "sticky top-0 z-[1] h-8 border-b border-border bg-background px-3 text-11 font-normal whitespace-nowrap text-muted-foreground first:pl-4 last:pr-4 sm:first:pl-6 sm:last:pr-6",
        numeric ? "text-right" : "text-left",
        className,
      )}
    />
  );
}

export function Td({ className, numeric, ...props }: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      {...props}
      className={cn(
        "h-9 border-b border-border px-3 align-middle first:pl-4 last:pr-4 sm:first:pl-6 sm:last:pr-6",
        numeric && "text-right font-mono text-12 tabular-nums",
        className,
      )}
    />
  );
}

/** Row hover: a faint lift, never a fill colour. */
export const rowClass = "transition-colors duration-120 ease-standard hover:bg-foreground/[0.03] motion-reduce:transition-none";

/** A filter chip row (docs/05 `FilterChips`): square, hairline, active carries the brand border. */
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
              "pressable inline-flex h-7 items-center gap-1.5 border px-2.5 text-12 transition-colors duration-120 ease-standard motion-reduce:transition-none pointer-coarse:h-10",
              on ? "border-brand text-foreground" : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
            )}
          >
            {option.label}
            {option.count !== undefined ? <span className="font-mono text-11 tabular-nums text-muted-foreground">{option.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
