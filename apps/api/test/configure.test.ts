/**
 * Admin Command's configure side (06 D0, D2–D6): the current organisation, venue counts, whole-layout
 * publish with its version, event drafts (no venue or dates yet, the wizard step), readiness and the
 * guarded publish, duplicate and delete, sessions and their notifications, the access-rule set's
 * publish time, the KPI series, report rows, the attendee table, inventory and staff extras.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AccessRuleSet, EventAdmin, EventAdminRow, EventLiveSummary, EventReadiness, EventSession, Notification, SetupStatus, TokenPair, VenueDetail, VenueListItem,
} from "@synan/contracts/rest";
import { createApp } from "../src/app.js";
import { ManualClock } from "../src/lib/clock.js";
import { hashPassword } from "../src/lib/crypto.js";
import { addAttendee, devEmail, errCode, mfaCode, REPO_UNDER_TEST, startHarness, type Harness } from "./helpers.js";

let h: Harness;
let admin: string;
let organiser: string;
let stepped: string;
beforeAll(async () => {
  h = await startHarness();
  admin = (await h.login(h.seed.emails.admin)).access_token;
  organiser = (await h.login(h.seed.emails.organiser)).access_token;
  stepped = (await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: admin, body: { code: mfaCode(h) } })).body.access_token;
});
afterAll(async () => h.close());

type Issues = { error: { code: string; issues?: { path: string; message: string }[] } };
const issuePaths = (body: unknown) => ((body as Issues).error.issues ?? []).map((i) => i.path);
const audits = async (action: string) => (await h.app.ctx.repos.audit.all()).filter((a) => a.action === action);
const rect = (x: number, y: number, w: number, h: number) => ({ kind: "rect" as const, x, y, w, h });
const square = (x: number, y: number, n: number) => ({ kind: "polygon" as const, points: [[x, y], [x + n, y], [x + n, y + n], [x, y + n]] });

async function signIn(email: string): Promise<string> {
  await h.call("POST", "/auth/email-link", { body: { email } });
  const token = /#token=([A-Za-z0-9_-]+)/.exec([...h.mailer.outbox].reverse().find((m) => m.tag === "auth.link" && m.to === email)!.text)![1]!;
  return (await h.call<TokenPair>("POST", "/auth/verify", { body: { token } })).body.access_token;
}

describe("D0 · the current organisation", () => {
  it("names the organisation and whether a venue has a published layout; empty before first run", async () => {
    const s = await h.call<SetupStatus>("GET", "/organizations/current", { token: organiser });
    expect(s.status).toBe(200);
    expect(s.body.organization?.id).toBe(h.seed.orgId);
    expect(s.body).toMatchObject({ has_published_venue: true });
    expect(s.body.venues).toBeGreaterThanOrEqual(1);
    expect((await h.call("GET", "/organizations/current")).status).toBe(401);
    expect((await h.call("GET", "/organizations/current", { token: await h.gateToken(h.seed.checkpoints.mainIn) })).status).toBe(403);

    const app = await createApp({ clock: new ManualClock(Date.now()), seed: false, config: { repo: REPO_UNDER_TEST } });
    try {
      const base = await app.listen(0, "127.0.0.1");
      const id = randomUUID();
      await app.ctx.repos.users.insert({ id, email: devEmail("fresh.admin"), password_hash: await hashPassword("pw", 12), role: "admin", mfa_enrolled_at: null, mfa_secret: null });
      const call = async (method: string, path: string, body?: unknown, token?: string) => {
        const r = await fetch(`${base}/api/v1${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
        return { status: r.status, body: await r.json() };
      };
      const tok = ((await call("POST", "/auth/login", { email: devEmail("fresh.admin"), password: "pw" })).body as { access_token: string }).access_token;
      expect((await call("GET", "/organizations/current", undefined, tok)).body).toEqual({ organization: null, has_published_venue: false, venues: 0 });
      await call("POST", "/organizations", { name: "Org", timezone: "Africa/Kampala", support_email: devEmail("support") }, tok);
      const v = await call("POST", "/venues", { name: "Hall", city: "Kampala", timezone: "Africa/Kampala", floors: ["Ground", "Level 1"], capacity_default: 40 }, tok);
      expect(v.status).toBe(201);
      expect(v.body).toMatchObject({ floors: ["Ground", "Level 1"], capacity_default: 40, layout_version: 0, layout_published_at: null, address: "" });
      // A venue with nothing drawn does not end first run.
      expect((await call("GET", "/organizations/current", undefined, tok)).body).toMatchObject({ has_published_venue: false, venues: 1 });
    } finally {
      await app.close();
    }
  });
});

describe("D2 · venues with counts; D2b · new venue", () => {
  it("lists venues by name with their counts", async () => {
    const r = await h.call<{ items: VenueListItem[] }>("GET", "/venues", { token: organiser });
    const seeded = r.body.items.find((v) => v.id === h.seed.venueId)!;
    expect(seeded.counts).toMatchObject({ zones: 2, rooms: 5, checkpoints: 8, capacity: 200 + 500 + 40 + 3 + 2 });
    expect(seeded.counts.events).toBeGreaterThanOrEqual(4);
    expect(seeded.counts.active_events).toBeGreaterThanOrEqual(3);
    expect(seeded.floors).toEqual(["0", "1"]);
    const names = r.body.items.map((v) => v.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("refuses repeated floors and an unknown time zone", async () => {
    const body = { name: "Annex", city: "Entebbe", timezone: "Africa/Kampala", floors: ["Ground", "ground"] };
    expect(issuePaths((await h.call("POST", "/venues", { token: admin, body })).body)).toEqual(["body.floors.1"]);
    expect(errCode((await h.call("POST", "/venues", { token: admin, body: { ...body, floors: ["Ground"], timezone: "Mars/Olympus" } })).body)).toBe("VALIDATION_FAILED");
  });
});

describe("D3 · whole-layout publish", () => {
  let venue: VenueDetail;
  const zoneA = randomUUID();
  const zoneB = randomUUID();
  const room1 = randomUUID();
  const room2 = randomUUID();
  const layout = () => ({
    floors: ["Ground", "Level 1"],
    zones: [
      { id: zoneB, name: "Studios", floor: "Level 1", geometry: square(60, 0, 30) },
      { id: zoneA, name: "Courtyard", floor: "Ground", geometry: square(0, 0, 50) },
    ],
    rooms: [
      { id: room1, zone_id: zoneA, name: "Stage", capacity: 300, warn_at_pct: 85, block_at_pct: 100, continuous: false, capacity_policy: "block", geometry: rect(2, 5, 30, 22) },
      { id: room2, zone_id: zoneB, name: "Studio 1", capacity: 40, warn_at_pct: 80, block_at_pct: 100, continuous: false, capacity_policy: "block", geometry: rect(62, 5, 18, 16) },
    ],
  });

  beforeAll(async () => {
    const v = await h.call<{ id: string }>("POST", "/venues", { token: admin, body: { name: "Innovation Village", city: "Kampala", timezone: "Africa/Kampala", floors: ["Ground"] } });
    venue = (await h.call<VenueDetail>("GET", `/venues/${v.body.id}`, { token: admin })).body;
  });

  it("publishes floors, zones and rooms in one step and raises the version", async () => {
    expect(venue).toMatchObject({ layout_version: 0, zones: [], rooms: [], grid: null, events: [] });
    expect((await h.call("PUT", `/venues/${venue.id}/layout`, { token: organiser, body: { expected_version: 0, ...layout() } })).status).toBe(403);
    const r = await h.call<VenueDetail>("PUT", `/venues/${venue.id}/layout`, { token: admin, body: { expected_version: 0, ...layout() } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ layout_version: 1, floors: ["Ground", "Level 1"], grid: { w: 90, h: 50 } });
    expect(r.body.layout_published_at).not.toBeNull();
    // Zones come back in floor order, whatever order they were sent in.
    expect(r.body.zones.map((z) => z.name)).toEqual(["Courtyard", "Studios"]);
    expect(r.body.rooms.find((x) => x.id === room1)).toMatchObject({ zone_id: zoneA, capacity: 300, geometry: rect(2, 5, 30, 22) });
    expect((await audits("venue.layout_publish")).at(-1)!.meta_jsonb).toMatchObject({ version: 1, zones_added: 2, rooms_added: 2 });
    venue = r.body;
    const s = await h.call<SetupStatus>("GET", "/organizations/current", { token: admin });
    expect(s.body.has_published_venue).toBe(true);
  });

  it("refuses a stale version with a clear conflict, and any single zone or room edit moves the version", async () => {
    const stale = await h.call<Issues>("PUT", `/venues/${venue.id}/layout`, { token: admin, body: { expected_version: 0, ...layout() } });
    expect(stale.status).toBe(409);
    expect(errCode(stale.body)).toBe("CONFLICT");
    expect(issuePaths(stale.body)).toEqual(["body.expected_version"]);
    await h.call("PUT", `/rooms/${room2}`, { token: admin, body: { capacity: 45 } });
    const after = (await h.call<VenueDetail>("GET", `/venues/${venue.id}`, { token: admin })).body;
    expect(after.layout_version).toBe(2);
    // A zone written on its own with a new floor adds the floor.
    await h.call("PUT", `/zones/${zoneB}`, { token: admin, body: { floor: "Roof" } });
    const again = (await h.call<VenueDetail>("GET", `/venues/${venue.id}`, { token: admin })).body;
    expect(again).toMatchObject({ layout_version: 3, floors: ["Ground", "Level 1", "Roof"] });
    venue = again;
  });

  it("validates the layout: rooms inside zones, floors from the list, thresholds, typed whole-unit shapes", async () => {
    const base = { expected_version: venue.layout_version, ...layout() };
    const r1 = await h.call("PUT", `/venues/${venue.id}/layout`, { token: admin, body: { ...base, rooms: [{ ...base.rooms[0]!, zone_id: randomUUID() }] } });
    expect(issuePaths(r1.body)).toEqual(["body.rooms.0.zone_id"]);
    const r2 = await h.call("PUT", `/venues/${venue.id}/layout`, { token: admin, body: { ...base, floors: ["Ground"] } });
    expect(issuePaths(r2.body)).toEqual(["body.zones.0.floor"]);
    const r3 = await h.call("PUT", `/venues/${venue.id}/layout`, { token: admin, body: { ...base, rooms: [{ ...base.rooms[0]!, warn_at_pct: 90, block_at_pct: 80 }] } });
    expect(issuePaths(r3.body)).toEqual(["body.rooms.0.block_at_pct"]);
    const r4 = await h.call("PUT", `/venues/${venue.id}/layout`, { token: admin, body: { ...base, rooms: [{ ...base.rooms[0]!, geometry: rect(0.5, 0, 2, 2) }] } });
    expect(errCode(r4.body)).toBe("VALIDATION_FAILED");
    expect((await h.call<VenueDetail>("GET", `/venues/${venue.id}`, { token: admin })).body.layout_version).toBe(venue.layout_version);
  });

  it("removes a room a draft used (the draft lets go of it), but not a zone with gates", async () => {
    const draft = await h.call<EventAdmin>("POST", "/events", { token: organiser, body: { slug: `iv-${randomUUID().slice(0, 6)}`, title: "Village day", timezone: "Africa/Kampala", venue_id: venue.id, rooms: [{ room_id: room2 }] } });
    expect(draft.body.rooms.map((r) => r.room_id)).toEqual([room2]);
    const gate = await h.call<{ id: string }>("POST", "/checkpoints", { token: admin, body: { venue_id: venue.id, zone_id: zoneA, room_id: null, direction: "in", perimeter: true, hardware_id: null, label: "Gate 1" } });
    expect(gate.status).toBe(201);
    let cur = (await h.call<VenueDetail>("GET", `/venues/${venue.id}`, { token: admin })).body;
    const blocked = await h.call<Issues>("PUT", `/venues/${venue.id}/layout`, { token: admin, body: { expected_version: cur.layout_version, floors: ["Level 1"], zones: [layout().zones[0]], rooms: [layout().rooms[1]] } });
    expect(blocked.status).toBe(409);
    expect(issuePaths(blocked.body)).toEqual([`zone:${zoneA}`, `room:${room1}`].filter((p) => p.startsWith("zone")));
    expect(blocked.body.error.issues![0]!.message).toContain("Courtyard");
    const ok = await h.call<VenueDetail>("PUT", `/venues/${venue.id}/layout`, { token: admin, body: { expected_version: cur.layout_version, floors: ["Ground", "Level 1"], zones: layout().zones, rooms: [layout().rooms[0]] } });
    expect(ok.status).toBe(200);
    expect(ok.body.rooms.map((r) => r.id)).toEqual([room1]);
    expect(ok.body.events!.map((e) => e.id)).toContain(draft.body.id);
    expect((await h.call<EventAdmin>("GET", `/events/${draft.body.id}/admin`, { token: organiser })).body.rooms).toEqual([]);
    cur = ok.body;
    void cur;
  });

  it("needs a fresh second factor while an event at the venue is live", async () => {
    const seeded = (await h.call<VenueDetail>("GET", `/venues/${h.seed.venueId}`, { token: admin })).body;
    const body = {
      expected_version: seeded.layout_version, floors: seeded.floors,
      zones: seeded.zones.map((z) => ({ id: z.id, name: z.name, floor: z.floor, geometry: z.geometry })),
      rooms: seeded.rooms.map((r) => ({ id: r.id, zone_id: r.zone_id, name: r.name, capacity: r.capacity, warn_at_pct: r.warn_at_pct, block_at_pct: r.block_at_pct, continuous: r.continuous, capacity_policy: r.capacity_policy, geometry: r.geometry })),
    };
    expect(errCode((await h.call("PUT", `/venues/${h.seed.venueId}/layout`, { token: admin, body })).body)).toBe("MFA_REQUIRED");
    const ok = await h.call<VenueDetail>("PUT", `/venues/${h.seed.venueId}/layout`, { token: stepped, body });
    expect(ok.status).toBe(200);
    expect(ok.body.layout_version).toBe(seeded.layout_version! + 1);
  });
});

describe("D4/D5 · drafts, the wizard step, readiness and the guarded publish", () => {
  let draft: EventAdmin;
  const slug = `night-${randomUUID().slice(0, 6)}`;

  it("creates a draft with only a name and an address; it resumes at the furthest step", async () => {
    const r = await h.call<EventAdmin>("POST", "/events", { token: organiser, body: { slug, title: "Startup Night", timezone: "Africa/Kampala" } });
    expect(r.status).toBe(201);
    draft = r.body;
    expect(draft).toMatchObject({ state: "draft", venue: null, starts_at: null, ends_at: null, wizard_step: "basics", published_at: null });
    expect(draft.updated_by?.name).toBe(h.seed.emails.organiser);
    const taken = await h.call<Issues>("POST", "/events", { token: organiser, body: { slug, title: "Again", timezone: "Africa/Kampala" } });
    expect(errCode(taken.body)).toBe("CONFLICT");
    expect(issuePaths(taken.body)).toEqual(["body.slug"]);
    // Rooms need a venue first.
    expect(issuePaths((await h.call("PATCH", `/events/${draft.id}`, { token: organiser, body: { rooms: [{ room_id: h.seed.rooms.auditorium }] } })).body)).toEqual(["body.rooms"]);
    const t = h.clock.now();
    const step = await h.call<EventAdmin>("PATCH", `/events/${draft.id}`, { token: organiser, body: {
      starts_at: new Date(t + 30 * 86_400_000).toISOString(), ends_at: new Date(t + 30 * 86_400_000 + 4 * 3_600_000).toISOString(), wizard_step: "venue",
    } });
    expect(step.body.wizard_step).toBe("venue");
    // Going back to an earlier step keeps the furthest one.
    expect((await h.call<EventAdmin>("PATCH", `/events/${draft.id}`, { token: organiser, body: { wizard_step: "basics" } })).body.wizard_step).toBe("venue");
  });

  it("lists every event, dateless drafts included, most recently changed first, with counts", async () => {
    const r = await h.call<{ items: EventAdminRow[] }>("GET", "/admin/events?limit=100", { token: organiser });
    expect(r.body.items[0]!.id).toBe(draft.id);
    const live = r.body.items.find((e) => e.id === h.seed.eventId)!;
    expect(live.registrations).toBeGreaterThanOrEqual(5);
    expect(live.venue?.id).toBe(h.seed.venueId);
    const bare = await h.call<EventAdmin>("POST", "/events", { token: organiser, body: { slug: `bare-${randomUUID().slice(0, 6)}`, title: "Bare", timezone: "Africa/Kampala" } });
    const list = (await h.call<{ items: EventAdminRow[] }>("GET", "/admin/events?state=draft&limit=100", { token: organiser })).body.items;
    expect(list.find((e) => e.id === bare.body.id)).toMatchObject({ starts_at: null, venue: null, registrations: 0, wizard_step: "basics" });
    expect(list.every((e) => e.state === "draft")).toBe(true);
    // Paging with the cursor walks the same order without repeats.
    const p1 = await h.call<{ items: EventAdminRow[]; next_cursor: string }>("GET", "/admin/events?limit=2", { token: organiser });
    const p2 = await h.call<{ items: EventAdminRow[] }>("GET", `/admin/events?limit=2&cursor=${p1.body.next_cursor}`, { token: organiser });
    expect(p2.body.items.map((e) => e.id).some((id) => p1.body.items.some((x) => x.id === id))).toBe(false);
    // Public and scope=all listings only show events with dates.
    const all = await h.call<{ items: { id: string }[] }>("GET", "/events?scope=all&limit=200", { token: organiser });
    expect(all.status).toBe(200);
    expect(all.body.items.some((e) => e.id === bare.body.id)).toBe(false);
    expect((await h.call("GET", "/admin/events", { token: await h.gateToken(h.seed.checkpoints.mainIn) })).status).toBe(403);
  });

  it("the readiness checklist names what is missing; publish enforces the blocking lines", async () => {
    const r = await h.call<EventReadiness>("GET", `/events/${draft.id}/readiness`, { token: organiser });
    expect(r.body.ready).toBe(false);
    const unmet = r.body.items.filter((i) => i.blocking && !i.met).map((i) => i.key);
    expect(unmet).toEqual(["venue", "rooms", "capacity", "pass"]);
    expect(r.body.items.find((i) => i.key === "basics")).toMatchObject({ met: true, step: "basics" });
    const refused = await h.call<Issues>("POST", `/events/${draft.id}/publish`, { token: organiser });
    expect(errCode(refused.body)).toBe("CONFLICT");
    expect(issuePaths(refused.body)).toEqual(unmet);

    // Venue, rooms (one without capacity), pass.
    await h.call("PATCH", `/events/${draft.id}`, { token: organiser, body: { venue_id: h.seed.venueId, wizard_step: "access" } });
    await h.call("PATCH", `/events/${draft.id}`, { token: organiser, body: { rooms: [{ room_id: h.seed.rooms.auditorium }, { room_id: h.seed.rooms.vip, capacity_override: 0 }], pass_template: { headline: "Night" } } });
    const r2 = (await h.call<EventReadiness>("GET", `/events/${draft.id}/readiness`, { token: organiser })).body;
    expect(r2.items.filter((i) => i.blocking && !i.met).map((i) => i.key)).toEqual(["capacity"]);
    expect(r2.items.find((i) => i.key === "capacity")!.detail).toContain("VIP Lounge");
    await h.call("PATCH", `/events/${draft.id}`, { token: organiser, body: { rooms: [{ room_id: h.seed.rooms.auditorium, capacity_override: 120 }, { room_id: h.seed.rooms.vip }] } });
    const ready = (await h.call<EventReadiness>("GET", `/events/${draft.id}/readiness`, { token: organiser })).body;
    expect(ready.ready).toBe(true);
    expect(ready.items.find((i) => i.key === "rules")).toMatchObject({ met: false, blocking: false });

    // A different venue clears the draft's rooms (and their sessions and rules).
    const rules = { expected_version: 0, rules: [{ subject_kind: "tier", subject: "VIP", room_id: h.seed.rooms.vip, window_start: null, window_end: null, effect: "permit" }] };
    expect((await h.call("PUT", `/events/${draft.id}/access-rules`, { token: organiser, body: rules })).status).toBe(200);
    const admin1 = (await h.call<EventAdmin>("GET", `/events/${draft.id}/admin`, { token: organiser })).body;
    expect(admin1.rooms.find((r) => r.room_id === h.seed.rooms.auditorium)).toMatchObject({ capacity: 120, capacity_override: 120 });

    const ok = await h.call<EventAdmin>("POST", `/events/${draft.id}/publish`, { token: organiser });
    expect(ok.body).toMatchObject({ state: "published", wizard_step: "review" });
    expect(Date.parse(ok.body.published_at!)).toBe(h.clock.now());
    // Published: dates stay, the venue is fixed.
    expect(issuePaths((await h.call("PATCH", `/events/${draft.id}`, { token: organiser, body: { starts_at: null } })).body)).toEqual(["body.starts_at"]);
    expect(errCode((await h.call("PATCH", `/events/${draft.id}`, { token: organiser, body: { venue_id: randomUUID() } })).body)).toBe("CONFLICT");
    draft = ok.body;
  });

  it("a draft's new venue takes its rooms, sessions and rules away", async () => {
    const other = (await h.call<{ items: VenueListItem[] }>("GET", "/venues", { token: admin })).body.items.find((v) => v.name === "Innovation Village")!;
    const d = await h.call<EventAdmin>("POST", "/events", { token: organiser, body: { slug: `mv-${randomUUID().slice(0, 6)}`, title: "Mover", timezone: "Africa/Kampala", venue_id: h.seed.venueId, rooms: [{ room_id: h.seed.rooms.expo }] } });
    await h.call("PUT", `/events/${d.body.id}/access-rules`, { token: organiser, body: { expected_version: 0, rules: [{ subject_kind: "tier", subject: "PUBLIC", room_id: h.seed.rooms.expo, window_start: null, window_end: null, effect: "permit" }] } });
    const moved = await h.call<EventAdmin>("PATCH", `/events/${d.body.id}`, { token: organiser, body: { venue_id: other.id } });
    expect(moved.body).toMatchObject({ venue: { id: other.id }, rooms: [] });
    expect((await h.call<AccessRuleSet>("GET", `/events/${d.body.id}/access-rules`, { token: organiser })).body.rules).toEqual([]);
  });

  it("duplicates without dates by default and deletes drafts only", async () => {
    const copy = await h.call<EventAdmin>("POST", `/events/${draft.id}/duplicate`, { token: organiser });
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({ state: "draft", slug: `${slug}-copy`, title: "Startup Night (copy)", starts_at: null, ends_at: null, wizard_step: "basics", venue: { id: h.seed.venueId } });
    expect(copy.body.rooms.map((r) => r.room_id).sort()).toEqual([h.seed.rooms.auditorium, h.seed.rooms.vip].sort());
    expect((await h.call<AccessRuleSet>("GET", `/events/${copy.body.id}/access-rules`, { token: organiser })).body.rules).toHaveLength(1);
    expect((await h.call<EventAdmin>("POST", `/events/${draft.id}/duplicate`, { token: organiser })).body.slug).toBe(`${slug}-copy-2`);
    const dated = await h.call<EventAdmin>("POST", `/events/${draft.id}/duplicate`, { token: organiser, body: { slug: `${slug}-next`, starts_at: new Date(Date.parse(draft.starts_at!) + 7 * 86_400_000).toISOString() } });
    expect(Date.parse(dated.body.ends_at!) - Date.parse(dated.body.starts_at!)).toBe(4 * 3_600_000);
    expect((await audits("event.duplicate")).length).toBeGreaterThanOrEqual(3);

    expect(errCode((await h.call("DELETE", `/events/${draft.id}`, { token: organiser })).body)).toBe("CONFLICT");
    expect((await h.call("DELETE", `/events/${copy.body.id}`, { token: organiser })).status).toBe(200);
    expect((await h.call("GET", `/events/${copy.body.id}/admin`, { token: organiser })).status).toBe(404);
    expect((await audits("event.delete")).at(-1)!.target).toBe(`event:${copy.body.id}`);
  });
});

describe("D6.2 · sessions, and attendees told of a change", () => {
  const sessions = () => h.call<{ items: EventSession[] }>("GET", `/events/${h.seed.eventId}/sessions`, { token: organiser });
  const mine = async (token: string) => (await h.call<{ items: Notification[] }>("GET", "/me/notifications", { token })).body.items;
  let created: EventSession;

  it("creates sessions in the event's rooms and dates, refusing overlaps in one room", async () => {
    const t = h.clock.now();
    const body = { room_id: h.seed.rooms.boardroom, title: "Investor hour", starts_at: new Date(t + 2 * 3_600_000).toISOString(), ends_at: new Date(t + 3 * 3_600_000).toISOString() };
    const r = await h.call<EventSession>("POST", `/events/${h.seed.eventId}/sessions`, { token: organiser, body });
    expect(r.status).toBe(201);
    created = r.body;
    expect(issuePaths((await h.call("POST", `/events/${h.seed.eventId}/sessions`, { token: organiser, body: { ...body, room_id: randomUUID() } })).body)).toEqual(["body.room_id"]);
    expect(issuePaths((await h.call("POST", `/events/${h.seed.eventId}/sessions`, { token: organiser, body: { ...body, ends_at: body.starts_at } })).body)).toEqual(["body.ends_at"]);
    expect(issuePaths((await h.call("POST", `/events/${h.seed.eventId}/sessions`, { token: organiser, body: { ...body, ends_at: new Date(t + 30 * 3_600_000).toISOString() } })).body)).toEqual(["body.starts_at"]);
    const clash = await h.call<Issues>("POST", `/events/${h.seed.eventId}/sessions`, { token: organiser, body: { ...body, title: "Clash" } });
    expect(errCode(clash.body)).toBe("CONFLICT");
    expect(clash.body.error.issues![0]!.message).toContain("Investor hour");
    expect((await h.call("POST", `/events/${h.seed.eventId}/sessions`, { token: await h.gateToken(h.seed.checkpoints.mainIn), body })).status).toBe(403);
    expect((await sessions()).body.items.map((s) => s.id)).toContain(created.id);
  });

  it("a new time or room is announced to registered attendees in generic words; a deletion too", async () => {
    const me = await signIn(h.seed.attendees.ordinary2.email!);
    const before = (await mine(me)).filter((n) => n.kind === "session").length;
    const later = new Date(Date.parse(created.starts_at) + 30 * 60_000);
    const moved = await h.call<EventSession>("PATCH", `/events/${h.seed.eventId}/sessions/${created.id}`, { token: organiser, body: { starts_at: later.toISOString(), ends_at: new Date(later.getTime() + 3_600_000).toISOString() } });
    expect(moved.status).toBe(200);
    expect(moved.body.starts_at).toBe(later.toISOString());
    await h.call("PATCH", `/events/${h.seed.eventId}/sessions/${created.id}`, { token: organiser, body: { room_id: h.seed.rooms.press } });
    // A title-only change is not announced.
    await h.call("PATCH", `/events/${h.seed.eventId}/sessions/${created.id}`, { token: organiser, body: { title: "Investor hour" } });
    expect((await h.call("DELETE", `/events/${h.seed.eventId}/sessions/${created.id}`, { token: organiser })).status).toBe(200);
    expect((await h.call("DELETE", `/events/${h.seed.eventId}/sessions/${created.id}`, { token: organiser })).status).toBe(404);
    const notes = (await mine(me)).filter((n) => n.kind === "session");
    expect(notes.length - before).toBe(3);
    const bodies = notes.map((n) => n.body).join(" | ");
    expect(bodies).toContain("Investor hour now starts at");
    expect(bodies).toContain("has moved to another room");
    expect(bodies).toContain("Investor hour has been cancelled");
    const v = h.app.ctx.repos.venues;
    const places = [...(await v.roomsOfVenue(h.seed.venueId)).map((r) => r.name), ...(await v.zonesOfVenue(h.seed.venueId)).map((z) => z.name), ...(await v.checkpointsOfVenue(h.seed.venueId)).map((c) => c.label)].filter((n) => n.length > 3);
    for (const n of notes) for (const p of places) expect(`${n.title} ${n.body}`).not.toContain(p);
    const updates = await audits("session.update");
    expect(updates.map((a) => a.meta_jsonb.notified)).toEqual([true, true, false]);
    expect((await audits("session.delete")).at(-1)!.meta_jsonb).toMatchObject({ notified: true });
  });
});

describe("D6.3 · the access-rule set says when it was published", () => {
  it("carries published_at and who published the current version", async () => {
    const cur = (await h.call<AccessRuleSet>("GET", `/events/${h.seed.publishedEventId}/access-rules`, { token: organiser })).body;
    expect(cur).toMatchObject({ version: 0, published_at: null, published_by: null });
    const put = await h.call<AccessRuleSet>("PUT", `/events/${h.seed.publishedEventId}/access-rules`, { token: organiser, body: { expected_version: 0, rules: [{ subject_kind: "tier", subject: "VIP", room_id: h.seed.rooms.auditorium, window_start: null, window_end: null, effect: "permit" }] } });
    expect(put.body.version).toBe(1);
    expect(Date.parse(put.body.published_at!)).toBe(h.clock.now());
    expect(put.body.published_by?.name).toBe(h.seed.emails.organiser);
    expect((await h.call<AccessRuleSet>("GET", `/events/${h.seed.publishedEventId}/access-rules`, { token: organiser })).body.published_at).toBe(put.body.published_at);
  });
});

describe("D1/D6.1 · the KPI series", () => {
  it("one series per headline figure, ending with the figures now", async () => {
    const s = (await h.call<EventLiveSummary>("GET", `/events/${h.seed.eventId}/summary?series_minutes=5`, { token: organiser })).body;
    const k = s.kpi_series!;
    expect(k.bucket_ms).toBe(60_000);
    expect(Date.parse(k.from)).toBe(Math.floor(h.clock.now() / 60_000) * 60_000 - 4 * 60_000);
    for (const key of ["registered", "checked_in", "on_site", "capacity_risk", "open_alerts"] as const) expect(k[key]).toHaveLength(5);
    expect(k.registered.at(-1)).toBe(s.registered);
    expect(k.checked_in.at(-1)).toBe(s.checked_in);
    expect(k.on_site.at(-1)).toBe(s.on_site);
    expect(k.open_alerts.at(-1)).toBe(s.open_alerts);
    expect(k.capacity_risk.at(-1)).toBe(s.capacity_risk);
    expect(s.series).toHaveLength(5);
    // A new registration shows in the current minute only.
    await addAttendee(h, "ORDINARY");
    const s2 = (await h.call<EventLiveSummary>("GET", `/events/${h.seed.eventId}/summary?series_minutes=5`, { token: organiser })).body;
    expect(s2.kpi_series!.registered.at(-1)).toBe(s.registered + 1);
    expect(s2.kpi_series!.registered.slice(0, 4)).toEqual(k.registered.slice(0, 4));
    expect((await h.call<EventLiveSummary>("GET", `/events/${h.seed.eventId}/summary?series_minutes=0`, { token: organiser })).body.kpi_series).toBeUndefined();
  });
});

describe("D6.7 · report rows; D6.4 attendees; D6.5 inventory; D6.6 staff", () => {
  it("the workbook and the PDF rows have no kind; a CSV names its report", async () => {
    const exp = (body: unknown) => h.call<{ kind: string | null; format: string }>("POST", `/reports/${h.seed.eventId}/export`, { token: stepped, body });
    expect((await exp({ format: "xlsx" })).body.kind).toBeNull();
    expect((await exp({ format: "pdf" })).body.kind).toBeNull();
    expect((await exp({ format: "csv", kind: "attendance" })).body.kind).toBe("attendance");
  });

  it("the attendee table: credential state, masked band, check-in, filters, total", async () => {
    type Row = { attendee: { full_name: string | null }; credential_state: string | null; band_hint: string | null; checked_in_at: string | null };
    const all = await h.call<{ items: Row[]; total: number }>("GET", `/events/${h.seed.eventId}/registrations?limit=500`, { token: organiser });
    expect(all.body.total).toBe(all.body.items.length);
    const vera = all.body.items.find((r) => r.attendee.full_name === "Vera Ip")!;
    expect(vera.credential_state).toMatch(/issued|active|suspended_review/);
    expect(vera.band_hint).toMatch(/^band ••/);
    const q = await h.call<{ items: Row[]; total: number }>("GET", `/events/${h.seed.eventId}/registrations?q=orla`, { token: organiser });
    expect(q.body.items.map((r) => r.attendee.full_name)).toEqual(["Orla Dinary"]);
    expect(q.body.total).toBe(all.body.total);
    const unbound = await h.call<{ items: Row[] }>("GET", `/events/${h.seed.eventId}/registrations?unbound=true&limit=500`, { token: organiser });
    expect(unbound.body.items.every((r) => r.band_hint === null)).toBe(true);
    const bound = await h.call<{ items: Row[] }>("GET", `/events/${h.seed.eventId}/registrations?unbound=false&limit=500`, { token: organiser });
    expect(bound.body.items.length + unbound.body.items.length).toBe(all.body.items.length);
    const issued = await h.call<{ items: Row[] }>("GET", `/events/${h.seed.eventId}/registrations?credential=revoked&limit=500`, { token: organiser });
    expect(issued.body.items.every((r) => r.credential_state === "revoked")).toBe(true);
  });

  it("the event's inventory carries its credentials by state", async () => {
    const r = await h.call<{ credentials: Record<string, number> }>("GET", `/credentials/inventory?event_id=${h.seed.eventId}`, { token: organiser });
    expect(Object.keys(r.body.credentials).sort()).toEqual(["active", "issued", "replaced", "revoked", "suspended_review"]);
    expect(Object.values(r.body.credentials).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(5);
    expect((await h.call<{ credentials?: unknown }>("GET", "/credentials/inventory", { token: organiser })).body.credentials).toBeUndefined();
  });

  it("staff carry their display name; an event's shifts come with gate label and name", async () => {
    const inv = await h.call<{ id: string; display_name: string | null }>("POST", "/staff", { token: admin, body: { email: devEmail(`gina-${randomUUID().slice(0, 6)}`), role: "security_staff", display_name: "Gina Gate" } });
    expect(inv.body.display_name).toBe("Gina Gate");
    const t = h.clock.now();
    const a = await h.call<{ checkpoint_label: string; staff_name: string; event_id: string }>("POST", "/staff-assignments", { token: admin, body: {
      user_id: inv.body.id, checkpoint_id: h.seed.checkpoints.eastIn, event_id: h.seed.eventId, shift_start: new Date(t + 20 * 3_600_000).toISOString(), shift_end: new Date(t + 22 * 3_600_000).toISOString(),
    } });
    expect(a.body).toMatchObject({ checkpoint_label: "East Entrance", staff_name: "Gina Gate", event_id: h.seed.eventId });
    const list = await h.call<{ items: { user_id: string; staff_name: string; event_id: string | null }[] }>("GET", `/staff-assignments?event_id=${h.seed.eventId}`, { token: organiser });
    expect(list.body.items.map((x) => x.user_id)).toContain(inv.body.id);
    expect(list.body.items.every((x) => x.event_id === h.seed.eventId)).toBe(true);
  });
});

describe("D6.8 · settings on a live event", () => {
  it("a room's capacity may change while live; the set of rooms may not", async () => {
    const cur = (await h.call<EventAdmin>("GET", `/events/${h.seed.eventId}/admin`, { token: organiser })).body;
    const rooms = cur.rooms.map((r) => ({ room_id: r.room_id, capacity_override: r.room_id === h.seed.rooms.expo ? 450 : (r.capacity_override ?? null) }));
    const ok = await h.call<EventAdmin>("PATCH", `/events/${h.seed.eventId}`, { token: organiser, body: { rooms } });
    expect(ok.status).toBe(200);
    expect(ok.body.rooms.find((r) => r.room_id === h.seed.rooms.expo)).toMatchObject({ capacity: 450, capacity_override: 450 });
    expect(errCode((await h.call("PATCH", `/events/${h.seed.eventId}`, { token: organiser, body: { rooms: rooms.slice(1) } })).body)).toBe("CONFLICT");
  });
});
