/**
 * The second, thinner strip (docs/06 §2.2): alert banners only. One line: the
 * highest open severity, with Acknowledge and Open. A critical alert flashes the
 * strip once on arrival, then settles into a steady tint until acknowledged.
 * Resolution lives in D10, so the strip never resolves anything.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { ActionButton } from "@synan/ui/components";
import type { BreachAlert } from "@synan/contracts/rest";
import { SignalShape, formatAge } from "@synan/ui/data";
import { ALERT_KIND_LABEL, SEVERITY_VIEW, severityRank } from "../live/alert-copy";
import { useCommand } from "../live/context";
import { useNow } from "../live/hooks";
import { useSlice } from "../live/slice";

export function topOpenAlert(alerts: readonly BreachAlert[]): BreachAlert | null {
  let top: BreachAlert | null = null;
  for (const alert of alerts) {
    if (alert.state !== "open") continue;
    if (
      !top ||
      severityRank(alert.severity) < severityRank(top.severity) ||
      (alert.severity === top.severity && alert.occurred_at > top.occurred_at)
    ) {
      top = alert;
    }
  }
  return top;
}

export function AlertStrip() {
  const { store } = useCommand();
  const alerts = useSlice(store.alerts);
  const flash = useSlice(store.flash);
  const layout = useSlice(store.layout);
  const load = useSlice(store.load);
  // After Acknowledge, hold that alert on the strip for a beat so the confirmation lands
  // before the next alert takes its place.
  const [held, setHeld] = useState<BreachAlert | null>(null);
  const top = held ?? topOpenAlert(alerts);
  const open = alerts.filter((a) => a.state === "open").length;
  const acked = alerts.filter((a) => a.state === "acked").length;
  const where = top ? layout?.checkpoints.find((c) => c.id === top.checkpoint_id)?.label : undefined;
  const critical = top?.severity === "critical";

  return (
    <section
      aria-label="Alerts"
      className={`relative flex h-8 items-stretch overflow-hidden border-b border-border text-13 ${
        critical ? "bg-destructive/10" : ""
      }`}
    >
      {flash && top && flash.alertId === top.id ? (
        <span key={flash.key} aria-hidden="true" className="flash-once pointer-events-none absolute inset-0 bg-destructive/35 opacity-0" />
      ) : null}
      {top ? (
        <>
          <span className={`relative flex shrink-0 items-center gap-2 border-r border-border px-4 ${SEVERITY_VIEW[top.severity].text}`}>
            <SignalShape state={SEVERITY_VIEW[top.severity].state} />
            <span className="font-medium">{SEVERITY_VIEW[top.severity].label}</span>
          </span>
          <span className="relative flex min-w-0 flex-1 items-center gap-3 px-4">
            <span className="shrink-0 font-medium">{ALERT_KIND_LABEL[top.kind]}</span>
            <span className="min-w-0 truncate text-muted-foreground">{top.detail}</span>
            {where ? <span className="hidden shrink-0 text-muted-foreground xl:inline">· {where}</span> : null}
            <AlertAge at={top.occurred_at} />
          </span>
          {open > 1 ? (
            <Link
              to="/alerts"
              className="relative flex shrink-0 items-center border-l border-border px-4 text-12 text-muted-foreground hover:text-foreground"
            >
              <span className="font-mono tabular-nums">+{open - 1}</span>&nbsp;more open
            </Link>
          ) : null}
          <ActionButton
            key={top.id}
            variant="plain"
            reward
            keepDone
            doneLabel="Acknowledged"
            action={async () => {
              setHeld(top);
              try {
                await store.ack(top.id);
              } finally {
                window.setTimeout(() => setHeld(null), 1400);
              }
            }}
            className="relative shrink-0 border-l-border px-4 hover:bg-foreground/5"
          >
            Acknowledge
          </ActionButton>
          <Link
            to={`/alerts?alert=${encodeURIComponent(top.id)}`}
            className="relative flex shrink-0 items-center border-l border-border px-4 text-12 text-muted-foreground transition-colors duration-120 ease-standard hover:text-foreground motion-reduce:transition-none"
          >
            Open
          </Link>
        </>
      ) : (
        <span className="flex items-center gap-2 px-4 text-12 text-muted-foreground">
          <SignalShape state="idle" />
          {load.status === "ready" ? "No open alerts" : load.status === "not-live" ? "No live event" : "Alerts load with the event"}
          {acked > 0 ? (
            <Link to="/alerts" className="hover:text-foreground">
              · <span className="font-mono tabular-nums">{acked}</span> acknowledged, awaiting resolution
            </Link>
          ) : null}
        </span>
      )}
      <Announcer />
    </section>
  );
}

function AlertAge({ at }: { at: string }) {
  const now = useNow(1000);
  return (
    <span className="ml-auto shrink-0 font-mono text-12 text-muted-foreground tabular-nums">
      {formatAge(now - Date.parse(at))} ago
    </span>
  );
}

/** Live regions: polite for most changes, assertive for critical alerts only. */
function Announcer() {
  const { store } = useCommand();
  const said = useSlice(store.announce);
  return (
    <>
      <span role="status" aria-live="polite" className="sr-only">
        {said.polite}
      </span>
      <span role="alert" aria-live="assertive" className="sr-only">
        {said.assertive}
      </span>
    </>
  );
}
