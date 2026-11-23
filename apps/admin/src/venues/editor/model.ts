/**
 * The spatial editor's draft (D3): floors, zones and rooms as the editor holds them, the grid
 * geometry rules (snap, inside, overlap, free space), validation worded as the fix, the
 * plain-words diff against the published layout, and the body for Publish layout.
 *
 * Geometry is in grid units, origin top-left. Zones are stored as 4-point polygons and rooms as
 * rectangles; the editor treats both as rectangles. The contract wants whole grid units, so
 * edges are rounded on publish (the mock seeds some rooms at fractions of a unit).
 */
import type { CapacityPolicy } from "@synan/contracts/enums";
import type { Room, Zone } from "@synan/contracts/rest";
import type { PublishLayoutBody, VenueDetail } from "@synan/mock/command";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DraftFloor {
  id: string;
  name: string;
}

export interface DraftZone {
  id: string;
  name: string;
  floorId: string;
  rect: Rect;
}

/** Numbers are kept as typed, so a half-typed value is an error to fix rather than lost. */
export interface DraftRoom {
  id: string;
  zoneId: string;
  name: string;
  capacity: string;
  warn: string;
  stop: string;
  continuous: boolean;
  policy: CapacityPolicy;
  rect: Rect;
}

export interface Layout {
  floors: DraftFloor[];
  zones: DraftZone[];
  rooms: DraftRoom[];
}

export type Selection = { kind: "zone"; id: string } | { kind: "room"; id: string } | null;

export const MIN_SIZE = 2;
const EPS = 0.001;

export const POLICY_LABEL: Record<CapacityPolicy, string> = {
  block: "Block entry",
  admit_with_alert: "Admit and alert",
};

/* --------------------------------------------------------------- geometry */

export function rectOfGeometry(geometry: unknown): Rect | null {
  if (typeof geometry !== "object" || geometry === null) return null;
  const g = geometry as { kind?: string; x?: number; y?: number; w?: number; h?: number; points?: [number, number][] };
  if (g.kind === "rect" && [g.x, g.y, g.w, g.h].every((n) => typeof n === "number")) {
    return { x: g.x as number, y: g.y as number, w: g.w as number, h: g.h as number };
  }
  if (g.kind === "polygon" && Array.isArray(g.points) && g.points.length >= 3) {
    const xs = g.points.map((p) => p[0]);
    const ys = g.points.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  return null;
}

/** Whole grid units, rounding each edge, so neighbours that shared an edge still do. */
export function roundRect(r: Rect): Rect {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  return { x, y, w: Math.max(1, Math.round(r.x + r.w) - x), h: Math.max(1, Math.round(r.y + r.h) - y) };
}

export function sameRect(a: Rect, b: Rect): boolean {
  const ra = roundRect(a);
  const rb = roundRect(b);
  return ra.x === rb.x && ra.y === rb.y && ra.w === rb.w && ra.h === rb.h;
}

export function inside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x - EPS &&
    inner.y >= outer.y - EPS &&
    inner.x + inner.w <= outer.x + outer.w + EPS &&
    inner.y + inner.h <= outer.y + outer.h + EPS
  );
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
}

export function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** The rectangle between two grid points, snapped outward to whole units. */
export function rectBetween(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  const x1 = Math.floor(Math.min(a.x, b.x));
  const y1 = Math.floor(Math.min(a.y, b.y));
  const x2 = Math.ceil(Math.max(a.x, b.x));
  const y2 = Math.ceil(Math.max(a.y, b.y));
  return { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) };
}

/** The first free whole-unit spot of size w×h inside `area`, scanning rows top to bottom. */
export function findSpot(area: Rect, w: number, h: number, obstacles: Rect[]): Rect | null {
  const x0 = Math.ceil(area.x - EPS);
  const y0 = Math.ceil(area.y - EPS);
  for (let y = y0; y + h <= area.y + area.h + EPS; y++) {
    for (let x = x0; x + w <= area.x + area.w + EPS; x++) {
      const candidate = { x, y, w, h };
      if (!obstacles.some((o) => overlaps(candidate, o))) return candidate;
    }
  }
  return null;
}

/** Where a new room goes in a zone: below the label band if it fits, anywhere free if not. */
export function spotForRoom(zone: Rect, others: Rect[], size: { w: number; h: number }): Rect | null {
  const padded = { x: zone.x + 1, y: zone.y + 4, w: zone.w - 2, h: zone.h - 5 };
  const sizes = [size, { w: 6, h: 4 }, { w: 4, h: 3 }, { w: MIN_SIZE, h: MIN_SIZE }];
  for (const s of sizes) {
    const spot = (padded.w >= s.w && padded.h >= s.h ? findSpot(padded, s.w, s.h, others) : null) ?? findSpot(zone, s.w, s.h, others);
    if (spot) return spot;
  }
  return null;
}

