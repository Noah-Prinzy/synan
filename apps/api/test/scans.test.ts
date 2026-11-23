import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPublicKey, generateKeyPairSync, sign as edSign, verify as edVerify } from "node:crypto";
import { buildSignedQr, parseSignedQr, QR_PREFIX_PORTAL, QR_TEXT_LENGTH } from "@synan/contracts/qr";
import type { BreachAlert, PortalCodeBatch, ScanBatchResponse, ScanSubmission, SigningKeys, TokenPair } from "@synan/contracts/rest";
import { addAttendee, band, devEmail, errCode, mfaCode, postScans, qr, scan, startHarness, type Harness } from "./helpers.js";

let h: Harness;
let organiser: TokenPair;

async function attendeeToken(email: string): Promise<string> {
  await h.call("POST", "/auth/email-link", { body: { email } });
  const token = /#token=([A-Za-z0-9_-]+)/.exec(h.mailer.last("auth.link")!.text)![1]!;
  return (await h.call<TokenPair>("POST", "/auth/verify", { body: { token } })).body.access_token;
}

async function post(scans: ScanSubmission[], token?: string, deviceId = "scanner-1") {
  return postScans<ScanBatchResponse>(h, scans, { token, deviceId });
}
const allScans = () => h.app.ctx.repos.scans.forEvent(h.seed.eventId);
async function one(s: ScanSubmission) {
  const r = await post([s]);
  if (r.status !== 200) throw new Error(`scan failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.results[0]!;
}
async function alerts(kind?: string): Promise<BreachAlert[]> {
  const r = await h.call<{ items: BreachAlert[] }>("GET", `/breach-alerts?event_id=${h.seed.eventId}&limit=500`, { token: organiser.access_token });
  return r.body.items.filter((a) => !kind || a.kind === kind);
}
async function occupancy() {
  const proj = await h.app.ctx.scans.projection(h.seed.eventId);
  const r = h.seed.rooms;
  return { auditorium: proj.count(r.auditorium), expo: proj.count(r.expo), vip: proj.count(r.vip), boardroom: proj.count(r.boardroom), press: proj.count(r.press) };
}
const step = (ms = 61_000) => h.clock.advance(ms);

beforeAll(async () => {
  h = await startHarness();
  organiser = await h.login(h.seed.emails.organiser);
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  // Access tokens live 10 min; tests move the clock. Keep them fresh.
  organiser = await h.login(h.seed.emails.organiser);
});

describe("portal QR: signed, short-lived, verifiable with public keys only (D-12)", () => {
  let codes: PortalCodeBatch;
  beforeAll(async () => {
    const t = await attendeeToken(devEmail("vip"));
    const r = await h.call<PortalCodeBatch>("GET", "/me/credential/codes", { token: t });
    expect(r.status).toBe(200);
    codes = r.body;
  });

  it("returns a batch of consecutive 60 s codes", () => {
    expect(codes.codes).toHaveLength(15);
    expect(codes.rotate_every_s).toBe(60);
    for (let i = 1; i < codes.codes.length; i++) expect(codes.codes[i]!.not_before).toBe(codes.codes[i - 1]!.expires_at);
  });

  it("is compact (125 characters) and verifies offline with only the published public key", async () => {
    const code = codes.codes[0]!.code;
    expect(code.length).toBe(125);
    expect(code.length).toBe(QR_TEXT_LENGTH.portal);
    expect(code.startsWith(QR_PREFIX_PORTAL)).toBe(true);
    const keys = (await h.call<SigningKeys>("GET", "/auth/signing-keys")).body.keys;
    const p = parseSignedQr(code)!;
    if (p.kind !== "portal") throw new Error("expected a portal code");
    expect(p.kid).toBe(codes.kid);
    const key = keys.find((k) => k.purpose === "qr" && k.qr_kid === p.kid)!;
    const pub = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: key.x }, format: "jwk" });
    expect(edVerify(null, p.signed, pub, p.signature)).toBe(true);
    // Body carries the key id, expiry, window and an opaque 128-bit reference — no identity, no tier.
    expect(p.exp * 1000).toBe(Date.parse(codes.codes[0]!.expires_at));
    expect(p.ttl).toBe(60);
    expect(p.ref).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("is admitted at the perimeter and refused at an interior gate", async () => {
    const first = await one(scan(h, h.seed.checkpoints.mainIn, qr(codes.codes[0]!.code)));
    expect(first).toMatchObject({ result: "admitted", carrier_kind: "qr_portal", tier: "VIP" });
    const interior = await one(scan(h, h.seed.checkpoints.vip, qr(codes.codes[0]!.code)));
    expect(interior.result).toBe("wristband_required");
  });

  it("a tampered code is unknown_token and raises invalid_qr", async () => {
    const c = codes.codes[0]!.code;
    const i = c.length - 10; // inside the signature
    const flipped = c.slice(0, i) + (c[i] === "A" ? "B" : "A") + c.slice(i + 1);
    const before = (await alerts("invalid_qr")).length;
    const r = await one(scan(h, h.seed.checkpoints.eastIn, qr(flipped)));
    expect(r.result).toBe("unknown_token");
    expect(r.carrier_kind).toBeNull();
    expect((await alerts("invalid_qr")).length).toBe(before + 1);
  });

  it("a code forged with an attacker key under a real key id is refused", async () => {
    const real = parseSignedQr(codes.codes[0]!.code)!;
    if (real.kind !== "portal") throw new Error();
    const { privateKey } = generateKeyPairSync("ed25519");
    const { signed, finish } = buildSignedQr({ kind: "portal", kid: real.kid, exp: real.exp, ttl: real.ttl, ref: real.ref });
    const forged = finish(new Uint8Array(edSign(null, signed, privateKey)));
    expect((await one(scan(h, h.seed.checkpoints.eastIn, qr(forged)))).result).toBe("unknown_token");
  });

  it("an expired code is refused (screenshot replay), judged at the scan's corrected time", async () => {
    const old = codes.codes[0]!;
    h.clock.set(Date.parse(old.expires_at) + 10_000);
    expect((await one(scan(h, h.seed.checkpoints.eastIn, qr(old.code)))).result).toBe("unknown_token");
    // The same code, scanned offline while it was valid and synced now, is judged as of then.
    const offline = await one(
      scan(h, h.seed.checkpoints.mainOut, qr(old.code), { occurred_at: new Date(Date.parse(old.not_before) + 1000).toISOString(), offline: true, local_result: "admitted" }),
    );
    expect(offline.result).toBe("admitted");
  });

  it("a third-party QR is unknown_token without an alert", async () => {
    const before = (await alerts()).length;
    expect((await one(scan(h, h.seed.checkpoints.eastIn, qr("https://example.com/hello")))).result).toBe("unknown_token");
    expect((await alerts()).length).toBe(before);
  });
});

describe("emailed QR: single use (D-05)", () => {
  let code: string;
  beforeAll(async () => {
    const admin = await h.login(h.seed.emails.admin);
    const stepped = (await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: admin.access_token, body: { code: mfaCode(h) } })).body;
    const r = await h.call("POST", `/credentials/${h.seed.attendees.ordinary2.credentialId}/resend`, { token: stepped.access_token });
    expect(r.status).toBe(200);
    code = /QR: (\S+)/.exec(h.mailer.last("pass.email_qr")!.text)![1]!;
  });

  it("is a 144-character compact code with the emailed-QR prefix", () => {
    expect(code.length).toBe(QR_TEXT_LENGTH.email);
    expect(code.length).toBe(144);
    expect(parseSignedQr(code)?.kind).toBe("email");
  });

  it("is admitted once, then pass_spent with a pass_replayed alert", async () => {
    expect((await one(scan(h, h.seed.checkpoints.mainIn, qr(code)))).result).toBe("admitted");
    step();
    await one(scan(h, h.seed.checkpoints.mainOut, band(h.seed.attendees.ordinary2.uid)));
    step();
    const before = (await alerts("pass_replayed")).length;
    const again = await one(scan(h, h.seed.checkpoints.eastIn, qr(code)));
    expect(again.result).toBe("pass_spent");
    expect((await alerts("pass_replayed")).length).toBe(before + 1);
  });
});

describe("idempotency (idem_key)", () => {
  it("a replayed batch returns the original outcomes and changes nothing", async () => {
    const a = await addAttendee(h, "ORDINARY");
    const s = scan(h, h.seed.checkpoints.expo, band(a.uid));
    const first = await post([s]);
    const occ = await occupancy();
    const second = await post([s]);
    expect(second.status).toBe(200);
    expect(second.body.results[0]).toMatchObject({ scan_id: first.body.results[0]!.scan_id, result: "admitted", replayed: true });
    expect(await occupancy()).toEqual(occ);
    const rows = (await allScans()).filter((r) => r.idem_key === s.idem_key);
    expect(rows).toHaveLength(1);
  });

  it("the same key with a different payload is rejected for that item only (IDEMPOTENCY_CONFLICT)", async () => {
    const a = await addAttendee(h, "ORDINARY");
    const s = scan(h, h.seed.checkpoints.expo, band(a.uid));
    await post([s]);
    const r = await post([{ ...s, occurred_at: new Date(h.clock.now() - 5_000).toISOString() }]);
    expect(r.status).toBe(200);
    expect(r.body.results).toEqual([]);
    expect(r.body.rejected).toEqual([{ idem_key: s.idem_key, code: "IDEMPOTENCY_CONFLICT", message: expect.any(String) }]);
  });

  it("duplicate keys inside one batch are applied once", async () => {
    const a = await addAttendee(h, "ORDINARY");
    const s = scan(h, h.seed.checkpoints.expo, band(a.uid));
    const r = await post([s, s]);
    expect(r.body.results.map((x) => x.scan_id)).toEqual([r.body.results[0]!.scan_id, r.body.results[0]!.scan_id]);
  });
});

describe("occupancy rules (01 §7, D-10)", () => {
  it("debounce: the same band at the same gate within 60 s is duplicate_read", async () => {
    const a = await addAttendee(h, "ORDINARY");
    expect((await one(scan(h, h.seed.checkpoints.mainIn, band(a.uid)))).result).toBe("admitted");
    step(30_000);
    expect((await one(scan(h, h.seed.checkpoints.mainIn, band(a.uid)))).result).toBe("duplicate_read");
  });

  it("anti-passback at the perimeter: already_inside (amber, no alert); re-entry after an out scan is admitted", async () => {
    const a = await addAttendee(h, "ORDINARY");
    await one(scan(h, h.seed.checkpoints.mainIn, band(a.uid)));
    step();
    const before = (await alerts()).length;
    expect((await one(scan(h, h.seed.checkpoints.mainIn, band(a.uid)))).result).toBe("already_inside");
    expect((await alerts()).length).toBe(before);
    step();
    expect((await one(scan(h, h.seed.checkpoints.mainOut, band(a.uid)))).result).toBe("admitted");
    step();
    expect((await one(scan(h, h.seed.checkpoints.mainIn, band(a.uid)))).result).toBe("admitted");
  });

  it("implied exit: entering another room removes the holder from the last one", async () => {
    const a = await addAttendee(h, "ORDINARY");
    const o0 = await occupancy();
    await one(scan(h, h.seed.checkpoints.auditorium, band(a.uid), { direction: "in" }));
    expect((await occupancy()).auditorium).toBe(o0.auditorium + 1);
    step();
    const r = await one(scan(h, h.seed.checkpoints.expo, band(a.uid)));
    expect(r.result).toBe("admitted");
    const o2 = await occupancy();
    expect(o2.auditorium).toBe(o0.auditorium);
    expect(o2.expo).toBe(o0.expo + 1);
    const implied = (await allScans()).filter((s) => s.idem_key.startsWith(r.idem_key) && s.result === "implied_exit");
    expect(implied).toHaveLength(1);
    // Recorded against the door they were counted in through.
    expect(implied[0]!.checkpoint_id).toBe(h.seed.checkpoints.auditorium);
  });

  it("a two-way checkpoint requires a direction (that item is rejected)", async () => {
    const a = await addAttendee(h, "ORDINARY");
    const r = await post([scan(h, h.seed.checkpoints.auditorium, band(a.uid))]);
    expect(r.body.rejected?.map((x) => x.code)).toEqual(["VALIDATION_FAILED"]);
    expect(r.body.results).toEqual([]);
  });

  it("tier not permitted → denied_room, with escalating alerts on repeat attempts", async () => {
    const pub = await addAttendee(h, "PUBLIC");
    const severities: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await one(scan(h, h.seed.checkpoints.vip, band(pub.uid)));
      expect(r.result).toBe("denied_room");
      const al = (await alerts("unauthorised_tier")).find((x) => x.id === r.alert_ids[0]);
      severities.push(al!.severity);
      step();
    }
    expect(severities).toEqual(["medium", "high", "critical"]);
    // Public tier is permitted in the Expo Hall.
    expect((await one(scan(h, h.seed.checkpoints.expo, band(pub.uid)))).result).toBe("admitted");
  });

  it("capacity: the Boardroom (3) blocks the 4th; the Press Room (2, admit_with_alert) admits and alerts", async () => {
    const people = await Promise.all([1, 2, 3, 4].map(() => addAttendee(h, "ORDINARY")));
    const results: string[] = [];
    for (const p of people) results.push((await one(scan(h, h.seed.checkpoints.boardroom, band(p.uid)))).result);
    expect(results).toEqual(["admitted", "admitted", "admitted", "capacity_block"]);
    expect((await occupancy()).boardroom).toBe(3);

    const press: ScanBatchResponse["results"] = [];
    for (const p of people.slice(0, 3)) {
      step();
      press.push(await one(scan(h, h.seed.checkpoints.press, band(p.uid))));
    }
    expect(press.map((x) => x.result)).toEqual(["admitted", "admitted", "admitted"]);
    expect((await alerts("capacity_exceeded")).some((a) => press[2]!.alert_ids.includes(a.id))).toBe(true);
    // Moving to the Press Room implied-exited them from the Boardroom.
    expect((await occupancy()).boardroom).toBe(0);
  });

  it("revocation takes effect at the next tap, distinct from unknown_token, and is audited", async () => {
    const a = await addAttendee(h, "ORDINARY");
    const r = await h.call("POST", `/credentials/${a.credentialId}/revoke`, { token: organiser.access_token, body: { reason: "refund" } });
    expect(r.status).toBe(200);
    expect((await one(scan(h, h.seed.checkpoints.expo, band(a.uid)))).result).toBe("revoked");
    expect((await one(scan(h, h.seed.checkpoints.expo, band("00112233445566")))).result).toBe("unknown_token");
    const audit = await h.app.ctx.repos.audit.all();
    expect(audit.some((x) => x.action === "credential.revoke" && x.target === `credential:${a.credentialId}`)).toBe(true);
    expect(await h.app.ctx.repos.audit.verify()).toBe(-1);
  });

  it("an unbound stock band is unknown_token", async () => {
    expect((await one(scan(h, h.seed.checkpoints.expo, band(h.seed.stockUid)))).result).toBe("unknown_token");
  });

  it("impossible travel suspends for review; a supervisor clears it", async () => {
    const a = await addAttendee(h, "VIP");
    await one(scan(h, h.seed.checkpoints.eastIn, band(a.uid)));
    step(90_000); // transit East Entrance → VIP Lounge is at least 300 s
    const r = await one(scan(h, h.seed.checkpoints.vip, band(a.uid)));
    expect(r.result).toBe("suspended");
    expect((await alerts("impossible_travel")).some((x) => r.alert_ids.includes(x.id))).toBe(true);
    expect((await h.app.ctx.repos.credentials.byId(a.credentialId))!.state).toBe("suspended_review");
    const cleared = await h.call("POST", `/credentials/${a.credentialId}/clear-review`, {
      token: organiser.access_token,
      body: { outcome: "clear", note: "ID checked at the door" },
    });
    expect(cleared.status).toBe(200);
    step(400_000);
    expect((await one(scan(h, h.seed.checkpoints.vip, band(a.uid)))).result).toBe("admitted");
  });

  it("manual recount sets the count and is audited", async () => {
    const r = await h.call<{ occupancy: number }>("POST", `/rooms/${h.seed.rooms.expo}/recount`, {
      token: organiser.access_token,
      body: { event_id: h.seed.eventId, count: 42, note: "headcount" },
    });
    expect(r.status).toBe(200);
    expect(r.body.occupancy).toBe(42);
    expect((await occupancy()).expo).toBe(42);
    expect((await h.app.ctx.repos.audit.all()).some((x) => x.action === "room.recount")).toBe(true);
  });
});

describe("scanner authorisation (03 §4)", () => {
  it("refuses a checkpoint the user is not assigned to, and outside the shift, raising rogue_scanner", async () => {
    const g2 = await h.login(h.seed.emails.gate2);
    const a = await addAttendee(h, "ORDINARY");
    const before = (await alerts("rogue_scanner")).length;
    const notAssigned = await post([scan(h, h.seed.checkpoints.expo, band(a.uid))], g2.access_token);
    expect(notAssigned.status).toBe(200);
    expect(notAssigned.body.results).toEqual([]);
    expect(notAssigned.body.rejected?.map((x) => x.code)).toEqual(["CHECKPOINT_NOT_ASSIGNED"]);
    const outside = await post([scan(h, h.seed.checkpoints.mainIn, band(a.uid))], g2.access_token);
    expect(outside.body.rejected?.map((x) => x.code)).toEqual(["OUTSIDE_SHIFT"]);
    expect((await alerts("rogue_scanner")).length).toBe(before + 2);
    // Nothing was applied for either.
    expect((await allScans()).some((x) => x.staff_user_id === h.seed.users.gate2)).toBe(false);
  });

  it("refuses scans for an event that is not live", async () => {
    const r = await postScans(h, [scan(h, h.seed.checkpoints.mainIn, band("AABBCCDDEEFF00"))], { eventId: h.seed.publishedEventId });
    expect(errCode(r.body)).toBe("EVENT_NOT_LIVE");
  });
});

describe("offline sync (D-13, D-14)", () => {
  it("orders by corrected time (occurred_at + clock_offset_ms), not by device time or arrival", async () => {
    const a = await addAttendee(h, "ORDINARY");
    const o0 = await occupancy();
    const before = (await alerts("reconciliation_fault")).length;
    const t0 = h.clock.now();
    // The device's clock is 150 s slow. It queued an entry at t0 and an exit that really happened at t0+120 s,
    // but the exit's device time (t0-30 s) is *earlier*, and the queue sends it first.
    const exit = scan(h, h.seed.checkpoints.auditorium, band(a.uid), {
      direction: "out", occurred_at: new Date(t0 - 30_000).toISOString(), clock_offset_ms: 150_000, offline: true, local_result: "admitted",
    });
    const entry = scan(h, h.seed.checkpoints.auditorium, band(a.uid), {
      direction: "in", occurred_at: new Date(t0 - 150_000).toISOString(), clock_offset_ms: 150_000, offline: true, local_result: "admitted",
    });
    h.clock.advance(300_000);
    const r = await post([exit, entry], undefined, "skewed-device");
    expect(r.body.results.map((x) => x.result)).toEqual(["admitted", "admitted"]);
    expect(Date.parse(r.body.results[0]!.corrected_at)).toBe(t0 + 120_000);
    expect(Date.parse(r.body.results[1]!.corrected_at)).toBe(t0);
    // Applied entry-then-exit: back to where it was, with no negative-count fault.
    // (Applied in arrival order, the exit would clamp at 0 and the entry would leave them counted inside.)
    expect((await occupancy()).auditorium).toBe(o0.auditorium);
    expect((await alerts("reconciliation_fault")).length).toBe(before);
    // Offset beyond two minutes flags the device.
    expect((await alerts("clock_skew")).length).toBeGreaterThanOrEqual(1);
  });

  it("two offline gates accepting the same emailed QR: accepted, then caught at sync", async () => {
    const a = await addAttendee(h, "ORDINARY");
    const { code } = await h.app.ctx.credentials.sendEmailedQr(a.credentialId);
    const t = h.clock.now();
    const s1 = scan(h, h.seed.checkpoints.mainIn, qr(code), { occurred_at: new Date(t).toISOString(), offline: true, local_result: "admitted" });
    const s2 = scan(h, h.seed.checkpoints.eastIn, qr(code), { occurred_at: new Date(t + 5_000).toISOString(), offline: true, local_result: "admitted" });
    h.clock.advance(120_000);
    const r1 = await post([s1], undefined, "gate-main");
    const r2 = await post([s2], undefined, "gate-east");
    expect(r1.body.results[0]!.result).toBe("admitted");
    expect(r2.body.results[0]!.result).toBe("admitted"); // what happened at the gate is recorded
    const conflict = (await alerts("offline_conflict_pass_reuse")).find((x) => r2.body.results[0]!.alert_ids.includes(x.id));
    expect(conflict).toBeDefined();
    expect(conflict!.scan_ids).toContain(r2.body.results[0]!.scan_id);
    expect((await h.app.ctx.repos.credentials.byId(a.credentialId))!.state).toBe("suspended_review");
  });

  it("pass-back across offline gates is caught at sync and suspends the credential", async () => {
    const a = await addAttendee(h, "ORDINARY");
    const t = h.clock.now();
    const s1 = scan(h, h.seed.checkpoints.mainIn, band(a.uid), { occurred_at: new Date(t).toISOString(), offline: true, local_result: "admitted" });
    const s2 = scan(h, h.seed.checkpoints.eastIn, band(a.uid), { occurred_at: new Date(t + 90_000).toISOString(), offline: true, local_result: "admitted" });
    h.clock.advance(200_000);
    await post([s1], undefined, "gate-main");
    const r2 = await post([s2], undefined, "gate-east");
    expect(r2.body.results[0]!.result).toBe("already_inside");
    expect((await alerts("offline_conflict_passback")).some((x) => r2.body.results[0]!.alert_ids.includes(x.id))).toBe(true);
    expect((await h.app.ctx.repos.credentials.byId(a.credentialId))!.state).toBe("suspended_review");
  });

  it("capacity overrun by offline gates is counted and alerted", async () => {
    // Reset the Boardroom to full (3) via recount, then an offline gate admits one more.
    await h.call("POST", `/rooms/${h.seed.rooms.boardroom}/recount`, { token: organiser.access_token, body: { event_id: h.seed.eventId, count: 3 } });
    const a = await addAttendee(h, "ORDINARY");
    const r = await post([scan(h, h.seed.checkpoints.boardroom, band(a.uid), { offline: true, local_result: "admitted" })]);
    expect(r.body.results[0]!.result).toBe("admitted");
    expect((await occupancy()).boardroom).toBe(4);
    expect((await alerts("offline_conflict_capacity")).some((x) => r.body.results[0]!.alert_ids.includes(x.id))).toBe(true);
  });

  it("an offline local refusal is recorded as refused and moves nobody", async () => {
    const a = await addAttendee(h, "ORDINARY");
    const o0 = await occupancy();
    const r = await post([scan(h, h.seed.checkpoints.expo, band(a.uid), { offline: true, local_result: "capacity_block" })]);
    expect(r.body.results[0]!.result).toBe("capacity_block");
    expect((await occupancy()).expo).toBe(o0.expo);
  });
});

describe("gate_rate_rollups (D-16)", () => {
  it("records per-gate, per-minute counts by tier from the first scan", async () => {
    const rows = await h.app.ctx.repos.rollups.gateRates(h.seed.eventId);
    expect(rows.length).toBeGreaterThan(0);
    const total = rows.reduce((n, r) => n + r.scans, 0);
    expect(total).toBe((await allScans()).filter((s) => s.result !== "implied_exit").length);
    for (const r of rows) {
      expect(r.minute_start.getUTCSeconds()).toBe(0);
      expect(r.admitted + r.denied).toBeLessThanOrEqual(r.scans);
      expect(Object.values(r.by_tier_jsonb).reduce((n, v) => n + (v ?? 0), 0)).toBe(r.scans);
    }
    expect(rows.some((r) => (r.by_tier_jsonb.VIP ?? 0) > 0)).toBe(true);
    expect(rows.some((r) => (r.by_tier_jsonb.UNKNOWN ?? 0) > 0)).toBe(true);
  });
});

describe("alerts lifecycle", () => {
  it("ack then resolve, both audited; gate staff may ack only alerts at their own checkpoint", async () => {
    const [a] = await alerts("unauthorised_tier");
    expect(a!.checkpoint_id).toBe(h.seed.checkpoints.vip);
    const elsewhere = await h.call("POST", `/alerts/${a!.id}/ack`, { token: await h.gateToken(h.seed.checkpoints.mainIn) });
    expect(elsewhere.status).toBe(404);
    const ack = await h.call<BreachAlert>("POST", `/alerts/${a!.id}/ack`, { token: await h.gateToken(h.seed.checkpoints.vip) });
    expect(ack.body.state).toBe("acked");
    expect(ack.body.credential_id).toBeNull(); // staff see what to act on, not who
    const res = await h.call<BreachAlert>("POST", `/alerts/${a!.id}/resolve`, { token: organiser.access_token, body: { note: "Escorted out" } });
    expect(res.body).toMatchObject({ state: "resolved", resolution_note: "Escorted out" });
    const audit = await h.app.ctx.repos.audit.all();
    expect(audit.filter((x) => x.target === `alert:${a!.id}`).map((x) => x.action)).toEqual(["alert.ack", "alert.resolve"]);
    expect(await h.app.ctx.repos.audit.verify()).toBe(-1);
  });
});
