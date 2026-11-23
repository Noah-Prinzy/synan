/**
 * An event's lifecycle state (docs/01 §9) as a chip: shape + word + colour, never colour alone.
 * Live is the only state with a signal colour; the rest are neutral.
 */
import type { EventState } from "@synan/contracts/enums";
import { SignalShape, type SignalState } from "@synan/ui/data";
import { cn } from "@synan/ui/components";

export const EVENT_STATE_VIEW: Record<EventState, { label: string; shape: SignalState; tone: string }> = {
  draft: { label: "Draft", shape: "idle", tone: "text-muted-foreground" },
  published: { label: "Published", shape: "idle", tone: "text-foreground" },
  live: { label: "Live", shape: "ok", tone: "text-success" },
  closed: { label: "Closed", shape: "idle", tone: "text-muted-foreground" },
  archived: { label: "Archived", shape: "idle", tone: "text-muted-foreground/70" },
};

export function EventStateChip({ state, className }: { state: EventState; className?: string }) {
  const view = EVENT_STATE_VIEW[state];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-12 whitespace-nowrap", view.tone, className)}>
      <SignalShape state={view.shape} />
      {view.label}
    </span>
  );
}

export const TIER_LABEL = {
  VIP: "VIP",
  ORDINARY: "Ordinary",
  PRIVATE_INVITE: "Invitation",
  PUBLIC: "Public",
} as const;

export const TIER_ORDER = ["VIP", "ORDINARY", "PRIVATE_INVITE", "PUBLIC"] as const;
