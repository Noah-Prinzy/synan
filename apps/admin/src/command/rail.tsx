/**
 * D1's right rail (docs/06 §2.3): gate health, the rooms list sorted by utilisation
 * (or one room, drilled in), and the live feed. Rows are dense (13px, 32px rows);
 * counts and bars are written by the frame loop, so a re-sort or a level change is
 * the only thing that re-renders a row.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Room } from "@synan/contracts/rest";
import {
  CapacityMeter,
  OccupancyBar,
  ResultChip,
  Sparkline,
  StatusDot,
  clampRatio,
  formatAge,
  formatClock,
  formatNumber,
  formatOffset,
  type SignalState,
} from "@synan/ui/data";
import { ALERT_KIND_LABEL, SEVERITY_VIEW } from "../live/alert-copy";
import { useCommand } from "../live/context";
import { useNow } from "../live/hooks";
import { useSlice } from "../live/slice";
import type { FeedItem, GateLive, RoomLive } from "../live/store";
import type { VenueLayout } from "../live/transport";
import { minuteChange } from "./room-card";
import { highlight, levelState, levelWords } from "./ui-state";

/* ----------------------------------------------------------------- shared */

export function RailSection({
  title,
  meta,
  children,
  className = "",
  id,
}: {
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  id: string;
}) {
  return (
    <section aria-labelledby={id} className={`flex min-h-0 flex-col border-t border-border first:border-t-0 ${className}`}>
      <header className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b border-border px-4 sm:px-5">
        <h2 id={id} className="text-13 font-medium">
          {title}
        </h2>
        {meta ? <span className="truncate text-12 text-muted-foreground">{meta}</span> : null}
      </header>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ gates */

function gateSignal(gate: GateLive): { state: SignalState; words: string } {
  if (gate.link_state === "offline") return { state: "stop", words: "Offline" };
  if (gate.link_state === "degraded") return { state: "warn", words: "Degraded" };
  if (gate.clock_fault) return { state: "warn", words: "Clock wrong" };
  if (gate.queue_depth > 0) return { state: "warn", words: "Draining queue" };
  return { state: "ok", words: "Online" };
}

function isFault(gate: GateLive): boolean {
  return gate.link_state !== "online" || gate.clock_fault || gate.queue_depth > 0;
}

/** One gate (P-09): `offline 4m · 182 queued` is a designed state, not an error. */
export function GateHealthRow({ gate, label, now }: { gate: GateLive; label: string; now: number }) {
  const { state, words } = gateSignal(gate);
  // Words first; one figure only where it explains the problem.
  let status: ReactNode;
  if (gate.link_state === "offline") {
    const since = gate.offlineSince ? ` ${formatAge(now - gate.offlineSince)}` : "";
    status = (
      <span className="text-destructive">
        Offline{since}
        {gate.queue_depth > 0 ? ` · ${formatNumber(gate.queue_depth)} waiting` : ""}
      </span>
    );
  } else if (gate.queue_depth > 0) {
    status = <span className="text-warning">Catching up · {formatNumber(gate.queue_depth)} waiting</span>;
  } else if (gate.link_state === "degraded") {
    status = <span className="text-warning">Weak connection</span>;
  } else if (gate.clock_fault) {
    status = (
      <span className="text-warning">Clock wrong{gate.clock_offset_ms !== null ? ` by ${formatOffset(gate.clock_offset_ms)}` : ""}</span>
    );
  } else {
    status = <span className="text-muted-foreground">Online</span>;
  }
  return (
    <li className="grid min-h-8 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 sm:px-5">
      <StatusDot state={state} label={words} />
      <span className="truncate text-13">{label}</span>
      <span className="text-13 whitespace-nowrap">{status}</span>
    </li>
  );
}

export function GatesSection({ layout }: { layout: VenueLayout }) {
  const { store } = useCommand();
  const gates = useSlice(store.gates);
  const now = useNow(1000);
  const byId = new Map(layout.checkpoints.map((c) => [c.id, c]));
  const all = [...gates.values()];
  const faults = all
    .filter(isFault)
    .sort((a, b) => (a.link_state === "offline" ? -1 : 0) - (b.link_state === "offline" ? -1 : 0));
  // At rest this is one line in words. Rows appear only for gates that need someone, each with the
  // one figure that explains it; the rest is on Gate health.
  return (
    <RailSection
      id="rail-gates"
      title="Gates"
      meta={
        <Link to="/gates" className="text-muted-foreground transition-colors duration-120 hover:text-foreground">
          Gate health →
        </Link>
      }
      className="shrink-0"
    >
      <ul className="py-1.5">
        {faults.map((gate) => (
          <GateHealthRow key={gate.checkpoint_id} gate={gate} label={byId.get(gate.checkpoint_id)?.label ?? gate.label} now={now} />
        ))}
        <li className="flex min-h-8 items-center px-4 text-13 text-muted-foreground sm:px-5">
          {faults.length === 0
            ? "All gates online"
            : `${faults.length === 1 ? "1 gate needs" : `${faults.length} gates need`} attention · the others are online`}
        </li>
      </ul>
    </RailSection>
  );
}

/* ------------------------------------------------------------------ rooms */

function utilisation(room: Room, live: RoomLive | undefined): number {
  return live && room.capacity > 0 ? live.occupancy / room.capacity : 0;
}

function sortRooms(rooms: readonly Room[], live: ReadonlyMap<string, RoomLive>): string[] {
  return [...rooms]
    .sort((a, b) => utilisation(b, live.get(b.id)) - utilisation(a, live.get(a.id)) || a.name.localeCompare(b.name))
    .map((room) => room.id);
}

const RESORT_MS = 2_000;

export function RoomsList({
  layout,
  selectedId,
  onSelect,
}: {
  layout: VenueLayout;
  selectedId: string | null;
  onSelect: (roomId: string) => void;
}) {
  const { store } = useCommand();
  const live = useSlice(store.rooms);
  const [order, setOrder] = useState(() => sortRooms(layout.rooms, live));
  const [held, setHeld] = useState(false);
  const lastSort = useRef(0);
  const byId = useMemo(() => new Map(layout.rooms.map((room) => [room.id, room])), [layout]);
  const zoneById = useMemo(() => new Map(layout.zones.map((zone) => [zone.id, zone])), [layout]);

  // Re-sort at most every two seconds, and never under the pointer: a row must not
  // move while someone is reaching for it.
  useEffect(() => {
    if (held) return;
    const desired = sortRooms(layout.rooms, live);
    if (desired.length === order.length && desired.every((id, i) => id === order[i])) return;
    const wait = Math.max(0, RESORT_MS - (performance.now() - lastSort.current));
    const timer = window.setTimeout(() => {
      lastSort.current = performance.now();
      setOrder(sortRooms(layout.rooms, store.rooms.get()));
    }, wait);
    return () => window.clearTimeout(timer);
  }, [live, held, layout, order, store]);

  // Rows wholly or partly hidden below the list's fold, counted from the DOM (on scroll, resize,
  // and when the order changes) — never per frame.
  const list = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState(0);
  const measureMore = useCallback(() => {
    const el = list.current;
    if (!el) return;
    const fold = el.getBoundingClientRect().bottom - 4;
    let hidden = 0;
    for (const row of el.children) if (row.getBoundingClientRect().bottom > fold) hidden++;
    setMore((prev) => (prev === hidden ? prev : hidden));
  }, []);
  useLayoutEffect(() => {
    measureMore();
    const el = list.current;
    if (!el) return;
    const observer = new ResizeObserver(measureMore);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measureMore, order]);

  return (
    <RailSection id="rail-rooms" title="Rooms" meta={held ? "Order held while you point" : "Fullest first"} className="min-h-56 flex-1">
      <ul
        ref={list}
        onScroll={measureMore}
        // While rows are hidden below, the last visible one fades out instead of being cut by the
        // next section; the "more" line under the list says how many and scrolls to them.
        className={`min-h-0 flex-1 overflow-y-auto py-1 ${more > 0 ? "mask-[linear-gradient(to_bottom,black_calc(100%-2.5rem),transparent)]" : ""}`}
        onPointerEnter={() => setHeld(true)}
        onPointerLeave={() => {
          setHeld(false);
          highlight.set(null);
        }}
      >
        {order.map((id) => {
          const room = byId.get(id);
          if (!room) return null;
          const zone = zoneById.get(room.zone_id);
          return (
            <RoomRow
              key={id}
              room={room}
              zoneName={zone ? `${zone.floor} · ${zone.name}` : ""}
              live={live.get(id)}
              selected={id === selectedId}
              onSelect={onSelect}
            />
          );
        })}
      </ul>
      {more > 0 ? (
        <button
          type="button"
          onClick={() => list.current?.scrollBy({ top: list.current.clientHeight * 0.8, behavior: "smooth" })}
          className="flex min-h-8 shrink-0 items-center gap-1.5 px-4 text-12 text-muted-foreground transition-colors duration-120 ease-standard hover:text-foreground sm:px-5 motion-reduce:transition-none pointer-coarse:min-h-11"
        >
          <span className="font-mono tabular-nums">{more}</span> more below <span aria-hidden="true">↓</span>
        </button>
      ) : null}
    </RailSection>
  );
}

const RoomRow = memo(function RoomRow({
  room,
  zoneName,
  live,
  selected,
  onSelect,
}: {
  room: Room;
  zoneName: string;
  live: RoomLive | undefined;
  selected: boolean;
  onSelect: (roomId: string) => void;
}) {
  const { store } = useCommand();
  const count = useRef<HTMLSpanElement>(null);
  const fill = useRef<HTMLSpanElement>(null);
  useLayoutEffect(
    () =>
      store.interp.bind(`room:${room.id}`, (display) => {
        if (count.current) {
          const text = formatNumber(display);
          if (count.current.textContent !== text) count.current.textContent = text;
        }
        if (fill.current) fill.current.style.transform = `scaleX(${clampRatio(display / room.capacity)})`;
      }),
    [store, room],
  );
  const level = live?.level ?? "ok";
  const tone = level === "block" ? "text-destructive" : level === "warn" ? "text-warning" : "text-foreground";
  // One number per row: the count. Capacity shows on hover, focus and selection.
  return (
    <li>
      <button
        type="button"
        aria-current={selected || undefined}
        aria-label={`${room.name}, ${zoneName}: ${live ? formatNumber(live.occupancy) : "—"} of ${formatNumber(room.capacity)}. ${levelWords(
          level,
          room.warn_at_pct,
          room.block_at_pct,
        )}.`}
        onClick={() => onSelect(room.id)}
        onPointerEnter={() => highlight.set(room.id)}
        onFocus={() => highlight.set(room.id)}
        onBlur={() => highlight.set(null)}
        className="group/row relative grid min-h-9 w-full contain-content grid-cols-[0.5rem_minmax(0,1fr)_minmax(2rem,4rem)_4.5rem] items-center gap-3 px-4 py-1.5 text-left pointer-coarse:min-h-11 sm:px-5 transition-colors duration-120 ease-standard before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 hover:bg-foreground/4 focus-visible:bg-foreground/4 aria-current:bg-foreground/6 aria-current:before:bg-brand motion-reduce:transition-none"
      >
        {/* Calm by default: a shape only for a room that is nearly full or full. */}
        {level === "ok" ? <span aria-hidden="true" /> : <StatusDot state={levelState(level)} label={levelWords(level, room.warn_at_pct, room.block_at_pct)} />}
        {/* The name wraps at words onto a second line rather than being cut. */}
        <span className="line-clamp-2 text-13 leading-tight">{room.name}</span>
        <OccupancyBar ratio={0} level={level} fillRef={fill} className="h-1" />
        <span className="text-right font-mono text-13 tabular-nums">
          <span ref={count} className={tone} />
          <span className="hidden text-12 text-muted-foreground group-hover/row:inline group-focus-visible/row:inline group-aria-current/row:inline">
            /{formatNumber(room.capacity)}
          </span>
        </span>
      </button>
    </li>
  );
});

/* ------------------------------------------------------ one room, drilled */

export function RoomDetail({
  layout,
  roomId,
  onBack,
  onRecount,
}: {
  layout: VenueLayout;
  roomId: string;
  onBack: () => void;
  onRecount: () => void;
}) {
  const { store } = useCommand();
  const rooms = useSlice(store.rooms);
  const history = useSlice(store.history);
  const gates = useSlice(store.gates);
  useSlice(store.feed); // re-read recent scans when the feed moves
  const now = useNow(1000);
  const room = layout.rooms.find((r) => r.id === roomId);
  const zone = layout.zones.find((z) => z.id === room?.zone_id);
  const live = rooms.get(roomId);
  const { event } = useCommand();
  const zoneTz = event?.timezone ?? "Africa/Kampala";
  if (!room || !live) {
    return (
      <RailSection id="rail-room" title="Room" className="min-h-0 flex-1">
        <p className="px-4 py-3 text-13 text-muted-foreground">That room is not part of this venue.</p>
      </RailSection>
    );
  }
  const samples = history.get(roomId) ?? [];
  const change = minuteChange(samples, live.occupancy);
  const doors = layout.checkpoints.filter((c) => c.room_id === roomId);
  const recent = doors.flatMap((door) => (store.recentScans.get(door.id) ?? []).map((scan) => ({ ...scan, door }))).slice(0, 5);

  return (
    <RailSection
      id="rail-room"
      title={
        <button type="button" onClick={onBack} className="text-muted-foreground hover:text-foreground">
          ← All rooms
        </button>
      }
      meta={zone ? `${zone.floor} · ${zone.name}` : undefined}
      className="min-h-0 flex-1"
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-start justify-between gap-3 px-4 pt-3">
          <div className="min-w-0">
            <h3 className="truncate font-display text-21 leading-tight">{room.name}</h3>
            <p className="mt-0.5 text-12 text-muted-foreground">
              {room.capacity_policy === "admit_with_alert" ? "Admits with an alert at stop" : "Refuses entry at stop"}
              {room.continuous ? " · continuously occupied" : " · resets when its session ends"}
            </p>
          </div>
          <button
            type="button"
            onClick={onRecount}
            className="shrink-0 border border-border px-3 py-1.5 text-12 font-medium transition-colors duration-120 ease-standard hover:border-foreground/50 motion-reduce:transition-none"
          >
            Recount
          </button>
        </div>
        <div className="px-4 pt-4">
          <CapacityMeter
            size="lg"
            occupancy={live.occupancy}
            capacity={room.capacity}
            warnAtPct={room.warn_at_pct}
            blockAtPct={room.block_at_pct}
            level={live.level}
          />
          <p className="mt-1 flex items-center gap-2 text-12">
            <StatusDot state={levelState(live.level)} label={levelWords(live.level, room.warn_at_pct, room.block_at_pct)} showLabel />
          </p>
        </div>
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-border px-4 py-3">
          <Sparkline values={samples} label={`${room.name} occupancy, last 3 minutes`} />
          <span className="text-right">
            <span className="block font-mono text-13 tabular-nums">{change === null ? "—" : formatNumber(change, { signed: true })}</span>
            <span className="block text-11 text-muted-foreground">last minute</span>
          </span>
        </div>
        <div className="border-t border-border">
          <p className="px-4 pt-2 pb-1 text-11 text-muted-foreground">{doors.length === 1 ? "Door" : "Doors"}</p>
          <ul className="pb-1">
            {doors.map((door) => {
              const gate = gates.get(door.id);
              return gate ? <GateHealthRow key={door.id} gate={gate} label={door.label} now={now} /> : null;
            })}
          </ul>
        </div>
        <div className="border-t border-border">
          <p className="px-4 pt-2 pb-1 text-11 text-muted-foreground">Recent at the door</p>
          {recent.length === 0 ? (
            <p className="px-4 pb-3 text-12 text-muted-foreground">No scans at this door since the page opened.</p>
          ) : (
            <ul className="pb-2">
              {recent.map((scan, index) => (
                <li key={`${scan.at}-${index}`} className="grid h-6 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-4">
                  <span className="font-mono text-11 text-muted-foreground tabular-nums">{formatClock(scan.at, zoneTz)}</span>
                  <ResultChip result={scan.result} className="justify-self-start" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </RailSection>
  );
}

/* ------------------------------------------------------------- live feed */

/** Routine traffic: summarised as a rate in "notable" view, listed in "all". */
function isRoutine(item: FeedItem): boolean {
  return item.kind === "scan" && (item.result === "admitted" || item.result === "already_inside" || item.result === "duplicate_read" || item.result === "implied_exit");
}

export function LiveFeed({ layout, timeZone }: { layout: VenueLayout; timeZone: string }) {
  const { store } = useCommand();
  const feed = useSlice(store.feed);
  const label = useMemo(() => new Map(layout.checkpoints.map((c) => [c.id, c.label])), [layout]);
  const roomName = useMemo(() => new Map(layout.rooms.map((r) => [r.id, r.name])), [layout]);
  const exits = useMemo(() => new Set(layout.checkpoints.filter((c) => c.direction === "out").map((c) => c.id)), [layout]);
  // Only what someone might act on: refusals, alerts, gate changes, recounts. Every scan is in
  // the Access log; the minute is enough here, the second is on the log.
  const rows = feed.filter((item) => !isRoutine(item)).slice(0, 6);
  return (
    <RailSection
      id="rail-feed"
      title="Recent activity"
      meta={
        <Link to="/access-log" className="text-muted-foreground transition-colors duration-120 hover:text-foreground">
          Access log →
        </Link>
      }
      className="shrink-0"
    >
      <ol aria-label="Recent refusals, alerts and gate changes" className="py-1.5">
        {rows.length === 0 ? (
          <li className="px-4 py-1.5 text-13 leading-relaxed text-muted-foreground sm:px-5">
            Nothing needs attention. Refusals, alerts and gate changes appear here.
          </li>
        ) : null}
        {rows.map((item) => (
          <li key={item.id} className="grid min-h-8 grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 px-4 text-13 sm:px-5">
            <span className="font-mono text-12 text-muted-foreground tabular-nums">{formatClock(item.at, timeZone, { seconds: false })}</span>
            <FeedText item={item} label={label} exits={exits} roomName={roomName} />
          </li>
        ))}
      </ol>
    </RailSection>
  );
}

function FeedText({
  item,
  label,
  exits,
  roomName,
}: {
  item: FeedItem;
  label: Map<string, string>;
  exits: Set<string>;
  roomName: Map<string, string>;
}) {
  switch (item.kind) {
    case "scan":
      return (
        <>
          <span className="truncate">
            {label.get(item.checkpointId) ?? "Unknown gate"}
            {item.count > 1 ? <span className="font-mono text-muted-foreground tabular-nums"> ×{item.count}</span> : null}
            {item.offline ? <span className="font-mono text-11 text-muted-foreground"> · synced</span> : null}
          </span>
          {exits.has(item.checkpointId) && item.result === "admitted" ? (
            <span className="font-mono text-11 tracking-[0.12em] text-muted-foreground">
              <span aria-hidden="true">↗</span> EXIT
            </span>
          ) : (
            <ResultChip result={item.result} />
          )}
        </>
      );
    case "alert": {
      const view = SEVERITY_VIEW[item.alert.severity];
      return (
        <>
          <span className="truncate">
            {ALERT_KIND_LABEL[item.alert.kind]}
            {item.change !== "raised" ? <span className="text-muted-foreground"> · {item.change}</span> : null}
          </span>
          <StatusDot state={item.change === "raised" ? view.state : "idle"} label={view.label} showLabel className="text-11" />
        </>
      );
    }
    case "gate":
      return (
        <>
          <span className="truncate">
            {label.get(item.checkpointId) ?? "Gate"}
            {item.link === "offline" && item.queue > 0 ? (
              <span className="font-mono text-muted-foreground tabular-nums"> · {item.queue} queued</span>
            ) : null}
          </span>
          <StatusDot
            state={item.link === "online" ? "ok" : item.link === "offline" ? "stop" : "warn"}
            label={item.link === "online" ? "Online" : item.link === "offline" ? "Offline" : "Degraded"}
            showLabel
            className="text-11"
          />
        </>
      );
    case "recount":
      return (
        <>
          <span className="truncate">
            Recount · {roomName.get(item.roomId) ?? "Room"}{" "}
            <span className="font-mono text-muted-foreground tabular-nums">
              {formatNumber(item.previous)} → {formatNumber(item.next)}
            </span>
          </span>
          <span className="text-11 text-muted-foreground">audited</span>
        </>
      );
  }
}
