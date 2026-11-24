/**
 * ThemeSwitch: System · Light · Dark, as one row of ruled cells (square chips, docs/05 §2.1).
 * Native radios underneath, so Tab enters the group, the arrow keys move and choose, and
 * assistive tech hears a labelled radio group. The chosen cell carries the accent rule
 * (blue = where you acted, docs/05 §5); the label is never colour alone, the chosen word
 * also turns from muted to ink. 44px under a coarse pointer at either density.
 */
import { useId, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { THEME_CHOICES, useTheme } from "../../theme";
import type { Density } from "./field";

const cell: Record<Density, string> = {
  compact: "h-8 px-3 text-13 pointer-coarse:h-11 pointer-coarse:px-4",
  comfortable: "min-h-11 px-4 text-15",
};

export function ThemeSwitch({
  label = "Appearance",
  hideLabel = false,
  hint,
  density = "comfortable",
  className,
  legendClassName,
  fill = false,
  cellClassName,
}: {
  label?: ReactNode;
  /** Keep the group named for assistive tech but say nothing on screen. */
  hideLabel?: boolean;
  /** Match the label to the surrounding headings (replaces the default label style). */
  legendClassName?: string;
  /** One quiet line under the cells. `true`: say what System currently resolves to. */
  hint?: ReactNode | true;
  density?: Density;
  className?: string;
  /** Stretch to the full width, three equal cells (the scanner, in thumb reach). */
  fill?: boolean;
  /** Extra classes for each cell, e.g. a taller target on the scanner. */
  cellClassName?: string;
}) {
  const { choice, resolved, setChoice } = useTheme();
  const name = useId();
  const hintText = hint === true ? (choice === "system" ? `Following this device: ${resolved} now.` : null) : hint;
  return (
    <fieldset className={cn("m-0 min-w-0 border-0 p-0", className)}>
      <legend
        className={
          hideLabel
            ? "sr-only"
            : cn("mb-2 p-0", legendClassName ?? cn("font-medium text-foreground", density === "compact" ? "text-12" : "text-15"))
        }
      >
        {label}
      </legend>
      <div className={cn("max-w-full border border-border", fill ? "flex w-full" : "inline-flex")}>
        {THEME_CHOICES.map((option) => (
          <label
            key={option.value}
            className={cn(
              "relative flex cursor-pointer items-center justify-center border-l border-border text-muted-foreground transition-colors duration-120 ease-standard first:border-l-0 hover:text-foreground motion-reduce:transition-none",
              "has-checked:text-foreground has-focus-visible:outline-1 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand has-focus-visible:outline-solid",
              cell[density],
              fill && "flex-1",
              cellClassName,
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={choice === option.value}
              onChange={() => setChoice(option.value)}
              className="peer sr-only"
            />
            {option.label}
            <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-brand opacity-0 peer-checked:opacity-100" />
          </label>
        ))}
      </div>
      {hintText ? (
        <p aria-live="polite" className={cn("mt-2 text-muted-foreground", density === "compact" ? "text-12" : "text-13")}>
          {hintText}
        </p>
      ) : null}
    </fieldset>
  );
}
