/** Slices 1–2: organisation, venues, zones, rooms, checkpoints; events, lifecycle, access rules, summary, dashboard. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AccessRule, Checkpoint, EventAdmin, EventSummary, Room, ScanBatchResponse, ScanRecord, TokenPair, Venue, Zone } from "@synan/contracts/rest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/lib/crypto.js";
import { ManualClock } from "../src/lib/clock.js";
import { band, devEmail, errCode, mfaCode, postScans, REPO_UNDER_TEST, scan, startHarness, addAttendee, type Harness } from "./helpers.js";

let h: Harness;
let admin: string;
let organiser: string;
beforeAll(async () => {
  h = await startHarness();
  admin = (await h.login(h.seed.emails.admin)).access_token;
  organiser = (await h.login(h.seed.emails.organiser)).access_token;
});
afterAll(async () => h.close());

const auditActions = async () => (await h.app.ctx.repos.audit.all()).map((a) => a.action);

describe("slice 1 · first-run setup", () => {
  it("creates the single organisation once; a venue before it is refused", async () => {
    const app = await createApp({ clock: new ManualClock(Date.now()), seed: false, config: { repo: REPO_UNDER_TEST } });
    try {
      const base = await app.listen(0, "127.0.0.1");
      const id = "7a000000-0000-4000-8000-000000000001";
      await app.ctx.repos.users.insert({ id, email: devEmail("first.admin"), password_hash: await hashPassword("pw", 12), role: "admin", mfa_enrolled_at: null, mfa_secret: null });
      const call = async (method: string, path: string, body?: unknown, token?: string) => {
        const r = await fetch(`${base}/api/v1${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
        return { status: r.status, body: await r.json() };
      };
      const tok = ((await call("POST", "/auth/login", { email: devEmail("first.admin"), password: "pw" })).body as { access_token: string }).access_token;
      const venue = { name: "Hall", address: "1 Road", timezone: "Africa/Kampala" };
      expect(errCode((await call("POST", "/venues", venue, tok)).body)).toBe("CONFLICT");
      const org = { name: "Org", timezone: "Africa/Kampala", support_email: devEmail("support") };
      expect((await call("POST", "/organizations", org, tok)).status).toBe(201);
      expect(errCode((await call("POST", "/organizations", org, tok)).body)).toBe("CONFLICT");
      expect((await call("POST", "/venues", venue, tok)).status).toBe(201);
    } finally {
      await app.close();
    }
  });
});

describe("slice 1 · venues, zones, rooms, checkpoints", () => {
  let venue: Venue;
  let zone: Zone;
  let room: Room;
  it("only an admin edits the layout; every edit is audited", async () => {
    const body = { name: "Riverside", address: "2 Bank St", timezone: "Africa/Kampala", city: "Jinja" };
    expect((await h.call("POST", "/venues", { token: organiser, body })).status).toBe(403);
    const v = await h.call<Venue>("POST", "/venues", { token: admin, body });
    expect(v.status).toBe(201);
    venue = v.body;
    expect(venue.city).toBe("Jinja");
    zone = (await h.call<Zone>("POST", `/venues/${venue.id}/zones`, { token: admin, body: { name: "Floor 0", floor: "0", geometry: null } })).body;
    const z2 = (await h.call<Zone>("PUT", `/zones/${zone.id}`, { token: admin, body: { name: "Ground floor" } })).body;
    expect(z2.name).toBe("Ground floor");
    expect(await auditActions()).toEqual(expect.arrayContaining(["venue.create", "zone.create", "zone.update"]));
  });

  it("rooms: zone must be in the venue, block ≥ warn; created and updated", async () => {
    const base = { venue_id: venue.id, zone_id: h.seed.zones.ground, name: "Studio", capacity: 30, warn_at_pct: 80, block_at_pct: 100, continuous: false, capacity_policy: "block", geometry: null };
    expect(errCode((await h.call("POST", "/rooms", { token: admin, body: base })).body)).toBe("VALIDATION_FAILED"); // other venue's zone
    expect(errCode((await h.call("POST", "/rooms", { token: admin, body: { ...base, zone_id: zone.id, warn_at_pct: 90, block_at_pct: 80 } })).body)).toBe("VALIDATION_FAILED");
    const r = await h.call<Room>("POST", "/rooms", { token: admin, body: { ...base, zone_id: zone.id } });
    expect(r.status).toBe(201);
    room = r.body;
    expect((await h.call<Room>("PUT", `/rooms/${room.id}`, { token: admin, body: { capacity: 40 } })).body.capacity).toBe(40);
    const full = await h.call<{ zones: Zone[]; rooms: Room[]; checkpoints: Checkpoint[] }>("GET", `/venues/${venue.id}`, { token: organiser });
    expect(full.body.rooms.map((x) => x.id)).toEqual([room.id]);
  });

  it("checkpoints: a room door is in the room's zone; hardware ids are unique", async () => {
    const z3 = (await h.call<Zone>("POST", `/venues/${venue.id}/zones`, { token: admin, body: { name: "Floor 1", floor: "1", geometry: null } })).body;
    const cp = { venue_id: venue.id, zone_id: z3.id, room_id: room.id, direction: "in", perimeter: false, hardware_id: "READER-1", label: "Studio door" };
    expect(errCode((await h.call("POST", "/checkpoints", { token: admin, body: cp })).body)).toBe("VALIDATION_FAILED");
    const ok = await h.call<Checkpoint>("POST", "/checkpoints", { token: admin, body: { ...cp, zone_id: zone.id } });
    expect(ok.status).toBe(201);
    expect(errCode((await h.call("POST", "/checkpoints", { token: admin, body: { ...cp, zone_id: zone.id, label: "Dup" } })).body)).toBe("CONFLICT");
    expect((await h.call<Checkpoint>("PUT", `/checkpoints/${ok.body.id}`, { token: admin, body: { label: "Studio main door" } })).body.label).toBe("Studio main door");
  });

  it("gate staff list only their own checkpoints; operators see the venue", async () => {
    const gate = await h.gateToken(h.seed.checkpoints.vip);
    const mine = await h.call<{ items: Checkpoint[] }>("GET", `/checkpoints?venue_id=${h.seed.venueId}`, { token: gate });
    expect(mine.body.items.map((c) => c.id)).toEqual([h.seed.checkpoints.vip]);
    const all = await h.call<{ items: Checkpoint[] }>("GET", `/checkpoints?venue_id=${h.seed.venueId}`, { token: organiser });
    expect(all.body.items.length).toBe(8);
  });

  it("checkpoint scans carry no per-person id; a room's new capacity reaches live decisions", async () => {
    const a = await addAttendee(h, "ORDINARY");
    await postScans(h, [scan(h, h.seed.checkpoints.boardroom, band(a.uid))]);
    const list = await h.call<{ items: ScanRecord[] }>("GET", `/checkpoints/${h.seed.checkpoints.boardroom}/scans`, { token: organiser });
    expect(list.body.items.length).toBeGreaterThan(0);
    expect(list.body.items.every((s) => s.ephemeral_id === null)).toBe(true);
    // Boardroom holds 1 now; shrink it to 1 and the next person is blocked.
    await h.call("PUT", `/rooms/${h.seed.rooms.boardroom}`, { token: admin, body: { capacity: 1 } });
    const b = await addAttendee(h, "ORDINARY");
    const r = await postScans<ScanBatchResponse>(h, [scan(h, h.seed.checkpoints.boardroom, band(b.uid))]);
    expect(r.body.results[0]!.result).toBe("capacity_block");
    await h.call("PUT", `/rooms/${h.seed.rooms.boardroom}`, { token: admin, body: { capacity: 3 } });
  });
});

describe("slice 2 · events and the guarded lifecycle", () => {
  let ev: EventAdmin;
  const inPublic = async (slug: string) => (await h.call<{ items: EventSummary[] }>("GET", "/events")).body.items.some((e) => e.slug === slug);

  it("creates a draft: unique slug, venue rooms, time order; drafts never reach discovery", async () => {
    const t = h.clock.now();
    const body = {
      venue_id: h.seed.venueId, slug: "new-conf", title: "New Conference", starts_at: new Date(t + 48 * 3600_000).toISOString(),
      ends_at: new Date(t + 50 * 3600_000).toISOString(), timezone: "Africa/Kampala", rooms: [{ room_id: h.seed.rooms.auditorium }],
    };
    expect(errCode((await h.call("POST", "/events", { token: organiser, body: { ...body, slug: h.seed.eventSlug } })).body)).toBe("CONFLICT");
    expect(errCode((await h.call("POST", "/events", { token: organiser, body: { ...body, ends_at: body.starts_at } })).body)).toBe("VALIDATION_FAILED");
    expect(errCode((await h.call("POST", "/events", { token: organiser, body: { ...body, rooms: [{ room_id: "7a000000-0000-4000-8000-0000000000ff" }] } })).body)).toBe("VALIDATION_FAILED");
    const r = await h.call<EventAdmin>("POST", "/events", { token: organiser, body });
    expect(r.status).toBe(201);
    ev = r.body;
    expect(ev.state).toBe("draft");
    expect(await inPublic("new-conf")).toBe(false);
    expect((await h.call("GET", "/events/new-conf")).status).toBe(404);
    const all = await h.call<{ items: EventSummary[] }>("GET", "/events?scope=all", { token: organiser });
    expect(all.body.items.some((e) => e.slug === "new-conf")).toBe(true);
    expect((await h.call("GET", "/events?scope=all")).status).toBe(403); // anonymous
  });

  it("publish refuses without a pass template, listing what is missing; then publishes", async () => {
    const refused = await h.call<{ error: { issues: { path: string }[] } }>("POST", `/events/${ev.id}/publish`, { token: organiser });
    expect(errCode(refused.body)).toBe("CONFLICT");
    // Issues name the readiness checklist's blocking lines (GET /events/:id/readiness).
    expect(refused.body.error.issues.map((i) => i.path)).toEqual(["pass"]);
    await h.call("PATCH", `/events/${ev.id}`, { token: organiser, body: { pass_template: { layout: "standard" }, profile_schema: [{ key: "company", label: "Company", type: "text", required: false, hint: "Where you work" }] } });
    const ok = await h.call<EventAdmin>("POST", `/events/${ev.id}/publish`, { token: organiser });
    expect(ok.body.state).toBe("published");
    expect(await inPublic("new-conf")).toBe(true);
    const schema = await h.call<{ fields: { key: string; hint?: string }[] }>("GET", "/events/new-conf/profile-schema");
    expect(schema.body.fields).toMatchObject([{ key: "company", hint: "Where you work" }]);
    expect(errCode((await h.call("PATCH", `/events/${ev.id}`, { token: organiser, body: { slug: "renamed" } })).body)).toBe("CONFLICT");
  });

  it("moves one step at a time; closing stamps closed_at with server time and freezes the event", async () => {
    expect(errCode((await h.call("POST", `/events/${ev.id}/state`, { token: organiser, body: { state: "closed" } })).body)).toBe("CONFLICT");
    expect((await h.call<EventAdmin>("POST", `/events/${ev.id}/state`, { token: organiser, body: { state: "live" } })).body.state).toBe("live");
    expect(errCode((await h.call("PATCH", `/events/${ev.id}`, { token: organiser, body: { rooms: [] } })).body)).toBe("CONFLICT");
    const closed = await h.call<EventAdmin>("POST", `/events/${ev.id}/state`, { token: organiser, body: { state: "closed" } });
    expect(closed.body.state).toBe("closed");
    expect(Date.parse(closed.body.closed_at!)).toBe(h.clock.now());
    expect(errCode((await h.call("PATCH", `/events/${ev.id}`, { token: organiser, body: { title: "x" } })).body)).toBe("CONFLICT");
    expect((await h.call<EventAdmin>("POST", `/events/${ev.id}/state`, { token: organiser, body: { state: "archived" } })).body.state).toBe("archived");
    expect(await auditActions()).toEqual(expect.arrayContaining(["event.create", "event.update", "event.publish", "event.go_live", "event.close", "event.archive"]));
  });
});

describe("slice 2 · access-rule matrix, summary, dashboard", () => {
  it("republishing on a live event needs a fresh second factor", async () => {
    const cur = (await h.call<{ version: number; rules: AccessRule[] }>("GET", `/events/${h.seed.eventId}/access-rules`, { token: organiser })).body;
    const rules = cur.rules.map(({ subject_kind, subject, room_id, window_start, window_end, effect }) => ({ subject_kind, subject, room_id, window_start, window_end, effect }));
    expect(errCode((await h.call("PUT", `/events/${h.seed.eventId}/access-rules`, { token: organiser, body: { expected_version: cur.version, rules } })).body)).toBe("MFA_REQUIRED");
  });

  it("republish needs the current version (409 otherwise), validates cells, is audited, and takes effect at the gate", async () => {
    const stepped = (await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: admin, body: { code: mfaCode(h) } })).body.access_token;
    const cur = (await h.call<{ version: number; rules: AccessRule[] }>("GET", `/events/${h.seed.eventId}/access-rules`, { token: organiser })).body;
    const keep = cur.rules.filter((r) => !(r.subject === "VIP" && r.room_id === h.seed.rooms.vip))
      .map(({ subject_kind, subject, room_id, window_start, window_end, effect }) => ({ subject_kind, subject, room_id, window_start, window_end, effect }));
    expect(errCode((await h.call("PUT", `/events/${h.seed.eventId}/access-rules`, {
      token: stepped, body: { expected_version: cur.version, rules: [...keep, { ...keep[0]!, subject: "GOLD" }] },
    })).body)).toBe("VALIDATION_FAILED");
    const put = await h.call<{ version: number }>("PUT", `/events/${h.seed.eventId}/access-rules`, { token: stepped, body: { expected_version: cur.version, rules: keep } });
    expect(put.body.version).toBe(cur.version + 1);
    expect(errCode((await h.call("PUT", `/events/${h.seed.eventId}/access-rules`, { token: stepped, body: { expected_version: cur.version, rules: keep } })).body)).toBe("CONFLICT");
    const audit = (await h.app.ctx.repos.audit.all()).filter((a) => a.action === "access_rules.republish").at(-1)!;
    expect(audit.meta_jsonb).toMatchObject({ version: cur.version + 1, removed: 1, added: 0, live: true });
    const v = await addAttendee(h, "VIP");
    const r = await postScans<ScanBatchResponse>(h, [scan(h, h.seed.checkpoints.vip, band(v.uid))]);
    expect(r.body.results[0]!.result).toBe("denied_room");
  });

  it("summary and dashboard count from the live state", async () => {
    const s = await h.call<{ registered: number; checked_in: number; by_tier: Record<string, number> }>("GET", `/events/${h.seed.eventId}/summary`, { token: organiser });
    expect(s.body.registered).toBeGreaterThanOrEqual(5);
    expect(s.body.checked_in).toBeGreaterThanOrEqual(1);
    expect(s.body.by_tier.VIP).toBeGreaterThanOrEqual(1);
    const d = await h.call<{ live_events: number; open_alerts: number }>("GET", "/dashboard", { token: organiser });
    expect(d.body.live_events).toBe(1);
    expect(d.body.open_alerts).toBeGreaterThanOrEqual(1);
    expect((await h.call("GET", "/dashboard", { token: await h.gateToken(h.seed.checkpoints.mainIn) })).status).toBe(403);
  });
});

void (null as unknown as TokenPair);
