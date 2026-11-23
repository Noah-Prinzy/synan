/** Slice 3: registration and the four tier flows. Runs on both backends (`test` and `test:pg`). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { InvitationRow, KioskRegistration, Registration, RegistrationRow, TokenPair } from "@synan/contracts/rest";
import type { z } from "zod";
import { band, devEmail, errCode, mfaCode, postScans, scan, startHarness, type Harness } from "./helpers.js";

let h: Harness;
let admin: string;
let adminMfa: string;
let organiser: string;
beforeAll(async () => {
  h = await startHarness();
  admin = (await h.login(h.seed.emails.admin)).access_token;
  adminMfa = (await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: admin, body: { code: mfaCode(h) } })).body.access_token;
  organiser = (await h.login(h.seed.emails.organiser)).access_token;
});
afterAll(async () => h.close());

/** Redeems the newest sign-in link sent to `email`. */
async function signIn(email: string): Promise<string> {
  const mail = [...h.mailer.outbox].reverse().find((m) => m.tag === "auth.link" && m.to === email);
  if (!mail) throw new Error(`no link for ${email}`);
  const token = /#token=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
  const r = await h.call<TokenPair>("POST", "/auth/verify", { body: { token } });
  expect(r.status).toBe(200);
  return r.body.access_token;
}
const auditOf = async (action: string) => (await h.app.ctx.repos.audit.all()).filter((a) => a.action === action);

describe("slice 3 · Ordinary self-registration with email verification", () => {
  const email = devEmail("newcomer");
  let token: string;
  let reg: Registration;

  it("register answers 202 and sends a sign-in link; no registration exists until the address is proved", async () => {
    const r = await h.call("POST", "/users/register", {
      body: { email, full_name: "New Comer", event_slug: h.seed.publishedEventSlug, profile: {}, zone_presence_consent: false },
    });
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ accepted: true, verification_sent: true });
    const att = await h.app.ctx.repos.attendees.byEmail(email);
    expect(att?.full_name).toBe("New Comer");
    expect(await h.app.ctx.repos.registrations.forAttendee(att!.id)).toHaveLength(0);
    token = await signIn(email);
  });

  it("an unlisted, draft or unknown event answers 404, exactly like a missing slug", async () => {
    for (const slug of [h.seed.privateEventSlug, h.seed.draftEventSlug, "no-such-event"]) {
      const r = await h.call("POST", "/users/register", { body: { email, full_name: "X", event_slug: slug, profile: {}, zone_presence_consent: false } });
      expect(r.status).toBe(404);
    }
  });

  it("a known address is never overwritten by an unauthenticated register call", async () => {
    await h.call("POST", "/users/register", { body: { email, full_name: "Impostor", event_slug: h.seed.publishedEventSlug, profile: {}, zone_presence_consent: true } });
    expect((await h.app.ctx.repos.attendees.byEmail(email))?.full_name).toBe("New Comer");
  });

  it("the verified attendee registers: Ordinary, confirmed, consent recorded separately, credential issued, pass sent", async () => {
    const before = h.mailer.outbox.length;
    const r = await h.call<Registration>("POST", "/registrations", { token, body: { event_id: h.seed.publishedEventId, zone_presence_consent: false } });
    expect(r.status).toBe(201);
    reg = r.body;
    expect(reg.tier).toBe("ORDINARY");
    expect(reg.state).toBe("confirmed");
    expect(reg.zone_presence_consent_at).toBeNull(); // unticked by default
    expect(await h.app.ctx.repos.credentials.forRegistration(reg.id)).not.toBeNull();
    expect(h.mailer.outbox.slice(before).some((m) => m.tag === "pass.email_qr" && m.to === email)).toBe(true);
    const mine = await h.call<{ registration: { tier: string } }>("GET", `/me/registration?event_id=${h.seed.publishedEventId}`, { token });
    expect(mine.body.registration.tier).toBe("ORDINARY");
  });

  it("refuses a second registration, a client-stated tier, and an unlisted event", async () => {
    expect(errCode((await h.call("POST", "/registrations", { token, body: { event_id: h.seed.publishedEventId, zone_presence_consent: true } })).body)).toBe("CONFLICT");
    expect((await h.call("POST", "/registrations", { token, body: { event_id: h.seed.eventId, zone_presence_consent: true, tier: "VIP" } })).status).toBe(400);
    expect((await h.call("POST", "/registrations", { token, body: { event_id: h.seed.privateEventId, zone_presence_consent: true } })).status).toBe(404);
  });

  it("VIP is granted only through the tier endpoint: MFA required, audited, epoch advanced", async () => {
    const path = `/registrations/${reg.id}/tier`;
    const body = { tier: "VIP", reason: "sponsor guest" };
    expect((await h.call("PATCH", path, { token, body })).status).toBe(403); // attendee
    expect(errCode((await h.call("PATCH", path, { token: organiser, body })).body)).toBe("MFA_REQUIRED");
    const epoch = (await h.app.ctx.repos.events.byId(h.seed.publishedEventId))!.revocation_epoch;
    const r = await h.call<Registration>("PATCH", path, { token: adminMfa, body });
    expect(r.status).toBe(200);
    expect(r.body.tier).toBe("VIP");
    expect((await h.app.ctx.repos.events.byId(h.seed.publishedEventId))!.revocation_epoch).toBeGreaterThan(epoch);
    const a = (await auditOf("registration.tier_change")).at(-1)!;
    expect(a.target).toBe(`registration:${reg.id}`);
    expect(a.meta_jsonb).toMatchObject({ from: "ORDINARY", to: "VIP" });
  });

  it("operators list an event's registrations with identity; attendees cannot", async () => {
    expect((await h.call("GET", `/events/${h.seed.publishedEventId}/registrations`, { token })).status).toBe(403);
    const r = await h.call<{ items: z.infer<typeof RegistrationRow>[] }>("GET", `/events/${h.seed.publishedEventId}/registrations?tier=VIP`, { token: organiser });
    expect(r.status).toBe(200);
    expect(r.body.items.map((i) => i.attendee.email)).toContain(email);
    const att = await h.call<{ items: { email: string | null; registrations: number }[] }>("GET", `/attendees?q=newcomer`, { token: organiser });
    expect(att.body.items).toHaveLength(1);
    expect(att.body.items[0]!.registrations).toBe(1);
  });

  it("an attendee edits only their own profile", async () => {
    const me = (await h.app.ctx.repos.attendees.byEmail(email))!;
    expect((await h.call("PATCH", `/users/${me.id}/profile`, { token, body: { full_name: "New Name" } })).status).toBe(200);
    expect((await h.app.ctx.repos.attendees.byId(me.id))!.full_name).toBe("New Name");
    expect((await h.call("PATCH", `/users/${h.seed.attendees.vip.id}/profile`, { token, body: { full_name: "Hijack" } })).status).toBe(404);
    expect((await h.call("PATCH", `/users/${h.seed.attendees.vip.id}/profile`, { token: organiser, body: { full_name: "Vera Ip" } })).status).toBe(200);
    expect((await auditOf("attendee.profile_update")).length).toBeGreaterThan(0);
  });
});

