/**
 * Compact signed QR format (D-12, 03 §2). ZOD-FREE and dependency-free: runs in the browser
 * (scanner, offline) and in Node (API).
 *
 *   text      = PREFIX + base64url(body ‖ signature)
 *   PREFIX    = QR_PREFIX_PORTAL ("SYP1.") or QR_PREFIX_EMAIL ("SYE1.")   — type and version
 *   signature = Ed25519 over ASCII(PREFIX) ‖ body                         — 64 bytes
 *
 *   portal body (26 B): kid[4] ‖ exp u32be (unix s) ‖ ttl u16be (s) ‖ ref[16]
 *   email  body (40 B): kid[4] ‖ exp u32be (unix s) ‖ ref[16] ‖ cid[16]
 *
 *   kid = first 4 bytes of SHA-256(raw Ed25519 public key), hex in `SigningKey.qr_kid`
 *   ref = the 128-bit credential reference (`credential_hash` in the offline allowlist)
 *   cid = id of the single-use emailed-QR carrier
 *   valid while exp − ttl ≤ now < exp (portal); now < exp (email)
 *
 * Lengths: portal 125 characters, email 144 (see QR_TEXT_LENGTH).
 * Verifying needs only the public key: WebCrypto `subtle.verify("Ed25519", key, signature, signedBytes)`.
 */
import { BRAND } from "../brand.js";

const P = BRAND.abbrev.toUpperCase();
/** Text prefix of a portal (rotating) QR. */
export const QR_PREFIX_PORTAL = `${P}P1.` as const;
/** Text prefix of an emailed (single-use) QR. */
export const QR_PREFIX_EMAIL = `${P}E1.` as const;

export const QR_SIGNATURE_BYTES = 64;
export const QR_KID_BYTES = 4;
export const QR_REF_BYTES = 16;
export const QR_CID_BYTES = 16;
export const QR_BODY_BYTES = { portal: 4 + 4 + 2 + 16, email: 4 + 4 + 16 + 16 } as const;

const b64len = (n: number) => Math.ceil((n * 4) / 3);
/** Exact text length of each code type. */
export const QR_TEXT_LENGTH = {
  portal: QR_PREFIX_PORTAL.length + b64len(QR_BODY_BYTES.portal + QR_SIGNATURE_BYTES),
  email: QR_PREFIX_EMAIL.length + b64len(QR_BODY_BYTES.email + QR_SIGNATURE_BYTES),
} as const;

/* ------------------------------------------------------------- base64url */

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const LOOKUP = new Map([...ALPHA].map((c, i) => [c, i]));

export function base64urlEncode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += ALPHA[(n >> 18) & 63]! + ALPHA[(n >> 12) & 63]! + ALPHA[(n >> 6) & 63]! + ALPHA[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += ALPHA[(n >> 18) & 63]! + ALPHA[(n >> 12) & 63]!;
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += ALPHA[(n >> 18) & 63]! + ALPHA[(n >> 12) & 63]! + ALPHA[(n >> 6) & 63]!;
  }
  return out;
}

