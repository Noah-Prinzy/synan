/**
 * D1 · Command Center (docs/06 §2.3, D-37 "the instrument"). One page, top to bottom: a
 * statement of how things stand ("All calm at Nexus Hall.", or what needs you), the four figures
 * in one instrument strip, the venue map on its still dot grid beside the rooms list, then the
 * recent activity beside the gates. Every word of the statement comes from live data; nothing is
 * said that the data does not show.
 *
 * States, all designed (docs/05 §1.8): loading, error, no live event, live, and
 * degraded (link down → the map dims to "last known"; gates offline → said in words).
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CircleCheck, OctagonAlert } from "lucide-react";
import { ERROR_COPY } from "@synan/contracts/copy";
import type { BreachAlert } from "@synan/contracts/rest";
import { surfaceName } from "@synan/ui/brand";
import { ActionButton, Button, buttonClass, cn } from "@synan/ui/components";
import { SignalShape, formatAge, formatClock, formatNumber } from "@synan/ui/data";
import { Can, useCan } from "../access/session";
import { ALERT_KIND_LABEL, SEVERITY_VIEW } from "../live/alert-copy";
import { useCommand } from "../live/context";
import { useNow } from "../live/hooks";
import { useSlice, useSliceValue } from "../live/slice";
import type { VenueLayout } from "../live/transport";
import { useMediaQuery } from "../shell/admin-shell";
import { topOpenAlert } from "../shell/alert-strip";
import { useLiveState } from "../shell/top-bar";
import { Figure, KpiStrip, STRIP, countLevel } from "./kpi-strip";
import { GatesSection, LiveFeed, RoomDetail, RoomsList } from "./rail";
import { RecountDialog } from "./recount-dialog";
import { MapLegend, ZoneMap } from "./zone-map";

/** From 640 up the map is the room view; below it, a list with the map one tap away. */
const ROOMY_QUERY = "(min-width: 40rem)";
type MapView = "list" | "map";

/** The page's frame: the gutter, and the space between its bands. */
const PAGE = "flex flex-col gap-4 px-4 pt-8 pb-12 sm:px-6 sm:pt-10 2xl:px-8";
/** A panel: a tonal surface (a soft depth on light). */
const PANEL = "bg-surface shadow-depth";
/** The two columns from 1024 up: the map, and the rooms beside it. */
const COLUMNS = "grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem] 2xl:grid-cols-[minmax(0,1fr)_28rem]";

