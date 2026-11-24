/**
 * ZoneMap — D1's main panel (docs/06 §2.3): zones as areas on the abstract venue grid,
 * rooms as solid blocks inside them, perimeter gates as labelled markers on the zone
 * edges, and a door fault or an open alert pinned to the room it belongs to.
 *
 * Reading order, at a normal viewing distance (docs/05 map rules):
 *   zone   a faint area with a hairline edge; its name and floor in a label band.
 *   room   a block with its name and a shade rising from its floor that shows how full it is
 *          — no figures (owner, 2026-11-24: "too many numbers"). Quiet while it has space; a
 *          nearly full or full room gets the signal colour, its shape and the word ("Nearly
 *          full", "Full"), so colour is never the only cue. The exact count is in the hover/focus
 *          card, the selected room's detail and the rooms list.
 *   gate   a chip outside the zone edge: shape + code (G1), neutral when online, and its
 *          problem in words when it has one.
 * The map scales to fit its panel with padding, keeps the venue's aspect ratio and stays
 * centred at every width. A name that does not fit a room is left out, never cut mid-word:
 * the hover card, the rooms list and the phone's list view carry it.
 *
 * Rendering (docs/02 §9): React lays the map out once per venue and size. After that, each
 * room's shade is written by the interpolator on requestAnimationFrame (a composited `scaleY`
 * transform), and level and aria-label by slice subscriptions (≤ 4 Hz) — never a React render
 * per frame. Zones are SVG; rooms are absolutely positioned buttons, so each is a real
 * focusable control. Styles live in index.css (`.map-*`) and key off data attributes, so a
 * level change is one attribute write.
 *
 * Keyboard: the map is one tab stop (roving tabindex). Arrow keys move to the nearest room
 * in that direction; Home/End to the first/last; Enter opens the room; Escape closes its card.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Checkpoint, Room, Zone } from "@synan/contracts/rest";
import { SignalShape, clampRatio, formatClock, formatNumber, formatPercent, type SignalState } from "@synan/ui/data";
import { useCommand } from "../live/context";
import { useSlice } from "../live/slice";
import type { GateLive, RoomLive } from "../live/store";
import type { GridPoint, GridPolygon, GridRect, VenueLayout } from "../live/transport";
import { RoomCard } from "./room-card";
import { card, highlight, levelWords } from "./ui-state";

/* --------------------------------------------------------------- geometry */

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * How much a room block can hold, from its size in px:
 *   lg  name (up to two lines), a large count and "/ capacity"
 *   md  name on one line, count and "/capacity"
 *   sm  name on one line when there is height for it, count only
 *   xs  count only
 */
export type RoomFit = "lg" | "md" | "sm" | "xs";

export interface PlacedRoom {
  room: Room;
  zone: Zone | undefined;
  box: Box;
  cx: number;
  cy: number;
  fit: RoomFit;
  /** What the block says: the full name, or its shortest clear form when the full name does not fit. */
  label: string;
  /** Whether a label is drawn inside the block, and on how many lines (wrapped at words, never cut). */
  named: boolean;
  nameLines: number;
  /** Name and status shape on one row, for a block too low to stack them. */
  row: boolean;
  /** A sliver: its shortest label at 11px with tight padding. */
  tiny: boolean;
  /** Whether the status ("Nearly full", "Full") is said in words, or by its shape alone. */
  statusWords: boolean;
}

