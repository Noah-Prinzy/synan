import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BRAND } from "../src/brand.js";
import { Id } from "../src/common.js";
import { DENY_RESULTS, ERROR_COPY, SCAN_RESULT_COPY, SCAN_RESULT_TONE } from "../src/copy/index.js";
import { ErrorCode } from "../src/errors/index.js";
import * as errorsModule from "../src/errors/index.js";
import { SCAN_RESULT_VALUES } from "../src/enums/index.js";
import {
  base64urlDecode,
  base64urlEncode,
  buildSignedQr,
  parseSignedQr,
  QR_PREFIX_EMAIL,
  QR_PREFIX_PORTAL,
  QR_TEXT_LENGTH,
} from "../src/qr/index.js";
import { endpoints, PortalCode, WS_SUBPROTOCOL, WS_TICKET_PREFIX } from "../src/rest/index.js";
import { ClientMessage, TelemetryServerMessage } from "../src/ws/index.js";

const subtle = webcrypto.subtle;

describe("REST registry", () => {
  it("covers every endpoint in docs/02 §5 (68) plus 9 additive endpoints (email-link, logout, me/registration, credentials/:id/scans, venue update, checkpoint create/update, event state, event admin view)", () => {
    expect(Object.keys(endpoints)).toHaveLength(77);
  });
  it("canonicalises ids to lower case at the boundary", () => {
    const upper = "3F2504E0-4F89-41D3-9A0C-0305E82C3301";
    expect(Id.parse(upper)).toBe(upper.toLowerCase());
    expect(endpoints.postScans.body.parse({ event_id: upper, device_id: "d", scans: [{
      idem_key: "abcdefghijklmnop", checkpoint_id: upper, presented: { medium: "nfc", uid: "AABBCCDD" },
      occurred_at: new Date().toISOString(), clock_offset_ms: 0, offline: false,
    }] }).event_id).toBe(upper.toLowerCase());
  });
  it("has no duplicate method + path", () => {
    const keys = Object.values(endpoints).map((e) => `${e.method} ${e.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("never lets a client send its own tier when registering", () => {
    expect(endpoints.createRegistration.body.safeParse({ event_id: webcrypto.randomUUID(), zone_presence_consent: true, tier: "VIP" }).success).toBe(false);
  });
});

describe("copy", () => {
  it("has copy for every error code and scan result, and never names the product", () => {
    for (const c of ErrorCode.options) expect(ERROR_COPY[c].message.length).toBeGreaterThan(0);
    const all = JSON.stringify([ERROR_COPY, SCAN_RESULT_COPY]).toLowerCase();
    expect(all).not.toContain(BRAND.name.toLowerCase());
    for (const r of SCAN_RESULT_VALUES) {
      expect(SCAN_RESULT_COPY[r].label.length).toBeGreaterThan(0);
      expect(SCAN_RESULT_TONE[r]).toBe(SCAN_RESULT_COPY[r].tone);
    }
    expect([...DENY_RESULTS].sort()).toEqual(SCAN_RESULT_VALUES.filter((r) => !SCAN_RESULT_COPY[r].admits).sort());
  });
  it("errors/ re-exports the same objects", () => {
    expect(errorsModule.SCAN_RESULT_COPY).toBe(SCAN_RESULT_COPY);
    expect(errorsModule.ERROR_COPY).toBe(ERROR_COPY);
  });
  it.each(["copy/index.ts", "qr/index.ts", "brand.ts"])("src/%s has no runtime imports except Zod-free siblings", (file) => {
    const src = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    const runtimeImports = [...src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(runtimeImports.every((p) => p === "../brand.js")).toBe(true);
    expect(src).not.toMatch(/from\s+"zod"/);
  });
});

describe("brand-derived wire constants", () => {
  it("all derive from BRAND", () => {
    expect(WS_SUBPROTOCOL.startsWith(BRAND.slug)).toBe(true);
    expect(WS_TICKET_PREFIX.startsWith(BRAND.abbrev)).toBe(true);
    for (const p of [QR_PREFIX_PORTAL, QR_PREFIX_EMAIL]) expect(p.startsWith(BRAND.abbrev.toUpperCase())).toBe(true);
    expect(QR_PREFIX_PORTAL).not.toBe(QR_PREFIX_EMAIL);
  });
});

describe("compact signed QR", () => {
  const rand = (n: number) => base64urlEncode(webcrypto.getRandomValues(new Uint8Array(n)));

  async function keypair() {
    const kp = (await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as unknown as webcrypto.CryptoKeyPair;
    const raw = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
    const kid = [...new Uint8Array(await subtle.digest("SHA-256", raw)).subarray(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return { ...kp, kid };
  }

  it("base64url round-trips every length", () => {
    for (let n = 0; n < 40; n++) {
      const b = webcrypto.getRandomValues(new Uint8Array(n));
      expect(base64urlDecode(base64urlEncode(b))).toEqual(b);
    }
    expect(base64urlDecode("ab+c")).toBeNull();
  });

  it("portal code: 125 characters, round-trips, verifies with the public key only", async () => {
    const k = await keypair();
    const ref = rand(16);
    const { signed, finish } = buildSignedQr({ kind: "portal", kid: k.kid, exp: 1_800_000_000, ttl: 60, ref });
    const text = finish(new Uint8Array(await subtle.sign("Ed25519", k.privateKey, signed)));
    expect(text.length).toBe(125);
    expect(text.length).toBe(QR_TEXT_LENGTH.portal);
    expect(PortalCode.shape.code.safeParse(text).success).toBe(true);
    const p = parseSignedQr(text)!;
    expect(p).toMatchObject({ kind: "portal", kid: k.kid, exp: 1_800_000_000, ttl: 60, ref });
    expect(await subtle.verify("Ed25519", k.publicKey, p.signature, p.signed)).toBe(true);
  });

  it("emailed code: 144 characters, distinct prefix, carries the carrier id", async () => {
    const k = await keypair();
    const ref = rand(16);
    const cid = rand(16);
    const { signed, finish } = buildSignedQr({ kind: "email", kid: k.kid, exp: 1_800_000_000, ref, cid });
    const text = finish(new Uint8Array(await subtle.sign("Ed25519", k.privateKey, signed)));
    expect(text.length).toBe(QR_TEXT_LENGTH.email);
    expect(text.length).toBe(144);
    expect(text.startsWith(QR_PREFIX_EMAIL)).toBe(true);
    const p = parseSignedQr(text)!;
    expect(p).toMatchObject({ kind: "email", ref, cid });
    expect(await subtle.verify("Ed25519", k.publicKey, p.signature, p.signed)).toBe(true);
  });

  it("the signature binds the type: a portal body relabelled as email does not parse or verify", async () => {
    const k = await keypair();
    const { signed, finish } = buildSignedQr({ kind: "portal", kid: k.kid, exp: 1_800_000_000, ttl: 60, ref: rand(16) });
    const text = finish(new Uint8Array(await subtle.sign("Ed25519", k.privateKey, signed)));
    expect(parseSignedQr(QR_PREFIX_EMAIL + text.slice(QR_PREFIX_PORTAL.length))).toBeNull(); // wrong length for email
    const tampered = text.slice(0, 20) + (text[20] === "A" ? "B" : "A") + text.slice(21);
    const p = parseSignedQr(tampered)!;
    expect(await subtle.verify("Ed25519", k.publicKey, p.signature, p.signed)).toBe(false);
  });

  it("rejects third-party text, wrong lengths and non-canonical base64", () => {
    expect(parseSignedQr("https://example.com/x")).toBeNull();
    expect(parseSignedQr(QR_PREFIX_PORTAL + "A".repeat(119))).toBeNull();
    // 104 email bytes leave 2 padding bits in the last character; setting one is non-canonical.
    const canonical = QR_PREFIX_EMAIL + "A".repeat(139);
    expect(parseSignedQr(canonical)).not.toBeNull();
    expect(parseSignedQr(canonical.slice(0, -1) + "B")).toBeNull();
  });
});

describe("WebSocket unions", () => {
  it("parse the documented frames and reject unknown types", () => {
    expect(ClientMessage.parse({ type: "hello", last_event_id: "abc.1" }).type).toBe("hello");
    expect(ClientMessage.safeParse({ type: "subscribe_all" }).success).toBe(false);
    const id = webcrypto.randomUUID();
    const delta = {
      id: "b.2", type: "occupancy.delta", at: new Date().toISOString(),
      data: { event_id: id, rooms: [{ room_id: id, zone_id: id, occupancy: null, capacity: 10, level: "ok" }], zones: [] },
    };
    expect(TelemetryServerMessage.parse(delta).type).toBe("occupancy.delta");
  });
});
