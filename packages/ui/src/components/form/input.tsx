import { useId } from "react";
import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function Input({ label, hint, error, id, className, ...props }: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="flex flex-col gap-2">
      {label ? (
        <label
          htmlFor={inputId}
          className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-muted-foreground"
        >
          {label}
        </label>
      ) : null}
      <input
        {...props}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "w-full border border-border bg-transparent px-3 py-2.5 text-[0.9375rem] text-foreground placeholder:text-muted-foreground/70 transition-[border-color] duration-[120ms] ease-[cubic-bezier(.2,0,0,1)] focus:border-brand focus-visible:outline-none motion-reduce:transition-none",
          error && "border-destructive",
          className,
        )}
      />
      {error ? (
        <p id={`${inputId}-error`} className="font-mono text-[0.625rem] uppercase tracking-[0.08em] text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
