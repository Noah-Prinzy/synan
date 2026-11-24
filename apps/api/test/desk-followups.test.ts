/**
 * Desk and console follow-ups: a band hint people can match to the band in hand (the UID's last four),
 * found by the log and desk searches; a lost-band replacement reads `replaced` in the inventory; a
 * supervisor's read of who is on shift at a gate; the events staff may work (unlisted ones included);
 * kiosk walk-ins found at the desk by pass or band. Runs on both backends (REPO=pglite for SQL).
 */
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@synan/contracts/enums";
import type { KioskRegistration, StaffAssignment, TokenPair } from "@synan/contracts/rest";
import { hashPassword } from "../src/lib/crypto.js";
import { nfcIdentifier } from "../src/domain/scan-service.js";
import { band, devEmail, errCode, mfaCode, postScans, scan, startHarness, type Harness } from "./helpers.js";

let h: Harness;
let organiser: string;
const H = 3_600_000;
beforeAll(async () => {
  h = await startHarness();
  organiser = (await h.login(h.seed.emails.organiser)).access_token;
});
afterAll(async () => h.close());

async function makeUser(role: Role, displayName: string | null = null) {
  const id = randomUUID();
  const email = devEmail(`${role}-${id.slice(0, 6)}`);
  await h.app.ctx.repos.users.insert({ id, email, password_hash: await hashPassword(h.seed.password, 12), role, mfa_enrolled_at: null, mfa_secret: null, display_name: displayName });
  return { id, email, token: async () => (await h.login(email)).access_token };
}
/** A fresh UID ending in `last4`. */
const uidEnding = (last4: string) => `04${randomBytes(5).toString("hex").toUpperCase()}${last4}`;
async function importBand(uid: string) {
  const r = await h.call<{ imported: number }>("POST", "/carriers/import", { token: organiser, body: { chip_profile: "ntag_uid", identifiers: [uid] } });
  expect(r.body.imported).toBe(1);
}
/** A kiosk walk-in (Public tier: no name, no email) with a band bound at the desk. */
async function walkIn(uid: string) {
  const gate = await h.gateToken(h.seed.checkpoints.mainIn);
  const r = await h.call<KioskRegistration>("POST", "/kiosk/registrations", { token: gate, body: { event_id: h.seed.eventId, zone_presence_consent: false, band_uid: uid } });
  expect(r.status).toBe(201);
  return r.body;
}

