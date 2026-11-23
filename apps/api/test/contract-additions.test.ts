/** Typed grid geometry validated on write, the derived venue grid, the per-minute summary series, totals on telemetry frames. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TelemetryEvent } from "@synan/contracts/ws";
import { ManualClock } from "../src/lib/clock.js";
import { TelemetryHub } from "../src/realtime/telemetry-hub.js";
import { band, errCode, postScans, scan, startHarness, type Harness } from "./helpers.js";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h.close());
const admin = async () => (await h.login(h.seed.emails.admin)).access_token;

describe("grid geometry", () => {
  it("rooms and zones take a rect or a polygon on the grid; anything else is refused; GET /venues/:id derives the grid", async () => {
    const token = await admin();
    const zone = `/zones/${h.seed.zones.ground}`;
    for (const geometry of [{ kind: "circle", r: 3 }, { kind: "rect", x: -1, y: 0, w: 2, h: 2 }, { kind: "rect", x: 0, y: 0, w: 0, h: 2 }, { kind: "polygon", points: [[0, 0], [1, 1]] }, { x: 1 }]) {
      expect(errCode((await h.call("PUT", zone, { token, body: { geometry } })).body)).toBe("VALIDATION_FAILED");
    }
    const poly = { kind: "polygon", points: [[0, 0], [40, 0], [40, 24], [0, 24]] };
    expect((await h.call<{ geometry: unknown }>("PUT", zone, { token, body: { geometry: poly } })).body.geometry).toEqual(poly);
    const rect = { kind: "rect", x: 2, y: 3, w: 50, h: 10 };
    expect((await h.call<{ geometry: unknown }>("PUT", `/rooms/${h.seed.rooms.expo}`, { token, body: { geometry: rect } })).body.geometry).toEqual(rect);
    expect(errCode((await h.call("PUT", `/rooms/${h.seed.rooms.expo}`, { token, body: { geometry: { kind: "rect", x: 0, y: 0, w: 1 } } })).body)).toBe("VALIDATION_FAILED");
    const v = await h.call<{ grid: { w: number; h: number } | null }>("GET", `/venues/${h.seed.venueId}`, { token: (await h.login(h.seed.emails.organiser)).access_token });
    expect(v.body.grid).toEqual({ w: 52, h: 24 });
    expect((await h.call("PUT", zone, { token, body: { geometry: null } })).status).toBe(200);
  });
});

describe("summary series", () => {
  it("per-minute throughput for the last N whole minutes, zero-filled, oldest first", async () => {
    const organiser = (await h.login(h.seed.emails.organiser)).access_token;
    h.clock.advance(60_000 - (h.clock.now() % 60_000) + 5_000); // 5 s into a fresh minute
    const a = h.seed.attendees;
    await postScans(h, [scan(h, h.seed.checkpoints.mainIn, band(a.vip.uid)), scan(h, h.seed.checkpoints.mainIn, band("DEADBEEF01"))]);
    h.clock.advance(60_000);
    const r = await h.call<{ series: { at: string; scans: number; admitted: number; denied: number }[] }>("GET", `/events/${h.seed.eventId}/summary?series_minutes=5`, { token: organiser });
    expect(r.body.series).toHaveLength(5);
    expect(r.body.series.at(-1)).toMatchObject({ scans: 2, admitted: 1, denied: 1 });
    expect(r.body.series.slice(0, 4).every((m) => m.scans === 0)).toBe(true);
    expect(Date.parse(r.body.series[1]!.at) - Date.parse(r.body.series[0]!.at)).toBe(60_000);
    expect((await h.call<{ series: unknown[] }>("GET", `/events/${h.seed.eventId}/summary`, { token: organiser })).body.series).toHaveLength(60);
    expect(errCode((await h.call("GET", `/events/${h.seed.eventId}/summary?series_minutes=999`, { token: organiser })).body)).toBe("VALIDATION_FAILED");
  });
});

describe("telemetry totals", () => {
  it("every frame carries the event totals; the public scope hides them below k and sends nothing while they stay hidden", async () => {
    const hub = new TelemetryHub(new ManualClock(), { batchMs: 1, kAnon: 5 });
    const eventId = randomUUID();
    const room = randomUUID();
    const zone = randomUUID();
    const full: TelemetryEvent[] = [];
    const pub: TelemetryEvent[] = [];
    hub.prime(eventId, [{ room_id: room, zone_id: zone, occupancy: 0, capacity: 50, level: "ok" }], [], 0);
    hub.subscribe(eventId, "full", (m) => full.push(m));
    hub.subscribe(eventId, "public", (m) => pub.push(m));
    const tick = () => new Promise((r) => setTimeout(r, 20));
    hub.update(eventId, [{ room_id: room, zone_id: zone, occupancy: 2, capacity: 50, level: "ok" }], [], 3);
    await tick();
    const d1 = full.find((m) => m.type === "occupancy.delta")!;
    expect((d1.data as { totals: unknown }).totals).toEqual({ on_site: 3, in_rooms: 2 });
    expect(pub.filter((m) => m.type === "occupancy.delta")).toHaveLength(0); // below k: nothing public changed
    hub.update(eventId, [], [], 4); // only the total moves
    await tick();
    expect((full.filter((m) => m.type === "occupancy.delta").at(-1)!.data as { totals: unknown }).totals).toEqual({ on_site: 4, in_rooms: 2 });
    expect(pub.filter((m) => m.type === "occupancy.delta")).toHaveLength(0);
    hub.update(eventId, [{ room_id: room, zone_id: zone, occupancy: 6, capacity: 50, level: "ok" }], [], 7);
    await tick();
    expect((pub.filter((m) => m.type === "occupancy.delta").at(-1)!.data as { totals: unknown }).totals).toEqual({ on_site: 7, in_rooms: 6 });
    expect((hub.snapshot(eventId, "public").data as { totals: unknown }).totals).toEqual({ on_site: 7, in_rooms: 6 });
    hub.close();
  });
});
