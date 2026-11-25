/**
 * The D3 canvas: the venue's abstract grid with zones as hairline areas and rooms as blocks, in
 * D1's visual language (zone-map.tsx), scaled to fit its frame and keeping the grid's aspect.
 *
 * Inert by default: a click selects a zone or room to inspect, arrow keys step between rooms.
 * In edit mode it draws: drag on empty grid for a zone, inside a zone for a room (whole units,
 * at least 2 × 2, inside its zone, never overlapping). Drag a room, or a zone by its label band,
 * to move it; drag the corner handle to resize. Every pointer action has a keyboard twin handled
 * by the editor: arrows move the selection by one unit, Shift+arrows resize, Delete removes.
 *
 * Hit-testing is done in grid units from the pointer position, not from DOM targets, so what is
 * drawn and what is hit can never disagree.
 */
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "@synan/ui/components";
import { formatNumber } from "@synan/ui/data";
import {
  hitTest,
  rectBetween,
  rectOf,
  roomBlocked,
  zoneBlocked,
  type Layout,
  type Rect,
  type Selection,
} from "./model";

/** Space around the grid, px. */
const PAD = 12;
/** Height of a zone's label band, px: dragging it moves the zone. */
const BAND = 20;
/** Room blocks sit this far inside their rectangle, px, so neighbours read apart. */
const GAP = 1;
/** The resize handle, px. */
const HANDLE = 9;

type Gesture =
  | { type: "draw-zone"; start: Point; current: Point }
  | { type: "draw-room"; zoneId: string; start: Point; current: Point }
  | { type: "move"; target: NonNullable<Selection>; start: Point; current: Point; from: Rect }
  | { type: "resize"; target: NonNullable<Selection>; start: Point; current: Point; from: Rect };

interface Point {
  x: number;
  y: number;
}