describe("5 · the band hint is the UID's last four", () => {
  it("imported then bound at the kiosk: ••••81BF, in upper case, never the full UID", async () => {
    const uid = uidEnding("81BF");
    await importBand(uid.toLowerCase());
    const k = await walkIn(uid);
    expect(k.carrier!.identifier_hint).toBe("••••81BF");
    expect(JSON.stringify(k)).not.toContain(uid);
    const stored = (await h.app.ctx.repos.carriers.byIdentifier("nfc", nfcIdentifier(uid)))!;
    expect(stored.identifier_hint).toBe("81BF");
    expect(JSON.stringify(stored)).not.toContain(uid);
    // The registration list, the pass list and the inventory all show the same hint.
    const rows = await h.call<{ items: { id: string; band_hint: string | null }[] }>("GET", `/events/${h.seed.eventId}/registrations?limit=500`, { token: organiser });
    expect(rows.body.items.find((r) => r.id === k.registration.id)!.band_hint).toBe("••••81BF");
    expect(JSON.stringify(rows.body)).not.toContain(uid);
  });

  it("a band imported as a bare hash reads `band` until its UID is first presented at a gate", async () => {
    const uid = uidEnding("C0DE");
    const id = randomUUID();
    const registrationId = randomUUID();
    await h.app.ctx.repos.attendees.insert({ id, user_id: null, email: devEmail(`t-${id}`), full_name: "Legacy", profile_jsonb: {} });
    await h.app.ctx.repos.fixtures.registration({ id: registrationId, event_id: h.seed.eventId, attendee_id: id, tier: "ORDINARY", state: "confirmed", zone_presence_consent_at: new Date(h.clock.now()), checked_in_at: null, created_at: new Date(h.clock.now()) });
    const cred = await h.app.ctx.credentials.issueForRegistration(registrationId);
    await h.app.ctx.repos.carriers.insert({ id: randomUUID(), credential_id: cred.id, kind: "nfc", identifier: nfcIdentifier(uid), chip_profile: "ntag_uid", state: "bound", bound_at: new Date(h.clock.now()), redeemed_at: null });
    const row = async () => (await h.call<{ items: { id: string; band_hint: string | null }[] }>("GET", `/events/${h.seed.eventId}/registrations?limit=500`, { token: organiser })).body.items.find((r) => r.id === registrationId)!;
    expect((await row()).band_hint).toBe("band");
    expect((await postScans<{ results: { result: string }[] }>(h, [scan(h, h.seed.checkpoints.mainIn, band(uid))])).body.results[0]!.result).toBe("admitted");
    expect((await row()).band_hint).toBe("••••C0DE");
    // The access-log search finds the pass by those four (any case, with or without the dots).
    for (const q of ["C0DE", "c0de", "••••C0DE"]) {
      const s = await h.call<{ items: { carrier_kind: string }[] }>("GET", `/scans?event_id=${h.seed.eventId}&q=${encodeURIComponent(q)}`, { token: organiser });
      expect(s.status).toBe(200);
      expect(s.body.items.length, q).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("6 · a lost-band replacement reads `replaced` in the inventory", () => {
  it("the new band's bind is `replaced`, the old band `lost`; nothing reads `bound`", async () => {
    const old = uidEnding("0A0A");
    await importBand(old);
    const k = await walkIn(old);
    const fresh = uidEnding("0B0B");
    await importBand(fresh);
    const admin = (await h.login(h.seed.emails.admin)).access_token;
    const stepped = (await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: admin, body: { code: mfaCode(h) } })).body.access_token;
    const r = await h.call<{ id: string }>("POST", `/carriers/${k.carrier!.id}/rebind`, { token: stepped, body: { identifier: fresh, reason: "lost in the hall", disposition: "lost" } });
    expect(r.status).toBe(200);
    const inv = await h.call<{ recent: { action: string; carrier_id: string; band_hint: string }[] }>("GET", `/credentials/inventory?event_id=${h.seed.eventId}`, { token: organiser });
    const mine = inv.body.recent.filter((x) => x.carrier_id === r.body.id || x.carrier_id === k.carrier!.id);
    expect(mine.find((x) => x.carrier_id === r.body.id)).toMatchObject({ action: "replaced", band_hint: "••••0B0B" });
    expect(mine.find((x) => x.carrier_id === k.carrier!.id)).toMatchObject({ action: "lost", band_hint: "••••0A0A" });
    expect(mine.some((x) => x.carrier_id === r.body.id && x.action === "bound")).toBe(false);
  });
});

describe("9 · the desk finds a kiosk walk-in by pass or band", () => {
  it("by the band hint's last four or the pass reference, for operators and the event's desk clerk", async () => {
    const uid = uidEnding("9E9E");
    await importBand(uid);
    const k = await walkIn(uid);
    const clerk = await makeUser("desk_clerk");
    await h.app.ctx.repos.fixtures.staffAssignment({ id: randomUUID(), user_id: clerk.id, checkpoint_id: h.seed.checkpoints.mainIn, shift_start: new Date(h.clock.now() - H), shift_end: new Date(h.clock.now() + 4 * H), event_id: h.seed.eventId });
    const ct = await clerk.token();
    const ref = (await h.app.ctx.repos.credentials.forRegistration(k.registration.id))!.token_hash;
    for (const [token, q] of [[organiser, "9E9E"], [organiser, "••••9e9e"], [ct, "9E9E"], [ct, ref], [organiser, uid]] as const) {
      const r = await h.call<{ items: { id: string; attendee: { full_name: string | null; email: string | null } }[] }>("GET", `/events/${h.seed.eventId}/registrations?q=${encodeURIComponent(q)}`, { token });
      expect(r.status, q).toBe(200);
      expect(r.body.items.map((x) => x.id), q).toEqual([k.registration.id]);
      expect(r.body.items[0]!.attendee).toMatchObject({ full_name: null, email: null });
    }
    // Names still work, and a hint that matches nothing finds nothing.
    expect((await h.call<{ items: unknown[] }>("GET", `/events/${h.seed.eventId}/registrations?q=orla`, { token: organiser })).body.items).toHaveLength(1);
    expect((await h.call<{ items: unknown[] }>("GET", `/events/${h.seed.eventId}/registrations?q=FFFF`, { token: organiser })).body.items).toHaveLength(0);
    // Outside the clerk's desk event: answered like a missing event.
    expect((await h.call("GET", `/events/${h.seed.publishedEventId}/registrations?q=9E9E`, { token: ct })).status).toBe(404);
  });
});

describe("7 · a supervisor reads who is on shift at a gate", () => {
  it("current and upcoming shifts for a checkpoint or event: gate, times and display name only", async () => {
    const sup = await makeUser("supervisor");
    const st = await sup.token();
    const cp = h.seed.checkpoints.boardroom;
    const now = h.clock.now();
    const named = await makeUser("security_staff", "Gina Gate");
    const unnamed = await makeUser("security_staff");
    const done = await makeUser("security_staff", "Done Dan");
    const ids: Record<"current" | "upcoming" | "past" | "handed", string> = { current: randomUUID(), upcoming: randomUUID(), past: randomUUID(), handed: randomUUID() };
    await h.app.ctx.repos.fixtures.staffAssignment({ id: ids.current, user_id: named.id, checkpoint_id: cp, shift_start: new Date(now - H), shift_end: new Date(now + H), event_id: h.seed.eventId });
    await h.app.ctx.repos.fixtures.staffAssignment({ id: ids.upcoming, user_id: unnamed.id, checkpoint_id: cp, shift_start: new Date(now + 2 * H), shift_end: new Date(now + 4 * H), event_id: null });
    await h.app.ctx.repos.fixtures.staffAssignment({ id: ids.past, user_id: done.id, checkpoint_id: cp, shift_start: new Date(now - 5 * H), shift_end: new Date(now - 3 * H), event_id: h.seed.eventId });
    await h.app.ctx.repos.fixtures.staffAssignment({ id: ids.handed, user_id: done.id, checkpoint_id: cp, shift_start: new Date(now - 2 * H), shift_end: new Date(now + 3 * H), event_id: h.seed.eventId, handed_over_at: new Date(now - 30 * 60_000) });

    const r = await h.call<{ items: StaffAssignment[] }>("GET", `/staff-assignments?checkpoint_id=${cp}&event_id=${h.seed.eventId}`, { token: st });
    expect(r.status).toBe(200);
    const mine = r.body.items.filter((a) => Object.values(ids).includes(a.id));
    expect(mine.map((a) => a.id)).toEqual([ids.current, ids.upcoming]);
    expect(mine[0]).toMatchObject({ checkpoint_id: cp, checkpoint_label: "Boardroom Door", staff_name: "Gina Gate" });
    expect("staff_name" in mine[1]!).toBe(false); // no display name: never the email instead
    expect(JSON.stringify(r.body)).not.toContain("@");
    for (const a of r.body.items) expect(Date.parse(a.shift_end)).toBeGreaterThan(now);
    // By event alone too; a filter is required; no create, no handover, no per-person listing.
    expect((await h.call<{ items: StaffAssignment[] }>("GET", `/staff-assignments?event_id=${h.seed.eventId}`, { token: st })).body.items.some((a) => a.id === ids.current)).toBe(true);
    expect(errCode((await h.call("GET", "/staff-assignments", { token: st })).body)).toBe("VALIDATION_FAILED");
    expect(errCode((await h.call("GET", `/staff-assignments?checkpoint_id=${cp}&user_id=${named.id}`, { token: st })).body)).toBe("VALIDATION_FAILED");
    expect((await h.call("POST", "/staff-assignments", { token: st, body: { user_id: named.id, checkpoint_id: cp, shift_start: new Date(now + 10 * H).toISOString(), shift_end: new Date(now + 11 * H).toISOString() } })).status).toBe(403);
    expect((await h.call("POST", `/staff-assignments/${ids.current}/handover`, { token: st })).status).toBe(403);
    // Operators keep the full list (past and handed-over shifts, names or emails).
    const all = await h.call<{ items: StaffAssignment[] }>("GET", `/staff-assignments?checkpoint_id=${cp}&limit=100`, { token: organiser });
    expect(all.body.items.map((a) => a.id)).toEqual(expect.arrayContaining(Object.values(ids)));
  });
});

describe("8 · the events staff may work, unlisted ones included", () => {
  it("supervisors: published and live events, listed or not; desk clerks: their desk events; never the public", async () => {
    await h.app.ctx.repos.events.update(h.seed.privateEventId, { state: "live" }); // an unlisted live event
    const ids = (b: { items: { id: string }[] }) => b.items.map((e) => e.id);

    const pub = await h.call<{ items: { id: string }[] }>("GET", "/events?limit=100");
    expect(ids(pub.body)).not.toContain(h.seed.privateEventId);
    expect((await h.call("GET", "/events?scope=work")).status).toBe(403);
    const att = await h.call<{ items: { id: string }[] }>("GET", "/events?limit=100", { token: (await h.login(h.seed.emails.gate)).access_token });
    expect(ids(att.body)).not.toContain(h.seed.privateEventId);

    const sup = await makeUser("supervisor");
    const s = await h.call<{ items: { id: string; state: string }[] }>("GET", "/events?scope=work&limit=100", { token: await sup.token() });
    expect(s.status).toBe(200);
    expect(ids(s.body)).toEqual(expect.arrayContaining([h.seed.eventId, h.seed.publishedEventId, h.seed.privateEventId]));
    expect(s.body.items.every((e) => e.state === "published" || e.state === "live")).toBe(true);
    const liveOnly = await h.call<{ items: { id: string; state: string }[] }>("GET", "/events?scope=work&state=live&limit=100", { token: await sup.token() });
    expect(ids(liveOnly.body)).toEqual(expect.arrayContaining([h.seed.eventId, h.seed.privateEventId]));
    expect(liveOnly.body.items.every((e) => e.state === "live")).toBe(true);

    const clerk = await makeUser("desk_clerk");
    await h.app.ctx.repos.fixtures.staffAssignment({ id: randomUUID(), user_id: clerk.id, checkpoint_id: h.seed.checkpoints.eastIn, shift_start: new Date(h.clock.now() - H), shift_end: new Date(h.clock.now() + H), event_id: h.seed.privateEventId });
    const c = await h.call<{ items: { id: string }[] }>("GET", "/events?scope=work", { token: await clerk.token() });
    expect(c.status).toBe(200);
    expect(ids(c.body)).toEqual([h.seed.privateEventId]);
    // Gate staff have no such list.
    expect((await h.call("GET", "/events?scope=work", { token: await h.gateToken(h.seed.checkpoints.mainIn) })).status).toBe(403);
  });
});
