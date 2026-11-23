import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

// Labels are the UI sans in sentence case; mono is for data only. Both sizes meet the
// 44px touch target. The primary fill is the `--action` token (neutral by rule).
const base =
  "pressable relative inline-flex items-center justify-center gap-2 border font-sans font-medium transition-[color,background-color,border-color] duration-120 ease-standard focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";

const variants: Record<ButtonVariant, string> = {
  primary: "border-action bg-action text-action-foreground hover:bg-transparent hover:text-foreground",
  secondary: "border-border text-foreground hover:border-foreground",
  quiet: "border-transparent text-muted-foreground hover:text-foreground",
  danger: "border-destructive/60 text-destructive hover:border-destructive",
};

const sizes: Record<ButtonSize, string> = {
  sm: "min-h-11 px-4 text-13",
  md: "min-h-12 px-5 text-15",
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
        <span aria-hidden="true" className="size-2 animate-spin border border-current motion-reduce:animate-none" />
      ) : null}
      {children}
    </button>
  );
}
