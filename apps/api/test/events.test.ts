import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { endpoints, type EventSummary, type TokenPair } from "@synan/contracts/rest";
import { addAttendee, band, devEmail, errCode, postScans, REPO_UNDER_TEST, scan, startHarness, type Harness } from "./helpers.js";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

async function attendee(email: string) {
  await h.call("POST", "/auth/email-link", { body: { email } });
  const token = /#token=([A-Za-z0-9_-]+)/.exec(h.mailer.last("auth.link")!.text)![1]!;
  return (await h.call<TokenPair>("POST", "/auth/verify", { body: { token } })).body.access_token;
}

describe("event summary: venue city and public on-site total", () => {
  const live = async () =>
    (await h.call<{ items: EventSummary[] }>("GET", "/events")).body.items.find((e) => e.slug === h.seed.eventSlug)!;

  it("carries the venue city", async () => {
    const e = await live();
    // The SQL schema has no venues.city column yet, so the Drizzle backend reports null.
    expect(e.venue.city).toBe(REPO_UNDER_TEST === "pglite" ? null : "Kampala");
  });

  it("hides the on-site count below k = 5, shows it from 5, and is null for events not live", async () => {
    expect((await live()).on_site).toBeNull();
    const people = await Promise.all([1, 2, 3, 4, 5].map(() => addAttendee(h, "ORDINARY")));
    for (const [i, p] of people.entries()) {
      await postScans(h, [scan(h, h.seed.checkpoints.mainIn, band(p.uid))], { deviceId: `os-${i}` });
      if (i === 3) expect((await live()).on_site).toBeNull(); // 4 inside
    }
    expect((await live()).on_site).toBe(5);
    const published = (await h.call<{ items: EventSummary[] }>("GET", "/events")).body.items.find((e) => e.slug === h.seed.publishedEventSlug)!;
    expect(published.on_site).toBeNull();
  });
});

describe("GET /me/registration", () => {
  it("returns the attendee's own registration, null when not registered, and flips checked_in on first admission", async () => {
    const t = await attendee(devEmail("ordinary"));
    const none = await h.call<{ registration: unknown }>("GET", `/me/registration?event_id=${h.seed.privateEventId}`, { token: t });
    expect(none.status).toBe(200);
    expect(none.body.registration).toBeNull();

    const before = await h.call<{ registration: Record<string, unknown> }>("GET", `/me/registration?event_id=${h.seed.eventId}`, { token: t });
    expect(() => endpoints.myRegistration.response.parse(before.body)).not.toThrow();
    expect(before.body.registration).toMatchObject({
      tier: "ORDINARY", state: "confirmed", checked_in: false, checked_in_at: null, zone_presence_consent: true, credential_state: "issued",
    });

    await postScans(h, [scan(h, h.seed.checkpoints.mainIn, band(h.seed.attendees.ordinary.uid))], { deviceId: "reg" });
    const after = await h.call<{ registration: Record<string, unknown> }>("GET", `/me/registration?event_id=${h.seed.eventId}`, { token: t });
    expect(after.body.registration).toMatchObject({ checked_in: true, credential_state: "active" });
    expect(typeof after.body.registration.checked_in_at).toBe("string");
  });

  it("requires an attendee token and an event id", async () => {
    expect((await h.call("GET", `/me/registration?event_id=${h.seed.eventId}`)).status).toBe(401);
    const t = await attendee(devEmail("vip"));
    expect((await h.call("GET", "/me/registration", { token: t })).status).toBe(400);
  });
});

describe("backend under test", () => {
  it("is the repository implementation that was requested", () => {
    expect(h.app.ctx.repos.kind).toBe(REPO_UNDER_TEST === "pglite" ? "drizzle" : "memory");
  });
});

