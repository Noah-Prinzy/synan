import { cn } from "../../lib/cn";

/**
 * A state as a shape, a colour and a word (docs/05 §1.9). The shape alone tells the
 * states apart, so the dot still reads without colour:
 *
 *   ok    filled square     success
 *   warn  triangle          warning
 *   stop  diamond           destructive
 *   idle  hollow square     muted
 */
export type SignalState = "ok" | "warn" | "stop" | "idle";

const toneText: Record<SignalState, string> = {
  ok: "text-success",
  warn: "text-warning",
  stop: "text-destructive",
  idle: "text-muted-foreground",
};

export function signalTone(state: SignalState): string {
  return toneText[state];
}

export function SignalShape({ state, className }: { state: SignalState; className?: string }) {
  return (
    <svg viewBox="0 0 8 8" aria-hidden="true" className={cn("size-2 shrink-0", className)}>
      {state === "ok" ? <rect x="1" y="1" width="6" height="6" fill="currentColor" /> : null}
      {state === "warn" ? <path d="M4 0.6 7.6 7.2H0.4Z" fill="currentColor" /> : null}
      {state === "stop" ? <path d="M4 0 8 4 4 8 0 4Z" fill="currentColor" /> : null}
      {state === "idle" ? (
        <rect x="1.5" y="1.5" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1" />
      ) : null}
    </svg>
  );
}

export interface StatusDotProps {
  state: SignalState;
  /** The state in words. Always given; visible with `showLabel`, otherwise for screen readers. */
  label: string;
  showLabel?: boolean;
  className?: string;
}

export function StatusDot({ state, label, showLabel = false, className }: StatusDotProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", toneText[state], className)} title={showLabel ? undefined : label}>
      <SignalShape state={state} />
      <span className={showLabel ? undefined : "sr-only"}>{label}</span>
    </span>
  );
}
