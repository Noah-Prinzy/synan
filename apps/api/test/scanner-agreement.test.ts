/**
 * The offline allowlist and the online verdict agree (Gate Scanner run against the real API):
 * - a cancelled registration's band reads `revoked` online, as the allowlist says (01 §5.2);
 * - an `assigned` band (not yet verified at the desk, 01 §5.3) opens nothing online or offline;
 * - a lost-band replacement leaves the new band verified (`bound`) on both backends, so it opens doors;
 * - the allowlist names the emailed codes still usable, so a code superseded by a resend reads spent offline.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AllowlistPayload, type ScanBatchResponse, type SignedAllowlist, type TokenPair } from "@synan/contracts/rest";
import { nfcIdentifier } from "../src/domain/scan-service.js";
import { addAttendee, band, mfaCode, postScans, scan, startHarness, type Harness } from "./helpers.js";

let h: Harness;
let stepped: string;
beforeAll(async () => {
  h = await startHarness();
  const admin = (await h.login(h.seed.emails.admin)).access_token;
  stepped = (await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: admin, body: { code: mfaCode(h) } })).body.access_token;
});
afterAll(async () => h.close());

const allowlist = async () => {
  const r = await h.call<SignedAllowlist>("GET", `/events/${h.seed.eventId}/allowlist`, { token: stepped });
  return AllowlistPayload.parse(JSON.parse(Buffer.from(r.body.jws.split(".")[1]!, "base64url").toString()));
};
const entryOf = async (credentialId: string) => {
  const ref = (await h.app.ctx.repos.credentials.byId(credentialId))!.token_hash;
  return (await allowlist()).entries.find((e) => e.credential_hash === ref)!;
};
const verdict = async (uid: string) =>
  (await postScans<ScanBatchResponse>(h, [scan(h, h.seed.checkpoints.mainIn, band(uid))])).body.results[0]!.result;
const stockBand = async () => {
  const uid = randomBytes(7).toString("hex").toUpperCase();
  await h.app.ctx.repos.carriers.insert({ id: randomUUID(), credential_id: null, kind: "nfc", identifier: nfcIdentifier(uid), chip_profile: "ntag_uid", state: "stock", bound_at: null, redeemed_at: null });
  return uid;
};

describe("online and offline verdicts agree", () => {
  it("a cancelled registration's band reads revoked, online and in the allowlist", async () => {
    const a = await addAttendee(h, "ORDINARY");
    await h.app.ctx.repos.registrations.update(a.registrationId, { state: "cancelled" });
    expect(await verdict(a.uid)).toBe("revoked");
    expect(await entryOf(a.credentialId)).toMatchObject({ revoked: true, state: "revoked" });
  });

  it("an assigned band is not yet verified: unknown online, absent from the allowlist", async () => {
    // A pass with no band yet, and a band written to it at the desk but not confirmed.
    const id = randomUUID();
    const registrationId = randomUUID();
    await h.app.ctx.repos.attendees.insert({ id, user_id: null, email: null, full_name: null, profile_jsonb: {} });
    await h.app.ctx.repos.fixtures.registration({ id: registrationId, event_id: h.seed.eventId, attendee_id: id, tier: "ORDINARY", state: "confirmed", zone_presence_consent_at: null, checked_in_at: null, created_at: new Date(h.clock.now()) });
    const cred = await h.app.ctx.credentials.issueForRegistration(registrationId);
    const uid = randomBytes(7).toString("hex").toUpperCase();
    await h.app.ctx.repos.carriers.insert({ id: randomUUID(), credential_id: cred.id, kind: "nfc", identifier: nfcIdentifier(uid), chip_profile: "ntag_uid", state: "assigned", bound_at: null, redeemed_at: null });
    expect(await verdict(uid)).toBe("unknown_token");
    expect((await entryOf(cred.id)).nfc_hashes).toEqual([]);
  });

  it("a replacement band for a lost one is verified at the desk and opens doors", async () => {
    const a = await addAttendee(h, "ORDINARY");
    const old = (await h.app.ctx.repos.carriers.forCredential(a.credentialId)).find((c) => c.kind === "nfc")!;
    const fresh = await stockBand();
    const r = await h.call<{ state: string; credential_id: string }>("POST", `/carriers/${old.id}/rebind`, { token: stepped, body: { identifier: fresh, reason: "lost at lunch", disposition: "lost" } });
    expect(r.status).toBe(200);
    expect(r.body.state).toBe("bound");
    expect(await verdict(a.uid)).toBe("revoked"); // the lost band
    expect(await verdict(fresh)).toBe("admitted");
    expect((await entryOf(r.body.credential_id)).nfc_hashes).toEqual([nfcIdentifier(fresh)]);
  });

  it("the allowlist names only the emailed code still usable after a resend", async () => {
    const a = await addAttendee(h, "ORDINARY");
    const mailed = async () => (await h.app.ctx.repos.carriers.forCredential(a.credentialId)).filter((c) => c.kind === "qr_email");
    const before = await mailed();
    expect((await h.call("POST", `/credentials/${a.credentialId}/resend`, { token: stepped })).status).toBe(200);
    const after = await mailed();
    const live = after.filter((c) => c.state !== "retired" && c.redeemed_at === null).map((c) => c.identifier!);
    expect(live).toHaveLength(1);
    expect(before.map((c) => c.identifier)).not.toContain(live[0]);
    expect((await entryOf(a.credentialId)).qr_email_hashes).toEqual(live);
  });
});
