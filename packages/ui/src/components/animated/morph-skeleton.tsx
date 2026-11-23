import type { CSSProperties } from "react";
import { cn } from "../../lib/cn";

export type SkeletonVariant = "text" | "block";

export interface MorphSkeletonProps {
  variant?: SkeletonVariant;
  width?: string | number;
  height?: string | number;
  className?: string;
  style?: CSSProperties;
}

const defaultHeight: Record<SkeletonVariant, string> = {
  text: "0.875rem",
  block: "4rem",
};

export function MorphSkeleton({
  variant = "text",
  width = "100%",
  height,
  className,
  style,
}: MorphSkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("relative overflow-hidden bg-muted", className)}
      style={{ width, height: height ?? defaultHeight[variant], ...style }}
    >
      <span className="absolute inset-0 -translate-x-full animate-skeleton-sweep bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.04),transparent)] motion-reduce:animate-none" />
    </div>
  );
}

export function SkeletonText({
  lines = 1,
  width = "100%",
  className,
}: {
  lines?: number;
  width?: string | number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, index) => (
        <MorphSkeleton
          key={index}
          variant="text"
          width={index === lines - 1 ? "75%" : width}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("border border-border p-5", className)}>
      <SkeletonText lines={3} />
    </div>
  );
}
