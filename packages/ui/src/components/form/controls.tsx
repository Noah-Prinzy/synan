/**
 * Text input, textarea and checkbox that read their ids from a surrounding <Field>, so
 * label, hint and error are wired for assistive tech without passing ids by hand.
 */
import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import { controlClass, useField, type Density } from "./field";

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  density?: Density;
  invalid?: boolean;
  /** Text or a unit shown inside the right edge ("people", "%"). */
  suffix?: ReactNode;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { density = "compact", invalid, suffix, className, id, ...props },
  ref,
) {
  const field = useField();
  const bad = invalid ?? field?.invalid ?? false;
  const input = (
    <input
      ref={ref}
      id={id ?? field?.id}
      aria-invalid={bad || undefined}
      aria-describedby={props["aria-describedby"] ?? field?.describedBy}
      aria-required={field?.required || undefined}
      {...props}
      className={controlClass(density, bad, cn(suffix ? "pr-14" : undefined, props.type === "number" && "font-mono tabular-nums", className))}
    />
  );
  if (!suffix) return input;
  return (
    <span className="relative block min-w-0">
      {input}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-12 text-muted-foreground"
      >
        {suffix}
      </span>
    </span>
  );
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  density?: Density;
  invalid?: boolean;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { density = "compact", invalid, className, id, rows = 3, ...props },
  ref,
) {
  const field = useField();
  const bad = invalid ?? field?.invalid ?? false;
  return (
    <textarea
      ref={ref}
      id={id ?? field?.id}
      rows={rows}
      aria-invalid={bad || undefined}
      aria-describedby={props["aria-describedby"] ?? field?.describedBy}
      {...props}
      className={controlClass(density, bad, cn("h-auto py-2 leading-relaxed pointer-coarse:h-auto", className))}
    />
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  label: ReactNode;
  /** A second, quieter line under the label. */
  description?: ReactNode;
  density?: Density;
}

/**
 * A square checkbox with its label. The box is a hairline square; checked, it carries the
 * brand check (blue = "you acted here"). The native input stays in place for keyboard,
 * form and assistive tech; only its paint is replaced.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, density = "compact", className, disabled, ...props },
  ref,
) {
  return (
    <label
      className={cn(
        "group flex cursor-pointer items-start gap-2.5",
        density === "compact" ? "text-13 pointer-coarse:min-h-11 pointer-coarse:py-2" : "min-h-11 py-1 text-15",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <span className={cn("relative grid shrink-0 place-items-center", density === "compact" ? "mt-px size-4" : "mt-0.5 size-5")}>
        <input
          ref={ref}
          type="checkbox"
          disabled={disabled}
          {...props}
          className="peer absolute inset-0 m-0 cursor-[inherit] appearance-none border border-foreground/40 bg-transparent transition-[border-color] duration-120 ease-standard checked:border-brand hover:border-foreground/70 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-brand motion-reduce:transition-none"
        />
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="pointer-events-none relative size-3 text-brand opacity-0 peer-checked:opacity-100"
        >
          <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="1.75" />
        </svg>
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-foreground">{label}</span>
        {description ? <span className="text-12 text-muted-foreground">{description}</span> : null}
      </span>
    </label>
  );
});
