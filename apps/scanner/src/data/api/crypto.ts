/**
 * Offline trust (D-12, 03 §2 and §4): the scanner holds public keys only. It verifies portal and
 * emailed QR codes, and the signed allowlist, with WebCrypto Ed25519.
 *
 * Browser support: Ed25519 in WebCrypto ships in Chrome 137+, Firefox 129+ and Safari 17+, and
 * `crypto.subtle` exists only in a secure context (HTTPS or localhost). Where either is missing,
 * `ed25519Supported()` is false and the scanner fails closed offline: no allowlist is trusted and
 * no QR is verified, so every offline read is `unknown_token`. Online scans are unaffected (the
 * server decides).
 */
import { base64urlDecode, base64urlEncode, type ParsedQr } from "@synan/contracts/qr";
import type { AllowlistPayload, SigningKey } from "@synan/contracts/rest";
import { DEFAULT_QR_LEEWAY_S, RETIRED_KEY_GRACE_MS } from "./config";

const subtle = (): SubtleCrypto | null => (typeof crypto !== "undefined" && crypto.subtle ? crypto.subtle : null);
const ascii = (s: string) => new TextEncoder().encode(s);

/** RFC 8032 §7.1 test 1: a known public key and its signature over the empty message. */
const SELF_TEST = {
  x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
  sig: "5VZDAMNgrHKQhuLMgG6CioSHfx645dl02HPgZSJJAVVfuIIVkKM7rMYeOXAc-bRr0lv18FlbviRlUUFDjnoQCw",
};

let support: Promise<boolean> | null = null;

/** True when this browser can verify Ed25519 signatures (checked once, against a known vector). */
export function ed25519Supported(): Promise<boolean> {
  support ??= (async () => {
    const s = subtle();
    if (!s) return false;
    try {
      const key = await importEd25519(SELF_TEST.x);
      const sig = base64urlDecode(SELF_TEST.sig);
      if (!sig) return false;
      return await s.verify({ name: "Ed25519" }, key, sig, new Uint8Array(0));
    } catch {
      return false;
    }
  })();
  return support;
}

/** Import a raw 32-byte Ed25519 public key (the JWK `x`, base64url). */
export async function importEd25519(x: string): Promise<CryptoKey> {
  const s = subtle();
  const raw = base64urlDecode(x);
  if (!s || !raw || raw.length !== 32) throw new Error("bad key");
  return s.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
}

export async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const s = subtle();
  if (!s) throw new Error("no subtle crypto");
  return new Uint8Array(await s.digest("SHA-256", data));
}

/** base64url SHA-256 of `nfc:<UID upper-case>`: the allowlist's `nfc_hashes` (apps/api nfcIdentifier). */
export async function nfcHash(uid: string): Promise<string> {
  return base64urlEncode(await sha256(ascii(`nfc:${uid.toUpperCase()}`)));
}

/** base64url SHA-256 of an emailed code's `cid` text: the allowlist's `qr_email_hashes` (apps/api credential-service). */
export async function emailCidHash(cid: string): Promise<string> {
  return base64urlEncode(await sha256(ascii(cid)));
}

const hex = (b: Uint8Array) => [...b].map((v) => v.toString(16).padStart(2, "0")).join("");

/** A signing key the scanner may use: right purpose, `qr_kid` consistent with `x`, not retired past grace. */
export interface TrustedKey {
  kid: string;
  qrKid: string;
  purpose: SigningKey["purpose"];
  key: CryptoKey;
  retiredAt: number | null;
}

/**
 * Import the published keys. A key whose `qr_kid` does not match SHA-256(x) is dropped, so a
 * tampered key list cannot alias one key's id onto another.
 */
export async function importKeys(keys: readonly SigningKey[]): Promise<TrustedKey[]> {
  const out: TrustedKey[] = [];
  for (const k of keys) {
    if (k.alg !== "EdDSA" || k.kty !== "OKP" || k.crv !== "Ed25519") continue;
    try {
      const raw = base64urlDecode(k.x);
      if (!raw || raw.length !== 32) continue;
      if (hex((await sha256(raw)).subarray(0, 4)) !== k.qr_kid) continue;
      out.push({ kid: k.kid, qrKid: k.qr_kid, purpose: k.purpose, key: await importEd25519(k.x), retiredAt: k.retired_at ? Date.parse(k.retired_at) : null });
    } catch {
      /* unusable key: skipped */
    }
  }
  return out;
}

