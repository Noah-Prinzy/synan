import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
/** `compact` is the Admin Command size: 32px on a mouse, 44px under a coarse pointer. */
export type ButtonSize = "compact" | "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

// Labels are the UI sans in sentence case; mono is for data only. Square, no outline (D-37):
// the one filled action is ink (--action); everything else is a tonal block or quiet text.
// Focus is the square brand ring from theme.css.
const base =
  "pressable relative inline-flex items-center justify-center gap-2 font-sans font-medium transition-[color,background-color,box-shadow] duration-120 ease-standard disabled:cursor-not-allowed motion-reduce:transition-none";

// Disabled drops every variant to a quiet tonal block with muted words: never a grey ink block,
// never an outline. A disabled button does not react to the pointer.
const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-action text-action-foreground hover:shadow-[0_0_0_4px_color-mix(in_srgb,var(--brand)_18%,transparent)] disabled:bg-surface-2 disabled:text-muted-foreground disabled:shadow-none",
  secondary: "bg-surface-2 text-foreground hover:bg-surface-3 disabled:bg-surface-2 disabled:text-muted-foreground",
  quiet: "text-muted-foreground hover:bg-surface-2 hover:text-foreground disabled:bg-transparent disabled:opacity-50 disabled:hover:text-muted-foreground",
  danger: "bg-surface-2 text-destructive hover:bg-surface-3 disabled:opacity-50 disabled:hover:bg-surface-2",
};

const sizes: Record<ButtonSize, string> = {
  compact: "h-8 px-3 text-13 whitespace-nowrap pointer-coarse:h-11 pointer-coarse:px-4",
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
        <span aria-hidden="true" className="size-2 animate-spin bg-current motion-reduce:animate-none" />
      ) : null}
      {children}
    </button>
  );
}
