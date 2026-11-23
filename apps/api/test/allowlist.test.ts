/** Slice 5: the signed offline allowlist. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compactVerify, importJWK } from "jose";
import { AllowlistPayload, type SignedAllowlist, type SigningKey, type TokenPair } from "@synan/contracts/rest";
import { nfcIdentifier } from "../src/domain/scan-service.js";
import { errCode, startHarness, type Harness } from "./helpers.js";

let h: Harness;
let organiser: string;
beforeAll(async () => {
  h = await startHarness();
  organiser = (await h.login(h.seed.emails.organiser)).access_token;
});
afterAll(async () => h.close());

async function verified(signed: SignedAllowlist): Promise<AllowlistPayload> {
  const keys = (await h.call<{ keys: SigningKey[] }>("GET", "/auth/signing-keys")).body.keys;
  const k = keys.find((x) => x.kid === signed.kid)!;
  expect(k.purpose).toBe("allowlist");
  const pub = await importJWK({ kty: "OKP", crv: "Ed25519", x: k.x }, "EdDSA");
  const { payload, protectedHeader } = await compactVerify(signed.jws, pub);
  expect(protectedHeader.typ).toBe("synan-allowlist+jws");
  return AllowlistPayload.parse(JSON.parse(new TextDecoder().decode(payload)));
}
const get = (token: string, cp?: string, eventId = h.seed.eventId) =>
  h.call<SignedAllowlist>("GET", `/events/${eventId}/allowlist${cp ? `?checkpoint_id=${cp}` : ""}`, { token });
const credRef = async (credentialId: string) => (await h.app.ctx.repos.credentials.byId(credentialId))!.token_hash;

describe("slice 5 · signed offline allowlist", () => {
  it("a gate user gets their shift's list, signed, verifiable with the public key, with no identity in it", async () => {
    const r = await get(await h.gateToken(h.seed.checkpoints.vip));
    expect(r.status).toBe(200);
    const p = await verified(r.body);
    expect(p.checkpoint_id).toBe(h.seed.checkpoints.vip);
    expect(p.shift_end).not.toBeNull();
    const vip = p.entries.find((e) => e.tier === "VIP")!;
    expect(vip.permitted_room_ids).toEqual([h.seed.rooms.vip]);
    const ord = p.entries.find((e) => e.tier === "ORDINARY")!;
    expect(ord.permitted_room_ids).toEqual([]);
    const v = h.seed.attendees.vip;
    const mine = p.entries.find((e) => e.nfc_hashes.includes(nfcIdentifier(v.uid)))!;
    expect(mine.credential_hash).toBe(await credRef(v.credentialId));
    expect(mine.revoked).toBe(false);
    const text = Buffer.from(r.body.jws.split(".")[1]!, "base64url").toString();
    for (const secret of [v.email!, "Vera", v.uid, h.seed.attendees.ordinary.email!, v.id, v.registrationId]) expect(text).not.toContain(secret);
  });

  it("refuses a forged or altered list", async () => {
    const r = await get(await h.gateToken(h.seed.checkpoints.vip));
    const [hd, body, sig] = r.body.jws.split(".");
    const altered = JSON.parse(Buffer.from(body!, "base64url").toString());
    altered.entries[0].revoked = !altered.entries[0].revoked;
    const forged = `${hd}.${Buffer.from(JSON.stringify(altered)).toString("base64url")}.${sig}`;
    await expect(verified({ ...r.body, jws: forged })).rejects.toThrow();
  });

  it("scope: only the caller's current checkpoint; a finished shift, an attendee and another venue's event see nothing", async () => {
    const gate = await h.gateToken(h.seed.checkpoints.vip);
    expect(errCode((await get(gate, h.seed.checkpoints.mainIn)).body)).toBe("CHECKPOINT_NOT_ASSIGNED");
    const gate2 = (await h.login(h.seed.emails.gate2)).access_token; // shift already over
    expect((await get(gate2)).status).toBe(404);
    await h.call("POST", "/auth/email-link", { body: { email: h.seed.attendees.vip.email! } });
    const link = /#token=([A-Za-z0-9_-]+)/.exec(h.mailer.last("auth.link")!.text)![1]!;
    const att = (await h.call<TokenPair>("POST", "/auth/verify", { body: { token: link } })).body.access_token;
    expect((await get(att)).status).toBe(403);
  });

  it("operators get the whole event; revoking a pass advances the epoch and marks the entry revoked", async () => {
    const before = await verified((await get(organiser)).body);
    const vip = before.entries.find((e) => e.tier === "VIP")!;
    expect(vip.permitted_room_ids.sort()).toEqual(Object.values(h.seed.rooms).sort());
    const o = h.seed.attendees.ordinary2;
    expect((await h.call("POST", `/credentials/${o.credentialId}/revoke`, { token: organiser, body: { reason: "refund" } })).status).toBe(200);
    const after = await verified((await get(organiser)).body);
    expect(after.revocation_epoch).toBeGreaterThan(before.revocation_epoch);
    const e = after.entries.find((x) => x.nfc_hashes.includes(nfcIdentifier(o.uid)))!;
    expect(e.revoked).toBe(true);
    expect(e.state).toBe("revoked");
  });

  it("a draft event has no allowlist", async () => {
    const draft = (await h.app.ctx.repos.events.bySlug(h.seed.draftEventSlug))!;
    expect(errCode((await get(organiser, undefined, draft.id)).body)).toBe("EVENT_NOT_LIVE");
  });
});
