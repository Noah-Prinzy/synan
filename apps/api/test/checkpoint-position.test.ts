/** Checkpoint grid positions (`checkpoints.position_jsonb`, contracts GridPoint): create, update, clear, read, gate health. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Checkpoint, GateHealth, TokenPair } from "@synan/contracts/rest";
import { errCode, mfaCode, startHarness, type Harness } from "./helpers.js";

let h: Harness;
let admin: string;
beforeAll(async () => {
  h = await startHarness();
  const t = (await h.login(h.seed.emails.admin)).access_token;
  admin = (await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: t, body: { code: mfaCode(h) } })).body.access_token;
});
afterAll(async () => h.close());

describe("checkpoint positions", () => {
  it("are optional on create, stored, returned on every read, changed or cleared on update", async () => {
    const zone = (await h.app.ctx.repos.venues.checkpoint(h.seed.checkpoints.mainIn))!.zone_id;
    const base = { venue_id: h.seed.venueId, zone_id: zone, room_id: null, direction: "in", perimeter: true, hardware_id: null, label: "Side gate" };

    const unplaced = await h.call<Checkpoint>("POST", "/checkpoints", { token: admin, body: base });
    expect(unplaced.status).toBe(201);
    expect(unplaced.body.position).toBeNull();

    const placed = await h.call<Checkpoint>("POST", "/checkpoints", { token: admin, body: { ...base, label: "North gate", position: { x: 12, y: 0, side: "n" } } });
    expect(placed.status).toBe(201);
    expect(placed.body.position).toEqual({ x: 12, y: 0, side: "n" });
    const id = placed.body.id;

    const list = await h.call<{ items: Checkpoint[] }>("GET", `/checkpoints?venue_id=${h.seed.venueId}&limit=100`, { token: admin });
    expect(list.body.items.find((c) => c.id === id)!.position).toEqual({ x: 12, y: 0, side: "n" });
    const venue = await h.call<{ checkpoints: Checkpoint[] }>("GET", `/venues/${h.seed.venueId}`, { token: admin });
    expect(venue.body.checkpoints.find((c) => c.id === id)!.position).toEqual({ x: 12, y: 0, side: "n" });
    expect((await h.app.ctx.repos.venues.checkpoint(id))!.position_jsonb).toEqual({ x: 12, y: 0, side: "n" });

    // Omitted: unchanged. Given: replaced. Null: cleared.
    const relabelled = await h.call<Checkpoint>("PUT", `/checkpoints/${id}`, { token: admin, body: { label: "North gate A" } });
    expect(relabelled.body.position).toEqual({ x: 12, y: 0, side: "n" });
    const moved = await h.call<Checkpoint>("PUT", `/checkpoints/${id}`, { token: admin, body: { position: { x: 40, y: 7, side: "e" } } });
    expect(moved.body.position).toEqual({ x: 40, y: 7, side: "e" });
    const health = await h.call<{ items: GateHealth[] }>("GET", `/gates/health?event_id=${h.seed.eventId}`, { token: admin });
    expect(health.body.items.find((g) => g.checkpoint_id === id)!.position).toEqual({ x: 40, y: 7, side: "e" });
    const cleared = await h.call<Checkpoint>("PUT", `/checkpoints/${id}`, { token: admin, body: { position: null } });
    expect(cleared.body.position).toBeNull();
    expect((await h.app.ctx.repos.venues.checkpoint(id))!.position_jsonb ?? null).toBeNull();
  });

  it("only a grid point is accepted: integers in range, one of four sides; anything else in it is dropped, never stored", async () => {
    const put = (position: unknown) => h.call<Checkpoint>("PUT", `/checkpoints/${h.seed.checkpoints.mainIn}`, { token: admin, body: { position } });
    for (const bad of [{ x: 1.5, y: 0, side: "n" }, { x: -1, y: 0, side: "n" }, { x: 10_001, y: 0, side: "n" }, { x: 1, y: 1, side: "up" }, { x: 1, y: 1 }, "1,1"]) {
      expect(errCode((await put(bad)).body)).toBe("VALIDATION_FAILED");
    }
    expect((await put({ x: 10_000, y: 10_000, side: "w" })).status).toBe(200);
    const extra = await put({ x: 3, y: 4, side: "s", lat: 51.5 });
    expect(extra.body.position).toEqual({ x: 3, y: 4, side: "s" });
    expect((await h.app.ctx.repos.venues.checkpoint(h.seed.checkpoints.mainIn))!.position_jsonb).toEqual({ x: 3, y: 4, side: "s" });
  });
});