/* ------------------------------------------------------------- conversion */

export function layoutOf(detail: VenueDetail): Layout {
  const floors: DraftFloor[] = detail.floors.map((name, index) => ({ id: `floor-${index}`, name }));
  const floorId = (name: string | null): string => {
    const found = floors.find((f) => f.name === name);
    if (found) return found.id;
    if (name) {
      const added = { id: `floor-${floors.length}`, name };
      floors.push(added);
      return added.id;
    }
    if (floors.length === 0) floors.push({ id: "floor-0", name: "Ground" });
    return (floors[0] as DraftFloor).id;
  };

  const zones: DraftZone[] = [];
  for (const zone of detail.zones) {
    const rect = rectOfGeometry(zone.geometry) ?? findSpot({ x: 0, y: 0, ...detail.grid }, 12, 8, zones.map((z) => z.rect));
    if (!rect) continue;
    zones.push({ id: zone.id, name: zone.name, floorId: floorId(zone.floor), rect });
  }
  if (floors.length === 0) floors.push({ id: "floor-0", name: "Ground" });

  const rooms: DraftRoom[] = [];
  for (const room of detail.rooms) {
    const zone = zones.find((z) => z.id === room.zone_id);
    if (!zone) continue;
    const rect =
      rectOfGeometry(room.geometry) ??
      spotForRoom(zone.rect, rooms.filter((r) => r.zoneId === zone.id).map((r) => r.rect), { w: 6, h: 4 });
    if (!rect) continue;
    rooms.push({
      id: room.id,
      zoneId: room.zone_id,
      name: room.name,
      capacity: String(room.capacity),
      warn: String(room.warn_at_pct),
      stop: String(room.block_at_pct),
      continuous: room.continuous,
      policy: room.capacity_policy,
      rect,
    });
  }
  return { floors, zones: orderZones(floors, zones), rooms };
}

/** Zones grouped in floor order, keeping their order within a floor. */
export function orderZones(floors: DraftFloor[], zones: DraftZone[]): DraftZone[] {
  const rank = new Map(floors.map((f, i) => [f.id, i]));
  return zones
    .map((zone, index) => ({ zone, index }))
    .sort((a, b) => (rank.get(a.zone.floorId) ?? 0) - (rank.get(b.zone.floorId) ?? 0) || a.index - b.index)
    .map(({ zone }) => zone);
}

export function publishBody(layout: Layout, expectedVersion: number): PublishLayoutBody {
  const floorName = new Map(layout.floors.map((f) => [f.id, f.name.trim()]));
  const zones: Omit<Zone, "venue_id">[] = orderZones(layout.floors, layout.zones).map((zone) => {
    const r = roundRect(zone.rect);
    return {
      id: zone.id,
      name: zone.name.trim(),
      floor: floorName.get(zone.floorId) ?? null,
      geometry: { kind: "polygon", points: [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]] },
    };
  });
  const rooms: Omit<Room, "venue_id">[] = layout.rooms.map((room) => {
    const r = roundRect(room.rect);
    return {
      id: room.id,
      zone_id: room.zoneId,
      name: room.name.trim(),
      capacity: Number(room.capacity),
      warn_at_pct: Number(room.warn),
      block_at_pct: Number(room.stop),
      continuous: room.continuous,
      capacity_policy: room.policy,
      geometry: { kind: "rect", x: r.x, y: r.y, w: r.w, h: r.h },
    };
  });
  return { expected_version: expectedVersion, floors: layout.floors.map((f) => f.name.trim()), zones, rooms };
}

/* ------------------------------------------------------------- validation */

export interface Issue {
  kind: "zone" | "room" | "floor" | "layout";
  id: string;
  field: string;
  message: string;
}

const whole = (value: string): number | null => (/^\s*\d+\s*$/.test(value) ? Number(value) : null);

