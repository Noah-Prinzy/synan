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
          className="text-13 font-medium text-muted-foreground"
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
          "w-full border border-border bg-transparent min-h-12 px-3 py-2.5 text-17 text-foreground placeholder:text-muted-foreground transition-[border-color] duration-120 ease-standard focus:border-brand focus-visible:outline-none motion-reduce:transition-none",
          error && "border-destructive",
          className,
        )}
      />
      {error ? (
        <p id={`${inputId}-error`} className="text-13 text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-13 text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
