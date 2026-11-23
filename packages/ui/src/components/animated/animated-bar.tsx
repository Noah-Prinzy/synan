import { useEffect, useRef, useState } from "react";
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

/**
 * A hairline bar that grows with transform: scaleX, never width (docs/05 §5).
 * It starts empty and grows to its value the first time it scrolls into view; later
 * changes transition from wherever it is.
 */
export function AnimatedBar({ value, tone = "neutral", label, className }: AnimatedBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
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
        style={{ transform: `scaleX(${seen ? clamped / 100 : 0})` }}
      />
    </div>
  );
}