export function roomIssues(room: DraftRoom): Issue[] {
  const out: Issue[] = [];
  const add = (field: string, message: string) => out.push({ kind: "room", id: room.id, field, message });
  if (!room.name.trim()) add("name", "Give the room a name.");
  else if (room.name.trim().length > 200) add("name", "Keep the name under 200 characters.");
  const capacity = whole(room.capacity);
  if (capacity === null || capacity < 1) add("capacity", "Enter a whole number of people, at least 1.");
  const warn = whole(room.warn);
  if (warn === null || warn < 1 || warn > 100) add("warn", "Warn somewhere between 1 and 100 percent.");
  const stop = whole(room.stop);
  if (stop === null || stop < 1) add("stop", "Enter a whole percentage, usually 100.");
  else if (warn !== null && stop < warn) add("stop", `Stop at or above the warning (${warn}%).`);
  else if (stop > 1000) add("stop", "Keep it at 1000 percent or less.");
  return out;
}

export function issuesOf(layout: Layout): Issue[] {
  const out: Issue[] = [];
  if (layout.zones.length === 0) out.push({ kind: "layout", id: "layout", field: "zones", message: "Draw at least one zone before publishing." });
  const seen = new Set<string>();
  for (const floor of layout.floors) {
    const name = floor.name.trim();
    if (!name) out.push({ kind: "floor", id: floor.id, field: "name", message: "Name this floor, or remove it." });
    else if (seen.has(name.toLowerCase())) out.push({ kind: "floor", id: floor.id, field: "name", message: `There is already a floor called ${name}.` });
    seen.add(name.toLowerCase());
  }
  for (const zone of orderZones(layout.floors, layout.zones)) {
    if (!zone.name.trim()) out.push({ kind: "zone", id: zone.id, field: "name", message: "Give the zone a name." });
    for (const room of layout.rooms.filter((r) => r.zoneId === zone.id)) out.push(...roomIssues(room));
  }
  return out;
}

/** Messages for one item, by field. */
export function issuesFor(issues: Issue[], id: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) if (issue.id === id && !out[issue.field]) out[issue.field] = issue.message;
  return out;
}

/* ------------------------------------------------------------------- diff */

export interface Change {
  key: string;
  kind: "added" | "changed" | "removed";
  target: "floor" | "zone" | "room" | "order";
  /** The item's name as it will be (or was, when removed). */
  name: string;
  /** Plain-words details: "capacity 80 → 90". */
  details: string[];
  /** For selecting it from the summary. */
  select: Selection;
}

const label = (name: string, fallback: string) => name.trim() || fallback;

function geometryWords(a: Rect, b: Rect): string | null {
  if (sameRect(a, b)) return null;
  const ra = roundRect(a);
  const rb = roundRect(b);
  const resized = ra.w !== rb.w || ra.h !== rb.h;
  const moved = ra.x !== rb.x || ra.y !== rb.y;
  if (resized && moved) return `moved and resized to ${rb.w} × ${rb.h}`;
  if (resized) return `resized ${ra.w} × ${ra.h} → ${rb.w} × ${rb.h}`;
  return "moved";
}

