/**
 * Loading, error and empty states (docs/05 §1.8: every state is designed). One look for all
 * admin screens (D-37, no lines): a quiet line and a still tonal bar while loading; a message on a
 * tonal panel with one retry when something failed; a short explanation and one way forward when empty.
 */
import type { ReactNode } from "react";
import { Button, cn } from "@synan/ui/components";
import { SignalShape } from "@synan/ui/data";
import { errorCopy } from "./errors";

export function LoadingState({ label = "Loading…", rows = 0, className }: { label?: string; rows?: number; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("px-4 py-8 sm:px-6", className)}>
      <p className="text-13 text-muted-foreground">{label}</p>
      <div aria-hidden="true" className="mt-3 h-1 w-64 max-w-full bg-surface-2" />
      {rows > 0 ? (
        <div aria-hidden="true" className="mt-6">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex h-10 items-center gap-6">
              <span className="h-2 w-40 bg-surface-3" />
              <span className="h-2 w-24 bg-surface-2" />
              <span className="ml-auto h-2 w-16 bg-surface-2" />
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
    <div role="alert" className={cn("m-4 max-w-120 bg-surface px-5 py-5 shadow-depth sm:m-6", className)}>
      <p className="flex items-center gap-2 text-13 font-medium text-destructive">
        <SignalShape state="stop" /> {title}
      </p>
      <p className="mt-2 text-13 text-muted-foreground">{copy.message}</p>
      {onRetry ? (
        <Button size="compact" onClick={onRetry} className="mt-4">
          Try again
        </Button>
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
        "flex items-start gap-2 px-3 py-2.5 text-13",
        tone === "danger" ? "bg-destructive/10 text-destructive-on-tint" : tone === "warning" ? "bg-warning/10 text-warning-on-tint" : "bg-surface-2 text-muted-foreground",
        className,
      )}
    >
      {tone !== "neutral" ? <SignalShape state={tone === "danger" ? "stop" : "warn"} className="mt-0.5" /> : null}
      <span className="min-w-0">{children}</span>
    </p>
  );
}
