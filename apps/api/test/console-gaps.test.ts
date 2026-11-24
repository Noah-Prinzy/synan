/**
 * Gaps found by the admin console and the invitation page: operator profile, a lost band reaching
 * the desk live and by filter, the access log's filters and figures, gate activity and live gate
 * health, alert detail, the desk's one-registration read and inventory, clearing a draft's venue,
 * the event contact, and the invitation read and token-in-body reply.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@synan/contracts/enums";
import type { AlertDetail, BreachAlert, GateActivity, InvitationPreview, OperatorProfile, Registration, TokenPair } from "@synan/contracts/rest";
import { BAND_ERROR_COPY } from "@synan/contracts/errors";
import { hashPassword, newTotpSecret, totp } from "../src/lib/crypto.js";
import { nfcIdentifier } from "../src/domain/scan-service.js";
import { loggablePath } from "../src/app.js";
import { startGateHealthFeed } from "../src/realtime/gate-health-feed.js";
import { ChannelHub } from "../src/realtime/channel-hub.js";
import { addAttendee, band, devEmail, errCode, mfaCode, postScans, scan, startHarness, type Harness } from "./helpers.js";

let h: Harness;
let admin: string;
let adminMfa: string;
let organiser: string;
const people: Record<"supervisor" | "clerk", { id: string; email: string; secret: string; token: string }> = {} as never;

async function makeUser(role: Role, displayName: string | null = null) {
  const id = randomUUID();
  const email = devEmail(`${role}-${id.slice(0, 6)}`);
  const secret = newTotpSecret();
  await h.app.ctx.repos.users.insert({ id, email, password_hash: await hashPassword(h.seed.password, 12), role, mfa_enrolled_at: new Date(h.clock.now()), mfa_secret: secret, display_name: displayName });
  return { id, email, secret, token: (await h.login(email)).access_token };
}
const stepUp = async (u: { token: string; secret: string }) =>
  (await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: u.token, body: { code: totp(u.secret, h.clock.now()) } })).body.access_token;
async function signIn(email: string) {
  await h.call("POST", "/auth/email-link", { body: { email } });
  const token = /#token=([A-Za-z0-9_-]+)/.exec(h.mailer.last("auth.link")!.text)![1]!;
  return (await h.call<TokenPair>("POST", "/auth/verify", { body: { token } })).body.access_token;
}
async function stockBand() {
  const uid = randomBytes(7).toString("hex").toUpperCase();
  await h.app.ctx.repos.carriers.insert({ id: randomUUID(), credential_id: null, kind: "nfc", identifier: nfcIdentifier(uid), chip_profile: "ntag_uid", state: "stock", bound_at: null, redeemed_at: null });
  return uid;
}

beforeAll(async () => {
  h = await startHarness();
  admin = (await h.login(h.seed.emails.admin)).access_token;
  adminMfa = (await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: admin, body: { code: mfaCode(h) } })).body.access_token;
  organiser = (await h.login(h.seed.emails.organiser)).access_token;
  people.supervisor = await makeUser("supervisor", "Sam Supervisor");
  people.clerk = await makeUser("desk_clerk");
  const t = h.clock.now();
  const a = await h.call("POST", "/staff-assignments", { token: admin, body: {
    user_id: people.clerk.id, checkpoint_id: h.seed.checkpoints.mainIn, event_id: h.seed.eventId,
    shift_start: new Date(t - 3_600_000).toISOString(), shift_end: new Date(t + 6 * 3_600_000).toISOString(),
  } });
  expect(a.status).toBe(201);
});
afterAll(async () => h.close());

describe("1 · GET /me/operator", () => {
  it("carries the display name, and a shift label only when there is a shift", async () => {
    const sup = await h.call<OperatorProfile>("GET", "/me/operator", { token: people.supervisor.token });
    expect(sup.body).toMatchObject({ display_name: "Sam Supervisor", shift_label: null, current_shift: null });
    const clerk = await h.call<OperatorProfile>("GET", "/me/operator", { token: people.clerk.token });
    expect(clerk.body.display_name).toBeNull();
    expect(clerk.body.shift_label).toBe(`Main Entrance · ${(await h.app.ctx.repos.events.byId(h.seed.eventId))!.title}`);
  });
});

describe("2 · a lost band reaches the desk", () => {
  it("raises a low alert for supervisors, flags the row for the clerk, and the desk replaces it idempotently", async () => {
    const p = await addAttendee(h, "ORDINARY");
    const email = (await h.app.ctx.repos.attendees.byId(p.id))!.email!;
    const me = await signIn(email);
    const r = await h.call<{ marked_lost: boolean }>("POST", "/me/credential/report-lost", { token: me, body: { event_id: h.seed.eventId } });
    expect(r.body.marked_lost).toBe(true);

    const alerts = await h.call<{ items: BreachAlert[] }>("GET", `/breach-alerts?event_id=${h.seed.eventId}`, { token: people.supervisor.token });
    const alert = alerts.body.items.find((x) => x.kind === "band_reported_lost" && x.credential_id === p.credentialId)!;
    expect(alert).toMatchObject({ severity: "low", checkpoint_id: null, state: "open" });
    expect(alert.detail).not.toContain("Test");
    // Gate staff do not see it (it names no gate).
    const gate = await h.gateToken(h.seed.checkpoints.mainIn);
    expect((await h.call<{ items: BreachAlert[] }>("GET", "/breach-alerts", { token: gate })).body.items.some((x) => x.id === alert.id)).toBe(false);

    // The clerk's queue: band_lost=true, with the lost band's id to replace.
    const q = await h.call<{ items: { id: string; band_lost: boolean; carrier_id: string | null }[] }>("GET", `/events/${h.seed.eventId}/registrations?band_lost=true`, { token: people.clerk.token });
    const row = q.body.items.find((i) => i.id === p.registrationId)!;
    expect(row.band_lost).toBe(true);
    expect(q.body.items.every((i) => i.band_lost)).toBe(true);
    expect((await h.call<{ items: { id: string }[] }>("GET", `/events/${h.seed.eventId}/registrations?band_lost=false&limit=200`, { token: people.clerk.token })).body.items.some((i) => i.id === p.registrationId)).toBe(false);

    const clerk = await stepUp(people.clerk);
    const fresh = await stockBand();
    const body = { identifier: fresh, reason: "lost at the bar", disposition: "lost" };
    const first = await h.call<{ id: string; state: string; credential_id: string }>("POST", `/carriers/${row.carrier_id}/rebind`, { token: clerk, body });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ state: "bound", credential_id: p.credentialId }); // the pass is kept
    const again = await h.call<{ id: string }>("POST", `/carriers/${row.carrier_id}/rebind`, { token: clerk, body });
    expect(again.body.id).toBe(first.body.id);
    const other = await stockBand();
    expect(errCode((await h.call("POST", `/carriers/${row.carrier_id}/rebind`, { token: clerk, body: { ...body, identifier: other } })).body)).toBe("CONFLICT");

    // Recent band actions and the clerk's own shift counts on the inventory.
    const inv = await h.call<{ recent: { action: string; carrier_id: string; band_hint: string }[]; today: { bound: number; replaced: number; resent: number; since: string } }>("GET", `/credentials/inventory?event_id=${h.seed.eventId}`, { token: people.clerk.token });
    expect(inv.body.recent[0]).toMatchObject({ action: "bound", carrier_id: first.body.id });
    expect(inv.body.recent.some((x) => x.action === "reported_lost" && x.carrier_id === row.carrier_id)).toBe(true);
    expect(JSON.stringify(inv.body.recent)).not.toContain("Test");
    expect(inv.body.today).toMatchObject({ bound: 0, replaced: 1, resent: 0 });
    const plain = await stockBand();
    const q2 = await addAttendee(h, "ORDINARY");
    for (const c of await h.app.ctx.repos.carriers.forCredential(q2.credentialId)) if (c.kind === "nfc") await h.app.ctx.repos.carriers.update(c.id, { state: "retired" });
    expect((await h.call("POST", "/carriers/bind", { token: people.clerk.token, body: { registration_id: q2.registrationId, identifier: plain } })).status).toBe(200);
    const inv2 = await h.call<{ today: { bound: number; replaced: number } }>("GET", `/credentials/inventory?event_id=${h.seed.eventId}`, { token: people.clerk.token });
    expect(inv2.body.today).toMatchObject({ bound: 1, replaced: 1 });
    expect((await h.call<{ today: unknown }>("GET", `/credentials/inventory?event_id=${h.seed.eventId}`, { token: admin })).body.today).toBeNull();

    // The bind error is copy written for people.
    const unknown = await h.call<{ error: { issues: { message: string }[] } }>("POST", "/carriers/bind", { token: people.clerk.token, body: { registration_id: q2.registrationId, identifier: "ABCDEF0123456789" } });
    expect(unknown.body.error.issues[0]!.message).toBe(BAND_ERROR_COPY.unknown_band.message);
  });
});

describe("3 · GET /scans", () => {
  it("filters several gates, counts, gives the oldest time and corrected times; a pass search is audited and for operators", async () => {
    const p = await addAttendee(h, "VIP");
    const skew = 90_000;
    await postScans(h, [scan(h, h.seed.checkpoints.mainIn, band(p.uid), { clock_offset_ms: skew })]);
    await postScans(h, [scan(h, h.seed.checkpoints.vip, band(p.uid))]);
    const two = `${h.seed.checkpoints.mainIn},${h.seed.checkpoints.vip}`;
    const r = await h.call<{ items: { checkpoint_id: string; occurred_at: string; corrected_at: string; clock_offset_ms: number; ephemeral_id: string | null }[]; total: number; total_exact: boolean; oldest_at: string }>(
      "GET", `/scans?event_id=${h.seed.eventId}&checkpoint_ids=${two}`, { token: people.supervisor.token });
    expect(r.status).toBe(200);
    expect(r.body.items.every((s) => [h.seed.checkpoints.mainIn, h.seed.checkpoints.vip].includes(s.checkpoint_id))).toBe(true);
    expect(r.body.total).toBe(r.body.items.length);
    expect(r.body.total_exact).toBe(true);
    expect(r.body.oldest_at).toEqual(expect.any(String));
    const atGate = r.body.items.find((s) => s.checkpoint_id === h.seed.checkpoints.mainIn)!;
    // The server applies the offset it measured; corrected = occurred + that offset.
    for (const s of r.body.items) expect(Date.parse(s.corrected_at) - Date.parse(s.occurred_at)).toBe(s.clock_offset_ms);
    expect(atGate).toBeDefined();

    expect(errCode((await h.call("GET", `/scans?event_id=${h.seed.eventId}&q=${p.credentialId}`, { token: people.supervisor.token })).body)).toBe("FORBIDDEN");
    const before = (await h.app.ctx.repos.audit.all()).filter((a) => a.action === "credential.access_history").length;
    const hintText = (await h.app.ctx.repos.carriers.forCredential(p.credentialId)).find((c) => c.kind === "nfc")!.identifier!.slice(-4);
    for (const q of [p.credentialId, p.uid, hintText]) {
      const s = await h.call<{ items: { ephemeral_id: string | null }[]; total: number }>("GET", `/scans?event_id=${h.seed.eventId}&q=${encodeURIComponent(q)}`, { token: organiser });
      expect(s.status).toBe(200);
      expect(s.body.total).toBe(2);
      expect(s.body.items.every((i) => i.ephemeral_id === null)).toBe(true);
    }
    expect((await h.app.ctx.repos.audit.all()).filter((a) => a.action === "credential.access_history").length).toBe(before + 3);
    const none = await h.call<{ items: unknown[]; total: number }>("GET", `/scans?event_id=${h.seed.eventId}&q=Vera%20Ip`, { token: organiser });
    expect(none.body).toMatchObject({ items: [], total: 0 });
  });
});

describe("4 · gate pages", () => {
  it("GET /checkpoints/:id/activity: per-minute series from the rollups, zero-filled", async () => {
    const p = await addAttendee(h, "ORDINARY");
    await postScans(h, [scan(h, h.seed.checkpoints.eastIn, band(p.uid))]);
    const r = await h.call<GateActivity>("GET", `/checkpoints/${h.seed.checkpoints.eastIn}/activity?event_id=${h.seed.eventId}&minutes=5`, { token: people.supervisor.token });
    expect(r.status).toBe(200);
    expect(r.body.minutes).toHaveLength(5);
    expect(r.body.minutes.reduce((s, m) => s + m.scans, 0)).toBeGreaterThanOrEqual(1);
    expect(r.body.by_result.admitted).toBeGreaterThanOrEqual(1);
    expect((await h.call("GET", `/checkpoints/${h.seed.checkpoints.eastIn}/activity?event_id=${h.seed.eventId}`, { token: people.clerk.token })).status).toBe(403);
  });

  it("gate.health frames are published on change while someone follows the alerts", async () => {
    const hub = new ChannelHub<{ event_id: string; checkpoint_id?: string | null }>(h.clock);
    const feed = startGateHealthFeed(h.app.ctx, hub, 3_600_000);
    const got: { type: string; data: { checkpoint_id: string } }[] = [];
    await feed.tick(); // nobody follows: nothing read or sent
    const sub = hub.subscribe(() => null, () => undefined);
    hub.subscribe((e) => ({ id: e.id, type: e.type, at: e.at, data: e.data }), (m) => got.push(m as never));
    await feed.tick();
    const gates = (await h.app.ctx.gates.health((await h.app.ctx.repos.events.byId(h.seed.eventId))!)).length;
    expect(got.filter((m) => m.type === "gate.health").length).toBeGreaterThanOrEqual(gates);
    const n = got.length;
    await feed.tick();
    expect(got.length).toBe(n); // unchanged: nothing new
    sub.unsubscribe();
    feed.stop();
  });
});

describe("5 · GET /alerts/:id", () => {
  it("the detail sheet: alert, gate, room, scans by id, credential without identity, history", async () => {
    const p = await addAttendee(h, "PUBLIC");
    const res = await postScans<{ results: { alert_ids: string[] }[] }>(h, [scan(h, h.seed.checkpoints.vip, band(p.uid))]);
    const alertId = res.body.results[0]!.alert_ids[0]!;
    expect((await h.call("POST", `/alerts/${alertId}/ack`, { token: people.supervisor.token })).status).toBe(200);
    expect((await h.call("POST", `/alerts/${alertId}/resolve`, { token: organiser, body: { note: "Escorted out" } })).status).toBe(200);
    const d = await h.call<AlertDetail>("GET", `/alerts/${alertId}`, { token: people.supervisor.token });
    expect(d.status).toBe(200);
    expect(d.body.alert.kind).toBe("unauthorised_tier");
    expect(d.body.checkpoint).toMatchObject({ id: h.seed.checkpoints.vip, label: "VIP Lounge Door" });
    expect(d.body.room).toMatchObject({ id: h.seed.rooms.vip, name: "VIP Lounge" });
    expect(d.body.scans).toHaveLength(1);
    expect(d.body.scans[0]).toMatchObject({ checkpoint_label: "VIP Lounge Door", ephemeral_id: null });
    expect(d.body.credential).toMatchObject({ id: p.credentialId, tier: "PUBLIC", registration_id: p.registrationId });
    expect(d.body.history.map((x) => [x.action, x.actor_name])).toEqual([["acked", "Sam Supervisor"], ["resolved", h.seed.emails.organiser]]);
    expect(d.body.history[1]!.note).toBe("Escorted out");
    expect(JSON.stringify(d.body)).not.toContain("full_name");
    expect((await h.call("GET", `/alerts/${randomUUID()}`, { token: admin })).status).toBe(404);
  });
});

describe("6 · GET /registrations/:id", () => {
  it("one row as in the list; a clerk only within their desk events; pass_sent_at set", async () => {
    await h.app.ctx.credentials.sendEmailedQr(h.seed.attendees.vip.credentialId);
    const r =await h.call<{ id: string; attendee: { full_name: string }; pass_sent_at: string | null; carrier_id: string | null; checked_in_at?: string | null }>(
      "GET", `/registrations/${h.seed.attendees.vip.registrationId}`, { token: people.clerk.token });
    expect(r.status).toBe(200);
    expect(r.body.attendee.full_name).toBe("Vera Ip");
    expect(r.body.pass_sent_at).toEqual(expect.any(String));
    expect(r.body.carrier_id).toEqual(expect.any(String));
    expect("checked_in_at" in r.body).toBe(false);
    const list = await h.call<{ items: { id: string; pass_sent_at: string | null; carrier_id: string | null }[] }>("GET", `/events/${h.seed.eventId}/registrations?q=vera`, { token: organiser });
    expect(list.body.items[0]).toMatchObject({ id: r.body.id, pass_sent_at: r.body.pass_sent_at, carrier_id: r.body.carrier_id });
    const other = (await h.app.ctx.repos.registrations.forEvent(h.seed.privateEventId))[0]!;
    expect((await h.call("GET", `/registrations/${other.id}`, { token: people.clerk.token })).status).toBe(404);
    expect((await h.call("GET", `/registrations/${other.id}`, { token: organiser })).status).toBe(200);
  });
});

describe("7 · drafts", () => {
  it("venue_id null clears a draft's venue; the event contact is stored and shown", async () => {
    const created = await h.call<{ id: string; venue: unknown }>("POST", "/events", { token: organiser, body: {
      slug: `draft-${randomUUID().slice(0, 8)}`, title: "Draft", timezone: "Africa/Kampala", venue_id: h.seed.venueId,
      rooms: [{ room_id: h.seed.rooms.auditorium }], contact: { name: "Partnerships", email: "partners@example.com" },
    } });
    expect(created.status).toBe(201);
    const cleared = await h.call<{ venue: unknown; rooms: unknown[]; contact: unknown }>("PATCH", `/events/${created.body.id}`, { token: organiser, body: { venue_id: null } });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ venue: null, rooms: [], contact: { name: "Partnerships", email: "partners@example.com" } });
    const noContact = await h.call<{ contact: unknown }>("PATCH", `/events/${created.body.id}`, { token: organiser, body: { contact: null } });
    expect(noContact.body.contact).toBeNull();
    expect(errCode((await h.call("PATCH", `/events/${h.seed.eventId}`, { token: organiser, body: { venue_id: null } })).body)).toBe("CONFLICT");
  });
});

describe("9 · invitations", () => {
  const tokenFor = (to: string) => /#token=([A-Za-z0-9_-]+)/.exec([...h.mailer.outbox].reverse().find((m) => m.tag === "invitation" && m.to === to)!.text)![1]!;
  const invite = async (to: string) => {
    expect((await h.call("POST", "/invitations", { token: organiser, body: { event_id: h.seed.privateEventId, emails: [to] } })).status).toBe(201);
    return tokenFor(to);
  };

  it("reads an open invitation without any address; spent and unknown links answer LINK_INVALID", async () => {
    await h.call("PATCH", `/events/${h.seed.privateEventId}`, { token: organiser, body: {
      contact: { name: "Roundtable desk", email: "roundtable@example.com" },
      profile_schema: [{ key: "company", label: "Company", type: "text", required: false }],
    } });
    const guest = devEmail(`read-${randomUUID().slice(0, 6)}`);
    const token = await invite(guest);
    const r = await h.call<InvitationPreview>("POST", "/invitations/read", { body: { token } });
    expect(r.status).toBe(200);
    expect(r.body.event).toMatchObject({ id: h.seed.privateEventId, title: "Private Roundtable", venue_name: "Harbour Hall" });
    expect(r.body).toMatchObject({ host: "Roundtable desk", contact: { name: "Roundtable desk", email: "roundtable@example.com" } });
    expect(r.body.fields.map((f) => f.key)).toEqual(["company"]);
    expect(JSON.stringify(r.body)).not.toContain(guest);
    expect(errCode((await h.call("POST", "/invitations/read", { body: { token: "x".repeat(43) } })).body)).toBe("LINK_INVALID");
    // Declining needs no name, with the token in the body; the link is then spent.
    const no = await h.call<{ registration: null }>("POST", "/invitations/rsvp", { body: { token, email: guest, accept: false, zone_presence_consent: false } });
    expect(no.status).toBe(200);
    expect(errCode((await h.call("POST", "/invitations/read", { body: { token } })).body)).toBe("LINK_INVALID");
  });

  it("accepting needs a name, and the name becomes the attendee's (also for a known address)", async () => {
    const guest = devEmail(`named-${randomUUID().slice(0, 6)}`);
    const id = randomUUID();
    await h.app.ctx.repos.attendees.insert({ id, user_id: null, email: guest, full_name: null, profile_jsonb: {} });
    const token = await invite(guest);
    const body = { token, email: guest, accept: true, zone_presence_consent: true };
    expect(errCode((await h.call("POST", "/invitations/rsvp", { body })).body)).toBe("VALIDATION_FAILED");
    const ok = await h.call<{ registration: Registration }>("POST", "/invitations/rsvp", { body: { ...body, full_name: "Grace Guest", profile: { company: "Acme" } } });
    expect(ok.status).toBe(200);
    expect(ok.body.registration.tier).toBe("PRIVATE_INVITE");
    const person = (await h.app.ctx.repos.attendees.byId(id))!;
    expect(person.full_name).toBe("Grace Guest");
    expect(person.profile_jsonb).toMatchObject({ company: "Acme" });
    // The deprecated path still answers; the path token never reaches a log line.
    const t2 = await invite(devEmail(`path-${randomUUID().slice(0, 6)}`));
    expect((await h.call("POST", `/invitations/${t2}/rsvp`, { body: { email: devEmail("nobody"), accept: false, zone_presence_consent: false } })).status).toBe(400);
    expect(loggablePath(`/api/v1/invitations/${t2}/rsvp`)).toBe("/api/v1/invitations/:token/rsvp");
  });
});
