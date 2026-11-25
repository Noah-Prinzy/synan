/**
 * DEVELOPMENT ONLY — the direction mock-ups read the same mock world the app runs on
 * (packages/mock): the portal's events, rooms, sessions and public occupancy at the demo instant,
 * the demo holder, and the registrations the console reports for each event.
 */
import { useEffect, useState } from "react";
import { createPortalStore, DEMO_HOLDER, DEMO_NOW, MockClock, type PortalEvent, type StorageLike } from "@synan/mock";

const memory = new Map<string, string>();
const storage: StorageLike = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => void memory.set(key, value),
  removeItem: (key) => void memory.delete(key),
};

const clock = new MockClock(DEMO_NOW);
const store = createPortalStore({ clock, storage });

export const NOW = Date.parse(DEMO_NOW);
export const HOLDER = DEMO_HOLDER;
export const TZ = "Africa/Kampala";

export type MockEvent = PortalEvent["detail"];

export const EVENTS: MockEvent[] = store.listEvents().map((event) => event.detail);
export const LIVE = EVENTS.filter((event) => event.state === "live");
export const UPCOMING = EVENTS.filter((event) => event.state !== "live");
export const FEATURED: MockEvent = LIVE[0] ?? EVENTS[0]!;

export const eventBySlug = (slug: string | undefined): MockEvent => EVENTS.find((event) => event.slug === slug) ?? FEATURED;

export function occupancy(event: MockEvent) {
  return store.occupancy(event.id).map((room) => ({
    ...room,
    name: event.rooms.find((r) => r.room_id === room.room_id)?.name ?? "Room",
    pct: room.capacity ? Math.round(((room.occupancy ?? 0) / room.capacity) * 100) : 0,
  }));
}

export const capacityOf = (event: MockEvent) => event.rooms.reduce((sum, room) => sum + room.capacity, 0);

export const profileFields = (slug: string) => store.profile(slug)?.fields ?? [];

/* ---------------------------------------------------------------- wording */

const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...options });

export const dayShort = (iso: string) => fmt({ weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
export const dayLong = (iso: string) => fmt({ weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
export const time = (iso: string) => fmt({ hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
export const dayNum = (iso: string) => fmt({ day: "numeric" }).format(new Date(iso));
export const monthShort = (iso: string) => fmt({ month: "short" }).format(new Date(iso));

/** "22–23 November", "25–27 November", "28 November". */
export function dateRange(event: MockEvent): string {
  const a = new Date(event.starts_at);
  const b = new Date(event.ends_at);
  const day = fmt({ day: "numeric" });
  const month = fmt({ month: "long" });
  if (day.format(a) === day.format(b) && month.format(a) === month.format(b)) return `${day.format(a)} ${month.format(a)}`;
  if (month.format(a) === month.format(b)) return `${day.format(a)}–${day.format(b)} ${month.format(a)}`;
  return `${day.format(a)} ${month.format(a)} – ${day.format(b)} ${month.format(b)}`;
}

export function whenLabel(event: MockEvent): string {
  if (event.state === "live") return "Live now";
  const days = Math.ceil((Date.parse(event.starts_at) - NOW) / 86_400_000);
  if (days <= 1) return "Tomorrow";
  if (days < 7) return `In ${days} days`;
  return dayShort(event.starts_at);
}

export const greeting = () => {
  const hour = Number(fmt({ hour: "numeric", hour12: false }).format(new Date(NOW)));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
};

export const nowLabel = () => `${fmt({ weekday: "long", day: "numeric", month: "long" }).format(new Date(NOW))} · ${time(DEMO_NOW)} in Kampala`;

export const n = (value: number) => value.toLocaleString("en-GB");

/** Sessions of an event around the demo instant: the next few, with the one on now first. */
export function sessionsExcerpt(event: MockEvent, count = 4) {
  const today = dayShort(new Date(NOW).toISOString());
  const sorted = [...event.sessions]
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .filter((s) => event.state !== "live" || dayShort(s.starts_at) === today);
  const firstOpen = sorted.findIndex((s) => Date.parse(s.ends_at) > NOW);
  const from = Math.max(0, firstOpen);
  return sorted.slice(from, from + count).map((s) => ({
    ...s,
    room: event.rooms.find((r) => r.room_id === s.room_id)?.name ?? "",
    now: Date.parse(s.starts_at) <= NOW && Date.parse(s.ends_at) > NOW,
  }));
}

/* ------------------------------------------------- registrations (console mock) */

export interface Registrations {
  registrations: number;
  checked_in: number;
}

let cached: Record<string, Registrations> | null = null;

/** How many have registered for each event, from the console's mock (by slug). */
export function useRegistrations(): Record<string, Registrations> {
  const [rows, setRows] = useState<Record<string, Registrations>>(cached ?? {});
  useEffect(() => {
    if (cached) return;
    let alive = true;
    void import("@synan/mock/command").then(async ({ createCommandMock }) => {
      const mock = createCommandMock({ clock: new MockClock(DEMO_NOW), latencyMs: 0 });
      const list = await mock.configure.eventRows();
      const next: Record<string, Registrations> = {};
      for (const row of list) next[row.slug] = { registrations: row.registrations, checked_in: row.checked_in };
      cached = next;
      if (alive) setRows(next);
    });
    return () => {
      alive = false;
    };
  }, []);
  return rows;
}

/**
 * How full an event is. Live: how full the venue is right now (people on site against the rooms'
 * capacity, from the public occupancy). Upcoming: registrations against the places on offer.
 * The mock world has no registration cap, so the places figure is illustrative: registrations
 * plus a quarter, rounded up to fifty (rooms turn over during a day, so registrations exceed
 * room capacity). Registrations themselves are the console mock's.
 */
export function fullness(event: MockEvent, regs: Record<string, Registrations>) {
  const registered = regs[event.slug]?.registrations ?? Math.round(capacityOf(event) * 0.6);
  if (event.state === "live") {
    const capacity = capacityOf(event);
    const here = event.on_site ?? 0;
    const pct = capacity ? Math.round((here / capacity) * 100) : 0;
    const words = pct >= 100 ? "Full right now" : pct >= 85 ? "Nearly full right now" : pct >= 60 ? "Busy right now" : "Quiet right now";
    return { live: true, capacity, taken: registered, here, pct, left: Math.max(0, capacity - here), words, note: `${n(here)} here now` };
  }
  const capacity = Math.ceil((registered * 1.25) / 50) * 50;
  const pct = capacity ? Math.round((registered / capacity) * 100) : 0;
  const words = pct >= 100 ? "Full" : pct >= 85 ? "Nearly full" : pct >= 60 ? "Filling up" : "Plenty of room";
  return { live: false, capacity, taken: registered, here: 0, pct, left: capacity - registered, words, note: `${n(registered)} of ${n(capacity)} places` };
}
