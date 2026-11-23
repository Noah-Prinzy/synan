/** Stored attendee notifications: written at the moment, generic text, per-item mark-read, audited operator broadcast. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Notification, TokenPair } from "@synan/contracts/rest";
import { addAttendee, band, devEmail, errCode, postScans, scan, startHarness, type Harness } from "./helpers.js";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h.close());

async function signIn(email: string): Promise<string> {
  await h.call("POST", "/auth/email-link", { body: { email } });
  const token = /#token=([A-Za-z0-9_-]+)/.exec([...h.mailer.outbox].reverse().find((m) => m.tag === "auth.link" && m.to === email)!.text)![1]!;
  return (await h.call<TokenPair>("POST", "/auth/verify", { body: { token } })).body.access_token;
}
const org = async () => (await h.login(h.seed.emails.organiser)).access_token;
const mine = async (token: string) => (await h.call<{ items: Notification[] }>("GET", "/me/notifications", { token })).body.items;

/** Nothing that places a person: no room, zone or gate names. */
async function assertGeneric(items: Notification[]) {
  const v = h.app.ctx.repos.venues;
  const names = [
    ...(await v.roomsOfVenue(h.seed.venueId)).map((r) => r.name),
    ...(await v.zonesOfVenue(h.seed.venueId)).map((z) => z.name),
    ...(await v.checkpointsOfVenue(h.seed.venueId)).map((c) => c.label),
  ].filter((n) => n.length > 3);
  for (const n of items) for (const name of names) expect(`${n.title} ${n.body}`).not.toContain(name);
}

