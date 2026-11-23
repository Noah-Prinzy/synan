import { cn } from "../../lib/cn";
import { SignalShape, type SignalState } from "./status-dot";

/**
 * The live connection, in the chrome (docs/06 §2.2): `● LIVE 4 Hz`, `RECONNECTING`,
 * `OFFLINE`. `idle` is for a screen with nothing to stream (no live event): it is
 * not a fault, so it is not drawn as one.
 *
 * "4 Hz" is the channel's data rate, never the frame rate (P-07).
 */
export type LiveState = "live" | "reconnecting" | "offline" | "idle";

const view: Record<LiveState, { state: SignalState; text: string; spoken: string; tone: string }> = {
  live: { state: "ok", text: "LIVE", spoken: "Live", tone: "text-success border-success/40" },
  reconnecting: { state: "warn", text: "RECONNECTING", spoken: "Reconnecting", tone: "text-warning border-warning/50" },
  offline: { state: "stop", text: "OFFLINE", spoken: "Offline", tone: "text-destructive border-destructive/50" },
  idle: { state: "idle", text: "NOT LIVE", spoken: "No live event", tone: "text-muted-foreground border-border" },
};

export function LivePill({ state, rate = "4 Hz", className }: { state: LiveState; rate?: string; className?: string }) {
  const v = view[state];
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 border px-2 font-mono text-11 tracking-[0.12em] whitespace-nowrap",
        v.tone,
        className,
      )}
      aria-label={state === "live" ? `Live connection: live, ${rate}` : `Live connection: ${v.spoken}`}
    >
      <SignalShape state={v.state} />
      {v.text}
      {state === "live" ? <span className="text-muted-foreground">{rate}</span> : null}
    </span>
  );
}
