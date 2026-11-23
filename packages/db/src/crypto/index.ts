/**
 * Field encryption for stored secrets (docs/03-security-privacy.md §5–§6): AES-256-GCM with
 * versioned, self-describing envelopes, row-bound associated data, multiple key versions, and a
 * keyed blind index on a separate key. Node `crypto` only.
 *
 * Envelope (text, safe in any text column):
 *
 *     ev1.<kid>.<iv>.<ciphertext+tag>          iv: 12 bytes, tag: 16 bytes, both base64url
 *
 * Associated data binds the envelope to its place: "ev1\0<kid>\0<table>\0<column>\0<rowId>". A value
 * copied to another row, column or table fails authentication, as does any edit to kid, iv or bytes.
 *
 * Keys never leave the KeyProvider/Cipher closures: they are not enumerable, not inspectable, not
 * serialisable, and no error message contains key material or plaintext.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { inspect } from "node:util";

export type KeyPurpose = "data" | "blind_index";

/**
 * Where keys come from. Implemented today by EnvKeyProvider (environment variables) and
 * StaticKeyProvider (tests, dev seed). A KMS-backed provider implements the same three methods —
 * e.g. holding KMS-wrapped data keys in configuration and unwrapping them in getKey() — and nothing
 * else in the package changes.
 */
export interface KeyProvider {
  /** Key id for new encryptions (data) or new index values (blind_index). */
  activeKeyId(purpose: KeyPurpose): string;
  /** Every key id that may still appear in stored data, including the active one. */
  keyIds(purpose: KeyPurpose): readonly string[];
  /** Raw key bytes. Data keys are exactly 32 bytes; blind-index keys at least 16. */
  getKey(purpose: KeyPurpose, kid: string): Promise<Uint8Array>;
  /** True for the fixed development keys. createCipher() refuses these when NODE_ENV=production. */
  readonly isDevelopmentKeys?: boolean;
}

export class CipherError extends Error {
  constructor(
    readonly code: "malformed" | "unknown_key" | "decrypt_failed" | "plaintext_rejected" | "bad_key",
    message: string,
  ) {
    super(message);
    this.name = "CipherError";
  }
}

const KID_RE = /^[A-Za-z0-9_-]{1,32}$/;
/** Matches any well-formed envelope. Also used by the (prepared) database enforcement. */
export const ENVELOPE_RE = /^ev1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/;
export const ENVELOPE_SQL_PATTERN = "^ev1\\.[A-Za-z0-9_-]{1,32}\\.[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]{22,}$";

/** Where an encrypted value lives. Becomes associated data. */
export interface FieldContext {
  table: string;
  column: string;
  rowId: string;
}

/* ------------------------------------------------------------------ providers */

type KeyMap = Map<string, Uint8Array>;

class MapKeyProvider implements KeyProvider {
  readonly #keys: Record<KeyPurpose, KeyMap>;
  readonly #active: Record<KeyPurpose, string>;
  readonly isDevelopmentKeys: boolean;

