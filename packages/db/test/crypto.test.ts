import { randomBytes } from "node:crypto";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import {
  CipherError,
  createCipher,
  devKeyProvider,
  ENVELOPE_RE,
  EnvKeyProvider,
  StaticKeyProvider,
  type Cipher,
} from "../src/crypto/index";

const k1 = randomBytes(32);
const k2 = randomBytes(32);
const b1 = randomBytes(32);
const b2 = randomBytes(32);
const cipherWith = (data: Record<string, Uint8Array>, bi: Record<string, Uint8Array>, opts: { activeData?: string; activeBlindIndex?: string; legacy?: boolean } = {}) =>
  createCipher(new StaticKeyProvider({ data, blindIndex: bi, activeData: opts.activeData, activeBlindIndex: opts.activeBlindIndex }), {
    allowLegacyPlaintext: opts.legacy ?? true,
  });
const where = { table: "pii_vault.attendees", column: "email", rowId: "11111111-1111-4111-8111-111111111111" };

async function errCode(f: () => unknown): Promise<string> {
  try {
    await f();
  } catch (e) {
    expect(e).toBeInstanceOf(CipherError);
    return (e as CipherError).code;
  }
  throw new Error("expected a CipherError");
}

describe("envelope encryption", () => {
  it("round-trips, is self-describing, and uses a fresh IV each time", async () => {
    const c = await cipherWith({ k1 }, { b1 });
    const a = c.encrypt("ada@example.test", where);
    const b = c.encrypt("ada@example.test", where);
    expect(a).toMatch(ENVELOPE_RE);
    expect(a.startsWith("ev1.k1.")).toBe(true);
    expect(a).not.toBe(b);
    expect(c.keyIdOf(a)).toBe("k1");
    expect(c.decrypt(a, where)).toBe("ada@example.test");
    expect(c.decrypt(c.encrypt("Zoë 🎟️", where), where)).toBe("Zoë 🎟️");
    expect(c.decrypt(c.encrypt("", where), where)).toBe("");
  });

  it("detects tampering with the ciphertext, the IV or the key id", async () => {
    const c = await cipherWith({ k1, k2 }, { b1 }, { activeData: "k1" });
    const env = c.encrypt("secret", where);
    const [v, kid, iv, ct] = env.split(".") as [string, string, string, string];
    const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
    expect(await errCode(() => c.decrypt([v, kid, iv, flip(ct, 3)].join("."), where))).toBe("decrypt_failed");
    expect(await errCode(() => c.decrypt([v, kid, flip(iv, 2), ct].join("."), where))).toBe("decrypt_failed");
    expect(await errCode(() => c.decrypt([v, "k2", iv, ct].join("."), where))).toBe("decrypt_failed");
    expect(await errCode(() => c.decrypt([v, kid, iv, ct.slice(0, 10)].join("."), where))).toBe("malformed");
    expect(await errCode(() => c.decrypt("ev1.garbage", where))).toBe("malformed");
  });

  it("binds a value to its table, column and row: substitution is rejected", async () => {
    const c = await cipherWith({ k1 }, { b1 });
    const env = c.encrypt("ada@example.test", where);
    expect(await errCode(() => c.decrypt(env, { ...where, rowId: "22222222-2222-4222-8222-222222222222" }))).toBe("decrypt_failed");
    expect(await errCode(() => c.decrypt(env, { ...where, column: "full_name" }))).toBe("decrypt_failed");
    expect(await errCode(() => c.decrypt(env, { ...where, table: "users" }))).toBe("decrypt_failed");
  });

  it("supports several key versions: encrypts with the newest, decrypts with any", async () => {
    const old = await cipherWith({ k1 }, { b1 });
    const both = await cipherWith({ k1, k2 }, { b1 }, { activeData: "k2" });
    const onlyNew = await cipherWith({ k2 }, { b1 });
    const fromOld = old.encrypt("x", where);
    const fromNew = both.encrypt("y", where);
    expect(both.keyIdOf(fromNew)).toBe("k2");
    expect(both.decrypt(fromOld, where)).toBe("x");
    expect(both.decrypt(fromNew, where)).toBe("y");
    expect(await errCode(() => onlyNew.decrypt(fromOld, where))).toBe("unknown_key");
  });

  it("passes legacy plaintext through only while allowed", async () => {
    const lenient = await cipherWith({ k1 }, { b1 });
    const strict = await cipherWith({ k1 }, { b1 }, { legacy: false });
    expect(lenient.decrypt("plain@example.test", where)).toBe("plain@example.test");
    expect(await errCode(() => strict.decrypt("plain@example.test", where))).toBe("plaintext_rejected");
  });
});

