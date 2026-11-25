import { useId } from "react";
import type { InputHTMLAttributes } from "react";
import { controlClass } from "./field";

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
          className="text-15 font-medium text-foreground"
        >
          {label}
        </label>
      ) : null}
      <input
        {...props}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={controlClass("comfortable", Boolean(error), className)}
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