  constructor(keys: Record<KeyPurpose, KeyMap>, active: Record<KeyPurpose, string>, dev = false) {
    for (const purpose of ["data", "blind_index"] as const) {
      if (!keys[purpose].has(active[purpose])) {
        throw new CipherError("bad_key", `active ${purpose} key id "${active[purpose]}" is not among the configured keys`);
      }
      for (const [kid, k] of keys[purpose]) {
        if (!KID_RE.test(kid)) throw new CipherError("bad_key", `invalid key id "${kid}" (use [A-Za-z0-9_-], 1–32 chars)`);
        if (purpose === "data" && k.length !== 32) throw new CipherError("bad_key", `data key "${kid}" must be 32 bytes`);
        if (purpose === "blind_index" && k.length < 16) throw new CipherError("bad_key", `blind-index key "${kid}" must be at least 16 bytes`);
      }
    }
    this.#keys = keys;
    this.#active = active;
    this.isDevelopmentKeys = dev;
  }
  activeKeyId(purpose: KeyPurpose) {
    return this.#active[purpose];
  }
  keyIds(purpose: KeyPurpose) {
    return [...this.#keys[purpose].keys()];
  }
  async getKey(purpose: KeyPurpose, kid: string) {
    const k = this.#keys[purpose].get(kid);
    if (!k) throw new CipherError("unknown_key", `unknown ${purpose} key id "${kid}"`);
    return k;
  }
  [inspect.custom]() {
    return `KeyProvider { data: [${this.keyIds("data").join(", ")}], blind_index: [${this.keyIds("blind_index").join(", ")}] }`;
  }
  toJSON() {
    return { data: this.keyIds("data"), blind_index: this.keyIds("blind_index") };
  }
}

/** Fixed keys from code — tests and seeds. */
export class StaticKeyProvider extends MapKeyProvider {
  constructor(opts: {
    data: Record<string, Uint8Array>;
    blindIndex: Record<string, Uint8Array>;
    activeData?: string;
    activeBlindIndex?: string;
    development?: boolean;
  }) {
    const data = new Map(Object.entries(opts.data));
    const bi = new Map(Object.entries(opts.blindIndex));
    super(
      { data, blind_index: bi },
      { data: opts.activeData ?? [...data.keys()].at(-1)!, blind_index: opts.activeBlindIndex ?? [...bi.keys()].at(-1)! },
      opts.development ?? false,
    );
  }
}

/**
 * Keys from environment variables:
 *
 *   DB_DATA_KEYS               "kid:base64,kid:base64"      32-byte AES keys (base64 or base64url)
 *   DB_DATA_KEY_ACTIVE         kid used for new encryptions  (default: the last listed)
 *   DB_BLIND_INDEX_KEYS        "kid:base64,…"               HMAC keys, ≥ 16 bytes; an entry may be
 *                              "kid:utf8:<secret>" to keep a legacy string key during migration
 *   DB_BLIND_INDEX_KEY_ACTIVE  kid for new index values       (default: the last listed)
 */
export class EnvKeyProvider extends MapKeyProvider {
  static fromEnv(env: Record<string, string | undefined> = process.env): EnvKeyProvider {
    const parse = (name: string, allowUtf8: boolean): KeyMap => {
      const raw = env[name];
      if (!raw || !raw.trim()) throw new CipherError("bad_key", `${name} is not set`);
      const map: KeyMap = new Map();
      for (const entry of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
        const i = entry.indexOf(":");
        if (i <= 0) throw new CipherError("bad_key", `${name}: entries are "kid:key"`);
        const kid = entry.slice(0, i);
        const rest = entry.slice(i + 1);
        if (allowUtf8 && rest.startsWith("utf8:")) map.set(kid, Buffer.from(rest.slice(5), "utf8"));
        else map.set(kid, Buffer.from(rest.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
      }
      return map;
    };
    const data = parse("DB_DATA_KEYS", false);
    const bi = parse("DB_BLIND_INDEX_KEYS", true);
    return new EnvKeyProvider(
      { data, blind_index: bi },
      {
        data: env.DB_DATA_KEY_ACTIVE || [...data.keys()].at(-1)!,
        blind_index: env.DB_BLIND_INDEX_KEY_ACTIVE || [...bi.keys()].at(-1)!,
      },
    );
  }
}

const devKey = (label: string) => createHash("sha256").update(`development only — ${label}`).digest();

/**
 * Fixed development keys (data "dev1", blind index "devbi1"). Used by the seed and tests so
 * seeded ciphertext is real and reproducible. Refused by createCipher() when NODE_ENV=production.
 */
export function devKeyProvider(): StaticKeyProvider {
  return new StaticKeyProvider({
    data: { dev1: devKey("data key 1") },
    blindIndex: { devbi1: devKey("blind index key 1") },
    development: true,
  });
}

/** Generates a fresh 32-byte key as base64 — for provisioning DB_DATA_KEYS / DB_BLIND_INDEX_KEYS. */
export function generateKeyMaterial(): string {
  return randomBytes(32).toString("base64");
}

/* --------------------------------------------------------------------- cipher */

export function normalizeEmail(email: string): string {
  return email.normalize("NFKC").trim().toLowerCase();
}

export interface Cipher {
  readonly activeDataKeyId: string;
  readonly activeBlindIndexKeyId: string;
  /** Whether stored values that are not envelopes are returned as legacy plaintext (true) or refused. */
  readonly allowLegacyPlaintext: boolean;
  encrypt(plaintext: string, ctx: FieldContext): string;
  /** Decrypts an envelope; with allowLegacyPlaintext, returns a non-envelope value unchanged. */
  decrypt(stored: string, ctx: FieldContext): string;
  isEnvelope(value: unknown): value is string;
  keyIdOf(envelope: string): string | null;
  /** Blind index (64 hex) under the active blind-index key. */
  blindIndex(value: string): string;
  /** Blind index under every configured blind-index key, active first — for lookups during rotation. */
  blindIndexCandidates(value: string): string[];
}

export interface CreateCipherOptions {
  /** Default true while existing rows may still be plaintext; set false once enforcement is on. */
  allowLegacyPlaintext?: boolean;
}

const aad = (kid: string, ctx: FieldContext) =>
  Buffer.from(["ev1", kid, ctx.table, ctx.column, ctx.rowId].join("\u0000"), "utf8");

/** Loads every key from the provider once, then encrypts and decrypts synchronously. */
export async function createCipher(provider: KeyProvider, options: CreateCipherOptions = {}): Promise<Cipher> {
  if (provider.isDevelopmentKeys && process.env.NODE_ENV === "production") {
    throw new CipherError("bad_key", "development keys are not allowed when NODE_ENV=production");
  }
  const dataKeys: KeyMap = new Map();
  for (const kid of provider.keyIds("data")) dataKeys.set(kid, Buffer.from(await provider.getKey("data", kid)));
  const biKeys: KeyMap = new Map();
  for (const kid of provider.keyIds("blind_index")) biKeys.set(kid, Buffer.from(await provider.getKey("blind_index", kid)));
  const activeData = provider.activeKeyId("data");
  const activeBi = provider.activeKeyId("blind_index");
  const allowLegacyPlaintext = options.allowLegacyPlaintext ?? true;

  const hmac = (kid: string, value: string) =>
    createHmac("sha256", biKeys.get(kid)!).update(normalizeEmail(value), "utf8").digest("hex");

  const cipher: Cipher = {
    activeDataKeyId: activeData,
    activeBlindIndexKeyId: activeBi,
    allowLegacyPlaintext,
    encrypt(plaintext, ctx) {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", dataKeys.get(activeData)!, iv);
      c.setAAD(aad(activeData, ctx));
      const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final(), c.getAuthTag()]);
      return `ev1.${activeData}.${iv.toString("base64url")}.${ct.toString("base64url")}`;
    },
    decrypt(stored, ctx) {
      if (!ENVELOPE_RE.test(stored)) {
        if (stored.startsWith("ev1.")) throw new CipherError("malformed", `malformed envelope in ${ctx.table}.${ctx.column}`);
        if (allowLegacyPlaintext) return stored;
        throw new CipherError("plaintext_rejected", `${ctx.table}.${ctx.column} holds a value that is not encrypted`);
      }
      const [, kid, ivB, ctB] = stored.split(".") as [string, string, string, string];
      const key = dataKeys.get(kid);
      if (!key) throw new CipherError("unknown_key", `${ctx.table}.${ctx.column} is encrypted under unknown key "${kid}"`);
      const iv = Buffer.from(ivB, "base64url");
      const all = Buffer.from(ctB, "base64url");
      if (iv.length !== 12 || all.length < 16) throw new CipherError("malformed", `malformed envelope in ${ctx.table}.${ctx.column}`);
      try {
        const d = createDecipheriv("aes-256-gcm", key, iv);
        d.setAAD(aad(kid, ctx));
        d.setAuthTag(all.subarray(all.length - 16));
        return Buffer.concat([d.update(all.subarray(0, all.length - 16)), d.final()]).toString("utf8");
      } catch {
        throw new CipherError(
          "decrypt_failed",
          `${ctx.table}.${ctx.column} failed authentication (tampered, or copied from another row)`,
        );
      }
    },
    isEnvelope(value): value is string {
      return typeof value === "string" && ENVELOPE_RE.test(value);
    },
    keyIdOf(envelope) {
      return ENVELOPE_RE.test(envelope) ? envelope.split(".")[1]! : null;
    },
    blindIndex(value) {
      return hmac(activeBi, value);
    },
    blindIndexCandidates(value) {
      return [...new Set([activeBi, ...biKeys.keys()].map((kid) => hmac(kid, value)))];
    },
  };
  Object.defineProperty(cipher, inspect.custom, {
    value: () => `Cipher { data: [${[...dataKeys.keys()].join(", ")}] active ${activeData}, blind_index: [${[...biKeys.keys()].join(", ")}] active ${activeBi} }`,
  });
  Object.defineProperty(cipher, "toJSON", {
    value: () => ({ data: [...dataKeys.keys()], activeData, blind_index: [...biKeys.keys()], activeBlindIndex: activeBi }),
  });
  return Object.freeze(cipher);
}
