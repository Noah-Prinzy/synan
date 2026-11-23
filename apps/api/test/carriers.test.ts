/** Slice 4: credentials and carriers — import, inventory, desk binding, self-binding, rebind, lost-band replacement. */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Carrier, Credential, DeskCode, KioskRegistration, MyCredential, Registration, TokenPair } from "@synan/contracts/rest";
import { nfcIdentifier } from "../src/domain/scan-service.js";
import { band, devEmail, errCode, mfaCode, postScans, scan, startHarness, type Harness } from "./helpers.js";

let h: Harness;
let adminMfa: string;
let organiser: string;
const uid = () => randomBytes(7).toString("hex").toUpperCase();
const A = uid();
const B = uid();
const C = uid();
const D = uid();

beforeAll(async () => {
  h = await startHarness();
  const admin = (await h.login(h.seed.emails.admin)).access_token;
  adminMfa = (await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: admin, body: { code: mfaCode(h) } })).body.access_token;
  organiser = (await h.login(h.seed.emails.organiser)).access_token;
});
afterAll(async () => h.close());

const actions = async () => (await h.app.ctx.repos.audit.all()).map((a) => a.action);
const scanAt = async (cp: string, u: string) => (await postScans<{ results: { result: string }[] }>(h, [scan(h, cp, band(u))])).body.results[0]!.result;

describe("slice 4 · import and inventory", () => {
  it("imports stock bands; duplicates in the list or already present are reported, not fatal; UIDs are stored hashed", async () => {
    const gate = await h.gateToken(h.seed.checkpoints.mainIn);
    expect((await h.call("POST", "/carriers/import", { token: gate, body: { chip_profile: "ntag_uid", identifiers: [A] } })).status).toBe(403);
    const r = await h.call<{ imported: number; duplicates: number; duplicate_identifiers: string[] }>("POST", "/carriers/import", {
      token: organiser, body: { chip_profile: "ntag_uid", identifiers: [A, A, h.seed.stockUid, B, C, D] },
    });
    expect(r.status).toBe(200);
    expect(r.body.imported).toBe(4);
    expect(r.body.duplicates).toBe(2);
    expect(r.body.duplicate_identifiers.sort()).toEqual([A, h.seed.stockUid].sort());
    const stored = await h.app.ctx.repos.carriers.byIdentifier("nfc", nfcIdentifier(A));
    expect(stored?.state).toBe("stock");
    expect(stored?.identifier).not.toContain(A);
    expect(await actions()).toContain("carrier.import");
  });

  it("counts carriers per state and chip profile, overall and per event", async () => {
    const all = await h.call<{ by_state: Record<string, number>; by_chip_profile: Record<string, number> }>("GET", "/credentials/inventory", { token: organiser });
    expect(all.body.by_state.stock).toBeGreaterThanOrEqual(5);
    expect(all.body.by_chip_profile.ntag_uid).toBeGreaterThan(0);
    const ev = await h.call<{ by_state: Record<string, number> }>("GET", `/credentials/inventory?event_id=${h.seed.eventId}`, { token: organiser });
    expect(ev.body.by_state.bound).toBeGreaterThanOrEqual(5);
    expect(ev.body.by_state.stock).toBe(0);
  });
});

describe("slice 4 · desk binding", () => {
  let reg: Registration;
  it("a perimeter desk binds a stock band to a registration; audited; the band then opens the door", async () => {
    const gate = await h.gateToken(h.seed.checkpoints.mainIn);
    reg = (await h.call<KioskRegistration>("POST", "/kiosk/registrations", { token: gate, body: { event_id: h.seed.eventId, zone_presence_consent: false } })).body.registration;
    // An interior gate user is out of scope: answered as if the registration did not exist.
    const interior = await h.gateToken(h.seed.checkpoints.auditorium);
    expect((await h.call("POST", "/carriers/bind", { token: interior, body: { identifier: A, registration_id: reg.id } })).status).toBe(404);
    expect(errCode((await h.call("POST", "/carriers/bind", { token: gate, body: { identifier: uid(), registration_id: reg.id } })).body)).toBe("VALIDATION_FAILED");
    const r = await h.call<Carrier>("POST", "/carriers/bind", { token: gate, body: { identifier: A, registration_id: reg.id } });
    expect(r.status).toBe(200);
    expect(r.body.state).toBe("bound");
    expect(r.body.identifier_hint).not.toContain(A.slice(-4));
    expect(errCode((await h.call("POST", "/carriers/bind", { token: gate, body: { identifier: B, registration_id: reg.id } })).body)).toBe("CONFLICT");
    expect(errCode((await h.call("POST", "/carriers/bind", { token: gate, body: { identifier: A, registration_id: reg.id } })).body)).toBe("CONFLICT");
    expect(await scanAt(h.seed.checkpoints.expo, A)).toBe("admitted");
  });

  it("lists credentials by event and state", async () => {
    const r = await h.call<{ items: Credential[] }>("GET", `/credentials?event_id=${h.seed.eventId}&limit=500`, { token: organiser });
    expect(r.body.items.some((c) => c.registration_id === reg.id && c.carriers.some((k) => k.kind === "nfc"))).toBe(true);
    expect((await h.call("GET", "/credentials", { token: await h.gateToken(h.seed.checkpoints.mainIn) })).status).toBe(403);
  });
});

