import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

/** High-entropy opaque token, base64url. 32 bytes = 256 bits. Never sequential, never a DB id. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256b64url(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("base64url");
}

export function sha256hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/* ---------------------------------------------------------------- passwords */

// scrypt N=2^15, r=8, p=1 (OWASP minimum is N=2^17 for interactive logins; 2^15 keeps the
// dev loop fast; raise via env SCRYPT_LOG_N in production).
const SCRYPT_KEYLEN = 32;

function scrypt(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize("NFKC"), salt, SCRYPT_KEYLEN, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** Format: `scrypt$<logN>$<r>$<p>$<salt b64url>$<hash b64url>` */
export async function hashPassword(password: string, logN = Number(process.env.SCRYPT_LOG_N ?? 15)): Promise<string> {
  const salt = randomBytes(16);
  const r = 8;
  const p = 1;
  const key = await scrypt(password, salt, { N: 2 ** logN, r, p, maxmem: 256 * 1024 * 1024 });
  return `scrypt$${logN}$${r}$${p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, logN, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hashB64, "base64url");
  const key = await scrypt(password, Buffer.from(saltB64, "base64url"), {
    N: 2 ** Number(logN),
    r: Number(r),
    p: Number(p),
    maxmem: 256 * 1024 * 1024,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/* --------------------------------------------------------------------- TOTP */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** RFC 6238 TOTP, SHA-1, 6 digits, 30 s step. */
export function totp(secretB32: string, atMs: number, step = 30): string {
  const counter = Math.floor(atMs / 1000 / step);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32Decode(secretB32)).update(msg).digest();
  const offset = h[h.length - 1]! & 0x0f;
  const code = ((h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
  return code;
}

/** Accepts the current step and one either side (±30 s drift). */
export function verifyTotp(secretB32: string, code: string, atMs: number): boolean {
  for (const d of [-1, 0, 1]) {
    if (safeEqual(totp(secretB32, atMs + d * 30_000), code)) return true;
  }
  return false;
}
