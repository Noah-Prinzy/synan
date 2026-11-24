/**
 * D10 · Security alerts `/alerts` (docs/06 §2.3). An inbox in severity bands — critical, high,
 * medium, low — of every alert raised at the live event. Each row: kind, where, venue-local
 * time, age, state. The default view is everything not yet resolved; resolution (with a note)
 * is what takes an alert off it. `?alert=:id` opens the detail: a side panel at ≥1280, a dialog
 * below, so the alert strip's `Open` lands on the same alert.
 *
 * Reads the CommandStore (GET /breach-alerts + stream/alerts), so the list moves with the strip.
 * States: loading, error, not live, no open alerts, no match for the view, last known (link down).
 * Not built: the webhook delivery attempts tab (D14 shows the delivery log).
 */
import { useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { X } from "lucide-react";
import type { BreachAlert } from "@synan/contracts/rest";
import type { AlertState, Severity } from "@synan/contracts/enums";
import { ActionButton, Button, Dialog, cn } from "@synan/ui/components";
import { SignalShape, StatusDot, formatAge, formatClock } from "@synan/ui/data";
import { useSession } from "../access/session";
import { EmptyState, FilterChips, PageHeader, SectionHead, useDocumentTitle, zoneLabel } from "../kit";
import { ALERT_KIND_LABEL, SEVERITY_ORDER, SEVERITY_VIEW } from "../live/alert-copy";
import { useCommand } from "../live/context";
import { useNow } from "../live/hooks";
import { useSlice } from "../live/slice";
import type { VenueLayout } from "../live/transport";
import { WIDE_QUERY, useMediaQuery } from "../shell/admin-shell";
import { ALERT_STATE_VIEW, AlertDetail, whereOf } from "./alert-detail";
import { LastKnown, LiveStates, Num, useEscape, useLiveReady } from "./shared";

type View = "unresolved" | "open" | "acked" | "resolved";

const VIEWS: View[] = ["unresolved", "open", "acked", "resolved"];
const VIEW_LABEL: Record<View, string> = {
  unresolved: "Needs action",
  open: "Open",
  acked: "Acknowledged",
  resolved: "Resolved",
};

function inView(alert: BreachAlert, view: View): boolean {
  return view === "unresolved" ? alert.state !== "resolved" : alert.state === view;
}

const STATE_ORDER: Record<AlertState, number> = { open: 0, acked: 1, resolved: 2 };

export default function AlertsScreen() {
  const { event } = useCommand();
  useDocumentTitle(event ? `Alerts · ${event.title}` : "Alerts");
  const ready = useLiveReady();
  return (
    <div className="min-h-full pb-10">
      {ready ? (
        <AlertsInbox />
      ) : (
        <>
          <PageHeader code="D10" title="Security alerts" />
          <LiveStates
            what="alerts"
            notLive={() =>
              "Alerts are raised only while an event is live: breaches, capacity, gate and scanner faults. Each one is acknowledged here and resolved with a note; the counts are kept in the event's reports."
            }
          />
        </>
      )}
    </div>
  );
}

function AlertsInbox() {
  const { store, event } = useCommand();
  const alerts = useSlice(store.alerts);
  const layout = useSlice(store.layout);
  const wide = useMediaQuery(WIDE_QUERY);
  const [params, setParams] = useSearchParams();
  const timeZone = event?.timezone ?? "Africa/Kampala";
  const rawView = params.get("state");
  const view: View = VIEWS.includes(rawView as View) ? (rawView as View) : "unresolved";
  const openId = params.get("alert");
  const opener = useRef<HTMLElement | null>(null);

  const setParam = useCallback(
    (key: string, value: string | null, replace = true) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (value === null) next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace },
      ),
    [setParams],
  );

  const counts = useMemo(() => {
    const c: Record<View, number> = { unresolved: 0, open: 0, acked: 0, resolved: 0 };
    for (const alert of alerts) {
      c[alert.state] += 1;
      if (alert.state !== "resolved") c.unresolved += 1;
    }
    return c;
  }, [alerts]);

  const bands = useMemo(() => {
    const shown = alerts.filter((a) => inView(a, view));
    return SEVERITY_ORDER.map((severity) => ({
      severity,
      rows: shown
        .filter((a) => a.severity === severity)
        .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || b.occurred_at.localeCompare(a.occurred_at)),
    })).filter((band) => band.rows.length > 0);
  }, [alerts, view]);

  const selected = openId ? (alerts.find((a) => a.id === openId) ?? null) : null;
  const missing = openId !== null && selected === null;
  const panel = wide && openId !== null;

  const close = useCallback(() => {
    setParam("alert", null, false);
    // Hand focus back to the row that opened it.
    window.setTimeout(() => opener.current?.focus(), 0);
  }, [setParam]);
  useEscape(panel, close);

  const open = (alert: BreachAlert, from: HTMLElement) => {
    opener.current = from;
    setParam("alert", alert.id, false);
    if (wide) window.setTimeout(() => document.getElementById("alert-detail-title")?.focus(), 0);
  };

  const empty = bands.length === 0;

  return (
    <>
      <PageHeader
        code="D10"
        title="Security alerts"
        meta={
          <>
            {event?.title} · <Num value={counts.open} /> open · <Num value={counts.acked} /> acknowledged · times in{" "}
            {zoneLabel(timeZone, store.now())}
          </>
        }
      />
      <LastKnown />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <FilterChips
          label="Show alerts"
          value={view}
          onChange={(value) => setParam("state", value === "unresolved" ? null : value)}
          options={VIEWS.map((v) => ({ value: v, label: VIEW_LABEL[v], count: counts[v] }))}
        />
        <p className="text-12 text-muted-foreground">Resolution needs a note. Acknowledge is one click.</p>
      </div>

      <div className={cn("min-w-0", panel && "xl:grid xl:grid-cols-12")}>
        <div className={cn("min-w-0", panel && "xl:col-span-7 2xl:col-span-8")}>
          {empty ? (
            <EmptyInbox view={view} counts={counts} onView={(v) => setParam("state", v === "unresolved" ? null : v)} />
          ) : (
            bands.map((band) => (
              <Band
                key={band.severity}
                severity={band.severity}
                rows={band.rows}
                layout={layout}
                timeZone={timeZone}
                selectedId={openId}
                onOpen={open}
              />
            ))
          )}
        </div>
        {panel ? (
          <aside aria-labelledby="alert-detail-title" className="min-w-0 border-t border-border xl:col-span-5 xl:border-t-0 xl:border-l 2xl:col-span-4">
            <div className="sticky top-0 max-h-[calc(100dvh-8rem)] overflow-y-auto">
              <SectionHead
                title="Alert"
                actions={
                  <Button variant="quiet" size="compact" aria-label="Close the alert" onClick={close}>
                    <X size={14} strokeWidth={1.5} aria-hidden="true" />
                  </Button>
                }
              />
              {selected ? (
                <AlertDetail key={selected.id} alert={selected} layout={layout} timeZone={timeZone} headingId="alert-detail-title" />
              ) : (
                <MissingAlert />
              )}
            </div>
          </aside>
        ) : null}
      </div>

      <Dialog
        open={!wide && openId !== null}
        onClose={close}
        width="lg"
        title={selected ? ALERT_KIND_LABEL[selected.kind] : "Alert"}
        description={selected ? `${SEVERITY_VIEW[selected.severity].label} · ${ALERT_STATE_VIEW[selected.state].label}` : undefined}
        footer={
          <Button variant="secondary" size="compact" onClick={close}>
            Close
          </Button>
        }
        className="[&>div>div]:px-0 [&>div>div]:py-0"
      >
        {selected ? <AlertDetail key={selected.id} alert={selected} layout={layout} timeZone={timeZone} /> : missing ? <MissingAlert /> : null}
      </Dialog>
    </>
  );
}