const usable = (k: TrustedKey, nowMs: number) => k.retiredAt === null || nowMs - k.retiredAt <= RETIRED_KEY_GRACE_MS;

export type QrCheck =
  | { ok: true }
  | { ok: false; reason: "bad_signature" | "expired" | "not_yet_valid" };

/**
 * Verify a parsed compact QR (`@synan/contracts/qr`) at `nowMs` (server-corrected time), exactly as
 * apps/api QrService.verify does: signature by a `qr` key named by its short id, then the window.
 */
export async function verifyQr(p: ParsedQr, keys: readonly TrustedKey[], nowMs: number, leewayS = DEFAULT_QR_LEEWAY_S): Promise<QrCheck> {
  const s = subtle();
  const k = keys.find((x) => x.purpose === "qr" && x.qrKid === p.kid && usable(x, nowMs));
  if (!s || !k) return { ok: false, reason: "bad_signature" };
  let good = false;
  try {
    good = await s.verify({ name: "Ed25519" }, k.key, p.signature, p.signed);
  } catch {
    good = false;
  }
  if (!good) return { ok: false, reason: "bad_signature" };
  const now = nowMs / 1000;
  // Written as "must be inside", so a non-finite value fails closed (as the server does).
  if (!(now < p.exp + leewayS)) return { ok: false, reason: "expired" };
  if (p.kind === "portal" && !(now >= p.exp - p.ttl - leewayS)) return { ok: false, reason: "not_yet_valid" };
  return { ok: true };
}

/* ------------------------------------------------------------ allowlist */

/** JWS protected-header `typ` (contracts `ALLOWLIST_JWS_TYP`; repeated here so no Zod reaches the bundle). */
export const ALLOWLIST_TYP = "synan-allowlist+jws";

export class AllowlistRejected extends Error {
  constructor(readonly why: string) {
    super(`allowlist rejected: ${why}`);
  }
}

const isStr = (v: unknown): v is string => typeof v === "string";
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const TIERS = new Set(["VIP", "ORDINARY", "PRIVATE_INVITE", "PUBLIC"]);
const STATES = new Set(["issued", "active", "suspended_review", "revoked", "replaced"]);

/** Structural check of the signed payload (AllowlistPayload), without Zod in the bundle. */
export function checkAllowlistPayload(v: unknown): AllowlistPayload {
  const p = v as Record<string, unknown>;
  const fail = (f: string) => {
    throw new AllowlistRejected(`payload.${f}`);
  };
  if (!p || typeof p !== "object") fail("root");
  if (!isStr(p.event_id)) fail("event_id");
  if (!(p.checkpoint_id === null || isStr(p.checkpoint_id))) fail("checkpoint_id");
  if (!(p.shift_end === null || isStr(p.shift_end))) fail("shift_end");
  if (!isInt(p.revocation_epoch)) fail("revocation_epoch");
  if (!isInt(p.access_rules_version)) fail("access_rules_version");
  for (const f of ["window_start", "window_end", "issued_at"] as const) if (!isStr(p[f]) || Number.isNaN(Date.parse(p[f] as string))) fail(f);
  if (!Array.isArray(p.entries)) fail("entries");
  for (const e of p.entries as Record<string, unknown>[]) {
    if (!e || typeof e !== "object") fail("entries[]");
    if (!isStr(e.credential_hash) || !isStrArr(e.nfc_hashes) || !isStrArr(e.dead_nfc_hashes) || !isStrArr(e.permitted_room_ids)) fail("entries[].fields");
    if (!(e.tier === null || (isStr(e.tier) && TIERS.has(e.tier)))) fail("entries[].tier");
    if (typeof e.revoked !== "boolean" || typeof e.qr_email_spent !== "boolean") fail("entries[].flags");
    if (!isStr(e.state) || !STATES.has(e.state)) fail("entries[].state");
    // Additive fields: absent on older lists, string arrays when present.
    if (e.qr_email_hashes !== undefined && !isStrArr(e.qr_email_hashes)) fail("entries[].qr_email_hashes");
    if (e.perimeter_room_ids !== undefined && !isStrArr(e.perimeter_room_ids)) fail("entries[].perimeter_room_ids");
  }
  return p as unknown as AllowlistPayload;
}