export function diffLayouts(before: Layout, after: Layout): Change[] {
  const changes: Change[] = [];
  const floorBefore = new Map(before.floors.map((f) => [f.id, f]));
  const floorAfter = new Map(after.floors.map((f) => [f.id, f]));
  const floorName = (layout: Layout, id: string) => layout.floors.find((f) => f.id === id)?.name.trim() || "Unnamed floor";

  /* floors */
  for (const floor of after.floors) {
    const old = floorBefore.get(floor.id);
    if (!old) changes.push({ key: `floor:${floor.id}`, kind: "added", target: "floor", name: label(floor.name, "New floor"), details: ["new floor"], select: null });
    else if (old.name.trim() !== floor.name.trim()) {
      changes.push({ key: `floor:${floor.id}`, kind: "changed", target: "floor", name: label(floor.name, "Unnamed floor"), details: [`renamed from ${old.name}`], select: null });
    }
  }
  for (const floor of before.floors) {
    if (!floorAfter.has(floor.id)) changes.push({ key: `floor:${floor.id}`, kind: "removed", target: "floor", name: floor.name, details: ["floor removed"], select: null });
  }
  const commonFloors = (layout: Layout) => layout.floors.map((f) => f.id).filter((id) => floorBefore.has(id) && floorAfter.has(id));
  if (commonFloors(before).join() !== commonFloors(after).join()) {
    changes.push({ key: "order:floors", kind: "changed", target: "order", name: "Floors", details: ["reordered"], select: null });
  }

  /* zones */
  const zoneBefore = new Map(before.zones.map((z) => [z.id, z]));
  const zoneAfter = new Map(after.zones.map((z) => [z.id, z]));
  for (const zone of orderZones(after.floors, after.zones)) {
    const old = zoneBefore.get(zone.id);
    const select: Selection = { kind: "zone", id: zone.id };
    if (!old) {
      changes.push({
        key: `zone:${zone.id}`,
        kind: "added",
        target: "zone",
        name: label(zone.name, "Unnamed zone"),
        details: [`new zone on ${floorName(after, zone.floorId)}, ${roundRect(zone.rect).w} × ${roundRect(zone.rect).h}`],
        select,
      });
      continue;
    }
    const details: string[] = [];
    if (old.name.trim() !== zone.name.trim()) details.push(`renamed from ${old.name}`);
    if (floorName(before, old.floorId) !== floorName(after, zone.floorId)) {
      details.push(`floor ${floorName(before, old.floorId)} → ${floorName(after, zone.floorId)}`);
    }
    const geometry = geometryWords(old.rect, zone.rect);
    if (geometry) details.push(geometry);
    if (details.length) changes.push({ key: `zone:${zone.id}`, kind: "changed", target: "zone", name: label(zone.name, "Unnamed zone"), details, select });
  }
  for (const zone of before.zones) {
    if (zoneAfter.has(zone.id)) continue;
    const lost = before.rooms.filter((r) => r.zoneId === zone.id && !after.rooms.some((a) => a.id === r.id)).length;
    changes.push({
      key: `zone:${zone.id}`,
      kind: "removed",
      target: "zone",
      name: zone.name,
      details: [lost > 0 ? `zone removed with its ${lost} ${lost === 1 ? "room" : "rooms"}` : "zone removed"],
      select: null,
    });
  }
  const commonZones = (layout: Layout) =>
    orderZones(layout.floors, layout.zones)
      .map((z) => z.id)
      .filter((id) => zoneBefore.has(id) && zoneAfter.has(id));
  if (commonZones(before).join() !== commonZones(after).join()) {
    changes.push({ key: "order:zones", kind: "changed", target: "order", name: "Zones", details: ["reordered in the list"], select: null });
  }

  /* rooms */
  const roomBefore = new Map(before.rooms.map((r) => [r.id, r]));
  const zoneLabel = (layout: Layout, id: string) => layout.zones.find((z) => z.id === id)?.name.trim() || "a zone";
  for (const room of after.rooms) {
    const old = roomBefore.get(room.id);
    const select: Selection = { kind: "room", id: room.id };
    const name = label(room.name, "Unnamed room");
    if (!old) {
      changes.push({
        key: `room:${room.id}`,
        kind: "added",
        target: "room",
        name,
        details: [`new room in ${zoneLabel(after, room.zoneId)}, capacity ${room.capacity || "not set"}`],
        select,
      });
      continue;
    }
    const details: string[] = [];
    if (old.name.trim() !== room.name.trim()) details.push(`renamed from ${old.name}`);
    if (old.zoneId !== room.zoneId) details.push(`zone ${zoneLabel(before, old.zoneId)} → ${zoneLabel(after, room.zoneId)}`);
    if (old.capacity.trim() !== room.capacity.trim()) details.push(`capacity ${old.capacity} → ${room.capacity || "not set"}`);
    if (old.warn.trim() !== room.warn.trim()) details.push(`warns at ${old.warn}% → ${room.warn || "?"}%`);
    if (old.stop.trim() !== room.stop.trim()) details.push(`stops at ${old.stop}% → ${room.stop || "?"}%`);
    if (old.continuous !== room.continuous) details.push(room.continuous ? "now continuous" : "no longer continuous");
    if (old.policy !== room.policy) details.push(`${POLICY_LABEL[old.policy]} → ${POLICY_LABEL[room.policy]}`);
    const geometry = old.zoneId === room.zoneId ? geometryWords(old.rect, room.rect) : null;
    if (geometry) details.push(geometry);
    if (details.length) changes.push({ key: `room:${room.id}`, kind: "changed", target: "room", name, details, select });
  }
  const afterRoomIds = new Set(after.rooms.map((r) => r.id));
  for (const room of before.rooms) {
    if (afterRoomIds.has(room.id)) continue;
    // Rooms that went with their zone are already counted in the zone's line.
    if (!zoneAfter.has(room.zoneId)) continue;
    changes.push({ key: `room:${room.id}`, kind: "removed", target: "room", name: room.name, details: [`room removed from ${zoneLabel(before, room.zoneId)}`], select: null });
  }
  return changes;
}

/** "new" or "changed" per zone/room id, for quiet markers in the list. */
export function changeMarks(changes: Change[]): Map<string, "new" | "changed"> {
  const marks = new Map<string, "new" | "changed">();
  for (const change of changes) {
    if (!change.select) continue;
    if (change.kind === "added") marks.set(change.select.id, "new");
    else if (change.kind === "changed") marks.set(change.select.id, "changed");
  }
  return marks;
}

