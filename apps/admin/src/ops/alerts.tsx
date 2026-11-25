/**
 * D10 · Security alerts `/alerts` (docs/06 §2.3). An inbox in severity bands — critical, high,
 * medium, low — of every alert raised at the live event. Each row: kind, where, venue-local
 * time, age, state. The default view is everything not yet resolved; resolution (with a note)
 * is what takes an alert off it. `?alert=:id` opens the detail: a side panel at ≥1280, a dialog
 * below, so the alert notice's `Open` lands on the same alert.
 *
 * Reads the CommandStore (GET /breach-alerts + stream/alerts), so the list moves with the alert notice.
 * States: loading, error, not live, no open alerts, no match for the view, last known (link down).
 * Not built: the webhook delivery attempts tab (D14 shows the delivery log).
 */
import { useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { X } from "lucide-react";
import type { BreachAlert } from "@synan/contracts/rest";
import type { AlertState, Severity } from "@synan/contracts/enums";
import { ActionButton, Button, Dialog, cn } from "@synan/ui/components";
import { SignalShape, StatusDot, formatClock } from "@synan/ui/data";
import { useSession } from "../access/session";
import { EmptyState, FilterChips, GUTTER_X, ICON_BUTTON, PageHeader, SectionHead, TYPE, useDocumentTitle, zoneLabel } from "../kit";
import { ALERT_KIND_LABEL, SEVERITY_ORDER, SEVERITY_VIEW } from "../live/alert-copy";
import { useCommand } from "../live/context";
import { useNow } from "../live/hooks";
import { useSlice } from "../live/slice";
import type { VenueLayout } from "../live/transport";
import { WIDE_QUERY, useMediaQuery } from "../shell/admin-shell";
import { ALERT_STATE_VIEW, AlertDetail, whereOf } from "./alert-detail";
import { LastKnown, LiveStates, roughAge, useEscape, useLiveReady } from "./shared";

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
            {event?.title} · acknowledging is one click; resolving needs a note · times in {zoneLabel(timeZone, store.now())}
          </>
        }
      />
      <LastKnown />
      <div className={cn("flex flex-wrap items-center gap-3 py-3", GUTTER_X)}>
        <FilterChips
          label="Show alerts"
          value={view}
          onChange={(value) => setParam("state", value === "unresolved" ? null : value)}
          options={VIEWS.map((v) => ({ value: v, label: VIEW_LABEL[v], count: counts[v] }))}
        />
      </div>

      <div className={cn("min-w-0", panel && "xl:grid xl:grid-cols-12")}>
        <div className={cn("@container min-w-0", panel && "xl:col-span-7 2xl:col-span-8")}>
          {empty ? (
            <EmptyInbox view={view} counts={counts} onView={(v) => setParam("state", v === "unresolved" ? null : v)} />
          ) : (
            <>
              {/* One column head for every band, so the bands read as one list. */}
              <div aria-hidden="true" className={cn("hidden h-9 items-center gap-x-4 sm:grid", ROW_COLS, GUTTER_X, TYPE.label)}>
                <span>Alert</span>
                <span className="hidden @3xl:block">Raised</span>
                <span>State</span>
                <span />
              </div>
              {bands.map((band) => (
                <Band key={band.severity} severity={band.severity} rows={band.rows} layout={layout} selectedId={openId} onOpen={open} />
              ))}
            </>
          )}
        </div>
        {panel ? (
          <aside aria-labelledby="alert-detail-title" className="min-w-0 xl:col-span-5 2xl:col-span-4">
            <div className="sticky top-0 max-h-[calc(100dvh-8rem)] overflow-y-auto">
              <SectionHead
                title="Alert"
                className="pr-2 sm:pr-3"
                actions={
                  <button type="button" aria-label="Close the alert" onClick={close} className={ICON_BUTTON}>
                    <X size={16} strokeWidth={1.5} aria-hidden="true" />
                  </button>
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
        {selected ? <AlertDetail key={selected.id} alert={selected} layout={layout} timeZone={timeZone} titled /> : missing ? <MissingAlert /> : null}
      </Dialog>
    </>
  );
}

function MissingAlert() {
  return (
    <div className="px-4 py-4 sm:px-5">
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
        className={GUTTER_X}
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
        <p className="mt-1">New alerts appear here and in the alert notice at the top the moment they are raised.</p>
      </EmptyState>
    );
  }
  return (
    <EmptyState title={view === "acked" ? "No acknowledged alerts" : "No resolved alerts yet"} className={GUTTER_X}>
      {view === "acked"
        ? "Every acknowledged alert has been resolved, or none has been acknowledged."
        : "Resolved alerts and their notes collect here through the event."}
    </EmptyState>
  );
}