/** Strict decoder; returns null on any non-alphabet character or impossible length. */
export function base64urlDecode(s: string): Uint8Array<ArrayBuffer> | null {
  if (s.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let o = 0;
  for (const ch of s) {
    const v = LOOKUP.get(ch);
    if (v === undefined) return null;
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (value >> bits) & 0xff;
    }
  }
  return out;
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/* ----------------------------------------------------------------- parse */

export interface ParsedQrBase {
  /** `qr_kid` of the signing key (8 hex chars). */
  kid: string;
  /** Expiry, unix seconds. */
  exp: number;
  /** base64url of the 16-byte credential reference. */
  ref: string;
  /** Exactly the bytes the signature covers: ASCII(prefix) ‖ body. */
  signed: Uint8Array<ArrayBuffer>;
  signature: Uint8Array<ArrayBuffer>;
}
export type ParsedQr =
  | (ParsedQrBase & { kind: "portal"; /** Validity window, seconds: valid from exp − ttl. */ ttl: number })
  | (ParsedQrBase & { kind: "email"; /** base64url of the 16-byte carrier id. */ cid: string });

/**
 * Parse a scanned QR text. Returns null for anything that is not one of our codes (a third-party
 * QR). Does NOT verify the signature or the time window; the caller must do both.
 */
export function parseSignedQr(text: string): ParsedQr | null {
  const kind = text.startsWith(QR_PREFIX_PORTAL) ? "portal" : text.startsWith(QR_PREFIX_EMAIL) ? "email" : null;
  if (!kind) return null;
  const prefix = kind === "portal" ? QR_PREFIX_PORTAL : QR_PREFIX_EMAIL;
  if (text.length !== QR_TEXT_LENGTH[kind]) return null;
  const encoded = text.slice(prefix.length);
  const raw = base64urlDecode(encoded);
  const bodyLen = QR_BODY_BYTES[kind];
  if (!raw || raw.length !== bodyLen + QR_SIGNATURE_BYTES) return null;
  // Canonical encoding only: one byte string has exactly one accepted text.
  if (base64urlEncode(raw) !== encoded) return null;
  const body = raw.subarray(0, bodyLen);
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const pre = ascii(prefix);
  const signed = new Uint8Array(pre.length + bodyLen);
  signed.set(pre, 0);
  signed.set(body, pre.length);
  const base = {
    kid: hex(body.subarray(0, 4)),
    exp: view.getUint32(4),
    signed,
    signature: raw.slice(bodyLen),
  };
  if (kind === "portal") {
    return { ...base, kind, ttl: view.getUint16(8), ref: base64urlEncode(body.subarray(10, 26)) };
  }
  return { ...base, kind, ref: base64urlEncode(body.subarray(8, 24)), cid: base64urlEncode(body.subarray(24, 40)) };
}

/**
 * Build the bytes to sign for a code (server side). Returns `signed` (to pass to Ed25519 sign) and
 * `finish(signature)`, which produces the QR text.
 */
export function buildSignedQr(
  fields:
    | { kind: "portal"; kid: string; exp: number; ttl: number; ref: string }
    | { kind: "email"; kid: string; exp: number; ref: string; cid: string },
): { signed: Uint8Array<ArrayBuffer>; finish: (signature: Uint8Array) => string } {
  const prefix = fields.kind === "portal" ? QR_PREFIX_PORTAL : QR_PREFIX_EMAIL;
  const body = new Uint8Array(QR_BODY_BYTES[fields.kind]);
  const view = new DataView(body.buffer);
  if (!/^[0-9a-f]{8}$/.test(fields.kid)) throw new Error("kid must be 8 lowercase hex characters");
  for (let i = 0; i < 4; i++) body[i] = parseInt(fields.kid.slice(i * 2, i * 2 + 2), 16);
  view.setUint32(4, fields.exp);
  const ref = base64urlDecode(fields.ref);
  if (!ref || ref.length !== QR_REF_BYTES) throw new Error("ref must be 16 bytes, base64url");
  if (fields.kind === "portal") {
    view.setUint16(8, fields.ttl);
    body.set(ref, 10);
  } else {
    body.set(ref, 8);
    const cid = base64urlDecode(fields.cid);
    if (!cid || cid.length !== QR_CID_BYTES) throw new Error("cid must be 16 bytes, base64url");
    body.set(cid, 24);
  }
  const pre = ascii(prefix);
  const signed = new Uint8Array(pre.length + body.length);
  signed.set(pre, 0);
  signed.set(body, pre.length);
  return {
    signed,
    finish: (signature) => {
      if (signature.length !== QR_SIGNATURE_BYTES) throw new Error("Ed25519 signature must be 64 bytes");
      const all = new Uint8Array(body.length + signature.length);
      all.set(body, 0);
      all.set(signature, body.length);
      return prefix + base64urlEncode(all);
    },
  };
}