export default function CommandCenter() {
  const { store, event } = useCommand();
  const load = useSlice(store.load);
  const layout = useSlice(store.layout);
  const linkStatus = useSliceValue(store.link, (l) => l.status);
  const [search, setSearch] = useSearchParams();
  const selectedId = search.get("room");
  const [recountId, setRecountId] = useState<string | null>(null);
  const timeZone = event?.timezone ?? "Africa/Kampala";
  const roomy = useMediaQuery(ROOMY_QUERY);
  const [view, setView] = useState<MapView>("list");

  const select = useCallback(
    (roomId: string | null) => {
      setSearch(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (roomId) next.set("room", roomId);
          else next.delete("room");
          return next;
        },
        { replace: false },
      );
    },
    [setSearch],
  );

  const onMapSelect = useCallback((id: string) => select(id === selectedId ? null : id), [select, selectedId]);

  useEffect(() => {
    document.title = event ? `Command Center · ${event.title} · ${surfaceName("admin")}` : `Command Center · ${surfaceName("admin")}`;
  }, [event]);

  // Every hook is above this line: the not-live state returns early.
  if (load.status === "not-live") return <NotLive />;

  const ready = load.status === "ready" && layout !== null;
  const stale = ready && linkStatus !== "live";
  // On a phone the rooms are a list first (the map is a tap away): a 24-room plan at 390px
  // cannot carry names and counts at a readable size.
  const showList = !roomy && view === "list";
  const roomsPanel = selectedId ? (
    <RoomDetail layout={layout!} roomId={selectedId} onBack={() => select(null)} onRecount={() => setRecountId(selectedId)} />
  ) : (
    <RoomsList layout={layout!} selectedId={selectedId} onSelect={select} />
  );

  return (
    <div className={PAGE}>
      <Statement ready={ready} layout={layout} timeZone={timeZone} />
      <KpiStrip loading={!ready} />
      <div className={COLUMNS}>
        <section aria-label="Venue map" className={cn(PANEL, "flex min-w-0 flex-col")}>
          <MapHeader
            layout={ready ? layout : null}
            selectedId={selectedId}
            onClear={() => select(null)}
            stale={stale}
            view={roomy ? null : view}
            onView={setView}
          />
          {showList && ready ? (
            <div className="pb-2">{roomsPanel}</div>
          ) : (
            <div className="px-3 pb-3 sm:px-5 sm:pb-5">
              <div
                className="map-grid relative min-h-64"
                // The map takes the venue's own proportions, so it is never a band of empty space.
                style={{ aspectRatio: ready ? `${layout.grid.w} / ${layout.grid.h}` : "16 / 10" }}
              >
                {ready ? (
                  <ZoneMap
                    layout={layout}
                    selectedId={selectedId}
                    onSelect={onMapSelect}
                    onRecount={setRecountId}
                    stale={stale}
                    timeZone={timeZone}
                  />
                ) : load.status === "error" ? (
                  <LoadError message={load.message} onRetry={() => store.retry()} />
                ) : (
                  <MapLoading />
                )}
              </div>
            </div>
          )}
        </section>
        {/* Beside the map from 1024 up, as tall as the map, scrolling inside; below it otherwise. */}
        {roomy ? (
          <div className="relative min-h-96 min-w-0">
            <div className={cn(PANEL, "flex min-h-0 flex-col lg:absolute lg:inset-0")}>{ready ? roomsPanel : <RailLoading />}</div>
          </div>
        ) : null}
      </div>
      {ready ? (
        <div className={COLUMNS}>
          <div className={PANEL}>
            <LiveFeed layout={layout} timeZone={timeZone} />
          </div>
          <div className={PANEL}>
            <GatesSection layout={layout} />
          </div>
        </div>
      ) : null}
      <RecountDialog roomId={recountId} onClose={() => setRecountId(null)} />
    </div>
  );
}

/* -------------------------------------------------------------- statement */

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const word = (n: number) => WORDS[n] ?? formatNumber(n);
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const people = (n: number) => `${formatNumber(n)} ${n === 1 ? "person" : "people"}`;
const rooms = (n: number) => `${word(n)} ${n === 1 ? "room" : "rooms"}`;

/**
 * The page's headline, in display type: how things stand, said from live data only. Calm when no
 * alert is open and every gate is online; otherwise it names what needs someone. The screen's
 * name and the event stay first in the heading for screen readers and anyone searching by it.
 */