export interface CanvasCommands {
  onSelect: (selection: Selection) => void;
  onDrawZone: (rect: Rect) => void;
  onDrawRoom: (zoneId: string, rect: Rect) => void;
  /** Commit a drag. `mode` says whether a zone's rooms travel with it (move) or it was resized. */
  onPlace: (target: NonNullable<Selection>, rect: Rect, mode: "move" | "resize") => void;
  onNudge: (dx: number, dy: number, resize: boolean) => void;
  onDelete: () => void;
  announce: (message: string) => void;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function describeRect(r: Rect): string {
  return `at ${fmt(r.x)}, ${fmt(r.y)}, ${fmt(r.w)} × ${fmt(r.h)}`;
}

export function LayoutCanvas({
  layout,
  grid,
  selection,
  editing,
  invalid,
  label,
  hintId,
  commands,
  children,
}: {
  layout: Layout;
  grid: { w: number; h: number };
  selection: Selection;
  editing: boolean;
  /** Ids with something to fix: outlined in the stop colour. */
  invalid: Set<string>;
  label: string;
  hintId: string;
  commands: CanvasCommands;
  /** Overlays (the empty state). */
  children?: ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [cursor, setCursor] = useState("default");

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const frame = useMemo(() => {
    if (!size) return null;
    const scale = Math.max(0.5, Math.min((size.w - PAD * 2) / grid.w, (size.h - PAD * 2) / grid.h));
    const ox = Math.round((size.w - grid.w * scale) / 2);
    const oy = Math.round((size.h - grid.h * scale) / 2);
    return { scale, ox, oy };
  }, [size, grid.w, grid.h]);

  const box = (r: Rect, inset = 0) => {
    if (!frame) return { left: 0, top: 0, width: 0, height: 0 };
    const left = Math.round(frame.ox + r.x * frame.scale) + inset;
    const top = Math.round(frame.oy + r.y * frame.scale) + inset;
    const right = Math.round(frame.ox + (r.x + r.w) * frame.scale) - inset;
    const bottom = Math.round(frame.oy + (r.y + r.h) * frame.scale) - inset;
    return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  };

  const toGrid = (event: { clientX: number; clientY: number }): Point => {
    const el = wrap.current;
    if (!el || !frame) return { x: -1, y: -1 };
    const r = el.getBoundingClientRect();
    return { x: (event.clientX - r.left - frame.ox) / frame.scale, y: (event.clientY - r.top - frame.oy) / frame.scale };
  };

  /* What a gesture would produce, and why it cannot (null when it can). */
  const preview = useMemo((): { rect: Rect; blocked: string | null; tiny: boolean } | null => {
    if (!gesture) return null;
    if (gesture.type === "draw-zone" || gesture.type === "draw-room") {
      const rect = rectBetween(gesture.start, gesture.current);
      const travelled = Math.hypot(gesture.current.x - gesture.start.x, gesture.current.y - gesture.start.y);
      const blocked =
        gesture.type === "draw-zone" ? zoneBlocked(layout, null, rect, grid, false) : roomBlocked(layout, null, gesture.zoneId, rect);
      return { rect, blocked, tiny: travelled < 0.75 };
    }
    const dx = Math.round(gesture.current.x - gesture.start.x);
    const dy = Math.round(gesture.current.y - gesture.start.y);
    const from = gesture.from;
    const rect =
      gesture.type === "move" ? { ...from, x: from.x + dx, y: from.y + dy } : { ...from, w: Math.max(1, from.w + dx), h: Math.max(1, from.h + dy) };
    const unchanged = dx === 0 && dy === 0;
    const target = gesture.target;
    let blocked: string | null = null;
    if (!unchanged) {
      if (target.kind === "room") {
        const room = layout.rooms.find((r) => r.id === target.id);
        blocked = room ? roomBlocked(layout, room.id, room.zoneId, rect) : "That room no longer exists.";
      } else {
        blocked = zoneBlocked(layout, target.id, rect, grid, gesture.type === "move");
      }
    }
    return { rect, blocked, tiny: unchanged };
  }, [gesture, layout, grid]);

  const selectedRect = rectOf(layout, selection);

  const nearHandle = (point: Point): boolean => {
    if (!selectedRect || !frame) return false;
    const hx = selectedRect.x + selectedRect.w;
    const hy = selectedRect.y + selectedRect.h;
    const reach = (HANDLE + 4) / frame.scale;
    return Math.abs(point.x - hx) <= reach && Math.abs(point.y - hy) <= reach;
  };

  const inBand = (zoneId: string, point: Point): boolean => {
    const zone = layout.zones.find((z) => z.id === zoneId);
    if (!zone || !frame) return false;
    return point.y - zone.rect.y <= BAND / frame.scale;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !frame) return;
    wrap.current?.focus({ preventScroll: true });
    const point = toGrid(event);
    const hit = hitTest(layout, point.x, point.y);
    if (!editing) {
      commands.onSelect(hit);
      return;
    }
    event.preventDefault();
    let next: Gesture | null = null;
    if (selection && selectedRect && nearHandle(point)) {
      next = { type: "resize", target: selection, start: point, current: point, from: selectedRect };
    } else if (hit?.kind === "room") {
      commands.onSelect(hit);
      const from = rectOf(layout, hit);
      if (from) next = { type: "move", target: hit, start: point, current: point, from };
    } else if (hit?.kind === "zone") {
      if (inBand(hit.id, point)) {
        commands.onSelect(hit);
        const from = rectOf(layout, hit);
        if (from) next = { type: "move", target: hit, start: point, current: point, from };
      } else {
        next = { type: "draw-room", zoneId: hit.id, start: point, current: point };
      }
    } else if (point.x >= 0 && point.y >= 0 && point.x <= grid.w && point.y <= grid.h) {
      next = { type: "draw-zone", start: point, current: point };
    } else {
      commands.onSelect(null);
    }
    if (next) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setGesture(next);
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const point = toGrid(event);
    if (gesture) {
      // Keep drawing inside the grid.
      const clamped = { x: Math.min(grid.w, Math.max(0, point.x)), y: Math.min(grid.h, Math.max(0, point.y)) };
      setGesture({ ...gesture, current: gesture.type === "move" || gesture.type === "resize" ? point : clamped });
      return;
    }
    if (!editing) {
      setCursor(hitTest(layout, point.x, point.y) ? "pointer" : "default");
      return;
    }
    if (selection && nearHandle(point)) return setCursor("nwse-resize");
    const hit = hitTest(layout, point.x, point.y);
    if (hit?.kind === "room") return setCursor("move");
    if (hit?.kind === "zone") return setCursor(inBand(hit.id, point) ? "move" : "crosshair");
    setCursor(point.x >= 0 && point.y >= 0 && point.x <= grid.w && point.y <= grid.h ? "crosshair" : "default");
  };

  const finish = () => {
    const g = gesture;
    const p = preview;
    setGesture(null);
    if (!g || !p) return;
    if (g.type === "draw-zone" || g.type === "draw-room") {
      if (p.tiny) {
        // A click, not a drag: select what is there.
        commands.onSelect(g.type === "draw-room" ? { kind: "zone", id: g.zoneId } : null);
        return;
      }
      if (p.blocked) {
        commands.announce(p.blocked);
        return;
      }
      if (g.type === "draw-zone") commands.onDrawZone(p.rect);
      else commands.onDrawRoom(g.zoneId, p.rect);
      return;
    }
    if (p.tiny) return;
    if (p.blocked) {
      commands.announce(`${p.blocked} It went back where it was.`);
      return;
    }
    commands.onPlace(g.target, p.rect, g.type);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      if (gesture) {
        setGesture(null);
        commands.announce("Cancelled.");
      } else commands.onSelect(null);
      event.preventDefault();
      return;
    }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const step = arrows[event.key];
    if (editing && step) {
      event.preventDefault();
      commands.onNudge(step[0], step[1], event.shiftKey);
      return;
    }
    if (editing && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      commands.onDelete();
      return;
    }
    if (!editing && (step || event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      const rooms = layout.rooms;
      if (rooms.length === 0) return;
      if (event.key === "Home") return commands.onSelect({ kind: "room", id: (rooms[0] as (typeof rooms)[number]).id });
      if (event.key === "End") return commands.onSelect({ kind: "room", id: (rooms[rooms.length - 1] as (typeof rooms)[number]).id });
      const from = selectedRect;
      if (!from || !step) return commands.onSelect({ kind: "room", id: (rooms[0] as (typeof rooms)[number]).id });
      const cx = from.x + from.w / 2;
      const cy = from.y + from.h / 2;
      let best: string | null = null;
      let bestScore = Infinity;
      for (const room of rooms) {
        if (selection?.kind === "room" && room.id === selection.id) continue;
        const dx = room.rect.x + room.rect.w / 2 - cx;
        const dy = room.rect.y + room.rect.h / 2 - cy;
        const along = step[0] !== 0 ? dx * step[0] : dy * step[1];
        const across = step[0] !== 0 ? dy : dx;
        if (along <= 0.5) continue;
        const score = along + Math.abs(across) * 2;
        if (score < bestScore) {
          bestScore = score;
          best = room.id;
        }
      }
      if (best) commands.onSelect({ kind: "room", id: best });
    }
  };

  const floorName = (id: string) => layout.floors.find((f) => f.id === id)?.name ?? "";
  const gridBox = frame ? box({ x: 0, y: 0, w: grid.w, h: grid.h }) : null;
  const dotStep = frame ? (frame.scale >= 9 ? 1 : frame.scale >= 4.5 ? 2 : 4) : 2;

  return (
    <div
      ref={wrap}
      role="application"
      aria-roledescription="layout canvas"
      aria-label={label}
      aria-describedby={hintId}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={() => setGesture(null)}
      onPointerLeave={() => !gesture && setCursor("default")}
      onKeyDown={onKeyDown}
      style={{ cursor: gesture ? (gesture.type === "resize" ? "nwse-resize" : gesture.type === "move" ? "move" : "crosshair") : cursor, touchAction: editing ? "none" : "auto" }}
      className="relative size-full overflow-hidden outline-offset-[-2px] select-none"
    >
      {frame && gridBox ? (
        <>
          {/* The drawable area: a quiet tone always, dots every few units while drawing. */}
          <div
            aria-hidden="true"
            className="absolute bg-surface"
            style={gridBox}
          />
          {editing ? (
            <svg aria-hidden="true" className="pointer-events-none absolute" style={gridBox} width={gridBox.width} height={gridBox.height}>
              <defs>
                <pattern id="d3-dots" width={frame.scale * dotStep} height={frame.scale * dotStep} patternUnits="userSpaceOnUse">
                  <rect x={0} y={0} width={1} height={1} className="fill-foreground/25" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#d3-dots)" />
            </svg>
          ) : null}

          {layout.zones.map((zone) => {
            const b = box(zone.rect);
            const selected = selection?.kind === "zone" && selection.id === zone.id;
            return (
              <div
                key={zone.id}
                aria-hidden="true"
                className={cn(
                  "absolute bg-foreground/[0.06]",
                  selected ? "shadow-[inset_0_0_0_2px_var(--brand)]" : invalid.has(zone.id) ? "shadow-[inset_0_0_0_2px_var(--destructive)]" : undefined,
                )}
                style={b}
              >
                <div
                  className={cn(
                    "flex items-baseline gap-1 truncate px-2 text-12 text-muted-foreground",
                  )}
                  style={{ height: BAND, lineHeight: `${BAND - 2}px` }}
                >
                  <span className="truncate">
                    <span className={cn("font-medium", selected ? "text-foreground" : "text-foreground/90")}>{zone.name.trim() || "Unnamed zone"}</span> ·{" "}
                    {floorName(zone.floorId)}
                  </span>
                </div>
              </div>
            );
          })}

          {layout.rooms.map((room) => {
            const b = box(room.rect, GAP);
            const selected = selection?.kind === "room" && selection.id === room.id;
            const roomy = b.width >= 44 && b.height >= 30;
            const lifted = gesture && (gesture.type === "move" || gesture.type === "resize") && gesture.target.id === room.id && !preview?.tiny;
            return (
              <div
                key={room.id}
                aria-hidden="true"
                className={cn(
                  "absolute flex flex-col justify-between overflow-hidden bg-foreground/[0.07]",
                  selected ? "shadow-[inset_0_0_0_2px_var(--brand)]" : invalid.has(room.id) ? "shadow-[inset_0_0_0_2px_var(--destructive)]" : undefined,
                  lifted && "opacity-40",
                )}
                style={b}
              >
                {roomy ? (
                  <>
                    {/* Same reading as the Command Center map: the name wraps at words (two lines at
                        most) instead of being cut to "Worksh…"; the capacity is this screen's figure. */}
                    <span className={cn("line-clamp-2 px-2 pt-1.5 text-12 leading-tight", selected ? "text-foreground" : "text-foreground/85")}>
                      {room.name.trim() || "Unnamed room"}
                    </span>
                    <span className="px-2 pb-1.5 font-mono text-12 leading-none text-muted-foreground tabular-nums">
                      {/^\d+$/.test(room.capacity.trim()) ? formatNumber(Number(room.capacity)) : "—"}
                    </span>
                  </>
                ) : null}
              </div>
            );
          })}

          {/* The selection's resize handle, only while drawing. */}
          {editing && selectedRect && !gesture ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute border border-background bg-brand"
              style={{
                left: box(selectedRect).left + box(selectedRect).width - Math.ceil(HANDLE / 2),
                top: box(selectedRect).top + box(selectedRect).height - Math.ceil(HANDLE / 2),
                width: HANDLE,
                height: HANDLE,
              }}
            />
          ) : null}

          {preview && !preview.tiny ? <Preview rect={box(preview.rect)} blocked={preview.blocked} size={preview.rect} /> : null}
        </>
      ) : null}
      {children}
    </div>
  );
}

function Preview({ rect, blocked, size }: { rect: { left: number; top: number; width: number; height: number }; blocked: string | null; size: Rect }) {
  return (
    <>
      <span
        aria-hidden="true"
        className={cn("pointer-events-none absolute", blocked ? "bg-destructive/10 shadow-[inset_0_0_0_2px_var(--destructive)]" : "shadow-[inset_0_0_0_2px_var(--brand)]")}
        style={rect}
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute max-w-64 bg-solid px-1.5 py-0.5 text-12 shadow-pop",
          blocked ? "text-destructive" : "font-mono text-foreground tabular-nums",
        )}
        style={{ left: rect.left, top: rect.top + rect.height + 4 }}
      >
        {blocked ?? `${fmt(size.w)} × ${fmt(size.h)}`}
      </span>
    </>
  );
}
