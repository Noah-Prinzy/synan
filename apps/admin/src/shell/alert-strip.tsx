/**
 * The alert notice in the top bar (owner, 2026-11-24 — replaces the full-width alert strip of
 * docs/06 §2.2). It sits just left of the live state:
 *
 *   calm     a bell and "No open alerts", muted. Nothing else.
 *   open     the count and the highest severity in words and its colour ("2 open · Critical");
 *            a critical alert tints the cell and the cell pulses once when one arrives.
 *   phone    below 768 the bell with a count badge.
 *
 * It is a button: it opens a panel anchored to it (a sheet under the bar on a phone) listing the
 * open alerts, most severe first, each with Acknowledge and Open, then how many are acknowledged
 * and awaiting resolution, and a link to the Alerts page. Acknowledge is still one click.
 * Resolution lives in D10, so nothing here resolves anything. Screen readers hear new alerts
 * through the same polite/assertive live regions the strip had.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { ActionButton, cn } from "@synan/ui/components";
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

/** Most severe first, then newest. */
function bySeverity(a: BreachAlert, b: BreachAlert): number {
  return severityRank(a.severity) - severityRank(b.severity) || (a.occurred_at < b.occurred_at ? 1 : -1);
}

/** The top bar's alert notice and its panel. */
export function AlertNotice() {
  const { store } = useCommand();
  const alerts = useSlice(store.alerts);
  const flash = useSlice(store.flash);
  const load = useSlice(store.load);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const openAlerts = alerts.filter((a) => a.state === "open");
  const acked = alerts.filter((a) => a.state === "acked").length;
  const top = topOpenAlert(alerts);
  const view = top ? SEVERITY_VIEW[top.severity] : null;
  const critical = top?.severity === "critical";

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const label = top
    ? `${openAlerts.length} open ${openAlerts.length === 1 ? "alert" : "alerts"}, highest ${view?.label.toLowerCase()}. Show alerts`
    : load.status === "ready"
      ? `No open alerts${acked > 0 ? `, ${acked} acknowledged awaiting resolution` : ""}. Show alerts`
      : "Alerts";

  return (
    <div
      ref={root}
      className="relative flex shrink-0 items-stretch border-l border-border"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          close();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "relative flex h-full items-center gap-2 overflow-hidden px-3 text-13 whitespace-nowrap transition-colors duration-120 ease-standard hover:bg-foreground/4 aria-expanded:bg-foreground/4 focus-visible:-outline-offset-2 motion-reduce:transition-none sm:px-4",
          critical && "bg-destructive/10 hover:bg-destructive/15 aria-expanded:bg-destructive/15",
        )}
      >
        {/* A new critical alert: the cell pulses once (no layout change), then holds its tint. */}
        {flash && top && flash.alertId === top.id ? (
          <span key={flash.key} aria-hidden="true" className="flash-once pointer-events-none absolute inset-0 bg-destructive/35 opacity-0" />
        ) : null}
        <Bell aria-hidden="true" size={16} strokeWidth={1.5} className={cn("relative shrink-0", top ? view?.text : "text-muted-foreground")} />
        {top && view ? (
          <>
            {/* Phone: a count badge on the bell's cell. */}
            <span
              aria-hidden="true"
              className={cn("relative grid h-5 min-w-5 place-items-center border border-current px-1 font-mono text-12 tabular-nums md:hidden", view.text)}
            >
              {openAlerts.length}
            </span>
            <span aria-hidden="true" className="relative hidden items-center gap-2 md:flex">
              <span className="text-foreground">
                <span className="font-mono tabular-nums">{openAlerts.length}</span> open
              </span>
              <span className="text-muted-foreground">·</span>
              <span className={cn("flex items-center gap-1.5 font-medium", view.text)}>
                <SignalShape state={view.state} />
                {view.label}
              </span>
            </span>
          </>
        ) : (
          <span aria-hidden="true" className="relative hidden text-muted-foreground md:inline">
            {load.status === "ready" ? "No open alerts" : "Alerts"}
          </span>
        )}
      </button>
      {open ? (
        <div
          ref={panel}
          id={panelId}
          role="dialog"
          aria-label="Alerts"
          tabIndex={-1}
          className="absolute top-full right-0 z-40 mt-px flex max-h-[calc(100dvh-4rem)] w-[26rem] flex-col border border-border bg-popover text-popover-foreground outline-none max-sm:fixed max-sm:inset-x-0 max-sm:top-12 max-sm:w-auto max-sm:border-x-0"
        >
          <AlertPanel alerts={openAlerts} acked={acked} ready={load.status === "ready"} onNavigate={() => close(false)} />
        </div>
      ) : null}
      <Announcer />
    </div>
  );
}