/** Alert · where · raised · state · the row action. Shared by the column head and every row. */
// The list answers to its own width (it narrows when the detail panel opens): from 48rem it has a
// Raised column; narrower, the age joins the muted line under the kind.
const ROW_COLS = "sm:grid-cols-[minmax(0,1fr)_7.5rem_8.5rem] @3xl:grid-cols-[minmax(0,1fr)_6.5rem_7.5rem_8.5rem]";

function Band({
  severity,
  rows,
  layout,
  selectedId,
  onOpen,
}: {
  severity: Severity;
  rows: BreachAlert[];
  layout: VenueLayout | null;
  selectedId: string | null;
  onOpen: (alert: BreachAlert, from: HTMLElement) => void;
}) {
  const view = SEVERITY_VIEW[severity];
  const id = `band-${severity}`;
  return (
    <section aria-labelledby={id}>
      <header className={cn("flex h-9 items-center gap-2", GUTTER_X)}>
        <h2 id={id} className={cn("flex items-center gap-2 text-12 font-medium", view.text)}>
          <SignalShape state={view.state} />
          {view.label}
        </h2>
        <span className="font-mono text-12 text-muted-foreground tabular-nums">{rows.length}</span>
      </header>
      <ul>
        {rows.map((alert) => (
          <AlertRow key={alert.id} alert={alert} layout={layout} selected={alert.id === selectedId} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}

function AlertRow({
  alert,
  layout,
  selected,
  onOpen,
}: {
  alert: BreachAlert;
  layout: VenueLayout | null;
  selected: boolean;
  onOpen: (alert: BreachAlert, from: HTMLElement) => void;
}) {
  const { store, event } = useCommand();
  const { can } = useSession();
  const now = useNow(1000);
  const where = whereOf(layout, alert.checkpoint_id);
  const state = ALERT_STATE_VIEW[alert.state];
  const quiet = alert.state === "resolved";
  const raised = roughAge(now - Date.parse(alert.occurred_at));
  const at = formatClock(alert.occurred_at, event?.timezone ?? "Africa/Kampala", { seconds: false });
  return (
    <li
      className={cn(
        "relative grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-2 transition-colors duration-120 ease-standard hover:bg-surface-2 motion-reduce:transition-none",
        ROW_COLS,
        GUTTER_X,
        selected && "bg-surface-2",
      )}
    >
      {selected ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-brand" /> : null}
      {/* The kind, then where it is and what happened on one muted line. */}
      <span className="min-w-0">
        <button
          type="button"
          aria-pressed={selected}
          onClick={(e) => onOpen(alert, e.currentTarget)}
          className={cn(
            "block max-w-full truncate text-left text-13 outline-none after:absolute after:inset-0 focus-visible:after:outline focus-visible:after:-outline-offset-1 focus-visible:after:outline-brand",
            alert.state === "open" ? "font-medium" : quiet ? "text-muted-foreground" : "",
          )}
        >
          {ALERT_KIND_LABEL[alert.kind]}
          <span className="sr-only">
            , {SEVERITY_VIEW[alert.severity].label}, {state.label}
            {where ? `, at ${where.label}` : ""}
          </span>
        </button>
        <span className="mt-0.5 block truncate text-12 text-muted-foreground">
          <span className={quiet ? undefined : "text-foreground/80"}>{where ? where.label : "Whole event"}</span>
          {where?.room ? <> · {where.room}</> : null}
          <span className="@3xl:hidden"> · {raised}</span>
          <span className="hidden @3xl:inline"> · {alert.detail}</span>
        </span>
      </span>
      <span className="hidden text-13 whitespace-nowrap text-muted-foreground @3xl:block" title={`Raised at ${at}`}>
        {raised}
      </span>
      <span className="justify-self-end sm:justify-self-start">
        <StatusDot state={state.state} label={state.label} showLabel className="text-13" />
      </span>
      <span className="relative z-[1] hidden justify-self-end sm:block">
        {alert.state === "open" && can("alerts.acknowledge") ? (
          <ActionButton
            variant="plain"
            size="compact"
            reward
            keepDone
            doneLabel="Acknowledged"
            action={() => store.ack(alert.id)}
            className="-mr-2.5 px-2.5 font-normal text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:text-foreground"
          >
            Acknowledge
          </ActionButton>
        ) : null}
      </span>
    </li>
  );
}
