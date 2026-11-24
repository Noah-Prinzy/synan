/**
 * Live room counts for the event page (A2) and the agenda (A6): GET /events/:id/occupancy, the
 * public, k-anonymised scope (O-08), signed in or not. One poll per event however many screens
 * watch it, never sooner than the answer's `max_age_s`, and paused while the tab is hidden or the
 * device is offline (docs/05 §5). The mock answers at once, so its counts are there on first paint.
 */
import { useEffect, useState } from "react";
import { backend } from "./backend";

export type RoomCount = { occupancy: number | null; capacity: number };

export type OccupancyView = {
  /** Counts exist only while the event is live. */
  live: boolean;
  /** By room id. A room that is absent has no count to show. */
  rooms: Record<string, RoomCount>;
  /** People on site; null when not live or below the minimum crowd size. */
  onSite: number | null;
  /** How long the answer may be reused. */
  maxAgeS: number;
};

/**
 * What a room's count can say: `closed` (the event is not live, or the room has no count yet),
 * `hidden` (fewer people than the minimum crowd size: the API withholds the number), or a count.
 */
export type RoomNow = { kind: "closed" } | { kind: "hidden"; capacity: number } | { kind: "count"; occupancy: number; capacity: number };

export function roomNow(view: OccupancyView | null, roomId: string): RoomNow {
  const room = view?.live ? view.rooms[roomId] : undefined;
  if (!room) return { kind: "closed" };
  if (room.occupancy === null) return { kind: "hidden", capacity: room.capacity };
  return { kind: "count", occupancy: room.occupancy, capacity: room.capacity };
}

/** Floor between polls of a live event, whatever max_age_s says. */
const LIVE_FLOOR_MS = 10_000;
/** Not live yet (or no longer): look again now and then, in case it opens while the page is open. */
const IDLE_MS = 60_000;
const RETRY_MS = 30_000;

type Watch = {
  value: OccupancyView | null;
  /** When the last answer (or failure) arrived; 0 before the first. */
  at: number;
  failed: boolean;
  loading: boolean;
  timer: number | null;
  listeners: Set<() => void>;
};

const watches = new Map<string, Watch>();

function entry(eventId: string): Watch {
  let watch = watches.get(eventId);
  if (!watch) {
    watch = { value: null, at: 0, failed: false, loading: false, timer: null, listeners: new Set() };
    watches.set(eventId, watch);
  }
  return watch;
}

function canPoll(): boolean {
  return document.visibilityState === "visible" && navigator.onLine;
}

function interval(watch: Watch): number {
  if (watch.failed) return RETRY_MS;
  if (!watch.value?.live) return IDLE_MS;
  return Math.max(watch.value.maxAgeS * 1000, LIVE_FLOOR_MS);
}

function settle(eventId: string, watch: Watch, value: OccupancyView | null | undefined): void {
  watch.loading = false;
  watch.at = Date.now();
  watch.failed = value === undefined;
  // A failed poll keeps the last counts on screen rather than blanking them.
  if (value !== undefined) watch.value = value;
  for (const listener of watch.listeners) listener();
  schedule(eventId, watch);
}

function load(eventId: string, watch: Watch): void {
  if (watch.loading) return;
  watch.loading = true;
  let answer: ReturnType<typeof backend.getOccupancy>;
  try {
    answer = backend.getOccupancy(eventId);
  } catch {
    settle(eventId, watch, undefined);
    return;
  }
  if (answer instanceof Promise) {
    answer.then(
      (value) => settle(eventId, watch, value),
      () => settle(eventId, watch, undefined),
    );
  } else {
    settle(eventId, watch, answer);
  }
}

function schedule(eventId: string, watch: Watch): void {
  if (watch.timer !== null) window.clearTimeout(watch.timer);
  watch.timer = null;
  if (watch.listeners.size === 0 || watch.loading || !canPoll()) return;
  const wait = Math.max(0, watch.at + interval(watch) - Date.now());
  watch.timer = window.setTimeout(() => {
    watch.timer = null;
    if (canPoll()) load(eventId, watch);
  }, wait);
}

/** Hidden or offline: every timer stops. Back: anything stale is fetched at once, then on schedule. */
function resume(): void {
  for (const [eventId, watch] of watches) schedule(eventId, watch);
}

let listening = false;
function listen(): void {
  if (listening) return;
  listening = true;
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("online", resume);
  window.addEventListener("offline", resume);
}

function watch(eventId: string, listener: () => void): () => void {
  listen();
  const current = entry(eventId);
  current.listeners.add(listener);
  schedule(eventId, current);
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size === 0 && current.timer !== null) {
      window.clearTimeout(current.timer);
      current.timer = null;
    }
  };
}

/** An answer the source gives at once (the mock) is used for the first paint; the API's comes after. */
function prime(eventId: string): void {
  const current = entry(eventId);
  if (current.at !== 0 || current.loading || backend.mode !== "mock") return;
  load(eventId, current);
}

/** Room counts for these events, live while the calling screen is mounted. */
export function useOccupancy(eventIds: readonly string[]): (eventId: string) => OccupancyView | null {
  const key = [...new Set(eventIds)].sort().join(" ");
  const [, setVersion] = useState(0);
  for (const eventId of eventIds) prime(eventId);

  useEffect(() => {
    if (!key) return;
    const bump = () => setVersion((n) => n + 1);
    const stops = key.split(" ").map((eventId) => watch(eventId, bump));
    return () => {
      for (const stop of stops) stop();
    };
  }, [key]);

  return (eventId) => watches.get(eventId)?.value ?? null;
}