function Statement({ ready, layout, timeZone }: { ready: boolean; layout: VenueLayout | null; timeZone: string }) {
  const { store, event } = useCommand();
  const live = useLiveState();
  const summary = useSlice(store.summary);
  const alerts = useSlice(store.alerts);
  const gates = useSlice(store.gates);
  const warn = useSliceValue(store.rooms, (r) => countLevel(r, "warn"));
  const full = useSliceValue(store.rooms, (r) => countLevel(r, "block"));
  const can = useCan();
  const now = useNow(15_000);
  const venue = layout?.venue.name ?? event?.venue_name ?? "";
  const top = can("alerts.view") ? topOpenAlert(alerts) : null;
  const openCount = alerts.filter((a) => a.state === "open").length;
  const offline = [...gates.values()].filter((g) => g.link_state === "offline");
  const label = (id: string) => layout?.checkpoints.find((c) => c.id === id)?.label;

  let headline: string;
  let lede: ReactNode = null;
  if (!ready || !summary) {
    headline = event ? `${event.title}.` : "Command Center";
    lede = "Loading the live picture…";
  } else {
    const roomWords =
      full + warn === 0
        ? "every room has space"
        : [full > 0 ? `${rooms(full)} full` : null, warn > 0 ? `${rooms(warn)} nearly full` : null].filter(Boolean).join(" and ");
    const onSite = `${people(summary.on_site)} on site`;
    if (top) {
      const checkpoint = top.checkpoint_id ? layout?.checkpoints.find((c) => c.id === top.checkpoint_id) : undefined;
      const room = checkpoint?.room_id ? layout?.rooms.find((r) => r.id === checkpoint.room_id) : undefined;
      const place = room?.name ?? checkpoint?.label;
      // A high or critical alert takes the headline; a lesser one is said as what it is.
      const serious = top.severity === "critical" || top.severity === "high";
      headline = serious
        ? place
          ? `${place} needs you.`
          : openCount === 1
            ? "An alert needs you."
            : `${capital(word(openCount))} alerts need you.`
        : `${capital(word(openCount))} ${openCount === 1 ? "alert" : "alerts"} open at ${venue}.`;
      const severity = SEVERITY_VIEW[top.severity].label.toLowerCase();
      lede = `${openCount === 1 ? `One ${severity} alert is open` : `${capital(word(openCount))} alerts are open, the most serious ${severity}`}. ${capital(onSite)} and ${roomWords}.`;
    } else if (offline.length > 0) {
      headline = offline.length === 1 ? `${label(offline[0]!.checkpoint_id) ?? offline[0]!.label} is offline.` : `${capital(word(offline.length))} gates are offline.`;
      lede = `${capital(onSite)} and ${roomWords}. Gate health has the details.`;
    } else {
      headline = `All calm at ${venue}.`;
      lede = `${capital(onSite)} and ${roomWords}.${can("alerts.view") ? " No alert needs you right now." : ""}`;
    }
  }

  const view = { live: ["ok", "Live"], reconnecting: ["warn", "Reconnecting"], offline: ["stop", "Offline"], idle: ["idle", "Not live"] } as const;
  const [shape, liveWord] = view[live];
  const date = new Date(now).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone });

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5 pb-4">
        <div className="min-w-0 max-w-[56rem]">
          <p className="eyebrow-mono flex flex-wrap items-center gap-x-2">
            <SignalShape state={shape} className={shape === "ok" ? "text-success" : shape === "warn" ? "text-warning" : shape === "stop" ? "text-destructive" : undefined} />
            <span>{liveWord}</span>
            {venue ? <span aria-hidden="true">·</span> : null}
            {venue ? <span>{venue}</span> : null}
            <span aria-hidden="true">·</span>
            <span>{date}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{formatClock(now, timeZone, { seconds: false })}</span>
          </p>
          <h1 className="type-statement mt-4">
            <span className="sr-only">Command Center{event ? ` — ${event.title}` : ""}. </span>
            {headline}
          </h1>
          {lede ? <p className="mt-4 max-w-[68ch] text-15 text-muted-foreground">{lede}</p> : null}
        </div>
        {ready && !top && can("alerts.view") ? (
          <p className="flex h-11 items-center gap-2.5 bg-surface-2 px-4 text-13 whitespace-nowrap">
            <CircleCheck aria-hidden="true" size={18} strokeWidth={1.5} className="text-success" />
            <span>
              <span className="font-medium">All clear</span> <span className="text-muted-foreground">· no open alerts</span>
            </span>
          </p>
        ) : null}
      </header>
      {ready && top ? <AlertCard alert={top} layout={layout} timeZone={timeZone} /> : null}
    </>
  );
}

