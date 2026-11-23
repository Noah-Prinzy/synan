/**
 * Form furniture shared by every control, so a text field, a select and a textarea sit
 * on the same line, at the same height, with the same focus treatment.
 *
 * Two densities:
 *   compact      Admin Command (13px, 32px rows on a mouse; 44px under a coarse pointer)
 *   comfortable  Attendee Portal (17px, 48px rows)
 *
 * Focus is the brand hairline on the control's own border (docs/05 §5: blue marks
 * interaction); an error is the destructive border plus a sentence under the field.
 */
import { createContext, useContext, useId, type ReactNode } from "react";
import { cn } from "../../lib/cn";

export type Density = "compact" | "comfortable";

const heights: Record<Density, string> = {
  compact: "h-8 px-2.5 text-13 pointer-coarse:h-11",
  comfortable: "min-h-12 px-3 py-2.5 text-17",
};

/**
 * The class recipe for any boxed control: border, height, padding, focus and error.
 * Use it on inputs, the select trigger and anything that must line up with them.
 */
export function controlClass(density: Density = "compact", invalid = false, className?: string): string {
  return cn(
    "w-full min-w-0 border bg-transparent text-foreground placeholder:text-muted-foreground transition-[border-color] duration-120 ease-standard",
    "outline-none focus-visible:border-brand focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
    "aria-[expanded=true]:border-brand",
    invalid ? "border-destructive" : "border-border hover:border-foreground/30",
    heights[density],
    className,
  );
}

/** Ids a control reads from its Field, so label, hint and error are wired without props. */
export interface FieldIds {
  id: string;
  labelId: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldIds | null>(null);

/** Inside a Field: the ids to put on the control. Outside one: null. */
export function useField(): FieldIds | null {
  return useContext(FieldContext);
}

export interface FieldProps {
  label: ReactNode;
  /** One sentence under the field. Hidden while an error shows. */
  hint?: ReactNode;
  error?: string | null;
  /** Shows "Optional" after the label when false; nothing when true (required is the default case). */
  required?: boolean;
  /** Mark optional fields explicitly. */
  optional?: boolean;
  density?: Density;
  id?: string;
  className?: string;
  /** Extra content on the label line, right-aligned (a counter, a link). */
  aside?: ReactNode;
  children: ReactNode;
}

export function Field({
  label,
  hint,
  error,
  required = false,
  optional = false,
  density = "compact",
  id,
  className,
  aside,
  children,
}: FieldProps) {
  const auto = useId();
  const controlId = id ?? `f${auto.replace(/:/g, "")}`;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const invalid = Boolean(error);
  const ids: FieldIds = {
    id: controlId,
    labelId: `${controlId}-label`,
    describedBy: invalid ? errorId : hint ? hintId : undefined,
    invalid,
    required,
  };
  return (
    <FieldContext.Provider value={ids}>
      <div className={cn("flex min-w-0 flex-col", density === "compact" ? "gap-1.5" : "gap-2", className)}>
        <div className="flex items-baseline justify-between gap-3">
          <label
            id={ids.labelId}
            htmlFor={controlId}
            className={cn("font-medium text-muted-foreground", density === "compact" ? "text-12" : "text-13")}
          >
            {label}
            {optional ? <span className="font-normal text-muted-foreground/80"> · optional</span> : null}
          </label>
          {aside ? <span className="text-11 text-muted-foreground">{aside}</span> : null}
        </div>
        {children}
        {invalid ? (
          <p id={errorId} className={cn("text-destructive", density === "compact" ? "text-12" : "text-13")}>
            {error}
          </p>
        ) : hint ? (
          <p id={hintId} className={cn("text-muted-foreground", density === "compact" ? "text-12" : "text-13")}>
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}
