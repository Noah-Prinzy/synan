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

const frame: Record<BadgeTone, string> = {
  neutral: "border-border text-muted-foreground",
  success: "border-success/40 text-success",
  warning: "border-warning/40 text-warning",
  destructive: "border-destructive/40 text-destructive",
  brand: "border-brand/40 text-brand",
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
        "inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-[0.625rem] uppercase tracking-[0.12em]",
        frame[tone],
        className,
      )}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className={cn("size-1", dotTone[tone], pulse && "animate-status-pulse [animation-duration:2s] motion-reduce:animate-none")}
        />
      ) : null}
      {children}
    </span>
  );
}