/** The most serious open alert, on the page itself: what, where, when, and the two actions. */
function AlertCard({ alert, layout, timeZone }: { alert: BreachAlert; layout: VenueLayout | null; timeZone: string }) {
  const { store } = useCommand();
  const now = useNow(1000);
  const view = SEVERITY_VIEW[alert.severity];
  const serious = alert.severity === "critical" || alert.severity === "high";
  const checkpoint = alert.checkpoint_id ? layout?.checkpoints.find((c) => c.id === alert.checkpoint_id) : undefined;
  return (
    <section
      aria-label={`${view.label} alert`}
      className={cn("grid grid-cols-[minmax(0,1fr)] items-center gap-x-5 gap-y-4 px-5 py-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:px-7 md:grid-cols-[auto_minmax(0,1fr)_auto]", serious ? "bg-destructive/10" : PANEL)}
    >
      <span aria-hidden="true" className={cn("hidden size-12 place-items-center sm:grid", serious ? "bg-destructive/15" : "bg-surface-2", view.text)}>
        <OctagonAlert size={22} strokeWidth={1.5} />
      </span>
      <div className="min-w-0">
        <p className={cn("flex flex-wrap items-center gap-x-2 text-13 font-medium", serious ? "text-destructive-on-tint" : view.text)}>
          <SignalShape state={view.state} />
          {view.label}
          <span className="font-mono font-normal tabular-nums">· {formatClock(alert.occurred_at, timeZone, { seconds: false })}</span>
          <span className="font-normal text-muted-foreground">· {formatAge(now - Date.parse(alert.occurred_at))} ago</span>
        </p>
        <h2 className="mt-1 font-display text-21 leading-snug">
          {ALERT_KIND_LABEL[alert.kind]}
          {checkpoint ? <span className="text-muted-foreground"> · {checkpoint.label}</span> : null}
        </h2>
        {alert.detail ? <p className="mt-1 line-clamp-2 text-13 text-muted-foreground">{alert.detail}</p> : null}
      </div>
      <div className="col-span-full flex flex-wrap items-center gap-2 md:col-span-1">
        <Link to={`/alerts?alert=${encodeURIComponent(alert.id)}`} className={buttonClass("quiet", "compact")}>
          Open alert
        </Link>
        <Can I="alerts.acknowledge">
          <ActionButton variant="primary" size="compact" reward keepDone doneLabel="Acknowledged" action={() => store.ack(alert.id)}>
            Acknowledge
          </ActionButton>
        </Can>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- map head */

function MapHeader({
  layout,
  selectedId,
  onClear,
  stale,
  view,
  onView,
}: {
  layout: VenueLayout | null;
  selectedId: string | null;
  onClear: () => void;
  stale: boolean;
  /** The list/map switch, on a phone only; null hides it. */
  view: MapView | null;
  onView: (view: MapView) => void;
}) {
  const selected = layout?.rooms.find((r) => r.id === selectedId);
  const option = (value: MapView, text: string) => (
    <button
      type="button"
      aria-pressed={view === value}
      onClick={() => onView(value)}
      className="pressable flex h-11 items-center px-4 text-13 text-muted-foreground aria-pressed:bg-foreground aria-pressed:text-background"
    >
      {text}
    </button>
  );
  const where = layout ? [layout.venue.city, `${formatNumber(layout.zones.length)} zones`, `${formatNumber(layout.rooms.length)} rooms`].filter(Boolean).join(" · ") : null;
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 pt-5 pb-4 sm:px-6">
      <div className="min-w-0">
        <p className="eyebrow-mono">Venue map</p>
        <h2 className="mt-1.5 truncate text-17 font-medium">{layout ? layout.venue.name : "Venue"}</h2>
        {where ? <p className="mt-0.5 text-13 text-muted-foreground">{where}</p> : null}
        {stale || selected ? (
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-13">
            {stale ? (
              <span className="flex items-center gap-1.5 text-warning">
                <SignalShape state="warn" /> Last known state
              </span>
            ) : null}
            {selected ? (
              <button type="button" onClick={onClear} className="-mx-2 h-8 px-2 text-muted-foreground hover:bg-surface-2 hover:text-foreground pointer-coarse:h-11">
                {selected.name} <span aria-hidden="true">&nbsp;·&nbsp;</span>Show all rooms
              </button>
            ) : null}
          </p>
        ) : null}
      </div>
      {view ? (
        <div role="group" aria-label="Show rooms as" className="flex bg-surface-2">
          {option("list", "List")}
          {option("map", "Map")}
        </div>
      ) : layout ? (
        <MapLegend className="pt-1" />
      ) : null}
    </header>
  );
}

/* ----------------------------------------------------------------- states */

function MapLoading() {
  return (
    <div className="grid size-full place-items-center" role="status">
      <p className="text-13 text-muted-foreground">Loading the venue layout…</p>
    </div>
  );
}

function RailLoading() {
  return (
    <div aria-hidden="true" className="flex-1 px-5 pt-5">
      <div className="h-3 w-16 bg-surface-2" />
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="mt-6">
          <span className="block h-3 bg-surface-2" style={{ maxWidth: `${40 + ((i * 37) % 45)}%` }} />
          <span className="mt-3 block h-1 bg-surface-2" />
        </div>
      ))}
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const copy = message in ERROR_COPY ? ERROR_COPY[message as keyof typeof ERROR_COPY] : ERROR_COPY.INTERNAL;
  return (
    <div className="grid size-full place-items-center p-4" role="alert">
      <div className="w-80 max-w-full bg-solid px-5 py-5 shadow-pop">
        <p className="flex items-center gap-2 text-13 font-medium text-destructive">
          <SignalShape state="stop" /> Could not load the venue
        </p>
        <p className="mt-2 text-13 text-muted-foreground">{copy.message} Live counts start once the layout loads.</p>
        <Button size="compact" onClick={onRetry} className="mt-4">
          Try again
        </Button>
      </div>
    </div>
  );
}

