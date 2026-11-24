/** Migrations 0023–0025: grid shapes, the layout version, whole-layout publish, event drafts. */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { deleteDraftEvent, publishVenueLayout, type LayoutRoomInput, type LayoutZoneInput } from "../src/layout";
import { duplicateEvent } from "../src/operations";
import * as s from "../src/schema/index";
import { attendeeWithCredential, miniVenue, type MiniVenue } from "./fixtures";
import { createTestDb, q, rejects, type TestDb } from "./helpers";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});

const venueRow = async (id: string) => (await db.select().from(s.venues).where(eq(s.venues.id, id)))[0]!;
const rect = (x: number, y: number, w: number, h: number) => ({ kind: "rect" as const, x, y, w, h });
const square = (x: number, y: number, n: number) => ({ kind: "polygon" as const, points: [[x, y], [x + n, y], [x + n, y + n], [x, y + n]] as [number, number][] });

describe("grid shapes", () => {
  it("accept a GridRect or GridPolygon in whole units and refuse anything else", async () => {
    const v = await miniVenue(db);
    const ok = [null, rect(0, 0, 1, 1), rect(10_000, 0, 1, 10_000), square(0, 0, 10)];
    for (const g of ok) await db.update(s.zones).set({ geometry_jsonb: g }).where(eq(s.zones.id, v.zoneId));
    const bad: unknown[] = [
      { kind: "rect", x: 0, y: 0, w: 0, h: 1 },
      { kind: "rect", x: -1, y: 0, w: 1, h: 1 },
      { kind: "rect", x: 0.5, y: 0, w: 1, h: 1 },
      { kind: "rect", x: 0, y: 0, w: 1, h: 1, extra: true },
      { kind: "rect", x: "1", y: 0, w: 1, h: 1 },
      { kind: "polygon", points: [[0, 0], [1, 1]] },
      { kind: "polygon", points: [[0, 0], [1, 1], [2]] },
      { kind: "polygon", points: [[0, 0], [1, 1], [2, 10_001]] },
      { kind: "polygon", points: "no" },
      { kind: "circle", r: 3 },
      [1, 2],
      "rect",
    ];
    for (const g of bad) {
      await rejects(q(db, `update zones set geometry_jsonb = $1::jsonb where id = $2`, [JSON.stringify(g), v.zoneId]), /zones_geometry_grid_shape/);
      await rejects(q(db, `update rooms set geometry_jsonb = $1::jsonb where id = $2`, [JSON.stringify(g), v.roomA]), /rooms_geometry_grid_shape/);
    }
  });
});

describe("layout version", () => {
  it("rises on every zone or room change; a zone's new floor joins the venue's floors", async () => {
    const v = await miniVenue(db);
    const before = await venueRow(v.venueId);
    expect(before.floors).toEqual(["G"]);
    expect(before.layout_published_at).not.toBeNull();
    await db.update(s.rooms).set({ capacity: 12 }).where(eq(s.rooms.id, v.roomA));
    const after = await venueRow(v.venueId);
    expect(after.layout_version).toBe(before.layout_version + 1);
    await db.insert(s.zones).values({ venue_id: v.venueId, name: "Mezzanine", floor: "1" });
    const again = await venueRow(v.venueId);
    expect(again.floors).toEqual(["G", "1"]);
    expect(again.layout_version).toBe(after.layout_version + 1);
  });
});