describe("notifications", () => {
  it("pass issued, wristband bound, revoked: written when they happen; mark-read answers per item", async () => {
    const a = await addAttendee(h, "ORDINARY");
    const email = (await h.app.ctx.repos.attendees.byId(a.id))!.email!;
    const me = await signIn(email);
    expect((await mine(me)).map((n) => n.title)).toContain("Your pass is ready");
    // A registration with no band yet, bound at the desk.
    const fresh = { id: randomUUID(), registrationId: randomUUID() };
    await h.app.ctx.repos.attendees.insert({ id: fresh.id, user_id: null, email: devEmail(`n-${fresh.id}`), full_name: "Test", profile_jsonb: {} });
    await h.app.ctx.repos.fixtures.registration({
      id: fresh.registrationId, event_id: h.seed.eventId, attendee_id: fresh.id, tier: "ORDINARY", state: "confirmed",
      zone_presence_consent_at: null, checked_in_at: null, created_at: new Date(h.clock.now()),
    });
    await h.app.ctx.credentials.issueForRegistration(fresh.registrationId);
    const bound = await h.call("POST", "/carriers/bind", { token: await org(), body: { registration_id: fresh.registrationId, identifier: h.seed.stockUid } });
    expect(bound.status).toBe(200);
    const freshMe = await signIn((await h.app.ctx.repos.attendees.byId(fresh.id))!.email!);
    expect((await mine(freshMe)).map((n) => n.title)).toContain("Wristband linked");

    await h.call("POST", `/credentials/${a.credentialId}/revoke`, { token: await org(), body: { reason: "refund" } });
    const items = await mine(me);
    expect(items.map((n) => n.title)).toContain("Your pass was cancelled");
    await assertGeneric(items);
    expect(items.every((n) => !n.read)).toBe(true);

    // Per item: mine → read; unknown and another attendee's → false, indistinguishably.
    const other = (await mine(freshMe))[0]!.id;
    const unknown = "00000000-0000-4000-8000-000000000000";
    const r = await h.call<{ items: { id: string; read: boolean }[] }>("POST", "/me/notifications/read", { token: me, body: { ids: [items[0]!.id, unknown, other] } });
    expect(r.body.items).toEqual([{ id: items[0]!.id, read: true }, { id: unknown, read: false }, { id: other, read: false }]);
    expect((await mine(me)).find((n) => n.id === items[0]!.id)!.read).toBe(true);
    expect((await mine(freshMe)).find((n) => n.id === other)!.read).toBe(false);
    expect((await h.call("POST", "/me/notifications/read", { token: await org(), body: { ids: [unknown] } })).status).toBe(403);
  });

  it("impossible travel puts the pass under review and says so, without saying where", async () => {
    const a = await addAttendee(h, "VIP");
    const me = await signIn((await h.app.ctx.repos.attendees.byId(a.id))!.email!);
    await postScans(h, [scan(h, h.seed.checkpoints.eastIn, band(a.uid))]);
    h.clock.advance(90_000);
    await postScans(h, [scan(h, h.seed.checkpoints.vip, band(a.uid))]);
    const items = await mine(me);
    const review = items.find((n) => n.title === "Your pass is under review")!;
    expect(review.kind).toBe("security");
    await assertGeneric(items);
  });

  it("a session room reaching capacity is announced once, naming the session, not the room", async () => {
    const { repos, scans } = h.app.ctx;
    await repos.venues.updateRoom(h.seed.rooms.auditorium, { capacity: 2, warn_at_pct: 50, block_at_pct: 100 });
    scans.forgetProjections();
    const enter = async (uid: string) => {
      await postScans(h, [scan(h, h.seed.checkpoints.mainIn, band(uid))]);
      h.clock.advance(400_000);
      await postScans(h, [scan(h, h.seed.checkpoints.auditorium, band(uid), { direction: "in" })]);
    };
    // Still inside the keynote's hour (it starts when the seed runs).
    const keynote = (await repos.events.sessions(h.seed.eventId)).find((s) => s.title === "Opening Keynote")!;
    expect(h.clock.now()).toBeLessThan(keynote.ends_at.getTime() - 1_200_000);
    const one = await addAttendee(h, "VIP");
    const two = await addAttendee(h, "VIP");
    const occupancy = async () => (await scans.projection(h.seed.eventId)).count(h.seed.rooms.auditorium);
    for (const x of [one, two]) if ((await occupancy()) < 2) await enter(x.uid);
    let listener = await signIn(h.seed.attendees.ordinary2.email!);
    const full = (await mine(listener)).filter((n) => n.kind === "capacity");
    expect(full.map((n) => n.title)).toEqual(["Opening Keynote is full"]);
    await assertGeneric(full);
    // A further admission attempt does not announce it again.
    await enter((await addAttendee(h, "VIP")).uid);
    listener = await signIn(h.seed.attendees.ordinary2.email!);
    expect((await mine(listener)).filter((n) => n.kind === "capacity")).toHaveLength(1);
  });

  it("operator broadcast: to an event or one tier, audited without the text; staff and attendees may not", async () => {
    const vip = await signIn(h.seed.attendees.vip.email!);
    const ordinary = await signIn(h.seed.attendees.ordinary2.email!);
    const path = `/events/${h.seed.eventId}/notifications`;
    const body = { title: "Doors open early", body: "The venue opens 30 minutes early today.", tier: "VIP" };
    expect((await h.call("POST", path, { token: await h.gateToken(h.seed.checkpoints.mainIn), body })).status).toBe(403);
    expect((await h.call("POST", path, { token: vip, body })).status).toBe(403);
    expect(errCode((await h.call("POST", path, { token: await org(), body: { ...body, title: "" } })).body)).toBe("VALIDATION_FAILED");
    const r = await h.call<{ id: string; tier: string }>("POST", path, { token: await org(), body });
    expect(r.status).toBe(201);
    expect((await mine(vip)).map((n) => n.title)).toContain("Doors open early");
    expect((await mine(ordinary)).map((n) => n.title)).not.toContain("Doors open early");
    const all = await h.call<{ id: string }>("POST", path, { token: await org(), body: { title: "Welcome", body: "Enjoy the event." } });
    expect((await mine(ordinary)).map((n) => n.id)).toContain(all.body.id);
    const entry = (await h.app.ctx.repos.audit.all()).find((x) => x.action === "notification.broadcast" && x.meta_jsonb.notification_id === r.body.id)!;
    expect(entry.meta_jsonb).toMatchObject({ tier: "VIP", kind: "event" });
    expect(JSON.stringify(entry.meta_jsonb)).not.toContain("Doors open");
    const draft = (await h.app.ctx.repos.events.bySlug(h.seed.draftEventSlug))!;
    expect(errCode((await h.call("POST", `/events/${draft.id}/notifications`, { token: await org(), body })).body)).toBe("CONFLICT");
  });
});