function NotLive() {
  const { events, event, selectEvent } = useCommand();
  const can = useCan();
  const live = (events ?? []).filter((e) => e.state === "live");
  if (!event) return null;
  const starts = new Date(event.starts_at);
  const when = starts.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: event.timezone,
  });
  return (
    <div className={PAGE}>
      <header className="pb-4">
        <p className="eyebrow-mono flex items-center gap-2">
          <SignalShape state="idle" /> No live event
        </p>
        <h1 className="type-statement mt-4">
          <span className="sr-only">Command Center — {event.title}. </span>
          {event.title} is not live.
        </h1>
        <p className="mt-4 max-w-[68ch] text-15 text-muted-foreground">
          {event.state === "published" || event.state === "draft" ? (
            <>
              Doors open <span className="font-mono text-foreground">{when}</span> at {event.venue_name}.{" "}
            </>
          ) : (
            <>This event has {event.state === "closed" ? "closed" : "been archived"}. </>
          )}
          The Command Center shows live counts, gates and alerts only while an event is live.
        </p>
        {(event.state === "closed" || event.state === "archived") && can("reports.view") ? (
          <p className="mt-6">
            <Link to={`/events/${event.id}/summary`} className={buttonClass("secondary", "compact")}>
              Open the event summary →
            </Link>
          </p>
        ) : null}
      </header>
      <dl className={STRIP} aria-hidden="true">
        {["On site now", "Checked in", "Rooms filling up", "Open alerts"].map((label) => (
          <Figure key={label} label={label} value={<span className="text-muted-foreground">—</span>} />
        ))}
      </dl>
      <section aria-labelledby="not-live-now" className={cn(PANEL, "max-w-160 pb-3")}>
        <h2 id="not-live-now" className="eyebrow-mono px-5 pt-5 pb-2">
          Live now
        </h2>
        {live.length === 0 ? (
          <p className="px-5 pb-2 text-13 text-muted-foreground">No event in this organisation is live.</p>
        ) : (
          <ul>
            {live.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-4 px-5 py-2.5">
                <span>
                  <span className="block text-13 font-medium">{e.title}</span>
                  <span className="block text-12 text-muted-foreground">{e.venue_name}</span>
                </span>
                <Button size="compact" onClick={() => selectEvent(e.id)}>
                  Watch this event
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-13 text-muted-foreground">
        <span className="font-mono tabular-nums">{formatNumber((events ?? []).length)}</span> events in the organisation ·
        readiness and schedule live in the event workspace.
      </p>
    </div>
  );
}
