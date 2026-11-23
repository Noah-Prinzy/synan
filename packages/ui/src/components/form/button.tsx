import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const base =
  "inline-flex items-center justify-center gap-2 border font-mono uppercase tracking-[0.12em] transition-[color,background-color,border-color] duration-[120ms] ease-[cubic-bezier(.2,0,0,1)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";

const variants: Record<ButtonVariant, string> = {
  primary: "border-foreground bg-foreground text-background hover:bg-background hover:text-foreground",
  secondary: "border-border text-foreground hover:border-brand hover:text-brand",
  quiet: "border-transparent text-muted-foreground hover:text-foreground",
  danger: "border-destructive/60 text-destructive hover:border-destructive",
};

const sizes: Record<ButtonSize, string> = {
  sm: "px-3 py-2 text-[0.625rem]",
  md: "px-4 py-3 text-[0.6875rem]",
};

/** Shared class recipe so links can be styled as buttons. */
export function buttonClass(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(base, variants[variant], sizes[size], className);
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(base, variants[variant], sizes[size], className)}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="size-2 animate-spin border border-current motion-reduce:animate-none"
        />
      ) : null}
      {children}
    </button>
  );
}
