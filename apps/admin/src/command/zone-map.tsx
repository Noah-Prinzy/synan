/**
 * ZoneMap — D1's main panel (docs/06 §2.3): zones as polygons on the abstract venue
 * grid, rooms as blocks with an occupancy bar on the bottom edge and a mono count,
 * coloured by threshold; perimeter gates on the zone edges.
 *
 * Rendering (docs/02 §9): React lays the map out once per venue and size. After
 * that, counts and bars are written by the interpolator on requestAnimationFrame,
 * and level, highlight and aria-label by slice subscriptions — never a React render
 * per frame. Zones and gates are SVG; rooms are absolutely positioned buttons, so
 * each is a real focusable control and its bar is a composited `scaleX` transform.
 *
 * Keyboard: the map is one tab stop (roving tabindex). Arrow keys move to the
 * nearest room in that direction; Home/End to the first/last; Enter opens the room;
 * Escape closes its card.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Checkpoint, Room, Zone } from "@synan/contracts/rest";
import { OccupancyBar, SignalShape, clampRatio, formatClock, formatNumber, formatPercent } from "@synan/ui/data";
import { useCommand } from "../live/context";
import { useSlice } from "../live/slice";
import type { GateLive, RoomLive } from "../live/store";
import type { GridPoint, GridPolygon, GridRect, VenueLayout } from "../live/transport";
import { RoomCard } from "./room-card";
import { LiveNumber, card, highlight, levelWords } from "./ui-state";

/* --------------------------------------------------------------- geometry */

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PlacedRoom {
  room: Room;
  zone: Zone | undefined;
  box: Box;
  cx: number;
  cy: number;
  size: "lg" | "md" | "sm";
}

interface PlacedZone {
  zone: Zone;
  points: string;
  box: Box;
}

interface PlacedGate {
  checkpoint: Checkpoint;
  x: number;
  y: number;
  side: GridPoint["side"];
  code: string;
}

interface Placement {
  rooms: PlacedRoom[];
  zones: PlacedZone[];
  gates: PlacedGate[];
}

/** Space around the venue for gate labels, and between room blocks. px. */
const PAD = 28;
const GAP = 2;

function isRect(value: unknown): value is GridRect {
  return typeof value === "object" && value !== null && (value as GridRect).kind === "rect";
}

function isPolygon(value: unknown): value is GridPolygon {
  return typeof value === "object" && value !== null && (value as GridPolygon).kind === "polygon";
}

