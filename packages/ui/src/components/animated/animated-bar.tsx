import { cn } from "../../lib/cn";

export type BarTone = "neutral" | "success" | "warning" | "destructive";

export interface AnimatedBarProps {
  /** 0-100 */
  value: number;
  tone?: BarTone;
  label?: string;
  className?: string;
}

const fillTone: Record<BarTone, string> = {
  neutral: "bg-foreground",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

export function AnimatedBar({ value, tone = "neutral", label, className }: AnimatedBarProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className={cn("h-px w-full overflow-hidden bg-border", className)}
    >
      <div
        className={cn(
          "h-full w-full origin-left transition-transform duration-[240ms] ease-[cubic-bezier(.2,0,0,1)] motion-reduce:transition-none",
          fillTone[tone],
        )}
        style={{ transform: `scaleX(${clamped / 100})` }}
      />
    </div>
  );
}