interface PlacedZone {
  zone: Zone;
  points: string;
  box: Box;
  /** Height of the band above the zone's first room, where its label goes. */
  band: number;
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

/** Space between room blocks. px. */
const GAP = 3;

function isRect(value: unknown): value is GridRect {
  return typeof value === "object" && value !== null && (value as GridRect).kind === "rect";
}

function isPolygon(value: unknown): value is GridPolygon {
  return typeof value === "object" && value !== null && (value as GridPolygon).kind === "polygon";
}

/** Padding around the venue: room for the gate chips on the sides that have gates, plus air. */
function paddingFor(layout: VenueLayout, width: number, height: number): { top: number; right: number; bottom: number; left: number } {
  const sides = new Set(Object.values(layout.checkpoint_positions).map((p) => p.side));
  const air = Math.round(Math.min(32, Math.max(12, Math.min(width, height) * 0.03)));
  // A chip is about 22px tall and 48px wide (more with a state word), plus its 8px tick.
  return {
    top: air + (sides.has("n") ? 30 : 0),
    right: air + (sides.has("e") ? 56 : 0),
    bottom: air + (sides.has("s") ? 30 : 0),
    left: air + (sides.has("w") ? 56 : 0),
  };
}

function fitFor(box: Box): RoomFit {
  if (box.width >= 128 && box.height >= 84) return "lg";
  if (box.width >= 80 && box.height >= 54) return "md";
  if (box.width >= 44 && box.height >= 30) return "sm";
  return "xs";
}

let measureContext: CanvasRenderingContext2D | null | undefined;

/**
 * The width of a UI-sans string at a size, to decide whether a name fits: measured with the
 * real face once it has loaded (place() runs once per layout and size, not per frame), and a
 * generous estimate before that.
 */
function textWidth(text: string, px: number): number {
  if (measureContext === undefined) measureContext = document.createElement("canvas").getContext("2d");
  if (measureContext) {
    measureContext.font = `${px}px "Instrument Sans Variable", ui-sans-serif, system-ui, sans-serif`;
    return measureContext.measureText(text).width + 1;
  }
  return text.length * px * 0.62;
}

/**
 * How many lines a name takes when wrapped at word breaks in `width` px; 0 when a single word
 * is wider than the line (it would break mid-word — then the name is left to the card and list).
 */
function nameLines(name: string, px: number, width: number): number {
  const space = px * 0.28;
  let lines = 1;
  let used = 0;
  for (const word of name.split(/\s+/)) {
    const w = textWidth(word, px);
    if (w > width) return 0;
    if (used === 0) used = w;
    else if (used + space + w <= width) used += space + w;
    else {
      lines++;
      used = w;
    }
  }
  return lines;
}

/** Words that say what kind of space a room is, dropped first when its name must shorten. */
const GENERIC = new Set(["room", "lounge", "hall", "floor", "stage", "bar", "booth", "suite", "court", "desk", "point", "area"]);

const singular = (word: string) => word.toLowerCase().replace(/s$/, "");

/**
 * A room's name from longest to shortest, each still a whole word or a clear abbreviation:
 *   "Workshop C" in zone "Workshops"  → "C"        (the zone already says "Workshop")
 *   "Quiet Room", "Partner Lounge"    → "Quiet", "Partner"
 *   "Boardroom", "Cloakroom"          → "Board", "Cloak"
 *   "Speaker Green Room"              → "Speaker Green" → "Speaker" (when no other room starts so)
 * and last the initials ("PL"). The full name is always in the hover card, the list and the
 * aria-label.
 */
function labelCandidates(name: string, zoneName: string, firstWords: Map<string, number>): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const zoneWords = new Set(zoneName.split(/\s+/).map(singular));
  const out: string[] = [name.trim()];
  const withoutZone = words.filter((w) => !zoneWords.has(singular(w)));
  if (withoutZone.length > 0 && withoutZone.length < words.length) out.push(withoutZone.join(" "));
  const withoutGeneric = words.filter((w) => !GENERIC.has(w.toLowerCase()));
  if (withoutGeneric.length > 0 && withoutGeneric.length < words.length) out.push(withoutGeneric.join(" "));
  const compound = words.map((w) => (/^.{3,}room$/i.test(w) ? w.slice(0, -4) : w));
  if (compound.join(" ") !== words.join(" ")) out.push(compound.filter((w) => !GENERIC.has(w.toLowerCase())).join(" ") || compound.join(" "));
  const first = words[0] ?? "";
  if (words.length > 1 && (firstWords.get(first.toLowerCase()) ?? 0) === 1 && !GENERIC.has(first.toLowerCase())) out.push(first);
  if (words.length > 1) out.push(words.map((w) => (/^\d+$/.test(w) ? w : w[0]?.toUpperCase() ?? "")).join(""));
  return [...new Set(out.filter(Boolean))];
}

/** Height kept at a room's foot for its status line ("Nearly full", "Full", an alert flag). px. */
const STATUS_LINE = 18;