function place(layout: VenueLayout, width: number, height: number): Placement {
  const { grid } = layout;
  const scale = Math.max(0, Math.min((width - PAD * 2) / grid.w, (height - PAD * 2) / grid.h));
  const ox = Math.round((width - grid.w * scale) / 2);
  const oy = Math.round((height - grid.h * scale) / 2);
  const px = (x: number) => ox + x * scale;
  const py = (y: number) => oy + y * scale;

  const zones: PlacedZone[] = [];
  const zoneById = new Map<string, Zone>();
  for (const zone of layout.zones) {
    zoneById.set(zone.id, zone);
    if (!isPolygon(zone.geometry)) continue;
    const xs = zone.geometry.points.map(([x]) => px(x));
    const ys = zone.geometry.points.map(([, y]) => py(y));
    zones.push({
      zone,
      // Half-pixel offsets keep 1px strokes crisp.
      points: zone.geometry.points.map(([x, y]) => `${Math.round(px(x)) + 0.5},${Math.round(py(y)) + 0.5}`).join(" "),
      box: {
        left: Math.min(...xs),
        top: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      },
    });
  }

  const rooms: PlacedRoom[] = [];
  for (const room of layout.rooms) {
    if (!isRect(room.geometry)) continue;
    const g = room.geometry;
    const left = Math.round(px(g.x)) + GAP;
    const top = Math.round(py(g.y)) + GAP;
    const right = Math.round(px(g.x + g.w)) - GAP;
    const bottom = Math.round(py(g.y + g.h)) - GAP;
    const box = { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
    const size = box.width >= 120 && box.height >= 64 ? "lg" : box.width >= 52 && box.height >= 38 ? "md" : "sm";
    rooms.push({
      room,
      zone: zoneById.get(room.zone_id),
      box,
      cx: left + box.width / 2,
      cy: top + box.height / 2,
      size,
    });
  }

  const gates: PlacedGate[] = [];
  for (const checkpoint of layout.checkpoints) {
    const at = layout.checkpoint_positions[checkpoint.id];
    if (!at) continue;
    const number = /(\d+)/.exec(checkpoint.label)?.[1];
    gates.push({
      checkpoint,
      x: Math.round(px(at.x)),
      y: Math.round(py(at.y)),
      side: at.side,
      code: number ? `G${number}` : checkpoint.label.slice(0, 2),
    });
  }
  return { rooms, zones, gates };
}

/** The nearest room in a direction: along-axis distance plus twice the off-axis distance. */
function neighbour(rooms: PlacedRoom[], from: PlacedRoom, key: string): PlacedRoom | null {
  let best: PlacedRoom | null = null;
  let bestScore = Infinity;
  for (const candidate of rooms) {
    if (candidate === from) continue;
    const dx = candidate.cx - from.cx;
    const dy = candidate.cy - from.cy;
    let along: number;
    let across: number;
    if (key === "ArrowRight") [along, across] = [dx, dy];
    else if (key === "ArrowLeft") [along, across] = [-dx, dy];
    else if (key === "ArrowDown") [along, across] = [dy, dx];
    else [along, across] = [-dy, dx];
    if (along <= 1) continue;
    const score = along + Math.abs(across) * 2;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

export function roomAriaLabel(room: Room, zone: Zone | undefined, live: RoomLive | undefined, alerting: boolean): string {
  const where = zone ? `, ${zone.floor ?? ""} ${zone.name}` : "";
  if (!live) return `${room.name}${where}`;
  const ratio = room.capacity > 0 ? live.occupancy / room.capacity : 0;
  return `${room.name}${where}: ${formatNumber(live.occupancy)} of ${formatNumber(room.capacity)}, ${formatPercent(ratio)}. ${levelWords(
    live.level,
    room.warn_at_pct,
    room.block_at_pct,
  )}.${alerting ? " Open alert." : ""}`;
}

/* -------------------------------------------------------------------- map */

interface RoomNodes {
  button: HTMLButtonElement | null;
  count: HTMLSpanElement | null;
  barRoot: HTMLSpanElement | null;
  barFill: HTMLSpanElement | null;
}

export const ZoneMap = memo(function ZoneMap({
  layout,
  selectedId,
  onSelect,
  onRecount,
  stale,
  timeZone,
}: {
  layout: VenueLayout;
  selectedId: string | null;
  onSelect: (roomId: string) => void;
  onRecount: (roomId: string) => void;
  stale: boolean;
  timeZone: string;
}) {
  const { store } = useCommand();
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const nodes = useRef(new Map<string, RoomNodes>());
  // Refs attach child-first, so whichever arrives first creates the entry.
  const node = (id: string): RoomNodes => {
    let n = nodes.current.get(id);
    if (!n) {
      n = { button: null, count: null, barRoot: null, barFill: null };
      nodes.current.set(id, n);
    }
    return n;
  };
  const alerts = useSlice(store.alerts);
  const [active, setActive] = useState<string | null>(null);
  const hideTimer = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const placed = useMemo(() => (size ? place(layout, size.w, size.h) : null), [layout, size]);
  const byId = useMemo(() => new Map(placed?.rooms.map((p) => [p.room.id, p]) ?? []), [placed]);

  // Rooms with an open high or critical alert keep a stop outline after the flash settles.
  const alerting = useMemo(() => {
    const doorRoom = new Map(layout.checkpoints.map((c) => [c.id, c.room_id]));
    const set = new Set<string>();
    for (const alert of alerts) {
      if (alert.state !== "open" || (alert.severity !== "critical" && alert.severity !== "high")) continue;
      const roomId = alert.checkpoint_id ? doorRoom.get(alert.checkpoint_id) : null;
      if (roomId) set.add(roomId);
    }
    return set;
  }, [alerts, layout]);

  /* Frame loop writers: count text and bar transform, per room. */
  useEffect(() => {
    if (!placed) return;
    const unbind = placed.rooms.map(({ room }) =>
      store.interp.bind(`room:${room.id}`, (display) => {
        const n = nodes.current.get(room.id);
        if (!n) return;
        if (n.count) {
          const text = formatNumber(display);
          if (n.count.textContent !== text) n.count.textContent = text;
        }
        if (n.barFill) n.barFill.style.transform = `scaleX(${clampRatio(display / room.capacity)})`;
      }),
    );
    return () => unbind.forEach((fn) => fn());
  }, [placed, store]);

  /* ≤ 4 Hz: level (colour) and the spoken label, from authoritative values. */
  useLayoutEffect(() => {
    if (!placed) return;
    const apply = () => {
      const rooms = store.rooms.get();
      for (const p of placed.rooms) {
        const n = nodes.current.get(p.room.id);
        const live = rooms.get(p.room.id);
        if (!n?.button || !live) continue;
        if (n.button.dataset.level !== live.level) {
          n.button.dataset.level = live.level;
          if (n.barRoot) n.barRoot.dataset.level = live.level;
        }
        const label = roomAriaLabel(p.room, p.zone, live, alerting.has(p.room.id));
        if (n.button.getAttribute("aria-label") !== label) n.button.setAttribute("aria-label", label);
      }
    };
    apply();
    return store.rooms.subscribe(apply);
  }, [placed, store, alerting]);

  /* Cross-highlight from the rail. */
  useEffect(() => {
    let previous: string | null = null;
    const apply = () => {
      const id = highlight.get();
      if (previous) nodes.current.get(previous)?.button?.removeAttribute("data-highlight");
      if (id) nodes.current.get(id)?.button?.setAttribute("data-highlight", "true");
      previous = id;
    };
    apply();
    return highlight.subscribe(apply);
  }, [placed]);

  const showCard = useCallback((id: string | null) => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
    card.set(id);
    highlight.set(id);
  }, []);
  const hideCardSoon = useCallback(() => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      card.set(null);
      highlight.set(null);
    }, 160);
  }, []);
  useEffect(() => () => card.set(null), []);

  const roomFromEvent = (target: EventTarget | null): string | null =>
    (target as HTMLElement | null)?.closest<HTMLElement>("[data-room]")?.dataset.room ?? null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!placed || placed.rooms.length === 0) return;
    const currentId = roomFromEvent(event.target);
    const current = currentId ? byId.get(currentId) : undefined;
    let next: PlacedRoom | null | undefined = null;
    if (event.key === "Escape") {
      card.set(null);
      return;
    }
    if (!current) return;
    if (event.key.startsWith("Arrow")) next = neighbour(placed.rooms, current, event.key);
    else if (event.key === "Home") next = placed.rooms[0];
    else if (event.key === "End") next = placed.rooms[placed.rooms.length - 1];
    else return;
    event.preventDefault();
    if (!next) return;
    setActive(next.room.id);
    nodes.current.get(next.room.id)?.button?.focus();
  };

  const tabStop = active ?? selectedId ?? placed?.rooms[0]?.room.id ?? null;
  const rooms = store.rooms.get();

  return (
    <div ref={wrap} className="relative size-full overflow-hidden" data-stale={stale || undefined}>
      {placed && placed.zones.length === 0 && placed.rooms.length === 0 ? (
        // Zones and rooms exist but none has a shape on the grid yet (a venue set up without the
        // spatial editor): say so, rather than show an empty panel that looks broken.
        <div className="absolute inset-0 grid place-items-center p-6">
          <p className="max-w-96 text-center text-13 leading-relaxed text-muted-foreground">
            No floor plan is drawn for this venue yet. Rooms and gates are live in the panels alongside; draw zones and rooms in the venue&apos;s
            spatial editor to see them here.
          </p>
        </div>
      ) : null}
      {placed && size ? (
        <>
          <svg width={size.w} height={size.h} className="absolute inset-0" aria-hidden="true">
            {placed.zones.map((z) => (
              <polygon key={z.zone.id} points={z.points} className="fill-card/40 stroke-foreground/15" strokeWidth={1} />
            ))}
          </svg>

          {placed.zones.map((z) => (
            <div
              key={z.zone.id}
              aria-hidden="true"
              className="absolute flex items-baseline gap-2 truncate px-2 pt-1.5 text-11 text-muted-foreground"
              style={{ left: z.box.left, top: z.box.top, width: z.box.width }}
            >
              <span className="truncate">
                {z.zone.floor} · <span className="text-foreground/80">{z.zone.name}</span>
              </span>
            </div>
          ))}

          <div
            role="group"
            aria-label={`Venue map, ${placed.rooms.length} rooms. Arrow keys move between rooms; Enter opens a room.`}
            onKeyDown={onKeyDown}
            onPointerOver={(event) => {
              const id = roomFromEvent(event.target);
              if (id) showCard(id);
            }}
            onPointerOut={(event) => {
              if (roomFromEvent(event.target) && roomFromEvent(event.relatedTarget) !== roomFromEvent(event.target)) {
                hideCardSoon();
              }
            }}
            className={`absolute inset-0 transition-opacity duration-180 ease-standard motion-reduce:transition-none ${
              stale ? "opacity-40" : ""
            }`}
          >
            {placed.rooms.map((p) => {
              const live = rooms.get(p.room.id);
              const id = p.room.id;
              return (
                <button
                  key={id}
                  type="button"
                  data-room={id}
                  data-selected={id === selectedId || undefined}
                  data-alert={alerting.has(id) || undefined}
                  tabIndex={id === tabStop ? 0 : -1}
                  ref={(button) => {
                    node(id).button = button;
                  }}
                  onFocus={() => {
                    setActive(id);
                    showCard(id);
                  }}
                  onBlur={(event) => {
                    if (!wrap.current?.contains(event.relatedTarget as Node)) hideCardSoon();
                  }}
                  onClick={() => onSelect(id)}
                  style={{ left: p.box.left, top: p.box.top, width: p.box.width, height: p.box.height }}
                  className="group/room absolute flex flex-col justify-between overflow-hidden border contain-strict border-foreground/15 bg-background text-left outline-offset-2 transition-colors duration-120 ease-standard hover:border-foreground/50 data-[highlight=true]:border-foreground/50 data-[level=block]:border-destructive/60 data-[level=warn]:border-warning/50 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-0.5 data-[selected=true]:before:bg-foreground motion-reduce:transition-none"
                >
                  {alerting.has(id) ? (
                    // An open high/critical alert: a stop outline over any level colour, until acknowledged.
                    <span aria-hidden="true" className="pointer-events-none absolute -inset-px border border-destructive" />
                  ) : null}
                  {p.size !== "sm" ? (
                    <span className={`block truncate px-1.5 pt-1 ${p.size === "lg" ? "text-12" : "text-11"} text-muted-foreground`}>
                      {p.room.name}
                    </span>
                  ) : (
                    <span />
                  )}
                  <span className="flex items-center gap-1 px-1.5 pb-2 font-mono leading-none tabular-nums">
                    <span className="hidden text-warning group-data-[level=warn]/room:inline-flex">
                      <SignalShape state="warn" />
                    </span>
                    <span className="hidden text-destructive group-data-[level=block]/room:inline-flex">
                      <SignalShape state="stop" />
                    </span>
                    <span
                      ref={(el) => {
                        node(id).count = el;
                      }}
                      className={`${
                        p.size === "lg" ? "text-21" : p.size === "md" ? "text-15" : "text-12"
                      } text-foreground/75 group-data-[level=block]/room:text-destructive group-data-[level=warn]/room:text-warning`}
                    />

                  </span>
                  <OccupancyBar
                    ratio={live ? live.occupancy / p.room.capacity : 0}
                    level="ok"
                    rootRef={(el) => {
                      node(id).barRoot = el;
                    }}
                    fillRef={(el) => {
                      node(id).barFill = el;
                    }}
                    className="absolute inset-x-0 bottom-0 h-1 opacity-60 group-data-[level=block]/room:opacity-100 group-data-[level=warn]/room:opacity-100"
                  />
                </button>
              );
            })}
          </div>

          <GateMarkers gates={placed.gates} />
          <FlashLayer placed={placed} />
          {stale ? <LastKnown timeZone={timeZone} /> : null}
          <CardHost
            placed={byId}
            width={size.w}
            height={size.h}
            onEnter={() => showCard(card.get())}
            onLeave={hideCardSoon}
            onOpen={onSelect}
            onRecount={onRecount}
          />
        </>
      ) : null}
    </div>
  );
});

