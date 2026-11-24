/** Test keys and signers, built the way apps/api builds them (domain/keys.ts, domain/qr.ts, routes/allowlist.ts). */
import { createHash } from "node:crypto";
import { base64urlEncode, buildSignedQr } from "@synan/contracts/qr";
import type { AllowlistEntry, AllowlistPayload, SigningKey } from "@synan/contracts/rest";

export interface TestKey {
  pair: CryptoKeyPair;
  x: string;
  qrKid: string;
  published: SigningKey;
}

export async function makeKey(purpose: "qr" | "allowlist", kid: string = crypto.randomUUID(), retiredAt: string | null = null): Promise<TestKey> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const x = base64urlEncode(raw);
  const qrKid = createHash("sha256").update(raw).digest().subarray(0, 4).toString("hex");
  return {
    pair,
    x,
    qrKid,
    published: { kid, purpose, alg: "EdDSA", kty: "OKP", crv: "Ed25519", x, qr_kid: qrKid, active_from: new Date(0).toISOString(), retired_at: retiredAt },
  };
}

export async function sign(k: TestKey, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, k.pair.privateKey, data));
}

export const ref16 = (n: number) => base64urlEncode(Uint8Array.from({ length: 16 }, (_, i) => (i * 7 + n) & 0xff));

export async function portalCode(k: TestKey, ref: string, nowS: number, ttl = 60): Promise<string> {
  const nbf = Math.floor(nowS / ttl) * ttl;
  const { signed, finish } = buildSignedQr({ kind: "portal", kid: k.qrKid, exp: nbf + ttl, ttl, ref });
  return finish(await sign(k, signed));
}

export async function emailCode(k: TestKey, ref: string, cid: string, expS: number): Promise<string> {
  const { signed, finish } = buildSignedQr({ kind: "email", kid: k.qrKid, exp: expS, ref, cid });
  return finish(await sign(k, signed));
}

const b64json = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");

/** A compact EdDSA JWS as jose's CompactSign produces it. */
export async function signJws(k: TestKey, payload: unknown, header: Record<string, unknown> = {}): Promise<string> {
  const h = b64json({ alg: "EdDSA", kid: k.published.kid, typ: "synan-allowlist+jws", ...header });
  const p = b64json(payload);
  const sig = await sign(k, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${Buffer.from(sig).toString("base64url")}`;
}

/** The API's NFC identifier (apps/api scan-service nfcIdentifier). */
export const nfcId = (uid: string) => createHash("sha256").update(`nfc:${uid.toUpperCase()}`).digest("base64url");

export function entry(p: Partial<AllowlistEntry> & { credential_hash: string }): AllowlistEntry {
  return { nfc_hashes: [], tier: "ORDINARY", permitted_room_ids: [], revoked: false, state: "active", dead_nfc_hashes: [], qr_email_spent: false, ...p };
}

/** A signed list's validity window, stated by every test: `window_start` → `window_end` (issued at the start). */
export interface ListWindow {
  window_start: string;
  window_end: string;
}

/** A window of `before` ms up to `after` ms around `atMs` (default: an hour either side of now). */
export function windowAround(atMs = Date.now(), before = 3_600_000, after = 3_600_000): ListWindow {
  return { window_start: new Date(atMs - before).toISOString(), window_end: new Date(atMs + after).toISOString() };
}

export function payload(entries: AllowlistEntry[], window: ListWindow, p: Partial<AllowlistPayload> = {}): AllowlistPayload {
  return {
    event_id: "11111111-1111-4111-8111-111111111111",
    checkpoint_id: "22222222-2222-4222-8222-222222222222",
    shift_end: window.window_end,
    revocation_epoch: 1,
    access_rules_version: 1,
    ...window,
    issued_at: window.window_start,
    entries,
    ...p,
  };
}
