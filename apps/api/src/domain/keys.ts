/**
 * Ed25519 key management (D-12).
 *
 * - `qr` and `allowlist` keys live in `signing_keys`; the public halves are served at
 *   GET /auth/signing-keys so scanners verify offline without holding any secret.
 * - Compact QR codes name their key by `qr_kid`: the first 4 bytes of SHA-256(raw public key), hex.
 *   Rotation regenerates if a new key's `qr_kid` would collide with one still verifying.
 * - The access-token key is separate and never published; it comes from env or is
 *   generated at startup (dev).
 */
import { createHash, createPrivateKey, createPublicKey, randomUUID, sign, verify, type JsonWebKey as NodeJwk, type KeyObject, type webcrypto } from "node:crypto";
import { exportJWK, generateKeyPair, importJWK, type JWK } from "jose";
import type { SigningKeyPurpose } from "@synan/contracts/enums";
import type { SigningKey } from "@synan/contracts/rest";
import type { Clock } from "../lib/clock.js";
import type { SigningKeysRepo, SigningKeyRow } from "../repo/types.js";

export type Key = webcrypto.CryptoKey;

export interface ActiveKey {
  kid: string;
  privateKey: Key;
}

/** Retired keys keep verifying for this long, so codes signed just before rotation stay valid. */
const RETIRED_VERIFY_GRACE_MS = 24 * 3600 * 1000;

export async function generateEd25519(): Promise<{ privateJwk: JWK; publicJwk: JWK }> {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  return { privateJwk: await exportJWK(privateKey), publicJwk: await exportJWK(publicKey) };
}

export async function importPrivate(jwk: JWK): Promise<Key> {
  return (await importJWK(jwk, "EdDSA")) as Key;
}
export async function importPublic(jwk: JWK): Promise<Key> {
  const { d: _d, ...pub } = jwk;
  return (await importJWK(pub, "EdDSA")) as Key;
}

/** First 4 bytes of SHA-256 of the raw 32-byte Ed25519 public key, hex. */
export function qrKidOf(x: string): string {
  return createHash("sha256").update(Buffer.from(x, "base64url")).digest().subarray(0, 4).toString("hex");
}

interface Cached {
  row: SigningKeyRow;
  pub: Key;
  priv: Key | null;
  qrKid: string;
  nodePub: KeyObject;
  nodePriv: KeyObject | null;
}

export class KeyService {
  private cache = new Map<string, Cached>();

  constructor(
    private readonly repo: SigningKeysRepo,
    private readonly clock: Clock,
  ) {}

  /** Ensure an active key exists for each purpose. Generates one when absent. */
  async init(): Promise<void> {
    for (const purpose of ["qr", "allowlist"] as const) {
      const rows = await this.repo.all();
      if (!rows.some((r) => r.purpose === purpose && r.retired_at === null)) await this.rotate(purpose);
    }
    await this.reload();
  }

  private stillVerifying(row: SigningKeyRow) {
    return !row.retired_at || this.clock.now() - row.retired_at.getTime() <= RETIRED_VERIFY_GRACE_MS;
  }

  async rotate(purpose: SigningKeyPurpose): Promise<string> {
    const now = new Date(this.clock.now());
    const taken = new Set([...this.cache.values()].filter((k) => k.row.purpose === purpose && this.stillVerifying(k.row)).map((k) => k.qrKid));
    let pair = await generateEd25519();
    while (taken.has(qrKidOf(String(pair.publicJwk.x)))) pair = await generateEd25519();
    const kid = randomUUID();
    // Retire the previous active key for this purpose.
    for (const row of await this.repo.all()) {
      if (row.purpose === purpose && row.retired_at === null) await this.repo.retire(row.id, now);
    }
    await this.repo.insert({
      id: kid,
      purpose,
      public_key: JSON.stringify({ ...pair.publicJwk, kid, alg: "EdDSA" }),
      private_key_enc: JSON.stringify(pair.privateJwk),
      active_from: now,
      retired_at: null,
    });
    await this.reload();
    return kid;
  }

  private async reload() {
    this.cache.clear();
    for (const row of await this.repo.all()) {
      const pubJwk = JSON.parse(row.public_key) as JWK;
      const { d: _d, ...pubOnly } = pubJwk;
      const active = row.retired_at === null;
      const privJwk = active ? (JSON.parse(row.private_key_enc) as JWK) : null;
      this.cache.set(row.id, {
        row,
        pub: await importPublic(pubJwk),
        priv: privJwk ? await importPrivate(privJwk) : null,
        qrKid: qrKidOf(String(pubJwk.x)),
        nodePub: createPublicKey({ key: pubOnly as NodeJwk, format: "jwk" }),
        nodePriv: privJwk ? createPrivateKey({ key: privJwk as NodeJwk, format: "jwk" }) : null,
      });
    }
  }

  active(purpose: SigningKeyPurpose): ActiveKey {
    for (const [kid, k] of this.cache) {
      if (k.row.purpose === purpose && k.row.retired_at === null && k.priv) return { kid, privateKey: k.priv };
    }
    throw new Error(`no active ${purpose} key`);
  }

  /** The active QR key: its short id and an Ed25519 signer. */
  activeQr(): { qrKid: string; sign: (data: Uint8Array) => Uint8Array } {
    for (const k of this.cache.values()) {
      if (k.row.purpose === "qr" && k.row.retired_at === null && k.nodePriv) {
        const priv = k.nodePriv;
        return { qrKid: k.qrKid, sign: (data) => new Uint8Array(sign(null, data, priv)) };
      }
    }
    throw new Error("no active qr key");
  }

  /** Verify an Ed25519 signature by a QR key named by its short id. False for unknown or expired-retired keys. */
  verifyQr(qrKid: string, data: Uint8Array, signature: Uint8Array): boolean {
    for (const k of this.cache.values()) {
      if (k.row.purpose !== "qr" || k.qrKid !== qrKid || !this.stillVerifying(k.row)) continue;
      return verify(null, data, k.nodePub, signature);
    }
    return false;
  }

  /** Public key for JWS verification, or null if unknown, wrong purpose, or retired past grace. */
  verificationKey(kid: string, purpose: SigningKeyPurpose): Key | null {
    const k = this.cache.get(kid);
    if (!k || k.row.purpose !== purpose || !this.stillVerifying(k.row)) return null;
    return k.pub;
  }

  publicKeys(): SigningKey[] {
    return [...this.cache.values()]
      .filter((k) => this.stillVerifying(k.row))
      .map(({ row, qrKid }) => {
        const jwk = JSON.parse(row.public_key) as JWK;
        return {
          kid: row.id,
          purpose: row.purpose,
          alg: "EdDSA" as const,
          kty: "OKP" as const,
          crv: "Ed25519" as const,
          x: String(jwk.x),
          qr_kid: qrKid,
          active_from: row.active_from.toISOString(),
          retired_at: row.retired_at ? row.retired_at.toISOString() : null,
        };
      });
  }
}
