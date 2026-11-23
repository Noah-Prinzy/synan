import { cn } from "../../lib/cn";

export interface AnimatedUnderlineProps {
  active: boolean;
  className?: string;
}

/** Hairline indicator that grows with transform only. Place inside a relative parent. */
export function AnimatedUnderline({ active, className }: AnimatedUnderlineProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-x-0 -bottom-px h-px origin-left bg-brand transition-transform duration-180 ease-standard motion-reduce:transition-none",
        active ? "scale-x-100" : "scale-x-0",
        className,
      )}
    />
  );
}