function place(layout: VenueLayout, width: number, height: number): Placement {
  const { grid } = layout;
  const pad = paddingFor(layout, width, height);
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const scale = Math.max(0, Math.min(innerW / grid.w, innerH / grid.h));
  // Centred in the padded box, so the venue sits in the middle of its panel at every width.
  const ox = Math.round(pad.left + (innerW - grid.w * scale) / 2);
  const oy = Math.round(pad.top + (innerH - grid.h * scale) / 2);
  const px = (x: number) => ox + x * scale;
  const py = (y: number) => oy + y * scale;

  const zoneById = new Map<string, Zone>();
  for (const zone of layout.zones) zoneById.set(zone.id, zone);

  // How many rooms start with each word: a first word alone is a fair short name only when unique.
  const firstWords = new Map<string, number>();
  for (const room of layout.rooms) {
    const first = room.name.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    firstWords.set(first, (firstWords.get(first) ?? 0) + 1);
  }

  const rooms: PlacedRoom[] = [];
  const firstRoomTop = new Map<string, number>();
  for (const room of layout.rooms) {
    if (!isRect(room.geometry)) continue;
    const g = room.geometry;
    const left = Math.round(px(g.x)) + GAP;
    const top = Math.round(py(g.y)) + GAP;
    const right = Math.round(px(g.x + g.w)) - GAP;
    const bottom = Math.round(py(g.y + g.h)) - GAP;
    const box = { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
    const fit = fitFor(box);
    const zone = zoneById.get(room.zone_id);
    const nameSize = fit === "lg" ? 13 : 12;
    const pad = fit === "lg" ? 20 : 16;
    // Lines the name may take: the height left after padding and the one-line status
    // ("Nearly full") a room shows when it needs attention.
    const linesByHeight = Math.floor((box.height - pad - STATUS_LINE) / Math.round(nameSize * 1.3));
    // Every room carries an identifier: the full name (wrapped at words) when it fits, else the
    // first shorter form that does — never an empty block, never a word cut in half.
    let label = "";
    let stacked = 0;
    let row = false;
    const candidates = labelCandidates(room.name, zone?.name ?? "", firstWords);
    let tiny = false;
    for (const candidate of candidates) {
      const lines = nameLines(candidate, nameSize, box.width - pad);
      const maxLines = candidate === room.name ? Math.min(3, linesByHeight) : Math.min(1, linesByHeight);
      if (fit !== "xs" && lines > 0 && lines <= maxLines) {
        label = candidate;
        stacked = lines;
        break;
      }
      // A low, wide room that cannot stack its name over its status sets both on one row.
      if (box.height >= 20 && textWidth(candidate, 12) + 16 + 16 <= box.width) {
        label = candidate;
        row = true;
        break;
      }
    }
    // A sliver of a room: the shortest form at 11px with tight padding, so no block is blank.
    const shortest = candidates[candidates.length - 1] ?? "";
    if (!label && shortest && textWidth(shortest, 11) + 8 <= box.width && box.height >= 18) {
      label = shortest;
      stacked = 1;
      tiny = true;
    }
    rooms.push({
      room,
      zone,
      box,
      cx: left + box.width / 2,
      cy: top + box.height / 2,
      fit,
      label,
      named: label !== "",
      nameLines: row ? 1 : stacked,
      row,
      tiny,
      // "Nearly full" in words where there is room for them; the shape alone where there is not.
      statusWords: !row && box.width - 16 >= textWidth("Nearly full", 12) + 14,
    });
    firstRoomTop.set(room.zone_id, Math.min(firstRoomTop.get(room.zone_id) ?? Infinity, top));
  }

  const zones: PlacedZone[] = [];
  for (const zone of layout.zones) {
    if (!isPolygon(zone.geometry)) continue;
    const xs = zone.geometry.points.map(([x]) => px(x));
    const ys = zone.geometry.points.map(([, y]) => py(y));
    const top = Math.min(...ys);
    const box = { left: Math.min(...xs), top, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - top };
    zones.push({
      zone,
      // Half-pixel offsets keep 1px strokes crisp.
      points: zone.geometry.points.map(([x, y]) => `${Math.round(px(x)) + 0.5},${Math.round(py(y)) + 0.5}`).join(" "),
      box,
      band: (firstRoomTop.get(zone.id) ?? top + box.height) - top,
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

/* ------------------------------------------------------------- live state */

/** Open alerts by room (through the door they were raised at), worst severity first. */
function alertsByRoom(
  alerts: readonly { state: string; severity: string; checkpoint_id: string | null }[],
  layout: VenueLayout,
): Map<string, "stop" | "warn"> {
  const doorRoom = new Map(layout.checkpoints.map((c) => [c.id, c.room_id]));
  const out = new Map<string, "stop" | "warn">();
  for (const alert of alerts) {
    if (alert.state !== "open") continue;
    const roomId = alert.checkpoint_id ? doorRoom.get(alert.checkpoint_id) : null;
    if (!roomId) continue;
    const tone = alert.severity === "critical" || alert.severity === "high" ? "stop" : alert.severity === "medium" ? "warn" : null;
    if (!tone) continue;
    if (out.get(roomId) !== "stop") out.set(roomId, tone);
  }
  return out;
}

function gateState(gate: GateLive | undefined): { state: Exclude<SignalState, "idle">; words: string | null } {
  if (!gate) return { state: "ok", words: null };
  if (gate.link_state === "offline") return { state: "stop", words: "offline" };
  if (gate.link_state === "degraded") return { state: "warn", words: "degraded" };
  if (gate.queue_depth > 0) return { state: "warn", words: `${formatNumber(gate.queue_depth)} queued` };
  if (gate.clock_fault) return { state: "warn", words: "clock" };
  return { state: "ok", words: null };
}

/* -------------------------------------------------------------------- map */

interface RoomNodes {
  button: HTMLButtonElement | null;
  fill: HTMLSpanElement | null;
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
      n = { button: null, fill: null };
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
    const measure = () => setSize((prev) => (prev && prev.w === el.clientWidth && prev.h === el.clientHeight ? prev : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Names are measured with the real face: lay out again once the fonts have loaded.
  const [fontsReady, setFontsReady] = useState(() => document.fonts.status === "loaded");
  useEffect(() => {
    if (fontsReady) return;
    let live = true;
    void document.fonts.ready.then(() => live && setFontsReady(true));
    return () => {
      live = false;
    };
  }, [fontsReady]);

  const placed = useMemo(() => (size ? place(layout, size.w, size.h) : null), [layout, size, fontsReady]);
  const byId = useMemo(() => new Map(placed?.rooms.map((p) => [p.room.id, p]) ?? []), [placed]);
  const alerting = useMemo(() => alertsByRoom(alerts, layout), [alerts, layout]);

  /* Frame loop writer: the fill's transform, per room (composited, no layout). */
  useEffect(() => {
    if (!placed) return;
    const unbind = placed.rooms.map(({ room }) =>
      store.interp.bind(`room:${room.id}`, (display) => {
        const fill = nodes.current.get(room.id)?.fill;
        if (fill) fill.style.transform = `scaleY(${clampRatio(display / room.capacity)})`;
      }),
    );
    return () => unbind.forEach((fn) => fn());
  }, [placed, store]);

  /* ≤ 4 Hz: level (colour, status words) and the spoken label, from authoritative values. */
  useLayoutEffect(() => {
    if (!placed) return;
    const apply = () => {
      const rooms = store.rooms.get();
      for (const p of placed.rooms) {
        const n = nodes.current.get(p.room.id);
        const live = rooms.get(p.room.id);
        if (!n?.button || !live) continue;
        if (n.button.dataset.level !== live.level) n.button.dataset.level = live.level;
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
    <div ref={wrap} className="map relative size-full overflow-hidden" data-stale={stale || undefined}>
      {placed && placed.zones.length === 0 && placed.rooms.length === 0 ? (
        // Zones and rooms exist but none has a shape on the grid yet (a venue set up without the
        // spatial editor): say so, rather than show an empty panel that looks broken.
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="max-w-96 text-center">
            <p className="text-15 font-medium">No floor plan drawn yet</p>
            <p className="mt-2 text-13 leading-relaxed text-muted-foreground">
              Rooms and gates are live in the panels alongside. Draw zones and rooms in the venue&apos;s spatial editor to see them
              here.
            </p>
          </div>
        </div>
      ) : null}
      {placed && size ? (
        <>
          <svg width={size.w} height={size.h} className="absolute inset-0" aria-hidden="true">
            {placed.zones.map((z) => (
              <polygon key={z.zone.id} points={z.points} className="map-zone" />
            ))}
          </svg>

          {placed.zones.map((z) =>
            z.band >= 18 && z.box.width >= 72 ? (
              <div
                key={z.zone.id}
                aria-hidden="true"
                className="map-zone-label absolute flex items-center justify-between gap-3 px-2.5"
                style={{ left: z.box.left, top: z.box.top, width: z.box.width, height: Math.min(z.band, 32) }}
              >
                <span className="min-w-0 truncate">
                  <span className="text-13 font-medium text-foreground">{z.zone.name}</span>
                  {z.zone.floor ? <span className="text-12 text-muted-foreground"> · {z.zone.floor}</span> : null}
                </span>
              </div>
            ) : null,
          )}

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
              const alert = alerting.get(id);
              return (
                <button
                  key={id}
                  type="button"
                  data-room={id}
                  data-fit={p.fit}
                  data-row={p.row || undefined}
                  data-tiny={p.tiny || undefined}
                  data-level={live?.level ?? "ok"}
                  data-selected={id === selectedId || undefined}
                  data-alert={alert}
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
                  className="map-room group/room"
                >
                  {p.named ? (
                    <span className="map-room-name" style={{ WebkitLineClamp: p.nameLines }}>
                      {p.label}
                    </span>
                  ) : (
                    <span />
                  )}
                  {/* How full the room is: a fill rising from the floor of the block, no figure.
                      The exact count is on hover, focus and selection, and in the rooms list. */}
                  <span
                    aria-hidden="true"
                    className="map-room-fill"
                    ref={(el) => {
                      node(id).fill = el;
                    }}
                    style={{ transform: `scaleY(${clampRatio(live ? live.occupancy / p.room.capacity : 0)})` }}
                  />
                  {/* Quiet unless something needs attention: then a shape and a word. */}
                  <span className="map-room-status" aria-hidden="true">
                    {alert ? (
                      <span className="map-room-alert" data-tone={alert}>
                        {p.statusWords && p.fit === "lg" ? "Alert" : "!"}
                      </span>
                    ) : null}
                    <span className="map-room-level map-room-level-warn">
                      <SignalShape state="warn" />
                      {p.statusWords ? <span>Nearly full</span> : null}
                    </span>
                    <span className="map-room-level map-room-level-stop">
                      <SignalShape state="stop" />
                      {p.statusWords ? <span>Full</span> : null}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <DoorFaults placed={placed.rooms} layout={layout} />
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

/** Perimeter gates: a chip just outside the zone edge, joined to the edge by a short tick. */
function GateMarkers({ gates }: { gates: PlacedGate[] }) {
  const { store } = useCommand();
  const health = useSlice(store.gates);
  const alerts = useSlice(store.alerts);
  const alerted = new Set(
    alerts.filter((a) => a.state === "open" && (a.severity === "critical" || a.severity === "high")).map((a) => a.checkpoint_id),
  );
  const TICK = 7;
  return (
    <>
      <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden="true">
        {gates.map((g) => {
          const { state } = gateState(health.get(g.checkpoint.id));
          const [dx, dy] = g.side === "n" ? [0, -TICK] : g.side === "s" ? [0, TICK] : g.side === "w" ? [-TICK, 0] : [TICK, 0];
          return (
            <g key={g.checkpoint.id} className={`map-gate-tick`} data-state={state}>
              {/* The opening in the zone wall. */}
              {g.side === "n" || g.side === "s" ? (
                <line x1={g.x - 6} x2={g.x + 6} y1={g.y + 0.5} y2={g.y + 0.5} strokeWidth={3} />
              ) : (
                <line x1={g.x + 0.5} x2={g.x + 0.5} y1={g.y - 6} y2={g.y + 6} strokeWidth={3} />
              )}
              <line x1={g.x + 0.5} y1={g.y + 0.5} x2={g.x + dx + 0.5} y2={g.y + dy + 0.5} strokeWidth={1} />
            </g>
          );
        })}
      </svg>
      {gates.map((g) => {
        const { state, words } = gateState(health.get(g.checkpoint.id));
        const offset = TICK + 1;
        const transform =
          g.side === "n"
            ? `translate(-50%, calc(-100% - ${offset}px))`
            : g.side === "s"
              ? `translate(-50%, ${offset}px)`
              : g.side === "w"
                ? `translate(calc(-100% - ${offset}px), -50%)`
                : `translate(${offset}px, -50%)`;
        return (
          <span
            key={g.checkpoint.id}
            aria-hidden="true"
            data-state={state}
            data-alert={alerted.has(g.checkpoint.id) || undefined}
            data-side={g.side}
            className="map-gate"
            style={{ left: g.x, top: g.y, transform }}
            title={g.checkpoint.label}
          >
            {/* On an east or west wall the problem goes under the code, so the chip stays narrow. */}
            <span className="flex items-center gap-1.5">
              <SignalShape state={state} className="map-gate-shape" />
              <span className="text-foreground">{g.code}</span>
            </span>
            {words ? <span className="map-gate-words">{words}</span> : null}
          </span>
        );
      })}
    </>
  );
}

/** A room's own door, when it needs someone: a shape and "door …" on the block's bottom-right corner. */
function DoorFaults({ placed, layout }: { placed: PlacedRoom[]; layout: VenueLayout }) {
  const { store } = useCommand();
  const health = useSlice(store.gates);
  const doorsByRoom = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const c of layout.checkpoints) {
      if (!c.room_id || c.perimeter) continue;
      out.set(c.room_id, [...(out.get(c.room_id) ?? []), c.id]);
    }
    return out;
  }, [layout]);
  const faults: { p: PlacedRoom; state: "warn" | "stop"; words: string }[] = [];
  for (const p of placed) {
    let worst: { state: "warn" | "stop"; words: string } | null = null;
    for (const id of doorsByRoom.get(p.room.id) ?? []) {
      const { state, words } = gateState(health.get(id));
      if (state === "stop") worst = { state, words: words ?? "offline" };
      else if (state === "warn" && !worst) worst = { state, words: words ?? "door" };
    }
    if (worst) faults.push({ p, ...worst });
  }
  return (
    <>
      {faults.map(({ p, state, words }) => (
        <span
          key={p.room.id}
          aria-hidden="true"
          data-state={state}
          className="map-door"
          style={{ left: p.box.left + p.box.width - 4, top: p.box.top + p.box.height }}
        >
          <SignalShape state={state} />
          {p.box.width >= 96 ? <span>door {words}</span> : null}
        </span>
      ))}
    </>
  );
}

/* -------------------------------------------------------------- the legend */

/** What the map's tints, shapes and outlines mean. Lives under the map, in the panel. */
export function MapLegend({ className = "" }: { className?: string }) {
  // Four keys, in plain words. The neutral state needs no key: a quiet room is simply quiet.
  return (
    <ul aria-label="Map key" className={`flex flex-wrap items-center gap-x-5 gap-y-1.5 text-12 text-muted-foreground ${className}`}>
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="map-legend-swatch" data-level="ok" />
        Shading shows how full a room is
      </li>
      <li className="flex items-center gap-1.5">
        <SignalShape state="warn" className="text-warning" /> Nearly full
      </li>
      <li className="flex items-center gap-1.5">
        <SignalShape state="stop" className="text-destructive" /> Full
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="map-gate-key">G1</span> Gate, with its problem when it has one
      </li>
    </ul>
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
    <div className="pointer-events-none absolute inset-0 grid place-items-center p-4" role="note">
      <div className="max-w-full border border-border bg-background/90 px-8 py-5 text-center">
        <p className="text-12 text-warning">Last known</p>
        <p className="mt-1 font-mono text-40 leading-none tracking-tight text-foreground/60 tabular-nums">
          {at ? formatClock(at, timeZone) : "—"}
        </p>
        <p className="mt-3 text-13 text-muted-foreground">Counts are frozen until the live connection returns.</p>
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
  const cardWidth = Math.min(272, width - 8);
  const gap = 8;
  const right = p.box.left + p.box.width + gap;
  const left = right + cardWidth <= width - 4 ? right : Math.max(4, p.box.left - gap - cardWidth);
  const top = Math.min(Math.max(4, p.box.top), Math.max(4, height - 244));
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