/**
 * Verify a compact EdDSA JWS signed with an `allowlist` key and return its payload. Throws
 * AllowlistRejected on anything else: unknown or wrong-purpose key, other alg or typ, a `kid`
 * different from the one named beside it, a bad signature, or a malformed payload.
 */
export async function verifyAllowlistJws(jws: string, kidBeside: string, keys: readonly TrustedKey[], nowMs: number): Promise<AllowlistPayload> {
  const s = subtle();
  if (!s) throw new AllowlistRejected("no WebCrypto");
  const parts = jws.split(".");
  if (parts.length !== 3) throw new AllowlistRejected("not a compact JWS");
  const [h64, p64, s64] = parts as [string, string, string];
  const hBytes = base64urlDecode(h64);
  const pBytes = base64urlDecode(p64);
  const sig = base64urlDecode(s64);
  if (!hBytes || !pBytes || !sig || sig.length !== 64) throw new AllowlistRejected("encoding");
  let header: { alg?: unknown; kid?: unknown; typ?: unknown; crit?: unknown };
  try {
    header = JSON.parse(new TextDecoder().decode(hBytes));
  } catch {
    throw new AllowlistRejected("header json");
  }
  if (header.alg !== "EdDSA") throw new AllowlistRejected("alg");
  if (header.typ !== ALLOWLIST_TYP) throw new AllowlistRejected("typ");
  if (header.crit !== undefined) throw new AllowlistRejected("crit");
  if (!isStr(header.kid) || header.kid !== kidBeside) throw new AllowlistRejected("kid");
  const k = keys.find((x) => x.kid === header.kid && x.purpose === "allowlist" && usable(x, nowMs));
  if (!k) throw new AllowlistRejected("unknown key");
  let good = false;
  try {
    good = await s.verify({ name: "Ed25519" }, k.key, sig, ascii(`${h64}.${p64}`));
  } catch {
    good = false;
  }
  if (!good) throw new AllowlistRejected("signature");
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(pBytes));
  } catch {
    throw new AllowlistRejected("payload json");
  }
  return checkAllowlistPayload(payload);
}

/**
 * Tolerance before a list's `window_start`. The server starts a staff list's window when it issues
 * it, and a device's corrected clock can trail the server's by a little, so a list fetched a moment
 * ago is not refused as "not yet valid".
 */
export const ALLOWLIST_START_LEEWAY_MS = 60_000;

/**
 * How long past its `window_end` a list may still decide offline, as a stale list does (the lead's
 * rule, 2026-11-24; to be written into docs/03 §4 and 01 §8, and the length confirmed by the owner).
 */
export const ALLOWLIST_END_GRACE_MS = 2 * 60 * 60_000;

/**
 * Where `nowMs` (server-corrected) falls in a verified list's signed validity window:
 *   before  ahead of `window_start` (less the tolerance): decides nothing;
 *   inside  from then until `window_end`: decides (stale after 15 minutes since issue, O-05);
 *   grace   up to ALLOWLIST_END_GRACE_MS past `window_end`: still decides offline, shown as out of
 *           date, like a stale list (fail open, alerts at sync);
 *   ended   later than that: not trusted, the scanner has no list and refuses what it cannot check.
 * Written as "must be inside", so a non-finite time or bound fails closed.
 */
export function allowlistWindow(payload: Pick<AllowlistPayload, "window_start" | "window_end">, nowMs: number): "before" | "inside" | "grace" | "ended" {
  const start = Date.parse(payload.window_start);
  const end = Date.parse(payload.window_end);
  if (!(nowMs < end + ALLOWLIST_END_GRACE_MS)) return "ended";
  if (!(nowMs >= start - ALLOWLIST_START_LEEWAY_MS)) return "before";
  return nowMs < end ? "inside" : "grace";
}
