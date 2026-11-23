/**
 * Loading, error and empty states (docs/05 §1.8: every state is designed). One look for all
 * admin screens: a quiet line and a hairline sweep while loading; a hairline-framed message
 * with one retry when something failed; a short explanation and one way forward when empty.
 */
import type { ReactNode } from "react";
import { cn } from "@synan/ui/components";
import { SignalShape } from "@synan/ui/data";
import { errorCopy } from "./errors";

export function LoadingState({ label = "Loading…", rows = 0, className }: { label?: string; rows?: number; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("px-4 py-8 sm:px-6", className)}>
      <p className="text-13 text-muted-foreground">{label}</p>
      <div className="relative mt-3 h-px w-64 max-w-full overflow-hidden bg-border">
        <span aria-hidden="true" className="animate-skeleton-sweep absolute inset-y-0 w-1/3 bg-foreground/40" />
      </div>
      {rows > 0 ? (
        <div aria-hidden="true" className="mt-6 border-t border-border">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex h-9 items-center gap-6 border-b border-border">
              <span className="h-2 w-40 bg-muted/50" />
              <span className="h-2 w-24 bg-muted/30" />
              <span className="ml-auto h-2 w-16 bg-muted/30" />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ErrorState({
  title,
  error,
  onRetry,
  className,
}: {
  /** What could not happen: "Could not load the venues". */
  title: string;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const copy = errorCopy(error);
  return (
    <div role="alert" className={cn("m-4 max-w-120 border border-border sm:m-6", className)}>
      <p className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-13 font-medium text-destructive">
        <SignalShape state="stop" /> {title}
      </p>
      <p className="px-4 py-3 text-13 text-muted-foreground">{copy.message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="pressable w-full border-t border-border px-4 py-2.5 text-left text-13 font-medium transition-colors duration-120 ease-standard hover:bg-foreground/5 motion-reduce:transition-none"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title: string;
  children?: ReactNode;
  /** One way forward (a link or button). */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("max-w-160 px-4 py-10 sm:px-6", className)}>
      <h2 className="font-display text-21 leading-tight">{title}</h2>
      {children ? <div className="mt-2 text-13 leading-relaxed text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-5 flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

/** An inline, one-line notice inside a form or panel (save failed, conflict, stale data). */
export function Notice({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "neutral" | "warning" | "danger";
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 border px-3 py-2 text-12",
        tone === "danger" ? "border-destructive/40 text-destructive" : tone === "warning" ? "border-warning/40 text-warning" : "border-border text-muted-foreground",
        className,
      )}
    >
      {tone !== "neutral" ? <SignalShape state={tone === "danger" ? "stop" : "warn"} className="mt-0.5" /> : null}
      <span className="min-w-0">{children}</span>
    </p>
  );
}
