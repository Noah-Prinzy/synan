/**
 * D1 · Command Center (docs/06 §2.3). Twelve columns: the KPI strip across the top,
 * the map in eight, the rail in four. Below 1280 the rail collapses into a tab at
 * the map's edge that opens it over the map.
 *
 * States, all designed (docs/05 §1.8): loading, error, no live event, live, and
 * degraded (link down → the map dims to "last known"; gates offline → in the rail).
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ERROR_COPY } from "@synan/contracts/copy";
import { surfaceName } from "@synan/ui/brand";
import { SignalShape, formatNumber } from "@synan/ui/data";
import { useCan } from "../access/session";
import { useCommand } from "../live/context";
import { useSlice, useSliceValue } from "../live/slice";
import type { VenueLayout } from "../live/transport";
import { useMediaQuery } from "../shell/admin-shell";
import { KpiStrip } from "./kpi-strip";
import { GatesSection, LiveFeed, RoomDetail, RoomsList } from "./rail";
import { RecountDialog } from "./recount-dialog";
import { MapLegend, ZoneMap } from "./zone-map";

/** From 640 up the map is the room view; below it, a list with the map one tap away. */
const ROOMY_QUERY = "(min-width: 40rem)";
type MapView = "list" | "map";

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

  const title = <h1 className="sr-only">Command Center{event ? ` — ${event.title}` : ""}</h1>;

  // Every hook is above this line: the not-live state returns early.
  if (load.status === "not-live") {
    return (
      <>
        {title}
        <NotLive />
      </>
    );
  }

  const ready = load.status === "ready" && layout !== null;
  const stale = ready && linkStatus !== "live";
  // On a phone the rooms are a list first (the map is a tap away): a 24-room plan at 390px
  // cannot carry names and counts at a readable size.
  const showList = !roomy && view === "list";

  return (
    // From 1024 up the page is one screen: strip, then map beside the rail. Below it the
    // sections stack and the page scrolls, so nothing is hidden behind a tab.
    <div className="flex min-h-full flex-col lg:grid lg:h-full lg:min-h-0 lg:grid-rows-[auto_minmax(0,1fr)]">
      {title}
      <KpiStrip loading={!ready} />
      <div className="relative flex flex-col lg:grid lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_26rem]">
        <section aria-label="Venue map" className="relative flex min-h-0 flex-col">
          <MapHeader
            layout={ready ? layout : null}
            selectedId={selectedId}
            onClear={() => select(null)}
            stale={stale}
            view={roomy ? null : view}
            onView={setView}
          />
          {showList && ready ? (
            selectedId ? (
              <RoomDetail layout={layout} roomId={selectedId} onBack={() => select(null)} onRecount={() => setRecountId(selectedId)} />
            ) : (
              <RoomsList layout={layout} selectedId={selectedId} onSelect={select} />
            )
          ) : (
            <>
              <div
                className="relative min-h-64 lg:aspect-auto! lg:min-h-0 lg:flex-1"
                // Below 1024 the map panel takes the venue's own proportions, so it is never a band
                // of empty space above and below the plan.
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
              {ready ? <MapLegend className="shrink-0 border-t border-border px-4 py-2 sm:px-5" /> : null}
            </>
          )}
        </section>
        <Rail
          layout={ready ? layout : null}
          selectedId={selectedId}
          onSelect={select}
          onRecount={setRecountId}
          timeZone={timeZone}
          rooms={roomy}
        />
      </div>
      <RecountDialog roomId={recountId} onClose={() => setRecountId(null)} />
    </div>
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
      className="pressable relative flex h-11 items-center px-3 text-13 text-muted-foreground transition-colors duration-120 ease-standard after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 aria-pressed:text-foreground aria-pressed:after:bg-brand motion-reduce:transition-none"
    >
      {text}
    </button>
  );
  return (
    <header className="flex min-h-10 shrink-0 items-center gap-x-4 overflow-hidden border-b border-border pl-4 text-13 whitespace-nowrap sm:pl-5">
      <h2 className="truncate font-medium">{layout ? layout.venue.name : "Venue"}</h2>
      {layout ? (
        <span className="hidden text-12 text-muted-foreground md:inline">
          <span className="font-mono tabular-nums">{layout.zones.length}</span> zones ·{" "}
          <span className="font-mono tabular-nums">{layout.rooms.length}</span> rooms
        </span>
      ) : null}
      {stale ? (
        <span className="flex items-center gap-1.5 text-12 text-warning">
          <SignalShape state="warn" /> Last known state
        </span>
      ) : null}
      {selected ? (
        <button
          type="button"
          onClick={onClear}
          className="flex h-10 items-center text-12 text-muted-foreground transition-colors duration-120 hover:text-foreground"
        >
          {selected.name} <span aria-hidden="true">&nbsp;·&nbsp;</span>Show all rooms
        </button>
      ) : null}
      {view ? (
        <div role="group" aria-label="Show rooms as" className="ml-auto flex">
          {option("list", "List")}
          {option("map", "Map")}
        </div>
      ) : (
        <span className="pr-4" />
      )}
    </header>
  );
}