function MissingAlert() {
  return (
    <div className="px-4 py-4">
      <p className="text-13">That alert is not part of this event.</p>
      <p className="mt-1 text-12 text-muted-foreground">It may belong to another event: choose that event in the selector at the top, then open the link again.</p>
    </div>
  );
}

function EmptyInbox({ view, counts, onView }: { view: View; counts: Record<View, number>; onView: (view: View) => void }) {
  const { event } = useCommand();
  if (view === "unresolved" || view === "open") {
    return (
      <EmptyState
        title="No open alerts"
        action={
          counts.resolved > 0 || (view === "open" && counts.acked > 0) ? (
            <Button variant="secondary" size="compact" onClick={() => onView(view === "open" && counts.acked > 0 ? "acked" : "resolved")}>
              {view === "open" && counts.acked > 0 ? `Show acknowledged (${counts.acked})` : `Show resolved (${counts.resolved})`}
            </Button>
          ) : undefined
        }
      >
        <p className="flex items-center gap-2">
          <SignalShape state="ok" className="text-success" />
          Nothing needs attention at {event?.title ?? "this event"}.
        </p>
        <p className="mt-1">New alerts appear here and on the strip above the moment they are raised.</p>
      </EmptyState>
    );
  }
  return (
    <EmptyState title={view === "acked" ? "No acknowledged alerts" : "No resolved alerts yet"}>
      {view === "acked"
        ? "Every acknowledged alert has been resolved, or none has been acknowledged."
        : "Resolved alerts and their notes collect here through the event."}
    </EmptyState>
  );
}

