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
import { useCommand } from "../live/context";
import { useSlice, useSliceValue } from "../live/slice";
import type { VenueLayout } from "../live/transport";
import { WIDE_QUERY, useMediaQuery } from "../shell/admin-shell";
import { KpiStrip } from "./kpi-strip";
import { GatesSection, LiveFeed, RoomDetail, RoomsList } from "./rail";
import { RecountDialog } from "./recount-dialog";
import { ZoneMap } from "./zone-map";

export default function CommandCenter() {
  const { store, event } = useCommand();
  const load = useSlice(store.load);
  const layout = useSlice(store.layout);
  const linkStatus = useSliceValue(store.link, (l) => l.status);
  const [search, setSearch] = useSearchParams();
  const selectedId = search.get("room");
  const [recountId, setRecountId] = useState<string | null>(null);
  const timeZone = event?.timezone ?? "Africa/Kampala";

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

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      {title}
      <KpiStrip loading={!ready} />
      <div className="relative grid min-h-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_26rem]">
        <section aria-label="Venue map" className="relative flex min-h-0 flex-col">
          <MapHeader layout={ready ? layout : null} selectedId={selectedId} onClear={() => select(null)} stale={stale} />
          <div className="relative min-h-0 flex-1">
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
        </section>
        <Rail
          layout={ready ? layout : null}
          selectedId={selectedId}
          onSelect={select}
          onRecount={setRecountId}
          timeZone={timeZone}
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
}: {
  layout: VenueLayout | null;
  selectedId: string | null;
  onClear: () => void;
  stale: boolean;
}) {
  const selected = layout?.rooms.find((r) => r.id === selectedId);
  return (
    <header className="flex h-8 shrink-0 items-center gap-4 overflow-hidden border-b border-border px-4 text-12 whitespace-nowrap">
      <h2 className="font-medium">{layout ? layout.venue.name : "Venue"}</h2>
      {layout ? (
        <span className="sr-only">
          {layout.rooms.length} rooms in {layout.zones.length} zones
        </span>
      ) : null}
      {stale ? (
        <span className="flex items-center gap-1.5 text-warning">
          <SignalShape state="warn" /> Last known state
        </span>
      ) : null}
      {selected ? (
        <button type="button" onClick={onClear} className="text-muted-foreground hover:text-foreground">
          Show all rooms
        </button>
      ) : null}
      <Legend />
    </header>
  );
}

function Legend() {
  return (
    <ul aria-label="Legend" className="ml-auto hidden items-center gap-4 text-11 text-muted-foreground lg:flex">
      <li className="flex items-center gap-1.5">
        <SignalShape state="warn" className="text-warning" />
        warn
      </li>
      <li className="flex items-center gap-1.5">
        <SignalShape state="stop" className="text-destructive" />
        at capacity
      </li>
    </ul>
  );
}

/* ------------------------------------------------------------------- rail */

function Rail({
  layout,
  selectedId,
  onSelect,
  onRecount,
  timeZone,
}: {
  layout: VenueLayout | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRecount: (id: string) => void;
  timeZone: string;
}) {
  const wide = useMediaQuery(WIDE_QUERY);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (wide) setOpen(false);
  }, [wide]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const content = layout ? (
    <>
      <GatesSection layout={layout} />
      {selectedId ? (
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
  );

  if (wide) {
    return (
      <aside aria-label="Rooms, gates and live feed" className="flex min-h-0 flex-col overflow-y-auto border-l border-border">
        {content}
      </aside>
    );
  }

  // Below 1280: the rail is a tab on the map's right edge.
  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className="absolute top-1/2 right-0 z-20 -translate-y-1/2 border border-r-0 border-border bg-background px-1.5 py-3 text-12 [writing-mode:vertical-rl] hover:text-foreground"
        >
          Rooms · Gates · Feed
        </button>
      ) : null}
      {open ? (
        <aside
          aria-label="Rooms, gates and live feed"
          className="absolute inset-y-0 right-0 z-30 flex w-96 max-w-full flex-col overflow-y-auto border-l border-border bg-background"
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-expanded={true}
            className="flex h-8 shrink-0 items-center justify-between border-b border-border px-4 text-12 text-muted-foreground hover:text-foreground"
          >
            Close panel <span aria-hidden="true">→</span>
          </button>
          {content}
        </aside>
      ) : null}
    </>
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
        {event.state === "closed" || event.state === "archived" ? (
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
