import type { ReactNode } from "react";
import { MorphSkeleton, buttonClass } from "@synan/ui/components";

/**
 * The designed non-default states (docs/05 §1.8). Each carries a glyph and words,
 * never colour alone.
 */

export function StateBlock({
  glyph,
  title,
  children,
  action,
  tone = "neutral",
}: {
  glyph: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "warning" | "destructive";
}) {
  const toneText = tone === "warning" ? "text-warning" : tone === "destructive" ? "text-destructive" : "text-muted-foreground";
  return (
    <div role="status" className="flex flex-col items-start gap-3 px-4 py-14 sm:px-6 md:px-10">
      <p className={`text-15 font-medium ${toneText}`}>
        <span aria-hidden="true" className="mr-2 font-mono">{glyph}</span>
        {title}
      </p>
      {children ? <div className="max-w-[46ch] text-15 leading-relaxed text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <StateBlock
      glyph="✕"
      tone="destructive"
      title={`We couldn't load ${what}.`}
      action={
        <button type="button" onClick={onRetry} className={buttonClass("secondary", "sm")}>
          Try again
        </button>
      }
    >
      The connection to the event server failed. Nothing you entered was lost.
    </StateBlock>
  );
}

export function OfflineState({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <StateBlock
      glyph="!"
      tone="warning"
      title="You're offline."
      action={
        <button type="button" onClick={onRetry} className={buttonClass("secondary", "sm")}>
          Try again
        </button>
      }
    >
      {`${what} will appear when you're back online. Your pass keeps working without a connection.`}
    </StateBlock>
  );
}

/** Hairline cells with a quiet sweep, in the shape of what is loading. */
export function SkeletonCells({ count = 3, className = "" }: { count?: number; className?: string }) {
  return (
    <div aria-busy="true" aria-label="Loading" className={`grid border-t border-border sm:grid-cols-2 lg:grid-cols-3 ${className}`}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex flex-col gap-4 border-b border-border p-6 sm:[&:not(:nth-child(2n))]:border-r lg:[&:not(:nth-child(3n))]:border-r">
          <MorphSkeleton variant="block" height="10rem" />
          <MorphSkeleton width="40%" />
          <MorphSkeleton width="80%" height="1.5rem" />
          <MorphSkeleton width="60%" />
        </div>
      ))}
    </div>
  );
}