function AlertPanel({
  alerts,
  acked,
  ready,
  onNavigate,
}: {
  alerts: BreachAlert[];
  acked: number;
  ready: boolean;
  onNavigate: () => void;
}) {
  const { store } = useCommand();
  const layout = useSlice(store.layout);
  // After Acknowledge, an alert stays in the list for a beat so the confirmation lands.
  const [held, setHeld] = useState<BreachAlert[]>([]);
  const rows = [...alerts, ...held.filter((h) => !alerts.some((a) => a.id === h.id))].sort(bySeverity);
  const where = (alert: BreachAlert) => layout?.checkpoints.find((c) => c.id === alert.checkpoint_id)?.label;

  return (
    <>
      <header className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <h2 className="text-13 font-medium">{rows.length > 0 ? "Open alerts" : "Alerts"}</h2>
        {rows.length > 0 ? <span className="text-12 text-muted-foreground">most severe first</span> : null}
      </header>
      {rows.length === 0 ? (
        <p className="px-4 py-4 text-13 text-muted-foreground">
          {ready ? "Nothing needs action right now." : "Alerts appear here once the event's live data has loaded."}
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {rows.map((alert) => {
            const view = SEVERITY_VIEW[alert.severity];
            const place = where(alert);
            return (
              <li key={alert.id} className="border-b border-border px-4 py-3 last:border-b-0">
                <p className={cn("flex items-center gap-1.5 text-12 font-medium", view.text)}>
                  <SignalShape state={view.state} />
                  {view.label}
                </p>
                <p className="mt-1 text-13 font-medium">{ALERT_KIND_LABEL[alert.kind]}</p>
                <p className="mt-0.5 line-clamp-2 text-13 text-muted-foreground">{alert.detail}</p>
                <p className="mt-1 text-12 text-muted-foreground">
                  {place ? `${place} · ` : ""}
                  <Age at={alert.occurred_at} />
                </p>
                <div className="mt-2.5 flex items-center gap-2 max-sm:flex-col max-sm:items-stretch">
                  <ActionButton
                    variant="quiet"
                    size="compact"
                    reward
                    keepDone
                    doneLabel="Acknowledged"
                    action={async () => {
                      setHeld((h) => [...h, alert]);
                      try {
                        await store.ack(alert.id);
                      } finally {
                        window.setTimeout(() => setHeld((h) => h.filter((x) => x.id !== alert.id)), 1400);
                      }
                    }}
                    className="max-sm:h-11 max-sm:w-full"
                  >
                    Acknowledge
                  </ActionButton>
                  <Link
                    to={`/alerts?alert=${encodeURIComponent(alert.id)}`}
                    onClick={onNavigate}
                    className="pressable inline-flex h-8 items-center justify-center px-3 text-13 text-muted-foreground transition-colors duration-120 ease-standard hover:text-foreground motion-reduce:transition-none pointer-coarse:h-11"
                  >
                    Open
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <footer className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-12 text-muted-foreground">
        <span>
          {acked > 0 ? (
            <>
              <span className="font-mono text-foreground tabular-nums">{acked}</span> acknowledged, awaiting resolution
            </>
          ) : (
            "None waiting for resolution"
          )}
        </span>
        <Link to="/alerts" onClick={onNavigate} className="inline-flex h-8 items-center text-13 text-foreground hover:underline hover:decoration-brand hover:underline-offset-4 pointer-coarse:h-11">
          All alerts →
        </Link>
      </footer>
    </>
  );
}

function Age({ at }: { at: string }) {
  const now = useNow(1000);
  return <span>{formatAge(now - Date.parse(at))} ago</span>;
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
