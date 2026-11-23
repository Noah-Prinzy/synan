/**
 * Rotating portal QR codes (D-05, D-12, O-07), in the real wire format from
 * `@synan/contracts/qr` (`SYP1.` + base64url body + signature). The server signs with
 * Ed25519; the mock fills the 64 signature bytes deterministically, so the QR has
 * exactly the production length and density.
 */
import { base64urlEncode, buildSignedQr } from "@synan/contracts/qr";
import { createRng, hashString } from "./random";
import type { PortalCode, PortalCodeBatch } from "./types";

/** O-07 working assumption: each code is valid 60 s, the portal holds 15 minutes ahead. */
export const CODE_TTL_S = 60;
export const CODES_AHEAD = 15;
const KID = "5e7a11c0";

function bytesFrom(seed: string, length: number): Uint8Array {
  const rng = createRng(hashString(seed));
  return Uint8Array.from({ length }, () => Math.floor(rng() * 256));
}

/** The registration's 16-byte reference, from its UUID. */
function refFor(registrationId: string): string {
  const hex = registrationId.replace(/-/g, "").padEnd(32, "0").slice(0, 32);
  return base64urlEncode(Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16)));
}

export function codeFor(registrationId: string, windowIndex: number): PortalCode {
  const nbf = windowIndex * CODE_TTL_S;
  const exp = nbf + CODE_TTL_S;
  const { finish } = buildSignedQr({ kind: "portal", kid: KID, exp, ttl: CODE_TTL_S, ref: refFor(registrationId) });
  return {
    code: finish(bytesFrom(`${registrationId}:${windowIndex}`, 64)),
    not_before: new Date(nbf * 1000).toISOString(),
    expires_at: new Date(exp * 1000).toISOString(),
  };
}

/** A batch of `count` consecutive codes starting with the one valid at `nowMs`. */
export function codeBatch(registrationId: string, nowMs: number, count = CODES_AHEAD): PortalCodeBatch {
  const first = Math.floor(nowMs / 1000 / CODE_TTL_S);
  return {
    kid: KID,
    codes: Array.from({ length: count }, (_, i) => codeFor(registrationId, first + i)),
    rotate_every_s: CODE_TTL_S,
    server_time: new Date(nowMs).toISOString(),
  };
}

/** The code to show at `nowMs`, or null once the batch is exhausted. */
export function currentCode(batch: PortalCodeBatch, nowMs: number): PortalCode | null {
  return (
    batch.codes.find((code) => Date.parse(code.not_before) <= nowMs && nowMs < Date.parse(code.expires_at)) ?? null
  );
}
