import type { ReactNode } from "react";
import { MorphSkeleton, buttonClass } from "@synan/ui/components";

/**
 * The designed non-default states (docs/05 §1.8). Each carries a glyph and words,
 * never colour alone. Calm (D-37): centred, held apart by space, no frame.
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
    <div role="status" className="mx-auto flex max-w-xl flex-col items-center gap-3 px-5 py-20 text-center md:py-28">
      <p className="font-display text-28 leading-tight font-medium">
        <span aria-hidden="true" className={`mr-2 font-mono ${toneText}`}>{glyph}</span>
        {title}
      </p>
      {children ? <div className="max-w-[46ch] text-17 leading-relaxed text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
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
        <button type="button" onClick={onRetry} className={buttonClass("secondary", "md")}>
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
        <button type="button" onClick={onRetry} className={buttonClass("secondary", "md")}>
          Try again
        </button>
      }
    >
      {`${what} will appear when you're back online. Your pass keeps working without a connection.`}
    </StateBlock>
  );
}

/** Quiet blocks in the shape of what is loading: a picture, then its words. */
export function SkeletonCells({ count = 3, className = "" }: { count?: number; className?: string }) {
  return (
    <div aria-busy="true" aria-label="Loading" className={`mx-auto grid w-full max-w-300 gap-8 px-5 py-16 sm:grid-cols-2 md:px-8 lg:grid-cols-3 ${className}`}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex flex-col gap-4">
          <MorphSkeleton variant="block" height="10rem" />
          <MorphSkeleton width="40%" />
          <MorphSkeleton width="80%" height="1.5rem" />
        </div>
      ))}
    </div>
  );
}
