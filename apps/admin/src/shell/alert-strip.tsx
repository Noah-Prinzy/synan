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
      className={`relative flex flex-wrap items-stretch overflow-hidden border-b border-border text-13 sm:h-8 sm:flex-nowrap ${
        critical ? "bg-destructive/10" : ""
      }`}
    >
      {flash && top && flash.alertId === top.id ? (
        <span key={flash.key} aria-hidden="true" className="flash-once pointer-events-none absolute inset-0 bg-destructive/35 opacity-0" />
      ) : null}
      {top ? (
        <>
          <span className={`relative order-1 flex min-h-8 shrink-0 items-center gap-2 border-r border-border px-4 ${SEVERITY_VIEW[top.severity].text}`}>
            <SignalShape state={SEVERITY_VIEW[top.severity].state} />
            <span className="font-medium">{SEVERITY_VIEW[top.severity].label}</span>
          </span>
          <span className="relative order-2 flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-1.5 sm:flex-nowrap sm:py-0">
            <span className="shrink-0 font-medium">{ALERT_KIND_LABEL[top.kind]}</span>
            {/* On a phone the detail takes its own line under the kind and age. */}
            <span className="order-last min-w-0 basis-full truncate text-muted-foreground sm:order-none sm:basis-auto">{top.detail}</span>
            {where ? <span className="hidden shrink-0 text-muted-foreground xl:inline">· {where}</span> : null}
            <AlertAge at={top.occurred_at} />
          </span>
          {open > 1 ? (
            <Link
              to="/alerts"
              className="relative order-3 hidden shrink-0 items-center border-l border-border px-4 text-12 text-muted-foreground hover:text-foreground sm:flex"
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
            className="relative order-5 h-11 shrink-0 basis-full border-t-border px-4 text-13 hover:bg-foreground/5 sm:order-4 sm:h-auto sm:basis-auto sm:border-t-transparent sm:border-l-border"
          >
            Acknowledge
          </ActionButton>
          <Link
            to={`/alerts?alert=${encodeURIComponent(top.id)}`}
            className="relative order-3 flex shrink-0 items-center border-l border-border px-4 text-12 text-muted-foreground transition-colors sm:order-5 duration-120 ease-standard hover:text-foreground motion-reduce:transition-none"
          >
            Open
          </Link>
        </>
      ) : (
        <span className="flex min-h-8 items-center gap-2 px-4 text-12 text-muted-foreground">
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