describe("blind index", () => {
  it("is deterministic, normalised, keyed, and offers every key's value during rotation", async () => {
    const c1 = await cipherWith({ k1 }, { b1 });
    const c2 = await cipherWith({ k1 }, { b1, b2 }, { activeBlindIndex: "b2" });
    const h = c1.blindIndex("Ada@Example.TEST ");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(c1.blindIndex("ada@example.test")).toBe(h);
    expect(c2.blindIndex("ada@example.test")).not.toBe(h);
    expect(c2.blindIndexCandidates("ada@example.test")).toEqual([c2.blindIndex("ada@example.test"), h]);
  });
});

describe("key providers", () => {
  it("read keys from the environment (base64, base64url, and a legacy utf8 blind-index key)", async () => {
    const env = {
      DB_DATA_KEYS: `old:${k1.toString("base64")},new:${k2.toString("base64url")}`,
      DB_BLIND_INDEX_KEYS: `legacy:utf8:a-legacy-string-key-from-config,bi1:${b1.toString("base64")}`,
      DB_BLIND_INDEX_KEY_ACTIVE: "bi1",
    };
    const c = await createCipher(EnvKeyProvider.fromEnv(env));
    expect(c.activeDataKeyId).toBe("new");
    expect(c.activeBlindIndexKeyId).toBe("bi1");
    const ref = await cipherWith({ old: k1 }, { bi1: b1 });
    expect(c.decrypt(ref.encrypt("v", where), where)).toBe("v");
    expect(c.blindIndexCandidates("a@b.test")).toHaveLength(2);
  });

  it("refuse bad configuration", () => {
    expect(() => EnvKeyProvider.fromEnv({})).toThrow(/DB_DATA_KEYS is not set/);
    expect(() => EnvKeyProvider.fromEnv({ DB_DATA_KEYS: `a:${randomBytes(16).toString("base64")}`, DB_BLIND_INDEX_KEYS: `b:${b1.toString("base64")}` })).toThrow(/32 bytes/);
    expect(() => EnvKeyProvider.fromEnv({ DB_DATA_KEYS: `a:${k1.toString("base64")}`, DB_BLIND_INDEX_KEYS: `b:${b1.toString("base64")}`, DB_DATA_KEY_ACTIVE: "zz" })).toThrow(/not among/);
    expect(() => EnvKeyProvider.fromEnv({ DB_DATA_KEYS: `bad.kid:${k1.toString("base64")}`, DB_BLIND_INDEX_KEYS: `b:${b1.toString("base64")}` })).toThrow(/invalid key id/);
  });

  it("never reveal key material through inspect, JSON or error messages", async () => {
    const env = { DB_DATA_KEYS: `k:${k1.toString("base64")}`, DB_BLIND_INDEX_KEYS: `b:${b1.toString("base64")}` };
    const p = EnvKeyProvider.fromEnv(env);
    const c: Cipher = await createCipher(p);
    const dumps = [inspect(p, { depth: 10, showHidden: true }), inspect(c, { depth: 10, showHidden: true }), JSON.stringify(p), JSON.stringify(c)];
    for (const d of dumps) {
      for (const k of [k1, b1]) {
        expect(d).not.toContain(k.toString("base64"));
        expect(d).not.toContain(k.toString("hex"));
      }
    }
    try {
      c.decrypt(c.encrypt("top secret value", where), { ...where, rowId: "x" });
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("top secret value");
    }
  });

  it("refuse the development keys in production", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await expect(createCipher(devKeyProvider())).rejects.toThrow(/development keys/);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
