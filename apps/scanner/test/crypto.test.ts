/** QR and allowlist verification (D-12, 03 §2 and §4). */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseSignedQr } from "@synan/contracts/qr";
import { ALLOWLIST_START_LEEWAY_MS, AllowlistRejected, allowlistWindow, ed25519Supported, emailCidHash, importKeys, nfcHash, verifyAllowlistJws, verifyQr } from "../src/data/api/crypto";
import { emailCode, entry, makeKey, nfcId, payload, portalCode, ref16, signJws } from "./helpers";

const nowS = 1_800_000_000;
const at = (s: number) => s * 1000;

describe("Ed25519 support", () => {
  it("passes the RFC 8032 self-test in this runtime", async () => {
    expect(await ed25519Supported()).toBe(true);
  });
});

describe("portal and emailed QR", () => {
  it("accepts a portal code inside its window, signed by a published qr key", async () => {
    const k = await makeKey("qr");
    const keys = await importKeys([k.published]);
    const code = await portalCode(k, ref16(1), nowS);
    const p = parseSignedQr(code)!;
    expect(p.kind).toBe("portal");
    expect(await verifyQr(p, keys, at(nowS))).toEqual({ ok: true });
  });

  it("refuses an altered code, an unknown key, and a key of the wrong purpose", async () => {
    const k = await makeKey("qr");
    const other = await makeKey("qr");
    const allow = await makeKey("allowlist");
    const code = await portalCode(k, ref16(1), nowS);
    const p = parseSignedQr(code)!;
    const flipped = { ...p, signed: p.signed.slice() };
    flipped.signed[flipped.signed.length - 1]! ^= 1;
    expect(await verifyQr(flipped, await importKeys([k.published]), at(nowS))).toEqual({ ok: false, reason: "bad_signature" });
    expect(await verifyQr(p, await importKeys([other.published]), at(nowS))).toEqual({ ok: false, reason: "bad_signature" });
    // Same public key published as an allowlist key: not usable for QR.
    expect(await verifyQr(p, await importKeys([{ ...k.published, purpose: "allowlist" }]), at(nowS))).toEqual({ ok: false, reason: "bad_signature" });
    void allow;
  });

  it("checks the window with the server's 5 s leeway: expired, not yet valid", async () => {
    const k = await makeKey("qr");
    const keys = await importKeys([k.published]);
    const p = parseSignedQr(await portalCode(k, ref16(1), nowS, 60))!;
    if (p.kind !== "portal") throw new Error("portal expected");
    expect(await verifyQr(p, keys, at(p.exp + 4))).toEqual({ ok: true });
    expect(await verifyQr(p, keys, at(p.exp + 5))).toEqual({ ok: false, reason: "expired" });
    expect(await verifyQr(p, keys, at(p.exp - p.ttl - 5))).toEqual({ ok: true });
    expect(await verifyQr(p, keys, at(p.exp - p.ttl - 6))).toEqual({ ok: false, reason: "not_yet_valid" });
    expect(await verifyQr(p, keys, Number.NaN)).toEqual({ ok: false, reason: "expired" });
  });

  it("verifies an emailed code and exposes its carrier id", async () => {
    const k = await makeKey("qr");
    const code = await emailCode(k, ref16(2), ref16(9), nowS + 3600);
    const p = parseSignedQr(code)!;
    expect(p.kind).toBe("email");
    expect(await verifyQr(p, await importKeys([k.published]), at(nowS))).toEqual({ ok: true });
    expect(await verifyQr(p, await importKeys([k.published]), at(nowS + 3606))).toEqual({ ok: false, reason: "expired" });
  });

  it("drops a published key whose qr_kid does not match its public key, and retired keys past grace", async () => {
    const k = await makeKey("qr");
    const liar = await makeKey("qr");
    const keys = await importKeys([{ ...liar.published, qr_kid: k.qrKid }]);
    expect(keys).toHaveLength(0);
    const retired = await makeKey("qr", undefined, new Date(at(nowS) - 25 * 3600_000).toISOString());
    const rk = await importKeys([retired.published]);
    const p = parseSignedQr(await portalCode(retired, ref16(1), nowS))!;
    expect(await verifyQr(p, rk, at(nowS))).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("hashes a band UID exactly as the API stores it: SHA-256 of `nfc:` + the UID in upper-case hex", async () => {
    expect(await nfcHash("04a29f31c7d0e2")).toBe(nfcId("04A29F31C7D0E2"));
    expect(await nfcHash("04a29f31c7d0e2")).toBe(createHash("sha256").update("nfc:04A29F31C7D0E2").digest("base64url"));
  });

  it("hashes an emailed code's cid exactly as the allowlist's qr_email_hashes (apps/api sha256b64url(cid))", async () => {
    const k = await makeKey("qr");
    const cid = ref16(9);
    const p = parseSignedQr(await emailCode(k, ref16(2), cid, nowS + 3600))!;
    if (p.kind !== "email") throw new Error("email expected");
    expect(p.cid).toBe(cid);
    expect(await emailCidHash(p.cid)).toBe(createHash("sha256").update(cid).digest("base64url"));
  });

  it("uses the leeway the server publishes (qr_leeway_s), not a fixed one", async () => {
    const k = await makeKey("qr");
    const keys = await importKeys([k.published]);
    const p = parseSignedQr(await portalCode(k, ref16(1), nowS, 60))!;
    if (p.kind !== "portal") throw new Error("portal expected");
    expect(await verifyQr(p, keys, at(p.exp + 1), 0)).toEqual({ ok: false, reason: "expired" });
    expect(await verifyQr(p, keys, at(p.exp + 29), 30)).toEqual({ ok: true });
    expect(await verifyQr(p, keys, at(p.exp - p.ttl - 29), 30)).toEqual({ ok: true });
    expect(await verifyQr(p, keys, at(p.exp - p.ttl - 1), 0)).toEqual({ ok: false, reason: "not_yet_valid" });
  });
});

describe("signed allowlist", () => {
  const list = payload([entry({ credential_hash: ref16(1), nfc_hashes: [nfcId("04AA")] })]);

  it("verifies a list signed with an allowlist key and returns its payload", async () => {
    const k = await makeKey("allowlist");
    const jws = await signJws(k, list);
    const p = await verifyAllowlistJws(jws, k.published.kid, await importKeys([k.published]), Date.now());
    expect(p.entries[0]!.credential_hash).toBe(ref16(1));
  });

  const rejects = async (f: () => Promise<unknown>, why: string) => {
    await expect(f()).rejects.toBeInstanceOf(AllowlistRejected);
    await expect(f()).rejects.toMatchObject({ why });
  };

  it("refuses an altered payload, a forged signature and a list signed with a qr key", async () => {
    const k = await makeKey("allowlist");
    const keys = await importKeys([k.published]);
    const [h, , s] = (await signJws(k, list)).split(".");
    const altered = Buffer.from(JSON.stringify({ ...list, entries: [{ ...list.entries[0], revoked: true }] })).toString("base64url");
    await rejects(() => verifyAllowlistJws(`${h}.${altered}.${s}`, k.published.kid, keys, Date.now()), "signature");
    const forger = await makeKey("allowlist", k.published.kid);
    await rejects(async () => verifyAllowlistJws(await signJws(forger, list), k.published.kid, keys, Date.now()), "signature");
    const qrKey = await makeKey("qr");
    await rejects(async () => verifyAllowlistJws(await signJws(qrKey, list), qrKey.published.kid, await importKeys([qrKey.published]), Date.now()), "unknown key");
  });

  it("refuses another alg or typ, a crit header, a kid different from the one beside it, and a malformed payload", async () => {
    const k = await makeKey("allowlist");
    const keys = await importKeys([k.published]);
    await rejects(async () => verifyAllowlistJws(await signJws(k, list, { typ: "JWT" }), k.published.kid, keys, Date.now()), "typ");
    await rejects(async () => verifyAllowlistJws(await signJws(k, list, { alg: "none" }), k.published.kid, keys, Date.now()), "alg");
    await rejects(async () => verifyAllowlistJws(await signJws(k, list, { crit: ["x"] }), k.published.kid, keys, Date.now()), "crit");
    await rejects(async () => verifyAllowlistJws(await signJws(k, list), "another-kid", keys, Date.now()), "kid");
    await rejects(async () => verifyAllowlistJws(await signJws(k, { ...list, entries: [{ credential_hash: 1 }] }), k.published.kid, keys, Date.now()), "payload.entries[].fields");
    await rejects(async () => verifyAllowlistJws("a.b", k.published.kid, keys, Date.now()), "not a compact JWS");
  });

  it("accepts the additive fields (qr_email_hashes, perimeter_room_ids) and refuses them malformed", async () => {
    const k = await makeKey("allowlist");
    const keys = await importKeys([k.published]);
    const withExtras = payload([entry({ credential_hash: ref16(1), qr_email_hashes: ["h"], perimeter_room_ids: ["r1", "r2"] })]);
    const p = await verifyAllowlistJws(await signJws(k, withExtras), k.published.kid, keys, Date.now());
    expect(p.entries[0]).toMatchObject({ qr_email_hashes: ["h"], perimeter_room_ids: ["r1", "r2"] });
    const bad = { ...withExtras, entries: [{ ...withExtras.entries[0], perimeter_room_ids: "r1" }] };
    await rejects(async () => verifyAllowlistJws(await signJws(k, bad), k.published.kid, keys, Date.now()), "payload.entries[].perimeter_room_ids");
    const bad2 = { ...withExtras, entries: [{ ...withExtras.entries[0], qr_email_hashes: [1] }] };
    await rejects(async () => verifyAllowlistJws(await signJws(k, bad2), k.published.kid, keys, Date.now()), "payload.entries[].qr_email_hashes");
  });
});

describe("the allowlist's signed validity window", () => {
  const start = Date.parse("2026-11-24T10:00:00.000Z");
  const end = Date.parse("2026-11-24T18:00:00.000Z");
  const list = payload([], { window_start: new Date(start).toISOString(), window_end: new Date(end).toISOString() });

  it("is inside from window_start (less a minute's clock tolerance) until window_end", () => {
    expect(allowlistWindow(list, start)).toBe("inside");
    expect(allowlistWindow(list, start - ALLOWLIST_START_LEEWAY_MS)).toBe("inside");
    expect(allowlistWindow(list, end - 1)).toBe("inside");
  });

  it("has ended at window_end and after, with no tolerance", () => {
    expect(allowlistWindow(list, end)).toBe("ended");
    expect(allowlistWindow(list, end + 60 * 60_000)).toBe("ended");
  });

  it("is not yet valid before window_start's tolerance", () => {
    expect(allowlistWindow(list, start - ALLOWLIST_START_LEEWAY_MS - 1)).toBe("before");
  });

  it("fails closed on a non-finite time or bound", () => {
    expect(allowlistWindow(list, Number.NaN)).toBe("ended");
    expect(allowlistWindow({ ...list, window_end: "not a time" }, start)).toBe("ended");
    expect(allowlistWindow({ ...list, window_start: "not a time" }, start)).toBe("before");
  });
});