describe("whole-layout publish", () => {
  let v: MiniVenue;
  let zones: LayoutZoneInput[];
  let rooms: LayoutRoomInput[];
  const roomInput = (id: string, zone: string, name: string, capacity: number): LayoutRoomInput => ({
    id, zone_id: zone, name, capacity, warn_at_pct: 80, block_at_pct: 100, capacity_policy: "block", continuous: false, geometry: rect(1, 1, 4, 3),
  });
  beforeAll(async () => {
    v = await miniVenue(db, { eventState: "draft" });
    zones = [{ id: v.zoneId, name: "Ground", floor: "G", geometry: square(0, 0, 50) }];
    rooms = [roomInput(v.roomA, v.zoneId, "Room A", 10), roomInput(v.roomB, v.zoneId, "Room B", 4)];
  });

  it("stores floors, zones in order and rooms as one new version", async () => {
    const cur = (await venueRow(v.venueId)).layout_version;
    const upper = randomUUID();
    const studio = randomUUID();
    const r = await publishVenueLayout(db, {
      venueId: v.venueId, expectedVersion: cur, floors: ["G", "Level 1"],
      zones: [...zones, { id: upper, name: "Upper", floor: "Level 1", geometry: square(60, 0, 20) }],
      rooms: [...rooms, roomInput(studio, upper, "Studio", 30)],
    });
    expect(r).toMatchObject({ status: "ok", layout_version: cur + 1, zones_added: 1, rooms_added: 1, zones_removed: 0, rooms_removed: 0 });
    const venue = await venueRow(v.venueId);
    expect(venue).toMatchObject({ floors: ["G", "Level 1"], layout_version: cur + 1 });
    const zs = await db.select().from(s.zones).where(eq(s.zones.venue_id, v.venueId));
    expect(zs.find((z) => z.id === upper)).toMatchObject({ name: "Upper", floor: "Level 1", sort_order: 1, geometry_jsonb: square(60, 0, 20) });
    const room = (await db.select().from(s.rooms).where(eq(s.rooms.id, studio)))[0]!;
    expect(room).toMatchObject({ zone_id: upper, capacity: 30, warn_at_pct: 80, geometry_jsonb: rect(1, 1, 4, 3) });
    zones = zs.sort((a, b) => a.sort_order - b.sort_order).map((z) => ({ id: z.id, name: z.name, floor: z.floor, geometry: z.geometry_jsonb ?? null }));
    rooms = [...rooms, roomInput(studio, upper, "Studio", 30)];
  });

  it("refuses a stale version without changing anything", async () => {
    const cur = (await venueRow(v.venueId)).layout_version;
    const r = await publishVenueLayout(db, { venueId: v.venueId, expectedVersion: cur - 1, floors: ["X"], zones, rooms: [] });
    expect(r).toMatchObject({ status: "version_conflict", layout_version: cur });
    expect((await venueRow(v.venueId)).floors).toEqual(["G", "Level 1"]);
  });

  it("refuses to remove a room with doors, or a zone with gates, and names them", async () => {
    const cur = (await venueRow(v.venueId)).layout_version;
    const r = await publishVenueLayout(db, { venueId: v.venueId, expectedVersion: cur, floors: ["Level 1"], zones: zones.slice(1), rooms: rooms.slice(2) });
    expect(r.status).toBe("blocked");
    expect(r.blocking).toEqual(expect.arrayContaining([
      { kind: "room", id: v.roomA, reason: "has_checkpoints" },
      { kind: "zone", id: v.zoneId, reason: "has_checkpoints" },
    ]));
    expect((await venueRow(v.venueId)).layout_version).toBe(cur);
  });

  it("refuses ids of another venue", async () => {
    const other = await miniVenue(db);
    const cur = (await venueRow(v.venueId)).layout_version;
    const r = await publishVenueLayout(db, { venueId: v.venueId, expectedVersion: cur, floors: ["G"], zones: [...zones, { id: other.zoneId, name: "Theirs", floor: null, geometry: null }], rooms });
    expect(r.status).toBe("foreign_id");
  });

  it("removes a room a draft used, taking the draft's rules and sessions with it; a published event's room stays", async () => {
    const studio = rooms[2]!;
    await db.insert(s.event_rooms).values({ event_id: v.eventId, room_id: studio.id });
    await db.insert(s.sessions).values({ event_id: v.eventId, room_id: studio.id, title: "Talk", starts_at: new Date("2026-12-01T10:00:00Z"), ends_at: new Date("2026-12-01T11:00:00Z") });
    await db.insert(s.access_rules).values({ event_id: v.eventId, subject_kind: "tier", subject: "VIP", room_id: studio.id, effect: "permit" });
    let cur = (await venueRow(v.venueId)).layout_version;
    const r = await publishVenueLayout(db, { venueId: v.venueId, expectedVersion: cur, floors: ["G", "Level 1"], zones, rooms: rooms.slice(0, 2) });
    expect(r).toMatchObject({ status: "ok", rooms_removed: 1 });
    expect(await db.select().from(s.sessions).where(eq(s.sessions.event_id, v.eventId))).toEqual([]);
    expect(await db.select().from(s.access_rules).where(eq(s.access_rules.event_id, v.eventId))).toEqual([]);

    // A published event elsewhere holds Room B: it cannot leave the layout.
    const roomB = rooms[1]!;
    await q(db, `delete from checkpoints where room_id = $1`, [roomB.id]);
    await q(db, `insert into events (org_id, venue_id, slug, title, starts_at, ends_at, timezone, state, pass_template_jsonb)
                 select org_id, $1::uuid, $2::text, 'Pub', now(), now() + interval '1 hour', 'UTC', 'published', '{}'::jsonb from venues where id = $1::uuid`,
            [v.venueId, `pub-${randomUUID().slice(0, 8)}`]);
    await q(db, `insert into event_rooms (event_id, room_id) select id, $1::uuid from events where venue_id = $2::uuid and state = 'published'`, [roomB.id, v.venueId]);
    cur = (await venueRow(v.venueId)).layout_version;
    const r2 = await publishVenueLayout(db, { venueId: v.venueId, expectedVersion: cur, floors: ["G"], zones: zones.slice(0, 1), rooms: rooms.slice(0, 1) });
    expect(r2.status).toBe("blocked");
    expect(r2.blocking).toContainEqual({ kind: "room", id: roomB.id, reason: "in_use" });
  });

  it("refuses to move a room whose doors are in its zone into another zone", async () => {
    const cur = (await venueRow(v.venueId)).layout_version;
    const upper = zones[1]!;
    const r = await publishVenueLayout(db, { venueId: v.venueId, expectedVersion: cur, floors: ["G", "Level 1"], zones, rooms: [{ ...rooms[0]!, zone_id: upper.id }, rooms[1]!] });
    expect(r.blocking).toContainEqual({ kind: "room", id: v.roomA, reason: "doors_in_other_zone" });
  });
});

