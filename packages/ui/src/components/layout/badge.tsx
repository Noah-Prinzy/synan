import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type BadgeTone = "neutral" | "success" | "warning" | "destructive" | "brand";

export interface BadgeProps {
  tone?: BadgeTone;
  dot?: boolean;
  pulse?: boolean;
  children: ReactNode;
  className?: string;
}

// A tonal chip, no outline (D-37): the signal tones sit on a faint tint of their own colour.
const frame: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-muted-foreground",
  success: "bg-success/12 text-success-on-tint",
  warning: "bg-warning/12 text-warning-on-tint",
  destructive: "bg-destructive/12 text-destructive-on-tint",
  brand: "bg-surface-2 text-brand",
};

const dotTone: Record<BadgeTone, string> = {
  neutral: "bg-muted-foreground",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  brand: "bg-brand",
};

export function Badge({ tone = "neutral", dot = false, pulse = false, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 font-sans text-13 font-medium leading-none",
        frame[tone],
        className,
      )}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className={cn("size-1.5 rounded-full", dotTone[tone], pulse && "animate-status-pulse")}
        />
      ) : null}
      {children}
    </span>
  );
}