describe("slice 3 · Private Invitation", () => {
  const guest = devEmail("guest.invite");
  const other = devEmail("guest.other");
  const tokenFor = (to: string) => /#token=([A-Za-z0-9_-]+)/.exec([...h.mailer.outbox].reverse().find((m) => m.tag === "invitation" && m.to === to)!.text)![1]!;

  it("operators invite; a repeated or already-invited address is a per-item rejection, never fatal; no address is audited", async () => {
    const r = await h.call<{ items: z.infer<typeof InvitationRow>[]; rejected: { index: number; code: string }[] }>("POST", "/invitations", {
      token: organiser, body: { event_id: h.seed.privateEventId, emails: [guest, other, guest] },
    });
    expect(r.status).toBe(201);
    expect(r.body.items).toHaveLength(2);
    expect(r.body.rejected).toEqual([expect.objectContaining({ index: 2, code: "CONFLICT" })]);
    const again = await h.call<{ items: unknown[]; rejected: { index: number }[] }>("POST", "/invitations", { token: organiser, body: { event_id: h.seed.privateEventId, emails: [guest] } });
    expect(again.body.items).toHaveLength(0);
    expect(again.body.rejected[0]!.index).toBe(0);
    const a = (await auditOf("invitation.create")).at(-1)!;
    expect(JSON.stringify(a.meta_jsonb)).not.toContain("guest");
    expect((await h.call("POST", "/invitations", { body: { event_id: h.seed.privateEventId, emails: [guest] } })).status).toBe(401);
  });

  it("the link is bound to the invited address: a forwarded link with another address is refused", async () => {
    const r = await h.call("POST", `/invitations/${tokenFor(guest)}/rsvp`, { body: { email: other, accept: true, full_name: "Fwd", zone_presence_consent: false } });
    expect(errCode(r.body)).toBe("LINK_INVALID");
  });

  it("RSVP redeems exactly once and yields a Private Invitation registration with a pass", async () => {
    const t = tokenFor(guest);
    const body = { email: guest, accept: true, full_name: "Gail Guest", zone_presence_consent: true };
    const r = await h.call<{ registration: Registration }>("POST", `/invitations/${t}/rsvp`, { body });
    expect(r.status).toBe(200);
    expect(r.body.registration.tier).toBe("PRIVATE_INVITE");
    expect(r.body.registration.event_id).toBe(h.seed.privateEventId);
    expect(h.mailer.last("pass.email_qr")?.to).toBe(guest);
    expect(errCode((await h.call("POST", `/invitations/${t}/rsvp`, { body })).body)).toBe("LINK_INVALID");
    // The unlisted event is now visible to its invited guest only.
    await h.call("POST", "/auth/email-link", { body: { email: guest } });
    const gt = await signIn(guest);
    expect((await h.call("GET", `/events/${h.seed.privateEventSlug}`, { token: gt })).status).toBe(200);
    expect((await h.call("GET", `/events/${h.seed.privateEventSlug}`)).status).toBe(404);
  });

  it("declining spends the link too", async () => {
    const t = tokenFor(other);
    const r = await h.call<{ registration: null }>("POST", `/invitations/${t}/rsvp`, { body: { email: other, accept: false, full_name: "No", zone_presence_consent: false } });
    expect(r.body.registration).toBeNull();
    expect(errCode((await h.call("POST", `/invitations/${t}/rsvp`, { body: { email: other, accept: true, full_name: "Yes", zone_presence_consent: false } })).body)).toBe("LINK_INVALID");
  });

  it("an expired link answers LINK_EXPIRED", async () => {
    const mail = devEmail("guest.late");
    await h.call("POST", "/invitations", { token: organiser, body: { event_id: h.seed.privateEventId, emails: [mail], expires_at: new Date(h.clock.now() + 60_000).toISOString() } });
    h.clock.advance(120_000);
    expect(errCode((await h.call("POST", `/invitations/${tokenFor(mail)}/rsvp`, { body: { email: mail, accept: true, full_name: "Late", zone_presence_consent: false } })).body)).toBe("LINK_EXPIRED");
  });
});