/* ------------------------------------------------------------------ gates */

function gateState(gate: GateLive | undefined): "ok" | "warn" | "stop" {
  if (!gate) return "ok";
  if (gate.link_state === "offline") return "stop";
  if (gate.link_state === "degraded" || gate.clock_fault || gate.queue_depth > 0) return "warn";
  return "ok";
}

function GateMarkers({ gates }: { gates: PlacedGate[] }) {
  const { store } = useCommand();
  const health = useSlice(store.gates);
  const alerts = useSlice(store.alerts);
  const alerted = new Set(alerts.filter((a) => a.state === "open" && (a.severity === "critical" || a.severity === "high")).map((a) => a.checkpoint_id));
  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden="true">
      {gates.map((g) => {
        const state = gateState(health.get(g.checkpoint.id));
        const tone = state === "stop" ? "text-destructive" : state === "warn" ? "text-warning" : "text-muted-foreground";
        const labelAt =
          g.side === "n"
            ? { x: g.x, y: g.y - 9, anchor: "middle" as const }
            : g.side === "s"
              ? { x: g.x, y: g.y + 17, anchor: "middle" as const }
              : g.side === "w"
                ? { x: g.x - 9, y: g.y + 4, anchor: "end" as const }
                : { x: g.x + 9, y: g.y + 4, anchor: "start" as const };
        return (
          <g key={g.checkpoint.id} className={tone}>
            {alerted.has(g.checkpoint.id) ? (
              <rect x={g.x - 7.5} y={g.y - 7.5} width={15} height={15} fill="none" className="stroke-destructive" />
            ) : null}
            {state === "ok" ? (
              <rect x={g.x - 3.5} y={g.y - 3.5} width={7} height={7} className="fill-current stroke-background" />
            ) : state === "warn" ? (
              <path d={`M${g.x} ${g.y - 4.5} L${g.x + 4.5} ${g.y + 3.5} L${g.x - 4.5} ${g.y + 3.5}Z`} className="fill-current stroke-background" />
            ) : (
              <path d={`M${g.x} ${g.y - 5} L${g.x + 5} ${g.y} L${g.x} ${g.y + 5} L${g.x - 5} ${g.y}Z`} className="fill-current stroke-background" />
            )}
            <text x={labelAt.x} y={labelAt.y} textAnchor={labelAt.anchor} className="fill-current font-mono text-11">
              {g.code}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* -------------------------------------------------------- flash and stale */

/** A critical alert flashes the offending room (or gate) outline once. */
function FlashLayer({ placed }: { placed: Placement }) {
  const { store } = useCommand();
  const flash = useSlice(store.flash);
  if (!flash) return null;
  const room = flash.roomId ? placed.rooms.find((p) => p.room.id === flash.roomId) : undefined;
  const gate = !room && flash.checkpointId ? placed.gates.find((g) => g.checkpoint.id === flash.checkpointId) : undefined;
  const box = room?.box ?? (gate ? { left: gate.x - 14, top: gate.y - 14, width: 28, height: 28 } : null);
  if (!box) return null;
  return (
    <span
      key={flash.key}
      aria-hidden="true"
      className="flash-once pointer-events-none absolute border-2 border-destructive bg-destructive/15 opacity-0"
      style={{ left: box.left - 3, top: box.top - 3, width: box.width + 6, height: box.height + 6 }}
    />
  );
}

/** The map dims to "last known" with a timestamp watermark while the link is down. */
function LastKnown({ timeZone }: { timeZone: string }) {
  const { store } = useCommand();
  const link = useSlice(store.link);
  const at = link.lastFrameAt ?? link.lostAt;
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center" role="note">
      <div className="border border-border bg-background/90 px-8 py-5 text-center">
        <p className="text-12 text-warning">Last known</p>
        <p className="mt-1 font-mono text-56 leading-none tracking-tight text-foreground/60 tabular-nums">
          {at ? formatClock(at, timeZone) : "—"}
        </p>
        <p className="mt-3 text-13 text-muted-foreground">
          Last known state. Counts are frozen until the live connection returns.
        </p>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- the card */

function CardHost({
  placed,
  width,
  height,
  onEnter,
  onLeave,
  onOpen,
  onRecount,
}: {
  placed: Map<string, PlacedRoom>;
  width: number;
  height: number;
  onEnter: () => void;
  onLeave: () => void;
  onOpen: (id: string) => void;
  onRecount: (id: string) => void;
}) {
  const id = useSlice(card);
  const p = id ? placed.get(id) : undefined;
  if (!p) return null;
  const cardWidth = 256;
  const gap = 8;
  const right = p.box.left + p.box.width + gap;
  const left = right + cardWidth <= width - 4 ? right : Math.max(4, p.box.left - gap - cardWidth);
  const top = Math.min(Math.max(4, p.box.top), Math.max(4, height - 236));
  return (
    <div
      className="absolute z-20"
      style={{ left, top, width: cardWidth }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onFocusCapture={onEnter}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) onLeave();
      }}
    >
      <RoomCard placed={p} onOpen={() => onOpen(p.room.id)} onRecount={() => onRecount(p.room.id)} />
    </div>
  );
}