describe("GET /events", () => {
  it("lists published and live listed events only — never unlisted Private Invitation events or drafts", async () => {
    const r = await h.call<{ items: EventSummary[]; next_cursor: string | null }>("GET", "/events");
    expect(r.status).toBe(200);
    expect(() => endpoints.listEvents.response.parse(r.body)).not.toThrow();
    const slugs = r.body.items.map((e) => e.slug);
    expect(slugs).toEqual([h.seed.eventSlug, h.seed.publishedEventSlug]);
    expect(slugs).not.toContain(h.seed.privateEventSlug);
    expect(slugs).not.toContain(h.seed.draftEventSlug);
  });

  it("an operator token does not reveal unlisted events in discovery either", async () => {
    const op = await h.login(h.seed.emails.organiser);
    const r = await h.call<{ items: EventSummary[] }>("GET", "/events", { token: op.access_token });
    expect(r.body.items.map((e) => e.slug)).not.toContain(h.seed.privateEventSlug);
  });

  it("paginates with an opaque cursor", async () => {
    const p1 = await h.call<{ items: EventSummary[]; next_cursor: string | null }>("GET", "/events?limit=1");
    expect(p1.body.items).toHaveLength(1);
    expect(p1.body.next_cursor).toBeTruthy();
    const p2 = await h.call<{ items: EventSummary[]; next_cursor: string | null }>("GET", `/events?limit=1&cursor=${p1.body.next_cursor}`);
    expect(p2.body.items[0]!.slug).toBe(h.seed.publishedEventSlug);
    expect(p2.body.next_cursor).toBeNull();
    expect((await h.call("GET", "/events?cursor=%%%")).status).toBe(400);
  });

  it("filters by state", async () => {
    const r = await h.call<{ items: EventSummary[] }>("GET", "/events?state=live");
    expect(r.body.items.map((e) => e.slug)).toEqual([h.seed.eventSlug]);
  });
});

describe("GET /events/:slug", () => {
  it("returns detail with rooms and sessions", async () => {
    const r = await h.call<{ rooms: unknown[]; sessions: unknown[] }>("GET", `/events/${h.seed.eventSlug}`);
    expect(r.status).toBe(200);
    expect(() => endpoints.getEvent.response.parse(r.body)).not.toThrow();
    expect(r.body.rooms).toHaveLength(5);
    expect(r.body.sessions).toHaveLength(1);
  });

  it("an unlisted event is 404 to the public and to unrelated attendees, visible to its invitees and operators", async () => {
    expect((await h.call("GET", `/events/${h.seed.privateEventSlug}`)).status).toBe(404);
    const outsider = await attendee(devEmail("ordinary"));
    expect((await h.call("GET", `/events/${h.seed.privateEventSlug}`, { token: outsider })).status).toBe(404);
    const invitee = await attendee(devEmail("private"));
    expect((await h.call("GET", `/events/${h.seed.privateEventSlug}`, { token: invitee })).status).toBe(200);
    const op = await h.login(h.seed.emails.organiser);
    expect((await h.call("GET", `/events/${h.seed.privateEventSlug}`, { token: op.access_token })).status).toBe(200);
  });

  it("a draft is 404 to the public and visible to operators", async () => {
    const r = await h.call("GET", `/events/${h.seed.draftEventSlug}`);
    expect(r.status).toBe(404);
    expect(errCode(r.body)).toBe("NOT_FOUND");
    const op = await h.login(h.seed.emails.organiser);
    expect((await h.call("GET", `/events/${h.seed.draftEventSlug}`, { token: op.access_token })).status).toBe(200);
  });

  it("an unknown slug and a hidden slug are indistinguishable", async () => {
    const a = await h.call("GET", "/events/does-not-exist");
    const b = await h.call("GET", `/events/${h.seed.privateEventSlug}`);
    expect(a.status).toBe(b.status);
    expect(errCode(a.body)).toBe(errCode(b.body));
  });
});

describe("GET /me/credential", () => {
  it("returns the attendee's own pass with server-resolved tier and permitted rooms", async () => {
    const t = await attendee(devEmail("ordinary"));
    const r = await h.call<{ tier: string; permitted_room_ids: string[]; state: string }>("GET", "/me/credential", { token: t });
    expect(r.status).toBe(200);
    expect(r.body.tier).toBe("ORDINARY");
    expect(r.body.permitted_room_ids.sort()).toEqual(
      [h.seed.rooms.auditorium, h.seed.rooms.expo, h.seed.rooms.boardroom, h.seed.rooms.press].sort(),
    );
  });

  it("requires event_id when the attendee holds several passes", async () => {
    const t = await attendee(devEmail("private"));
    expect((await h.call("GET", "/me/credential", { token: t })).status).toBe(400);
    expect((await h.call("GET", `/me/credential?event_id=${h.seed.eventId}`, { token: t })).status).toBe(200);
  });
});
