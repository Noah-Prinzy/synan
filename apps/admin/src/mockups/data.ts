/**
 * DEVELOPMENT ONLY — the admin mock-ups' data: the real Admin Command mock (Nexus Summit 2026 at
 * Nexus Hall, the demo instant Sun 22 Nov 2026 11:45 Kampala), loaded once and cached for the page.
 */
import { useEffect, useState } from "react";
import { DEMO_NOW, MockClock, idFor } from "@synan/mock";
import {
  buildVenue,
  createCommandMock,
  isGridPolygon,
  isGridRect,
  type AttendeeListRow,
  type DeskStock,
  type EventRow,
  type LiveSummary,
  type OperatorContext,
} from "@synan/mock/command";

export interface ZoneView {
  id: string;
  name: string;
  floor: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoomView {
  id: string;
  name: string;
  zone: string;
  floor: string;
  capacity: number;
  occupancy: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GateView {
  id: string;
  label: string;
  code: string;
  x: number;
  y: number;
}

export interface DxData {
  now: number;
  events: EventRow[];
  live: EventRow;
  summary: LiveSummary;
  grid: { w: number; h: number };
  venueName: string;
  zones: ZoneView[];
  rooms: RoomView[];
  gates: GateView[];
  gatesOnline: number;
  scansPerMinute: number;
  attendees: AttendeeListRow[];
  attendeeTotal: number;
  unbound: AttendeeListRow[];
  stock: DeskStock;
  operator: OperatorContext;
}

let pending: Promise<DxData> | null = null;
let ready: DxData | null = null;

async function load(): Promise<DxData> {
  const clock = new MockClock(DEMO_NOW);
  clock.setRate(0);
  const mock = createCommandMock({ clock, latencyMs: 0 });
  const events = await mock.configure.eventRows();
  const live = events.find((e) => e.slug === "nexus-summit-2026") ?? events[0];
  if (!live) throw new Error("no events in the mock");

  const [summary, gates, list, unbound, stock, operator] = await Promise.all([
    mock.api.summary(live.id),
    mock.api.gates(live.id),
    mock.configure.attendees(live.id),
    mock.configure.attendees(live.id, { unbound: true }),
    mock.configure.deskStock(live.id),
    mock.api.operator(),
  ]);

  const built = buildVenue("nexus-hall", idFor("org:synan-demo"));
  const { layout, initial } = built;
  const zones: ZoneView[] = layout.zones.map((z) => {
    const pts = isGridPolygon(z.geometry) ? z.geometry.points : [];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { id: z.id, name: z.name, floor: z.floor ?? "", x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  });
  const zoneOf = new Map(zones.map((z) => [z.id, z]));
  const rooms: RoomView[] = layout.rooms.flatMap((r) => {
    if (!isGridRect(r.geometry)) return [];
    const zone = zoneOf.get(r.zone_id);
    return [
      {
        id: r.id,
        name: r.name,
        zone: zone?.name ?? "",
        floor: zone?.floor ?? "",
        capacity: r.capacity,
        occupancy: initial[r.id] ?? 0,
        x: r.geometry.x,
        y: r.geometry.y,
        w: r.geometry.w,
        h: r.geometry.h,
      },
    ];
  });
  const perimeter = layout.checkpoints.filter((c) => c.perimeter);
  const gateViews: GateView[] = perimeter.flatMap((c) => {
    const p = layout.checkpoint_positions[c.id];
    if (!p) return [];
    const n = /Gate (\d+)/.exec(c.label)?.[1] ?? "";
    return [{ id: c.id, label: c.label, code: `G${n}`, x: p.x, y: p.y }];
  });
  const perimeterIds = new Set(perimeter.map((c) => c.id));
  const perimeterHealth = gates.filter((g) => perimeterIds.has(g.checkpoint_id));

  return {
    now: clock.now(),
    events,
    live,
    summary,
    grid: layout.grid,
    venueName: layout.venue.name,
    zones,
    rooms,
    gates: gateViews,
    gatesOnline: perimeterHealth.filter((g) => g.link_state === "online").length,
    scansPerMinute: perimeterHealth.reduce((sum, g) => sum + g.scans_last_minute, 0),
    attendees: list.items,
    attendeeTotal: list.total,
    unbound: unbound.items,
    stock,
    operator,
  };
}

export function loadData(): Promise<DxData> {
  if (!pending) {
    pending = load().then((d) => {
      ready = d;
      return d;
    });
  }
  return pending;
}

/** The mock data, or null for the first moment while it loads. */
export function useData(): DxData | null {
  const [data, setData] = useState<DxData | null>(ready);
  useEffect(() => {
    if (data) return;
    let alive = true;
    void loadData().then((d) => {
      if (alive) setData(d);
    });
    return () => {
      alive = false;
    };
  }, [data]);
  return data;
}

/* ---------------------------------------------------------------- rooms and words */

export type Level = "quiet" | "busy" | "near" | "full" | "over";

export function levelOf(room: Pick<RoomView, "occupancy" | "capacity">): Level {
  const pct = room.capacity > 0 ? room.occupancy / room.capacity : 0;
  if (pct > 1) return "over";
  if (pct >= 1) return "full";
  if (pct >= 0.85) return "near";
  if (pct >= 0.5) return "busy";
  return "quiet";
}

export const LEVEL_WORD: Record<Level, string> = {
  quiet: "Space",
  busy: "Busy",
  near: "Nearly full",
  full: "Full",
  over: "Over capacity",
};

export const LAB = "Lab 1";

/** The rooms for a Command Center state: calm keeps Lab 1 just under full; the alert puts it at 41 of 40. */
export function roomsFor(rooms: RoomView[], state: "calm" | "alert"): RoomView[] {
  return rooms.map((r) => (r.name === LAB ? { ...r, occupancy: state === "alert" ? 41 : 37 } : r));
}

export function busiest(rooms: RoomView[]): RoomView[] {
  return [...rooms].sort((a, b) => b.occupancy / b.capacity - a.occupancy / a.capacity);
}

/* ---------------------------------------------------------------- formatting */

const TZ = "Africa/Kampala";
const nf = new Intl.NumberFormat("en-GB");
export const num = (n: number) => nf.format(n);
export const pct = (n: number, of: number) => `${Math.round((of > 0 ? n / of : 0) * 100)}%`;

export function clock(iso: string | number) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export function day(iso: string | number) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
}

export function dateRange(from: string | null, to: string | null) {
  if (!from) return "Dates not set";
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" });
  const a = f.format(new Date(from));
  if (!to) return a;
  const b = f.format(new Date(to));
  if (a === b) return a;
  const [ad, am] = a.split(" ");
  const [bd, bm] = b.split(" ");
  return am === bm ? `${ad}–${bd} ${bm}` : `${a} – ${b}`;
}

export function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export const TIER_WORD: Record<string, string> = {
  VIP: "VIP",
  ORDINARY: "Delegate",
  PRIVATE_INVITE: "Invited",
  PUBLIC: "Public",
};

export const PASS_WORD: Record<string, { word: string; tone: "ok" | "warn" | "stop" | "quiet" }> = {
  active: { word: "Active", tone: "ok" },
  issued: { word: "Issued", tone: "quiet" },
  suspended_review: { word: "Under review", tone: "warn" },
  revoked: { word: "Revoked", tone: "stop" },
  replaced: { word: "Replaced", tone: "quiet" },
};

export const STATE_WORD: Record<string, { word: string; tone: "ok" | "warn" | "stop" | "quiet" | "live" }> = {
  live: { word: "Live", tone: "live" },
  published: { word: "Published", tone: "quiet" },
  draft: { word: "Draft", tone: "quiet" },
  closed: { word: "Closed", tone: "quiet" },
  archived: { word: "Archived", tone: "quiet" },
};
