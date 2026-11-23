/**
 * Signed QR codes (D-12, 03 §2), in the compact format defined in `@synan/contracts/qr`:
 *
 *   portal: PREFIX_PORTAL + base64url(kid4 ‖ exp u32 ‖ ttl u16 ‖ ref16 ‖ Ed25519 sig64)   → 125 chars
 *   email:  PREFIX_EMAIL  + base64url(kid4 ‖ exp u32 ‖ ref16 ‖ cid16 ‖ Ed25519 sig64)    → 144 chars
 *
 * The signature covers the ASCII prefix and the body, so the type and version are signed too.
 * `ref` is the credential's 128-bit reference (credentials.token_hash). `cid` is the random id of a
 * `qr_email` carrier; single use is enforced on that row. Verified with public keys only; a scanner
 * runs the same check offline with WebCrypto.
 */
import { buildSignedQr, parseSignedQr } from "@synan/contracts/qr";
import type { PortalCode } from "@synan/contracts/rest";
import type { UnknownReason } from "./decision.js";
import type { KeyService } from "./keys.js";

export type VerifiedQr =
  | { ok: true; typ: "portal"; credentialRef: string; kid: string }
  | { ok: true; typ: "email"; credentialRef: string; carrierCid: string; kid: string }
  | { ok: false; reason: UnknownReason };

export class QrService {
  constructor(
    private readonly keys: KeyService,
    private readonly opts: { codeTtlS: number; leewayS: number },
  ) {}

  /** `count` consecutive portal codes starting at the window containing `nowMs`. */
  async portalBatch(credentialRef: string, nowMs: number, count: number): Promise<{ kid: string; codes: PortalCode[] }> {
    const ttl = this.opts.codeTtlS;
    const { qrKid, sign } = this.keys.activeQr();
    const windowStart = Math.floor(nowMs / 1000 / ttl) * ttl;
    const codes: PortalCode[] = [];
    for (let i = 0; i < count; i++) {
      const nbf = windowStart + i * ttl;
      const exp = nbf + ttl;
      const { signed, finish } = buildSignedQr({ kind: "portal", kid: qrKid, exp, ttl, ref: credentialRef });
      codes.push({
        code: finish(sign(signed)),
        not_before: new Date(nbf * 1000).toISOString(),
        expires_at: new Date(exp * 1000).toISOString(),
      });
    }
    return { kid: qrKid, codes };
  }

  async emailCode(credentialRef: string, carrierCid: string, _nowMs: number, expMs: number): Promise<string> {
    const { qrKid, sign } = this.keys.activeQr();
    const { signed, finish } = buildSignedQr({ kind: "email", kid: qrKid, exp: Math.floor(expMs / 1000), ref: credentialRef, cid: carrierCid });
    return finish(sign(signed));
  }

  /** Verify a presented QR at `atMs` (the corrected scan time, so offline scans verify as of when they happened). */
  async verify(data: string, atMs: number): Promise<VerifiedQr> {
    const p = parseSignedQr(data);
    if (!p) return { ok: false, reason: "malformed" }; // not one of ours (or unreadable)
    if (!this.keys.verifyQr(p.kid, p.signed, p.signature)) return { ok: false, reason: "bad_signature" };
    const now = atMs / 1000;
    const leeway = this.opts.leewayS;
    // Written as "must be inside", so a non-finite operand (bad config, bad clock) fails closed.
    if (!(now < p.exp + leeway)) return { ok: false, reason: "expired" };
    if (p.kind === "portal") {
      if (!(now >= p.exp - p.ttl - leeway)) return { ok: false, reason: "not_yet_valid" };
      return { ok: true, typ: "portal", credentialRef: p.ref, kid: p.kid };
    }
    return { ok: true, typ: "email", credentialRef: p.ref, carrierCid: p.cid, kid: p.kid };
  }
}