/** "Room 3", "Zone 2": the first free numbered name. */
export function nextName(prefix: string, taken: string[]): string {
  const names = new Set(taken.map((n) => n.trim().toLowerCase()));
  for (let i = 1; ; i++) {
    const name = `${prefix} ${i}`;
    if (!names.has(name.toLowerCase())) return name;
  }
}

export function newId(): string {
  return crypto.randomUUID();
}

/* ------------------------------------------------------------ edit rules */

/** Why a room cannot go at `rect` (null when it can). */
export function roomBlocked(layout: Layout, roomId: string | null, zoneId: string, rect: Rect): string | null {
  const zone = layout.zones.find((z) => z.id === zoneId);
  if (!zone) return "Rooms are drawn inside a zone.";
  if (rect.w < MIN_SIZE - EPS || rect.h < MIN_SIZE - EPS) return `Rooms are at least ${MIN_SIZE} × ${MIN_SIZE} grid units.`;
  if (!inside(rect, zone.rect)) return `A room stays inside its zone, ${label(zone.name, "this zone")}.`;
  const hit = layout.rooms.find((r) => r.id !== roomId && r.zoneId === zoneId && overlaps(r.rect, rect));
  if (hit) return `That would overlap ${label(hit.name, "another room")}.`;
  return null;
}

/** Why a zone cannot take `rect` (null when it can). Its rooms move with it when `carryRooms`. */
export function zoneBlocked(layout: Layout, zoneId: string | null, rect: Rect, grid: { w: number; h: number }, carryRooms: boolean): string | null {
  if (rect.w < MIN_SIZE - EPS || rect.h < MIN_SIZE - EPS) return `Zones are at least ${MIN_SIZE} × ${MIN_SIZE} grid units.`;
  if (!inside(rect, { x: 0, y: 0, w: grid.w, h: grid.h })) return "Zones stay on the grid.";
  const hit = layout.zones.find((z) => z.id !== zoneId && overlaps(z.rect, rect));
  if (hit) return `That would overlap ${label(hit.name, "another zone")}.`;
  if (zoneId && !carryRooms) {
    const out = layout.rooms.find((r) => r.zoneId === zoneId && !inside(r.rect, rect));
    if (out) return `${label(out.name, "A room")} would end up outside the zone. Move or shrink it first.`;
  }
  return null;
}

/** The layout with a zone at `rect`; with `carryRooms`, its rooms shift by the same amount. */
export function withZoneRect(layout: Layout, zoneId: string, rect: Rect, carryRooms: boolean): Layout {
  const zone = layout.zones.find((z) => z.id === zoneId);
  if (!zone) return layout;
  const dx = rect.x - zone.rect.x;
  const dy = rect.y - zone.rect.y;
  return {
    ...layout,
    zones: layout.zones.map((z) => (z.id === zoneId ? { ...z, rect } : z)),
    rooms:
      carryRooms && (dx !== 0 || dy !== 0)
        ? layout.rooms.map((r) => (r.zoneId === zoneId ? { ...r, rect: { ...r.rect, x: r.rect.x + dx, y: r.rect.y + dy } } : r))
        : layout.rooms,
  };
}

/** The room under a grid point, then the zone. */
export function hitTest(layout: Layout, x: number, y: number): Selection {
  for (let i = layout.rooms.length - 1; i >= 0; i--) {
    const room = layout.rooms[i] as DraftRoom;
    if (contains(room.rect, x, y)) return { kind: "room", id: room.id };
  }
  for (let i = layout.zones.length - 1; i >= 0; i--) {
    const zone = layout.zones[i] as DraftZone;
    if (contains(zone.rect, x, y)) return { kind: "zone", id: zone.id };
  }
  return null;
}

export function rectOf(layout: Layout, selection: Selection): Rect | null {
  if (!selection) return null;
  if (selection.kind === "zone") return layout.zones.find((z) => z.id === selection.id)?.rect ?? null;
  return layout.rooms.find((r) => r.id === selection.id)?.rect ?? null;
}

export function nameOf(layout: Layout, selection: Selection): string {
  if (!selection) return "";
  if (selection.kind === "zone") return label(layout.zones.find((z) => z.id === selection.id)?.name ?? "", "Unnamed zone");
  return label(layout.rooms.find((r) => r.id === selection.id)?.name ?? "", "Unnamed room");
}