describe("slice 3 · Public tier at a kiosk", () => {
  it("a perimeter gate user registers an anonymous attendee, prints a single-use code and binds a stock band that then opens the expo", async () => {
    const gate = await h.gateToken(h.seed.checkpoints.mainIn);
    const r = await h.call<KioskRegistration>("POST", "/kiosk/registrations", {
      token: gate, body: { event_id: h.seed.eventId, zone_presence_consent: false, band_uid: h.seed.stockUid },
    });
    expect(r.status).toBe(201);
    expect(r.body.registration.tier).toBe("PUBLIC");
    expect(r.body.pass_code).toHaveLength(144);
    expect(r.body.carrier?.state).toBe("bound");
    const att = (await h.app.ctx.repos.registrations.byId(r.body.registration.id))!;
    const person = (await h.app.ctx.repos.attendees.byId(att.attendee_id))!;
    expect(person.email).toBeNull();
    expect(person.full_name).toBeNull();
    expect((await auditOf("carrier.bind")).length).toBeGreaterThan(0);
    const s = await postScans<{ results: { result: string }[] }>(h, [scan(h, h.seed.checkpoints.expo, band(h.seed.stockUid))]);
    expect(s.body.results[0]!.result).toBe("admitted");
  });

  it("an interior gate user, an attendee, and a band not in stock are refused", async () => {
    const interior = await h.gateToken(h.seed.checkpoints.auditorium);
    expect(errCode((await h.call("POST", "/kiosk/registrations", { token: interior, body: { event_id: h.seed.eventId, zone_presence_consent: false } })).body)).toBe("CHECKPOINT_NOT_ASSIGNED");
    const organiserR = await h.call("POST", "/kiosk/registrations", { token: organiser, body: { event_id: h.seed.eventId, zone_presence_consent: false, band_uid: h.seed.attendees.vip.uid } });
    expect(errCode(organiserR.body)).toBe("VALIDATION_FAILED");
  });
});