describe("slice 4 · attendee self-binding with a desk code", () => {
  it("the desk issues a one-time code; the attendee binds the band with it exactly once", async () => {
    const email = devEmail("selfbinder");
    await h.call("POST", "/users/register", { body: { email, full_name: "Self Binder", event_slug: h.seed.eventSlug, profile: {}, zone_presence_consent: false } });
    const link = /#token=([A-Za-z0-9_-]+)/.exec(h.mailer.last("auth.link")!.text)![1]!;
    const att = (await h.call<TokenPair>("POST", "/auth/verify", { body: { token: link } })).body.access_token;
    expect((await h.call("POST", "/registrations", { token: att, body: { event_id: h.seed.eventId, zone_presence_consent: true } })).status).toBe(201);

    const gate = await h.gateToken(h.seed.checkpoints.mainIn);
    expect((await h.call("POST", "/carriers/desk-code", { token: att, body: { identifier: B } })).status).toBe(403);
    const code = (await h.call<DeskCode>("POST", "/carriers/desk-code", { token: gate, body: { identifier: B } })).body;
    expect(code.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const body = { event_id: h.seed.eventId, binding: { via: "desk_code", code: code.code } };
    const r = await h.call<MyCredential>("POST", "/me/credential/bind", { token: att, body });
    expect(r.status).toBe(200);
    expect(r.body.carriers.some((c) => c.kind === "nfc" && c.state === "bound")).toBe(true);
    expect(errCode((await h.call("POST", "/me/credential/bind", { token: att, body })).body)).toBe("CONFLICT"); // the pass now has its band
    expect(await scanAt(h.seed.checkpoints.expo, B)).toBe("admitted");
  });
});

describe("slice 4 · replacing bands", () => {
  it("lost band: MFA required; band lost, credential replaced, new credential issued, new band bound — four audit steps in order", async () => {
    const o = h.seed.attendees.ordinary2;
    const old = (await h.app.ctx.repos.carriers.forCredential(o.credentialId)).find((c) => c.kind === "nfc")!;
    const path = `/carriers/${old.id}/rebind`;
    expect(errCode((await h.call("POST", path, { token: organiser, body: { identifier: C, reason: "lost at lunch" } })).body)).toBe("MFA_REQUIRED");
    const before = (await h.app.ctx.repos.audit.all()).length;
    const epoch = (await h.app.ctx.repos.events.byId(h.seed.eventId))!.revocation_epoch;
    const r = await h.call<Carrier>("POST", path, { token: adminMfa, body: { identifier: C, reason: "lost at lunch" } });
    expect(r.status).toBe(200);
    expect(r.body.state).toBe("bound");
    expect(r.body.credential_id).not.toBe(o.credentialId);
    const steps = (await h.app.ctx.repos.audit.all()).slice(before).map((a) => a.action);
    expect(steps.slice(0, 4)).toEqual(["carrier.mark_lost", "credential.replace", "credential.reissue", "carrier.bind"]);
    expect(steps).toContain("carrier.replace_lost");
    expect((await h.app.ctx.repos.credentials.byId(o.credentialId))!.state).toBe("replaced");
    expect((await h.app.ctx.repos.events.byId(h.seed.eventId))!.revocation_epoch).toBeGreaterThan(epoch);
    expect(h.mailer.last("pass.email_qr")?.to).toBe(o.email);
    expect(await scanAt(h.seed.checkpoints.expo, o.uid)).toBe("revoked"); // the lost band
    expect(await scanAt(h.seed.checkpoints.expo, C)).toBe("admitted");
    const replaced = await h.call<{ items: Credential[] }>("GET", `/credentials?event_id=${h.seed.eventId}&state=replaced`, { token: organiser });
    expect(replaced.body.items.map((c) => c.id)).toContain(o.credentialId);
  });

  it("damaged band: the old band is retired and the credential is kept", async () => {
    const v = h.seed.attendees.ordinary;
    const old = (await h.app.ctx.repos.carriers.forCredential(v.credentialId)).find((c) => c.kind === "nfc" && c.state !== "retired")!;
    const r = await h.call<Carrier>("POST", `/carriers/${old.id}/rebind`, { token: adminMfa, body: { identifier: D, reason: "strap broke", disposition: "damaged" } });
    expect(r.status).toBe(200);
    expect(r.body.credential_id).toBe(v.credentialId);
    expect((await h.app.ctx.repos.carriers.byId(old.id))!.state).toBe("retired");
    expect(await actions()).toEqual(expect.arrayContaining(["carrier.mark_retired", "carrier.rebind", "carrier.replace_damaged"]));
  });
});
