/**
 * Attendee portal gaps (B1–B8): GET /me, PATCH /me/profile, own registrations, the current pass,
 * event references on passes and the agenda, event card figures, registration across devices
 * (pending registrations), phone, lost-band report, public occupancy. Runs on both backends.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EventSummary, Me, MyCredential, MyRegistrationItem, PublicOccupancy, Registration, TokenPair } from "@synan/contracts/rest";
import { sha256b64url } from "../src/lib/crypto.js";
import { nfcIdentifier } from "../src/domain/scan-service.js";
import { addAttendee, band, devEmail, errCode, postScans, scan, startHarness, type Harness } from "./helpers.js";

let h: Harness;
let organiser: string;
beforeAll(async () => {
  h = await startHarness();
  organiser = (await h.login(h.seed.emails.organiser)).access_token;
});
afterAll(async () => h.close());

const linkOf = (email: string) => {
  const mail = [...h.mailer.outbox].reverse().find((m) => m.tag === "auth.link" && m.to === email);
  if (!mail) throw new Error(`no link for ${email}`);
  return { token: /#token=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!, text: mail.text };
};
const verify = async (token: string) => h.call<TokenPair>("POST", "/auth/verify", { body: { token } });
async function signIn(email: string): Promise<TokenPair> {
  await h.call("POST", "/auth/email-link", { body: { email } });
  return (await verify(linkOf(email).token)).body;
}
const auditOf = async (action: string) => (await h.app.ctx.repos.audit.all()).filter((a) => a.action === action);
const scanAt = async (cp: string, uid: string) => (await postScans<{ results: { result: string }[] }>(h, [scan(h, cp, band(uid))])).body.results[0]!.result;

describe("B1 · GET /me and PATCH /me/profile", () => {
  it("shows the caller's own identity, masked; only attendees reach it", async () => {
    const t = await signIn(h.seed.attendees.ordinary.email!);
    const r = await h.call<Me>("GET", "/me", { token: t.access_token });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ id: t.principal.sub, full_name: "Orla Dinary", email_masked: expect.stringMatching(/^o•••@/), phone_masked: null });
    expect(r.body.email_masked).not.toContain("ordinary");
    expect((await h.call("GET", "/me")).status).toBe(401);
    expect((await h.call("GET", "/me", { token: organiser })).status).toBe(403);
  });

  it("edits the caller's own name, answers and phone without an id; the old route keeps working", async () => {
    const t = await signIn(h.seed.attendees.ordinary2.email!);
    const token = t.access_token;
    const r = await h.call<Me>("PATCH", "/me/profile", { token, body: { full_name: "Owen D.", phone: "+256 700 123 456", profile: { company: "Acme" } } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ full_name: "Owen D.", phone_masked: "••••• 3456" });
    expect((await h.app.ctx.repos.attendees.byId(t.principal.sub))!.phone).toBe("+256 700 123 456");
    // Answers merge: a later edit of one key keeps the others.
    await h.call("PATCH", "/me/profile", { token, body: { profile: { role: "Engineer" } } });
    expect((await h.app.ctx.repos.attendees.byId(t.principal.sub))!.profile_jsonb).toEqual({ company: "Acme", role: "Engineer" });
    expect((await h.call("PATCH", "/me/profile", { token, body: { phone: "call me maybe" } })).status).toBe(400);
    expect((await h.call<Me>("PATCH", "/me/profile", { token, body: { phone: null } })).body.phone_masked).toBeNull();
    // Principal.sub is the attendee's own id: PATCH /users/:id/profile with it still works; another id is 404.
    expect((await h.call("PATCH", `/users/${t.principal.sub}/profile`, { token, body: { full_name: "Owen Dinary" } })).status).toBe(200);
    expect((await h.call("PATCH", `/users/${h.seed.attendees.vip.id}/profile`, { token, body: { full_name: "X" } })).status).toBe(404);
    expect((await h.call<Me>("GET", "/me", { token })).body.full_name).toBe("Owen Dinary");
  });
});

describe("B2/B3 · own registrations, the current pass, events on passes and sessions", () => {
  it("lists every own registration with its event (unlisted Private Invitation included) and pass state, newest event first", async () => {
    const t = await signIn(h.seed.attendees.privateInvite.email!);
    const r = await h.call<{ items: MyRegistrationItem[] }>("GET", "/me/registrations", { token: t.access_token });
    expect(r.status).toBe(200);
    expect(r.body.items.map((i) => i.event.id)).toEqual([h.seed.privateEventId, h.seed.eventId]); // the roundtable starts later
    const [roundtable, live] = r.body.items;
    expect(roundtable!.event).toMatchObject({ slug: h.seed.privateEventSlug, title: "Private Roundtable", timezone: "Africa/Kampala", state: "published" });
    expect(roundtable!.event.venue_name).toBeTruthy();
    expect(roundtable!).toMatchObject({ tier: "PRIVATE_INVITE", state: "confirmed", credential_state: null, band_bound: false, zone_presence_consent: true });
    expect(live!).toMatchObject({ tier: "PRIVATE_INVITE", credential_state: "issued", band_bound: true });
    expect((await h.call("GET", "/me/registrations", { token: organiser })).status).toBe(403);
  });

  it("/me/sessions items name their event and room, with the room's capacity in force", async () => {
    const t = await signIn(h.seed.attendees.vip.email!);
    const r = await h.call<{ items: { title: string; event_slug?: string; event_title?: string; event_timezone?: string; room_name?: string; room_capacity?: number }[] }>("GET", "/me/sessions", { token: t.access_token });
    const keynote = r.body.items.find((s) => s.title === "Opening Keynote")!;
    const room = (await h.app.ctx.repos.venues.room(h.seed.rooms.auditorium))!;
    expect(keynote).toMatchObject({ event_slug: h.seed.eventSlug, event_timezone: "Africa/Kampala", room_name: room.name, room_capacity: room.capacity });
    expect(keynote.event_title).toBeTruthy();
  });
});

describe("B4 · event card figures", () => {
  it("carries capacity (sum of the rooms in force), session count and an image url (null for now)", async () => {
    const r = await h.call<{ items: EventSummary[] }>("GET", "/events");
    const live = r.body.items.find((e) => e.id === h.seed.eventId)!;
    const rooms = await h.app.ctx.repos.venues.roomsByIds((await h.app.ctx.repos.events.rooms(h.seed.eventId)).map((x) => x.room_id));
    expect(live).toMatchObject({ capacity: rooms.reduce((n, x) => n + x.capacity, 0), session_count: 1, image_url: null });
    const future = r.body.items.find((e) => e.id === h.seed.publishedEventId)!;
    expect(future).toMatchObject({ capacity: 150, session_count: 0, image_url: null }); // the auditorium's override
  });
});

describe("B5/B6 · registration across devices", () => {
  it("keeps the registration pending with the link; redeeming it anywhere completes it with the answers and phone", async () => {
    const email = devEmail(`roamer-${randomUUID().slice(0, 8)}`);
    const r = await h.call("POST", "/users/register", {
      body: { email, full_name: "Ro Amer", event_slug: h.seed.publishedEventSlug, profile: { company: "Acme" }, zone_presence_consent: true, phone: "+44 20 7946 0001" },
    });
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ accepted: true, verification_sent: true });
    const att = (await h.app.ctx.repos.attendees.byEmail(email))!;
    // Nothing identifying is written to the person until the address is proved: it waits with the link.
    expect(att).toMatchObject({ full_name: null, profile_jsonb: {} });
    expect(att.phone ?? null).toBeNull();
    expect(await h.app.ctx.repos.registrations.forAttendee(att.id)).toHaveLength(0);
    const { token, text } = linkOf(email);
    expect(text).toContain("confirms your registration for Future Summit");

    // "Another device": only the link is presented.
    const before = h.mailer.outbox.length;
    const v = await verify(token);
    expect(v.status).toBe(200);
    const regs = await h.app.ctx.repos.registrations.forAttendee(att.id);
    expect(regs).toHaveLength(1);
    expect(regs[0]).toMatchObject({ event_id: h.seed.publishedEventId, tier: "ORDINARY", state: "confirmed" });
    expect(regs[0]!.zone_presence_consent_at).not.toBeNull();
    expect(await h.app.ctx.repos.credentials.forRegistration(regs[0]!.id)).not.toBeNull();
    expect(h.mailer.outbox.slice(before).some((m) => m.tag === "pass.email_qr" && m.to === email)).toBe(true);
    expect(await h.app.ctx.repos.attendees.byId(att.id)).toMatchObject({ full_name: "Ro Amer", phone: "+44 20 7946 0001", profile_jsonb: { company: "Acme" } });
    expect((await h.call<Me>("GET", "/me", { token: v.body.access_token })).body.phone_masked).toBe("••••• 0001");
    // The pending registration is gone (taken once).
    expect(await h.app.ctx.repos.pendingRegistrations.take(sha256b64url(token), new Date(h.clock.now()))).toBeNull();

    // The old two-call path still works: its POST /registrations adopts the completed registration once.
    const again = await h.call<Registration>("POST", "/registrations", { token: v.body.access_token, body: { event_id: h.seed.publishedEventId, zone_presence_consent: true } });
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(regs[0]!.id);
    expect(errCode((await h.call("POST", "/registrations", { token: v.body.access_token, body: { event_id: h.seed.publishedEventId, zone_presence_consent: true } })).body)).toBe("CONFLICT");
  });

  it("a known address: same answer, and the link never overwrites the identity already held", async () => {
    const email = h.seed.attendees.vip.email!;
    const r = await h.call("POST", "/users/register", { body: { email, full_name: "Impostor", event_slug: h.seed.publishedEventSlug, profile: {}, zone_presence_consent: false, phone: "+1 555 0100" } });
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ accepted: true, verification_sent: true });
    const v = await verify(linkOf(email).token);
    expect(v.status).toBe(200);
    const a = (await h.app.ctx.repos.attendees.byId(h.seed.attendees.vip.id))!;
    expect(a.full_name).toBe("Vera Ip");
    expect(a.phone).toBe("+1 555 0100"); // empty before: filled
    expect((await h.app.ctx.repos.registrations.forAttendee(a.id)).some((x) => x.event_id === h.seed.publishedEventId)).toBe(true);
  });

  it("an unused pending registration expires with its link and is purged; erasure removes any left", async () => {
    const email = devEmail(`late-${randomUUID().slice(0, 8)}`);
    await h.call("POST", "/users/register", { body: { email, full_name: "La Te", event_slug: h.seed.publishedEventSlug, profile: {}, zone_presence_consent: false } });
    const { token } = linkOf(email);
    const att = (await h.app.ctx.repos.attendees.byEmail(email))!;
    h.clock.advance((h.app.ctx.config.emailLinkTtlS + 1) * 1000);
    expect(await h.app.ctx.repos.pendingRegistrations.cleanup(new Date(h.clock.now()))).toBeGreaterThanOrEqual(1);
    expect(errCode((await verify(token)).body)).toBe("LINK_EXPIRED");
    expect(await h.app.ctx.repos.registrations.forAttendee(att.id)).toHaveLength(0);

    const email2 = devEmail(`erase-${randomUUID().slice(0, 8)}`);
    await h.call("POST", "/users/register", { body: { email: email2, full_name: "Era Se", event_slug: h.seed.publishedEventSlug, profile: {}, zone_presence_consent: false } });
    const link2 = linkOf(email2).token;
    const att2 = (await h.app.ctx.repos.attendees.byEmail(email2))!;
    const req = await h.app.ctx.repos.dataRequests.open(att2.id, "erasure", new Date(h.clock.now()));
    await h.app.ctx.repos.dataRequests.erase((await h.app.ctx.repos.dataRequests.byId(req.request_id))!, null, new Date(h.clock.now()));
    expect(await h.app.ctx.repos.pendingRegistrations.take(sha256b64url(link2), new Date(h.clock.now()))).toBeNull();
  });

  it("refuses a malformed phone and an unlisted event as before", async () => {
    const body = { email: devEmail("x-phone"), full_name: "X", event_slug: h.seed.publishedEventSlug, profile: {}, zone_presence_consent: false };
    expect((await h.call("POST", "/users/register", { body: { ...body, phone: "not a phone" } })).status).toBe(400);
    expect((await h.call("POST", "/users/register", { body: { ...body, event_slug: h.seed.privateEventSlug } })).status).toBe(404);
  });
});

describe("B7 · POST /me/credential/report-lost", () => {
  it("marks the live band lost at once (doors refuse it), audits, tells the desk through the registrations list; idempotent", async () => {
    const a = await addAttendee(h, "ORDINARY");
    const email = (await h.app.ctx.repos.attendees.byId(a.id))!.email!;
    const t = (await signIn(email)).access_token;
    expect(await scanAt(h.seed.checkpoints.expo, a.uid)).toBe("admitted");
    const epoch = (await h.app.ctx.repos.events.byId(h.seed.eventId))!.revocation_epoch;

    const r = await h.call<{ marked_lost: boolean; credential: MyCredential }>("POST", "/me/credential/report-lost", { token: t, body: { event_id: h.seed.eventId } });
    expect(r.status).toBe(200);
    expect(r.body.marked_lost).toBe(true);
    expect(r.body.credential.carriers.find((c) => c.kind === "nfc")!.state).toBe("lost");
    expect(r.body.credential.state).not.toBe("revoked"); // the pass itself still works (app, emailed code)
    expect((await h.app.ctx.repos.carriers.byIdentifier("nfc", nfcIdentifier(a.uid)))!.state).toBe("lost");
    expect((await h.app.ctx.repos.events.byId(h.seed.eventId))!.revocation_epoch).toBeGreaterThan(epoch); // offline gates drop it
    expect(await scanAt(h.seed.checkpoints.press, a.uid)).not.toBe("admitted");
    const audit = (await auditOf("carrier.report_lost")).at(-1)!;
    expect(audit).toMatchObject({ actor_id: a.id });
    expect(JSON.stringify(audit)).not.toContain(a.uid);

    // The desk sees it on the event's registrations and binds a stock band (no automatic replacement).
    organiser = (await h.login(h.seed.emails.organiser)).access_token; // the clock moved on above
    const rows = await h.call<{ items: { id: string; band_lost?: boolean; band_hint: string | null }[] }>("GET", `/events/${h.seed.eventId}/registrations?limit=200`, { token: organiser });
    expect(rows.status, JSON.stringify(rows.body)).toBe(200);
    expect(rows.body.items.find((x) => x.id === a.registrationId)).toMatchObject({ band_lost: true, band_hint: null });
    const again = await h.call<{ marked_lost: boolean }>("POST", "/me/credential/report-lost", { token: t, body: { event_id: h.seed.eventId } });
    expect(again.body.marked_lost).toBe(false);
    const stock = "04" + randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
    await h.app.ctx.repos.carriers.importStock([nfcIdentifier(stock)], "ntag_uid");
    const bound = await h.app.ctx.repos.carriers.bind({ identifier: nfcIdentifier(stock), credentialId: a.credentialId, actorId: null, now: new Date(h.clock.now()) });
    expect(bound.status).toBe("bound");

    // Notified; only the caller's own pass; operators cannot call it.
    const n = await h.call<{ items: { title: string }[] }>("GET", "/me/notifications", { token: t });
    expect(n.body.items.map((x) => x.title)).toContain("Wristband reported lost");
    expect((await h.call("POST", "/me/credential/report-lost", { token: t, body: { event_id: h.seed.privateEventId } })).status).toBe(404);
    expect((await h.call("POST", "/me/credential/report-lost", { token: organiser, body: { event_id: h.seed.eventId } })).status).toBe(403);
  });
});

describe("B8 · GET /events/:id/occupancy (public)", () => {
  it("serves the k-anonymised public scope: suppressed rooms read null/ok, totals add up only what is shown", async () => {
    const k = h.app.ctx.config.kAnon;
    for (let i = 0; i < k; i++) expect(await scanAt(h.seed.checkpoints.vip, (await addAttendee(h, "VIP")).uid)).toBe("admitted");
    h.clock.advance(10_000); // past any cached read
    const r = await h.call<PublicOccupancy>("GET", `/events/${h.seed.eventId}/occupancy`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("public, max-age=5");
    expect(r.body).toMatchObject({ event_id: h.seed.eventId, live: true, max_age_s: 5 });
    const full = (await h.app.ctx.scans.projection(h.seed.eventId)).allRooms();
    const shownSum = full.filter((x) => (x.occupancy ?? 0) >= k).reduce((n, x) => n + x.occupancy!, 0);
    for (const room of r.body.rooms) {
      const real = full.find((x) => x.room_id === room.room_id)!;
      if ((real.occupancy ?? 0) >= k) expect(room.occupancy).toBe(real.occupancy);
      else expect(room).toMatchObject({ occupancy: null, level: "ok" });
    }
    expect(r.body.rooms.find((x) => x.room_id === h.seed.rooms.vip)!.occupancy).toBeGreaterThanOrEqual(k);
    // A suppressed room exists (the expo/press admissions above are below k) and in_rooms leaves it out.
    expect(full.some((x) => (x.occupancy ?? 0) > 0 && (x.occupancy ?? 0) < k)).toBe(true);
    expect(r.body.totals.in_rooms).toBe(shownSum >= k ? shownSum : null);
  });

  it("is cached a few seconds, rate-limited per address, and only for published or live events the caller may see", async () => {
    const first = await h.call<PublicOccupancy>("GET", `/events/${h.seed.eventId}/occupancy`);
    const second = await h.call<PublicOccupancy>("GET", `/events/${h.seed.eventId}/occupancy`);
    expect(second.body.as_of).toBe(first.body.as_of);
    // Unlisted: 404 to the public, readable (privately cacheable) by its registered attendee.
    expect((await h.call("GET", `/events/${h.seed.privateEventId}/occupancy`)).status).toBe(404);
    const t = (await signIn(h.seed.attendees.privateInvite.email!)).access_token;
    const p = await h.call<PublicOccupancy>("GET", `/events/${h.seed.privateEventId}/occupancy`, { token: t });
    expect(p.status).toBe(200);
    expect(p.headers.get("cache-control")).toBe("private, max-age=5");
    expect(p.body.live).toBe(false);
    expect(p.body.rooms.every((x) => x.occupancy === null)).toBe(true);
    expect((await h.call("GET", `/events/${randomUUID()}/occupancy`)).status).toBe(404);
    const draft = (await h.app.ctx.repos.events.bySlug(h.seed.draftEventSlug))!;
    expect((await h.call("GET", `/events/${draft.id}/occupancy`)).status).toBe(404);

    const saved = h.app.ctx.config.publicReadsPerMin;
    h.app.ctx.config.publicReadsPerMin = 2;
    try {
      h.clock.advance(61_000);
      expect((await h.call("GET", `/events/${h.seed.eventId}/occupancy`)).status).toBe(200);
      expect((await h.call("GET", `/events/${h.seed.eventId}/occupancy`)).status).toBe(200);
      const limited = await h.call("GET", `/events/${h.seed.eventId}/occupancy`);
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBeTruthy();
    } finally {
      h.app.ctx.config.publicReadsPerMin = saved;
    }
  });
});
