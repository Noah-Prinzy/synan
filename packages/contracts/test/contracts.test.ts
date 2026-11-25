import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BRAND } from "../src/brand.js";
import { Id } from "../src/common.js";
import {
  CARRIER_STATE_COPY,
  CREDENTIAL_STATE_COPY,
  DENY_RESULTS,
  ERROR_COPY,
  EVENT_STATE_COPY,
  INVITATION_STATE_COPY,
  REGISTRATION_STATE_COPY,
  ROLE_COPY,
  SCAN_RESULT_COPY,
  SCAN_RESULT_TONE,
} from "../src/copy/index.js";
import { ErrorCode } from "../src/errors/index.js";
import { STAFF_PASSWORD } from "../src/copy/index.js";
import * as errorsModule from "../src/errors/index.js";
import {
  CARRIER_STATE_VALUES,
  CREDENTIAL_STATE_VALUES,
  EVENT_STATE_VALUES,
  InvitationState,
  RegistrationState,
  ROLE_VALUES,
  SCAN_RESULT_VALUES,
} from "../src/enums/index.js";
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
  it("covers every endpoint in docs/02 §5 (68) plus 36 additive endpoints (email-link, logout, me/registration, credentials/:id/scans, venue update, checkpoint create/update, event state, event admin view, kiosk registration, desk code, staff invite and activation, shift handover, gate heartbeat, MFA enrolment and confirmation, six webhook endpoints, six device endpoints, five data-request endpoints, post-event summary, operator profile) and 6 more (four report-schedule endpoints, notification mark-read, operator broadcast) and the attendee's own pass resend", () => {
    expect(Object.keys(endpoints)).toHaveLength(111 + 9 + 1 + 6 + 5 + 1);
  });
  it("adds the activation-link check: public, the sign-in rate limit, the token in the body, and a state that names no account", () => {
    expect(endpoints.checkActivation).toMatchObject({ method: "POST", path: "/auth/activate/check", access: ["public"], rateLimit: "auth" });
    expect(endpoints.checkActivation.response.safeParse({ state: "used" }).success).toBe(true);
    expect(endpoints.checkActivation.response.safeParse({ state: "valid", role: "supervisor", expires_at: new Date().toISOString() }).success).toBe(true);
    expect(Object.keys(endpoints.checkActivation.response.shape).sort()).toEqual(["expires_at", "role", "state"]);
    expect(endpoints.activateStaff.body.safeParse({ token: "x".repeat(20), password: "x".repeat(STAFF_PASSWORD.min - 1) }).success).toBe(false);
    expect(endpoints.activateStaff.body.safeParse({ token: "x".repeat(20), password: "x".repeat(STAFF_PASSWORD.min) }).success).toBe(true);
  });
  it("adds five endpoints for the console and invitation gaps: alert detail, gate activity, one registration, invitation read, RSVP with the token in the body", () => {
    expect(endpoints.getAlert).toMatchObject({ method: "GET", path: "/alerts/:id", access: ["admin", "organiser", "supervisor"] });
    expect(endpoints.checkpointActivity).toMatchObject({ method: "GET", path: "/checkpoints/:id/activity", access: ["admin", "organiser", "supervisor"] });
    expect(endpoints.getRegistration).toMatchObject({ method: "GET", path: "/registrations/:id", access: ["admin", "organiser", "supervisor", "desk_clerk"] });
    expect(endpoints.readInvitation).toMatchObject({ method: "POST", path: "/invitations/read", access: ["public"], rateLimit: "public" });
    expect(endpoints.rsvpWithToken).toMatchObject({ method: "POST", path: "/invitations/rsvp", access: ["public"], rateLimit: "auth" });
    // Additive only: a decline needs no name; an accept without one still parses (the server refuses it).
    expect(endpoints.rsvp.body.safeParse({ email: "a@example.com", accept: false, zone_presence_consent: false }).success).toBe(true);
    expect(endpoints.rsvp.body.safeParse({ email: "a@example.com", accept: true, full_name: "A", zone_presence_consent: true }).success).toBe(true);
    expect(endpoints.listScans.query.parse({ event_id: webcrypto.randomUUID(), checkpoint_ids: `${webcrypto.randomUUID()},${webcrypto.randomUUID()}` }).checkpoint_ids).toHaveLength(2);
    expect(endpoints.updateEvent.body.safeParse({ venue_id: null }).success).toBe(true);
  });
  it("adds six endpoints for the scanner and attendee gaps: scan undo, GET /me, PATCH /me/profile, own registrations, lost-band report, public occupancy", () => {
    expect(endpoints.undoScan).toMatchObject({ method: "POST", path: "/scans/:id/undo", access: ["security_staff"], audited: true, rateLimit: "scan" });
    for (const name of ["me", "updateMyProfile", "myRegistrations", "reportLostBand"] as const) expect(endpoints[name].access).toEqual(["attendee"]);
    expect(endpoints.reportLostBand.audited).toBe(true);
    expect(endpoints.reportLostBand.rateLimit).toBe("resend");
    expect(endpoints.publicOccupancy).toMatchObject({ method: "GET", path: "/events/:id/occupancy", access: ["public"], rateLimit: "public" });
    // Additive only: an existing scan submission (no assignment) and a heartbeat (no allowlist time) still parse.
    expect(endpoints.gateHeartbeat.body.safeParse({ checkpoint_id: webcrypto.randomUUID(), device_id: "d", queue_depth: 0, clock_offset_ms: 0, online: true }).success).toBe(true);
    expect(endpoints.registerUser.body.safeParse({ email: "a@example.com", full_name: "A", event_slug: "x", zone_presence_consent: false, phone: "call me" }).success).toBe(false);
  });
  it("pins every role's endpoints (D-23): a new endpoint must be placed in this matrix deliberately", () => {
    const allowed = (role: string) =>
      (Object.entries(endpoints) as [string, { access: readonly string[] }][])
        .filter(([, e]) => !e.access.includes("public") && e.access.includes(role)).map(([name]) => name).sort();
    const signedIn = ["logout", "mfaEnrol", "mfaEnrolConfirm", "mfaVerify", "myOperator", "wsTicket"];
    expect(allowed("supervisor")).toEqual([
      ...signedIn, "ackAlert", "checkpointScans", "clearReview", "dashboard", "eventRegistrations", "eventSummary", "gateHealth", "getVenue",
      "listAlerts", "listAttendees", "listCheckpoints", "listCredentials", "listScans", "recountRoom", "resolveAlert", "revoke",
      "getAlert", "checkpointActivity", "getRegistration", "listAssignments",
    ].sort());
    expect(allowed("desk_clerk")).toEqual([
      ...signedIn, "bindCarrier", "deskCode", "eventRegistrations", "inventory", "myAssignments", "rebindCarrier", "resend",
      "getRegistration",
    ].sort());
    expect(allowed("security_staff")).toEqual([
      ...signedIn, "ackAlert", "allowlist", "bindCarrier", "deskCode", "gateHeartbeat", "handover", "kioskRegister", "listAlerts", "listCheckpoints",
      "myAssignments", "postScans", "undoScan",
    ].sort());
    for (const role of ["speaker", "crew"]) expect(allowed(role)).toEqual([...signedIn, "myAssignments"].sort());
    // Admin reaches every endpoint an operator or staff role reaches, except the scanner's own and the attendee's.
    const scannerOnly = new Set(["postScans", "gateHeartbeat", "myAssignments", "deviceHeartbeat"]);
    for (const [name, e] of Object.entries(endpoints) as [string, { access: readonly string[] }][]) {
      const staffish = e.access.some((a) => ["organiser", "supervisor", "desk_clerk"].includes(a));
      if (staffish && !scannerOnly.has(name)) expect(e.access, name).toContain("admin");
    }
  });
  it("adds nine endpoints for Admin Command's configure screens (06 D0, D2–D6)", () => {
    const added = [
      "currentOrganization", "publishLayout", "listEventsAdmin", "eventReadiness", "duplicateEvent", "deleteEvent",
      "createSession", "updateSession", "deleteSession",
    ] as const;
    for (const name of added) expect(endpoints[name].access).toEqual(expect.arrayContaining(["admin"]));
    for (const name of ["publishLayout", "duplicateEvent", "deleteEvent", "createSession", "updateSession", "deleteSession"] as const) {
      expect(endpoints[name].audited, name).toBe(true);
    }
    // A draft may be written before it has a venue or dates.
    expect(endpoints.createEvent.body.safeParse({ slug: "a-draft", title: "A draft", timezone: "Africa/Kampala" }).success).toBe(true);
    expect(endpoints.createEvent.body.safeParse({ slug: "a-draft", title: "A draft", timezone: "Mars/Olympus" }).success).toBe(false);
    // Geometry is typed on read as on write: whole grid units only.
    expect(endpoints.publishLayout.body.safeParse({
      expected_version: 0, floors: ["Ground"],
      zones: [{ id: webcrypto.randomUUID(), name: "Z", floor: "Ground", geometry: { kind: "rect", x: 0.5, y: 0, w: 2, h: 2 } }], rooms: [],
    }).success).toBe(false);
    expect(endpoints.duplicateEvent.body.safeParse(undefined).success).toBe(true);
    expect(endpoints.eventRegistrations.query.parse({ unbound: "false" }).unbound).toBe(false);
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
  it("has state words for credentials, carriers, registrations, invitations, events and roles, without the product name", () => {
    const tables = [CREDENTIAL_STATE_COPY, CARRIER_STATE_COPY, REGISTRATION_STATE_COPY, INVITATION_STATE_COPY, EVENT_STATE_COPY, ROLE_COPY];
    const pairs: [object, readonly string[]][] = [
      [CREDENTIAL_STATE_COPY, CREDENTIAL_STATE_VALUES], [CARRIER_STATE_COPY, CARRIER_STATE_VALUES], [REGISTRATION_STATE_COPY, RegistrationState.options],
      [INVITATION_STATE_COPY, InvitationState.options], [EVENT_STATE_COPY, EVENT_STATE_VALUES], [ROLE_COPY, ROLE_VALUES],
    ];
    for (const [table, values] of pairs) expect(Object.keys(table).sort()).toEqual([...values].sort());
    for (const t of tables) for (const c of Object.values(t) as { label: string; description: string }[]) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.description.endsWith(".")).toBe(true);
    }
    expect(JSON.stringify(tables).toLowerCase()).not.toContain(BRAND.name.toLowerCase());
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
