/**
 * Encryption of exported files at rest (workbooks, CSVs, PDFs, attendee data exports).
 *
 * Each file has its own random 256-bit key, wrapped by the cipher's active data key as an `ev1`
 * envelope whose associated data names the file's object key — so a file copied under another
 * key does not decrypt, and rotating data keys only needs the (short-lived) files re-wrapped, not
 * re-encrypted. Content is AES-256-GCM in chunks (default 64 KiB), streamed in constant memory.
 *
 * Format:
 *   "EVF1" | u32 header length | header JSON { v, kid, wrapped, chunk, nonce }
 *   then frames: u32 ciphertext length | ciphertext | 16-byte tag
 * Frame i uses nonce = 8-byte random prefix ‖ u32 i, and associated data
 * SHA-256(header) ‖ u32 i ‖ final flag, so frames cannot be reordered, dropped or truncated.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Transform, type TransformCallback } from "node:stream";
import type { Cipher } from "./index";

const MAGIC = Buffer.from("EVF1", "ascii");
const ctxFor = (objectKey: string) => ({ table: "exported_files", column: "file_key", rowId: objectKey });

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}
function aad(headerHash: Buffer, i: number, final: boolean): Buffer {
  return Buffer.concat([headerHash, u32(i), Buffer.from([final ? 1 : 0])]);
}

export interface FileEncryptOptions {
  /** The storage key the file will be written under (bound into the wrapped file key). */
  objectKey: string;
  chunkSize?: number;
}

/** A Transform that encrypts a byte stream. `keyId` is the data key that wrapped the file key (record it). */
export function encryptFileStream(cipher: Cipher, opts: FileEncryptOptions): Transform & { keyId: string } {
  const chunkSize = opts.chunkSize ?? 64 * 1024;
  const fileKey = randomBytes(32);
  const prefix = randomBytes(8);
  const header = Buffer.from(
    JSON.stringify({
      v: 1,
      kid: cipher.activeDataKeyId,
      wrapped: cipher.encrypt(fileKey.toString("base64url"), ctxFor(opts.objectKey)),
      chunk: chunkSize,
      nonce: prefix.toString("base64url"),
    }),
    "utf8",
  );
  const headerHash = createHash("sha256").update(header).digest();
  let pending = Buffer.alloc(0);
  let index = 0;
  let started = false;

  const frame = (plain: Buffer, final: boolean): Buffer => {
    const c = createCipheriv("aes-256-gcm", fileKey, Buffer.concat([prefix, u32(index)]));
    c.setAAD(aad(headerHash, index, final));
    const ct = Buffer.concat([c.update(plain), c.final()]);
    index++;
    return Buffer.concat([u32(ct.length), ct, c.getAuthTag()]);
  };
  const start = (t: Transform) => {
    if (!started) {
      t.push(Buffer.concat([MAGIC, u32(header.length), header]));
      started = true;
    }
  };

  const t = new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      start(this);
      pending = Buffer.concat([pending, chunk]);
      // Keep at least one byte back: the last frame is only known at the end.
      while (pending.length > chunkSize) {
        this.push(frame(pending.subarray(0, chunkSize), false));
        pending = pending.subarray(chunkSize);
      }
      cb();
    },
    flush(cb: TransformCallback) {
      start(this);
      this.push(frame(pending, true));
      fileKey.fill(0);
      cb();
    },
  }) as Transform & { keyId: string };
  t.keyId = cipher.activeDataKeyId;
  return t;
}

/** A Transform that decrypts a stream written by encryptFileStream for the same object key. */
export function decryptFileStream(cipher: Cipher, opts: { objectKey: string }): Transform {
  let buf = Buffer.alloc(0);
  let fileKey: Buffer | null = null;
  let prefix: Buffer | null = null;
  let headerHash: Buffer | null = null;
  let held: { ct: Buffer; tag: Buffer } | null = null;
  let index = 0;

  const open = (f: { ct: Buffer; tag: Buffer }, final: boolean): Buffer => {
    const d = createDecipheriv("aes-256-gcm", fileKey!, Buffer.concat([prefix!, u32(index)]));
    d.setAAD(aad(headerHash!, index, final));
    d.setAuthTag(f.tag);
    try {
      const out = Buffer.concat([d.update(f.ct), d.final()]);
      index++;
      return out;
    } catch {
      throw new Error("encrypted file failed authentication (tampered, truncated, or for another object key)");
    }
  };

  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      try {
        buf = Buffer.concat([buf, chunk]);
        if (!fileKey) {
          if (buf.length < 8) return cb();
          if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error("not an encrypted export file");
          const len = buf.readUInt32BE(4);
          if (buf.length < 8 + len) return cb();
          const header = buf.subarray(8, 8 + len);
          const h = JSON.parse(header.toString("utf8")) as { v: number; wrapped: string; nonce: string };
          if (h.v !== 1) throw new Error(`unsupported encrypted file version ${h.v}`);
          fileKey = Buffer.from(cipher.decrypt(h.wrapped, ctxFor(opts.objectKey)), "base64url");
          prefix = Buffer.from(h.nonce, "base64url");
          headerHash = createHash("sha256").update(header).digest();
          buf = buf.subarray(8 + len);
        }
        for (;;) {
          if (buf.length < 4) break;
          const n = buf.readUInt32BE(0);
          if (buf.length < 4 + n + 16) break;
          const f = { ct: Buffer.from(buf.subarray(4, 4 + n)), tag: Buffer.from(buf.subarray(4 + n, 4 + n + 16)) };
          buf = buf.subarray(4 + n + 16);
          if (held) this.push(open(held, false));
          held = f;
        }
        cb();
      } catch (e) {
        cb(e as Error);
      }
    },
    flush(cb: TransformCallback) {
      try {
        if (!fileKey || !held || buf.length) throw new Error("encrypted file failed authentication (tampered, truncated, or for another object key)");
        this.push(open(held, true));
        fileKey.fill(0);
        cb();
      } catch (e) {
        cb(e as Error);
      }
    },
  });
}

/** Convenience for small files: encrypt a whole buffer. */
export async function encryptFileBuffer(cipher: Cipher, data: Buffer, opts: FileEncryptOptions): Promise<{ bytes: Buffer; keyId: string }> {
  const t = encryptFileStream(cipher, opts);
  const parts: Buffer[] = [];
  t.on("data", (c: Buffer) => parts.push(c));
  const done = new Promise<void>((res, rej) => (t.on("end", res), t.on("error", rej)));
  t.end(data);
  await done;
  return { bytes: Buffer.concat(parts), keyId: t.keyId };
}

/** Convenience for small files: decrypt a whole buffer. */
export async function decryptFileBuffer(cipher: Cipher, bytes: Buffer, opts: { objectKey: string }): Promise<Buffer> {
  const t = decryptFileStream(cipher, opts);
  const parts: Buffer[] = [];
  t.on("data", (c: Buffer) => parts.push(c));
  const done = new Promise<void>((res, rej) => (t.on("end", res), t.on("error", rej)));
  t.end(bytes);
  await done;
  return Buffer.concat(parts);
}
