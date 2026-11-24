// @vitest-environment happy-dom
/**
 * Live room counts on the event page and agenda (data/occupancy.ts): one poll per event however
 * many screens watch it, never sooner than the answer's `max_age_s` (with a 10 s floor), paused while
 * the tab is hidden or the phone is offline, and the last counts kept through a failed poll.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { PublicOccupancy } from "@synan/contracts/rest";
import type { OccupancyView } from "../src/data/occupancy";
import { EVENT_A, EVENT_B } from "./fixtures";
import { cleanup, renderHook } from "./render-hook";

const getOccupancy = vi.hoisted(() => vi.fn<(eventId: string) => Promise<OccupancyView | null>>());
vi.mock("../src/data/backend", () => ({ backend: { mode: "api", getOccupancy } }));

const ROOM = "99999999-9999-4999-8999-999999999999";
const ZONE = "88888888-8888-4888-8888-888888888888";

/** An answer as the API sends it, mapped the way data/api/remote.ts maps it. */
function answer(p: { live?: boolean; maxAgeS?: number; occupancy?: number | null } = {}): OccupancyView {
  const wire = PublicOccupancy.parse({
    event_id: EVENT_A,
    as_of: "2026-12-01T10:00:00.000Z",
    live: p.live ?? true,
    rooms: [{ room_id: ROOM, zone_id: ZONE, occupancy: p.occupancy === undefined ? 40 : p.occupancy, capacity: 100, level: "ok" }],
    zones: [{ zone_id: ZONE, occupancy: 40 }],
    totals: { on_site: 120, in_rooms: 40 },
    max_age_s: p.maxAgeS ?? 30,
  });
  return {
    live: wire.live,
    rooms: Object.fromEntries(wire.rooms.map((room) => [room.room_id, { occupancy: room.occupancy, capacity: room.capacity }])),
    onSite: wire.totals.on_site,
    maxAgeS: wire.max_age_s,
  };
}

let visibility: DocumentVisibilityState = "visible";
let onLine = true;
let occupancy: typeof import("../src/data/occupancy");

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-12-01T10:00:00.000Z"));
  visibility = "visible";
  onLine = true;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => onLine });
  getOccupancy.mockReset();
  getOccupancy.mockResolvedValue(answer());
  // The poller keeps one watch per event for the page's life: start each test from a fresh page.
  vi.resetModules();
  occupancy = await import("../src/data/occupancy");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const polls = () => getOccupancy.mock.calls.length;

function watch(ids: string[]) {
  return renderHook((eventIds: string[]) => occupancy.useOccupancy(eventIds), ids);
}

describe("polling", () => {
  it("reads at once, then not again before the answer's max_age_s", async () => {
    const view = watch([EVENT_A]);
    await advance(0);
    expect(polls()).toBe(1);
    expect(view.result.current(EVENT_A)?.onSite).toBe(120);
    await advance(29_999);
    expect(polls()).toBe(1);
    await advance(1);
    expect(polls()).toBe(2);
  });

  it("never polls a live event more often than every 10 s, whatever max_age_s says", async () => {
    getOccupancy.mockResolvedValue(answer({ maxAgeS: 1 }));
    watch([EVENT_A]);
    await advance(0);
    await advance(9_999);
    expect(polls()).toBe(1);
    await advance(1);
    expect(polls()).toBe(2);
  });

  it("looks only once a minute while the event is not live", async () => {
    getOccupancy.mockResolvedValue(answer({ live: false, maxAgeS: 5 }));
    watch([EVENT_A]);
    await advance(0);
    await advance(59_999);
    expect(polls()).toBe(1);
    await advance(1);
    expect(polls()).toBe(2);
  });

  it("keeps the last counts on screen through a failed poll, and tries again after 30 s", async () => {
    const view = watch([EVENT_A]);
    await advance(0);
    getOccupancy.mockRejectedValueOnce(new Error("502"));
    await advance(30_000);
    expect(polls()).toBe(2);
    expect(view.result.current(EVENT_A)?.onSite).toBe(120);
    await advance(29_999);
    expect(polls()).toBe(2);
    await advance(1);
    expect(polls()).toBe(3);
  });

  it("polls each event once however many screens watch it", async () => {
    watch([EVENT_A]);
    watch([EVENT_A, EVENT_A]);
    await advance(0);
    expect(getOccupancy.mock.calls.map(([id]) => id)).toEqual([EVENT_A]);
    await advance(30_000);
    expect(polls()).toBe(2);
  });

  it("stops polling an event once no screen watches it", async () => {
    const view = watch([EVENT_A]);
    await advance(0);
    view.unmount();
    await advance(10 * 60_000);
    expect(polls()).toBe(1);
  });

  it("follows a change of events on the same screen", async () => {
    const view = watch([EVENT_A]);
    await advance(0);
    view.rerender([EVENT_B]);
    await advance(0);
    expect(getOccupancy.mock.calls.map(([id]) => id)).toEqual([EVENT_A, EVENT_B]);
    await advance(30_000);
    expect(getOccupancy.mock.calls.map(([id]) => id)).toEqual([EVENT_A, EVENT_B, EVENT_B]);
  });
});

describe("pausing", () => {
  it("stops while the tab is hidden, and reads at once when it is shown again after the answer went stale", async () => {
    watch([EVENT_A]);
    await advance(0);
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await advance(10 * 60_000);
    expect(polls()).toBe(1);
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await advance(0);
    expect(polls()).toBe(2);
  });

  it("waits out the rest of max_age_s when the tab comes back before the answer is stale", async () => {
    watch([EVENT_A]);
    await advance(0);
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await advance(10_000);
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await advance(19_999);
    expect(polls()).toBe(1);
    await advance(1);
    expect(polls()).toBe(2);
  });

  it("stops while the phone is offline and resumes when it is back", async () => {
    watch([EVENT_A]);
    await advance(0);
    onLine = false;
    window.dispatchEvent(new Event("offline"));
    await advance(10 * 60_000);
    expect(polls()).toBe(1);
    onLine = true;
    window.dispatchEvent(new Event("online"));
    await advance(0);
    expect(polls()).toBe(2);
  });
});

describe("what a room's count can say", () => {
  it("is closed when the event is not live or the room has no count, hidden below the crowd minimum, else the count", () => {
    expect(occupancy.roomNow(null, ROOM)).toEqual({ kind: "closed" });
    expect(occupancy.roomNow(answer({ live: false }), ROOM)).toEqual({ kind: "closed" });
    expect(occupancy.roomNow(answer(), "some-other-room")).toEqual({ kind: "closed" });
    expect(occupancy.roomNow(answer({ occupancy: null }), ROOM)).toEqual({ kind: "hidden", capacity: 100 });
    expect(occupancy.roomNow(answer({ occupancy: 40 }), ROOM)).toEqual({ kind: "count", occupancy: 40, capacity: 100 });
  });
});