/* ------------------------------------------------------------------- rail */

function Rail({
  layout,
  selectedId,
  onSelect,
  onRecount,
  timeZone,
  rooms,
}: {
  layout: VenueLayout | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRecount: (id: string) => void;
  timeZone: string;
  /** Whether the rooms (list or one room) live here; on a phone they sit with the map instead. */
  rooms: boolean;
}) {
  // Beside the map from 1024 up (its own scroll); below the map otherwise, in the page's scroll.
  return (
    <aside
      aria-label={rooms ? "Rooms, gates and live feed" : "Gates and live feed"}
      className="flex flex-col border-t border-border lg:min-h-0 lg:overflow-y-auto lg:border-t-0 lg:border-l"
    >
      {layout ? (
        <>
          <GatesSection layout={layout} />
          {!rooms ? null : selectedId ? (
            <RoomDetail
              layout={layout}
              roomId={selectedId}
              onBack={() => onSelect(null)}
              onRecount={() => onRecount(selectedId)}
            />
          ) : (
            <RoomsList layout={layout} selectedId={selectedId} onSelect={onSelect} />
          )}
          <LiveFeed layout={layout} timeZone={timeZone} />
        </>
      ) : (
        <RailLoading />
      )}
    </aside>
  );
}

/* ----------------------------------------------------------------- states */

function MapLoading() {
  return (
    <div className="grid size-full place-items-center" role="status">
      <div className="w-64">
        <p className="text-13 text-muted-foreground">Loading the venue layout…</p>
        <div className="relative mt-3 h-px overflow-hidden bg-border">
          <span aria-hidden="true" className="animate-skeleton-sweep absolute inset-y-0 w-1/3 bg-foreground/40" />
        </div>
      </div>
    </div>
  );
}

function RailLoading() {
  return (
    <div aria-hidden="true" className="flex-1">
      <div className="h-8 border-b border-border" />
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex h-8 items-center gap-3 px-4">
          <span className="size-2 bg-muted" />
          <span className="h-2 flex-1 bg-muted/60" style={{ maxWidth: `${40 + ((i * 37) % 45)}%` }} />
          <span className="h-2 w-10 bg-muted/60" />
        </div>
      ))}
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const copy = message in ERROR_COPY ? ERROR_COPY[message as keyof typeof ERROR_COPY] : ERROR_COPY.INTERNAL;
  return (
    <div className="grid size-full place-items-center" role="alert">
      <div className="w-80 border border-border">
        <p className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-13 font-medium text-destructive">
          <SignalShape state="stop" /> Could not load the venue
        </p>
        <p className="px-4 py-3 text-13 text-muted-foreground">
          {copy.message} Live counts start once the layout loads.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="w-full border-t border-border px-4 py-2.5 text-left text-13 font-medium hover:bg-foreground/5"
        >
          Try again
        </button>
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
    <div className="h-full">
      <div className="grid grid-cols-2 gap-px border-b border-border bg-border md:grid-cols-5" aria-hidden="true">
        {["Registered", "Checked in", "On site now", "Capacity risk", "Open alerts"].map((label, index) => (
          <div key={label} className={`bg-background px-4 pt-3 pb-3 ${index === 4 ? "col-span-2 md:col-span-1" : ""}`}>
            <p className="text-12 text-muted-foreground">{label}</p>
            <p className="mt-2 font-mono text-40 leading-none text-muted-foreground/40">—</p>
            <p className="mt-2 h-5" />
          </div>
        ))}
      </div>
      <div className="max-w-160 px-4 py-8 sm:px-6">
        <p className="flex items-center gap-2 text-12 text-muted-foreground">
          <SignalShape state="idle" /> No live event
        </p>
        <h2 className="mt-2 font-display text-28 leading-tight tracking-tight">{event.title} is not live</h2>
        <p className="mt-2 text-13 text-muted-foreground">
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
          <p className="mt-4">
            <Link
              to={`/events/${event.id}/summary`}
              className="inline-block border border-border px-3 py-1.5 text-12 font-medium hover:border-foreground/50"
            >
              Open the event summary →
            </Link>
          </p>
        ) : null}
        <div className="mt-6 border border-border">
          <p className="border-b border-border px-4 py-2 text-12 text-muted-foreground">Live now</p>
          {live.length === 0 ? (
            <p className="px-4 py-3 text-13 text-muted-foreground">No event in this organisation is live.</p>
          ) : (
            <ul>
              {live.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-4 border-b border-border px-4 py-2.5 last:border-b-0">
                  <span>
                    <span className="block text-13">{e.title}</span>
                    <span className="block text-12 text-muted-foreground">{e.venue_name}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => selectEvent(e.id)}
                    className="border border-border px-3 py-1.5 text-12 font-medium hover:border-foreground/50"
                  >
                    Watch this event
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="mt-4 text-12 text-muted-foreground">
          <span className="font-mono tabular-nums">{formatNumber((events ?? []).length)}</span> events in the organisation ·
          readiness and schedule live in the event workspace.
        </p>
      </div>
    </div>
  );
}