function Band({
  severity,
  rows,
  layout,
  timeZone,
  selectedId,
  onOpen,
}: {
  severity: Severity;
  rows: BreachAlert[];
  layout: VenueLayout | null;
  timeZone: string;
  selectedId: string | null;
  onOpen: (alert: BreachAlert, from: HTMLElement) => void;
}) {
  const view = SEVERITY_VIEW[severity];
  const id = `band-${severity}`;
  return (
    <section aria-labelledby={id}>
      <header className="flex h-8 items-center gap-2 border-b border-border px-4 sm:px-6">
        <h2 id={id} className={cn("flex items-center gap-2 text-12 font-medium", view.text)}>
          <SignalShape state={view.state} />
          {view.label}
        </h2>
        <span className="font-mono text-11 text-muted-foreground tabular-nums">{rows.length}</span>
      </header>
      <div
        aria-hidden="true"
        className="hidden h-7 grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_4.75rem_5.5rem_8rem_8.5rem] items-center gap-x-4 border-b border-border px-4 text-11 text-muted-foreground sm:grid sm:px-6"
      >
        <span>Kind</span>
        <span>Where</span>
        <span>Time</span>
        <span>Age</span>
        <span>State</span>
        <span />
      </div>
      <ul>
        {rows.map((alert) => (
          <AlertRow key={alert.id} alert={alert} layout={layout} timeZone={timeZone} selected={alert.id === selectedId} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}

function AlertRow({
  alert,
  layout,
  timeZone,
  selected,
  onOpen,
}: {
  alert: BreachAlert;
  layout: VenueLayout | null;
  timeZone: string;
  selected: boolean;
  onOpen: (alert: BreachAlert, from: HTMLElement) => void;
}) {
  const { store } = useCommand();
  const { can } = useSession();
  const now = useNow(1000);
  const where = whereOf(layout, alert.checkpoint_id);
  const state = ALERT_STATE_VIEW[alert.state];
  const quiet = alert.state === "resolved";
  return (
    <li
      className={cn(
        "relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 border-b border-border px-4 py-2 transition-colors duration-120 ease-standard hover:bg-foreground/3 motion-reduce:transition-none",
        "sm:min-h-9 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_4.75rem_5.5rem_8rem_8.5rem] sm:px-6 sm:py-1",
        selected && "bg-foreground/4",
      )}
    >
      {selected ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-brand" /> : null}
      <button
        type="button"
        aria-pressed={selected}
        onClick={(e) => onOpen(alert, e.currentTarget)}
        className={cn(
          "min-w-0 truncate text-left text-13 outline-none after:absolute after:inset-0 focus-visible:after:outline focus-visible:after:-outline-offset-1 focus-visible:after:outline-brand",
          alert.state === "open" ? "font-medium" : quiet ? "text-muted-foreground" : "",
        )}
      >
        {ALERT_KIND_LABEL[alert.kind]}
        <span className="sr-only">
          , {SEVERITY_VIEW[alert.severity].label}, {state.label}
          {where ? `, at ${where.label}` : ""}
        </span>
      </button>
      <span className="justify-self-end sm:order-5 sm:justify-self-start">
        <StatusDot state={state.state} label={state.label} showLabel className="text-12" />
      </span>
      <span className="col-span-2 flex min-w-0 gap-x-2 text-12 text-muted-foreground sm:contents">
        <span className="truncate sm:order-2 sm:text-13 sm:text-foreground">
          {where ? where.label : <span className="text-muted-foreground">Whole event</span>}
          {where?.room ? <span className="text-muted-foreground"> · {where.room}</span> : null}
        </span>
        <span aria-hidden="true" className="sm:hidden">
          ·
        </span>
        <span className="shrink-0 font-mono tabular-nums sm:order-3 sm:text-12">{formatClock(alert.occurred_at, timeZone)}</span>
        <span aria-hidden="true" className="sm:hidden">
          ·
        </span>
        <span className="shrink-0 font-mono tabular-nums sm:order-4 sm:text-12">{formatAge(now - Date.parse(alert.occurred_at))}</span>
      </span>
      <span className="relative z-[1] hidden justify-self-end sm:order-6 sm:block">
        {alert.state === "open" && can("alerts.acknowledge") ? (
          <ActionButton variant="plain" reward keepDone doneLabel="Acknowledged" action={() => store.ack(alert.id)} className="h-7 text-muted-foreground hover:text-foreground">
            Acknowledge
          </ActionButton>
        ) : null}
      </span>
    </li>
  );
}
