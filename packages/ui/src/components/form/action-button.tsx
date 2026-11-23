/**
 * Interaction feedback (owner, 2026-11-23: "less animation, but reward for click").
 *
 * ActionButton — a button that starts work and answers it in place:
 *   idle → working (the label keeps its width; a short blue rule runs along the foot)
 *        → done (a blue check draws itself; the label says what happened) → idle again
 *        → failed (a plain sentence, no shake; press to try again)
 * `reward` marks a key moment: a blue hairline draws under the button once and phones
 * get a light haptic tick. Everything is a state change without movement under reduced
 * motion, and nothing blocks the next action.
 *
 * Blue here means "you can act / you just acted" — never a state (states keep green,
 * amber and red).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";

/** A light tick where the Vibration API exists (most Android phones). Silent elsewhere. */
export function haptic(pattern: number | number[] = 12): void {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(pattern);
  } catch {
    /* not available */
  }
}

/** A check that draws itself in the current colour. */
export function DrawnCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cn("size-3.5 shrink-0", className)}>
      <path d="M3 8.5 6.5 12 13 4.5" pathLength={24} fill="none" stroke="currentColor" strokeWidth="1.75" className="draw-check" />
    </svg>
  );
}

/** A single blue hairline drawing under a completed result. Place inside a relative parent. */
export function RewardRule({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("rule-in pointer-events-none absolute inset-x-0 -bottom-px h-px bg-brand", className)} />;
}

/**
 * A key moment arriving (registration sent, pass ready, band bound): a blue check draws,
 * the word settles, one blue rule draws under it, and phones get one haptic tick — once,
 * on mount. The word keeps its own colour (a state word stays green; blue is the act).
 */
export function RewardMoment({ children, className }: { children: ReactNode; className?: string }) {
  useEffect(() => haptic(), []);
  return (
    <span className={cn("relative inline-flex items-center gap-2 pb-1", className)}>
      <DrawnCheck className="text-brand" />
      <span className="settle-in">{children}</span>
      <RewardRule />
    </span>
  );
}

type Phase = "idle" | "working" | "done" | "failed";

export interface ActionButtonProps {
  /** The work. Resolve to finish; throw to fail. */
  action: () => Promise<unknown> | unknown;
  children: ReactNode;
  /** What happened, shown with the check: "Acknowledged", "Saved", "Bound". */
  doneLabel: ReactNode;
  failedLabel?: ReactNode;
  /** A key moment: the blue rule and a haptic tick. Use sparingly. */
  reward?: boolean;
  /** Stay in the done state (the action cannot be repeated). */
  keepDone?: boolean;
  variant?: "primary" | "quiet" | "plain";
  /** `compact` matches Button size="compact" and the form controls (32px; 44px on touch). */
  size?: "inline" | "compact";
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  "aria-label"?: string;
}

const variants = {
  primary: "bg-action text-action-foreground border border-transparent hover:opacity-90",
  quiet: "border border-border hover:border-foreground/50",
  plain: "border border-transparent",
} as const;

export function ActionButton({
  action,
  children,
  doneLabel,
  failedLabel = "Didn't work — try again",
  reward = false,
  keepDone = false,
  variant = "quiet",
  size = "inline",
  className,
  disabled,
  type = "button",
  ...rest
}: ActionButtonProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const timer = useRef<number | null>(null);
  const alive = useRef(true);
  // Set on every mount, not only at first render: StrictMode (development) mounts, unmounts and
  // mounts again, and a flag set only once would stay false and freeze the button in "working".
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const run = async () => {
    if (phase === "working" || (keepDone && phase === "done")) return;
    setPhase("working");
    try {
      await action();
      if (!alive.current) return;
      setPhase("done");
      if (reward) haptic();
      if (!keepDone) timer.current = window.setTimeout(() => alive.current && setPhase("idle"), 1600);
    } catch {
      if (alive.current) setPhase("failed");
    }
  };

  const current = phase === "done" ? doneLabel : phase === "failed" ? failedLabel : children;
  return (
    <>
    <button
      type={type}
      onClick={() => void run()}
      disabled={disabled}
      aria-busy={phase === "working" || undefined}
      aria-label={rest["aria-label"]}
      className={cn(
        "pressable relative inline-grid place-items-center overflow-visible px-3 font-medium whitespace-nowrap transition-colors duration-120 ease-standard disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
        size === "compact" ? "h-8 text-13 pointer-coarse:h-11 pointer-coarse:px-4" : "text-12",
        variants[variant],
        className,
      )}
    >
      {/* All labels share one grid cell, so the button never changes width. */}
      {/* One spoken name; the stacked visual labels below are hidden from assistive tech. */}
      <span className="sr-only">{current}</span>
      <span aria-hidden="true" className={cn("col-start-1 row-start-1 flex items-center gap-1.5", phase === "idle" ? "" : "invisible")}>{children}</span>
      <span className={cn("col-start-1 row-start-1 flex items-center gap-1.5", phase === "working" ? "" : "invisible")} aria-hidden="true">
        {children}
      </span>
      <span
        className={cn("col-start-1 row-start-1 flex items-center gap-1.5", phase === "done" ? "settle-in" : "invisible")}
        aria-hidden="true"
      >
        {phase === "done" ? <DrawnCheck className={variant === "primary" ? undefined : "text-brand"} /> : null}
        {doneLabel}
      </span>
      <span className={cn("col-start-1 row-start-1 flex items-center gap-1.5 text-destructive", phase === "failed" ? "" : "invisible")} aria-hidden="true">
        {failedLabel}
      </span>
      {phase === "working" ? (
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-px overflow-hidden">
          <span className="busy-rule absolute inset-y-0 left-0 w-1/3 bg-brand" />
        </span>
      ) : null}
      {phase === "done" && reward ? <RewardRule /> : null}
    </button>
    <span role="status" className="sr-only">
      {phase === "working" ? "Working" : phase === "done" ? doneLabel : phase === "failed" ? failedLabel : ""}
    </span>
    </>
  );
}