describe("event drafts", () => {
  it("may lack venue and dates while a draft; publishing needs all three", async () => {
    const v = await miniVenue(db, { eventState: "draft" });
    const [e] = await db.insert(s.events).values({ org_id: v.orgId, slug: `d-${randomUUID().slice(0, 8)}`, title: "Draft", timezone: "UTC", pass_template_jsonb: {} }).returning();
    expect(e).toMatchObject({ state: "draft", venue_id: null, starts_at: null, wizard_step: "basics" });
    await rejects(q(db, `update events set state = 'published' where id = $1`, [e!.id]), /events_scheduled_unless_draft|without at least one room/);
    await rejects(
      q(db, `insert into events (org_id, slug, title, timezone, state) values ($1, $2, 'x', 'UTC', 'live')`, [v.orgId, `l-${randomUUID().slice(0, 8)}`]),
      /events_scheduled_unless_draft/,
    );
    // A draft without a venue cannot hold rooms.
    await rejects(q(db, `insert into event_rooms (event_id, room_id) values ($1, $2)`, [e!.id, v.roomA]), /not in the venue/);
  });

  it("delete a draft and everything hanging off it; refuse one with registrations or past draft", async () => {
    const v = await miniVenue(db, { eventState: "draft" });
    await db.insert(s.sessions).values({ event_id: v.eventId, room_id: v.roomA, title: "Talk", starts_at: new Date("2026-12-01T10:00:00Z"), ends_at: new Date("2026-12-01T11:00:00Z") });
    const partition = `scans_${v.eventId.replace(/-/g, "")}`;
    expect((await q(db, `select to_regclass($1) is not null as x`, [`public.${partition}`]))[0]!.x).toBe(true);
    expect(await deleteDraftEvent(db, v.eventId)).toBe("deleted");
    expect(await db.select().from(s.events).where(eq(s.events.id, v.eventId))).toEqual([]);
    expect((await q(db, `select to_regclass($1) is not null as x`, [`public.${partition}`]))[0]!.x).toBe(false);
    expect(await deleteDraftEvent(db, v.eventId)).toBe("not_found");

    const withPeople = await miniVenue(db, { eventState: "draft" });
    await attendeeWithCredential(db, withPeople.eventId);
    expect(await deleteDraftEvent(db, withPeople.eventId)).toBe("has_registrations");
    const live = await miniVenue(db);
    expect(await deleteDraftEvent(db, live.eventId)).toBe("not_draft");
  });

  it("duplicate without dates: no dates, no sessions, only rules without a window", async () => {
    const v = await miniVenue(db);
    await db.insert(s.sessions).values({ event_id: v.eventId, room_id: v.roomA, title: "Talk", starts_at: new Date("2026-12-01T10:00:00Z"), ends_at: new Date("2026-12-01T11:00:00Z") });
    await db.insert(s.access_rules).values([
      { event_id: v.eventId, subject_kind: "tier", subject: "VIP", room_id: v.roomA, effect: "permit" },
      { event_id: v.eventId, subject_kind: "tier", subject: "ORDINARY", room_id: v.roomA, effect: "permit", window_start: new Date("2026-12-01T10:00:00Z"), window_end: new Date("2026-12-01T11:00:00Z") },
    ]);
    const id = await duplicateEvent(db, { eventId: v.eventId, slug: `copy-${randomUUID().slice(0, 8)}`, title: "Copy", startsAt: null });
    const [e] = await db.select().from(s.events).where(eq(s.events.id, id));
    expect(e).toMatchObject({ state: "draft", starts_at: null, ends_at: null, venue_id: v.venueId, wizard_step: "basics" });
    expect(await db.select().from(s.sessions).where(eq(s.sessions.event_id, id))).toEqual([]);
    expect((await db.select().from(s.access_rules).where(eq(s.access_rules.event_id, id))).map((r) => r.subject)).toEqual(["VIP"]);
    expect((await db.select().from(s.event_rooms).where(eq(s.event_rooms.event_id, id))).length).toBe(2);
  });
});
