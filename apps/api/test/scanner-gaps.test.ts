/**
 * Scanner gaps (A1–A7): stranded queued scans, the gate picker's assignments, refresh reuse grace,
 * allowlist age on heartbeats, undo of a mistaken admission, the published QR leeway, and the
 * verdict's `last in` time and room chips. Runs on both backends (REPO=pglite for SQL).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GateHealth, HandoverSummary, ScanBatchResponse, ServerTime, SigningKeys, SignedAllowlist, StaffAssignment, TokenPair, UndoScanResult } from "@synan/contracts/rest";
import { hashPassword, randomToken, sha256b64url } from "../src/lib/crypto.js";
import { addAttendee, band, devEmail, errCode, postScans, scan, startHarness, type Harness } from "./helpers.js";

let h: Harness;
let admin: string;
beforeAll(async () => {
  h = await startHarness();
  admin = (await h.login(h.seed.emails.admin)).access_token;
});
afterAll(async () => h.close());
const MIN = 60_000;
const H = 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();

/** A new security-staff user with one assignment (the seed's gate users already hold shifts). */
async function staffWithShift(checkpointId: string, from: number, to: number, eventId: string | null = null) {
  const id = randomUUID();
  const email = devEmail(`s-${id.slice(0, 8)}`);
  await h.app.ctx.repos.users.insert({ id, email, password_hash: await hashPassword(h.seed.password, 12), role: "security_staff", mfa_enrolled_at: null, mfa_secret: null });
  const assignmentId = randomUUID();
  await h.app.ctx.repos.fixtures.staffAssignment({ id: assignmentId, user_id: id, checkpoint_id: checkpointId, shift_start: new Date(from), shift_end: new Date(to), event_id: eventId });
  return { id, email, assignmentId, token: async () => (await h.login(email)).access_token };
}
const heartbeat = (token: string, checkpointId: string, deviceId: string, extra: Record<string, unknown> = {}) =>
  h.call("POST", "/gates/heartbeat", { token, body: { checkpoint_id: checkpointId, device_id: deviceId, queue_depth: 0, clock_offset_ms: 0, online: true, ...extra } });

describe("A2 · GET /me/assignments", () => {
  it("embeds the gate and the event, always sets event_id, and drops a shift once handed over", async () => {
    const now = h.clock.now();
    const x = await staffWithShift(h.seed.checkpoints.auditorium, now - MIN, now + 2 * H);
    const t = await x.token();
    const r = await h.call<{ items: StaffAssignment[] }>("GET", "/me/assignments", { token: t });
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0]).toMatchObject({
      id: x.assignmentId, event_id: h.seed.eventId, event: { id: h.seed.eventId },
      checkpoint: { id: h.seed.checkpoints.auditorium, label: "Auditorium Doors", perimeter: false, direction: "both", room_id: h.seed.rooms.auditorium, room_name: "Main Auditorium", zone_id: h.seed.zones.ground, zone_name: "Ground" },
    });
    await h.call("POST", `/staff-assignments/${x.assignmentId}/handover`, { token: t });
    expect((await h.call<{ items: StaffAssignment[] }>("GET", "/me/assignments", { token: t })).body.items).toHaveLength(0);
  });
});

describe("A3 · refresh reuse grace", () => {
  const refresh = (token: string, ua: string) => h.call<TokenPair>("POST", "/auth/refresh", { body: { refresh_token: token }, headers: { "user-agent": ua } });

  it("re-issues a token whose response was lost (same client, seconds later); the lost token then counts as theft", async () => {
    const first = await h.call<TokenPair>("POST", "/auth/login", { body: { email: h.seed.emails.organiser, password: h.seed.password }, headers: { "user-agent": "UA-op" } });
    const lost = await refresh(first.body.refresh_token, "UA-op");
    expect(lost.status).toBe(200);
    h.clock.advance(3_000);
    const retry = await refresh(first.body.refresh_token, "UA-op");
    expect(retry.status).toBe(200);
    expect(retry.body.refresh_token).not.toBe(lost.body.refresh_token);
    // The token from the lost response is superseded: presenting it is reuse, which ends the family.
    expect((await refresh(lost.body.refresh_token, "UA-op")).status).toBe(401);
    expect((await refresh(retry.body.refresh_token, "UA-op")).status).toBe(401);
  });

  it("still ends the session on real reuse: later, from another client, or after the new token was used", async () => {
    const login = async () => (await h.call<TokenPair>("POST", "/auth/login", { body: { email: h.seed.emails.organiser, password: h.seed.password }, headers: { "user-agent": "UA-op" } })).body;
    const a = await login();
    await refresh(a.refresh_token, "UA-op");
    h.clock.advance(30_000);
    expect((await refresh(a.refresh_token, "UA-op")).status).toBe(401);

    const b = await login();
    const b1 = await refresh(b.refresh_token, "UA-op");
    expect((await refresh(b.refresh_token, "UA-thief")).status).toBe(401);
    expect((await refresh(b1.body.refresh_token, "UA-op")).status).toBe(401); // the family is gone

    const c = await login();
    const c1 = await refresh(c.refresh_token, "UA-op");
    expect((await refresh(c1.body.refresh_token, "UA-op")).status).toBe(200);
    expect((await refresh(c.refresh_token, "UA-op")).status).toBe(401);
  });

  it("applies to attendees too", async () => {
    const token = randomToken(32);
    const now = h.clock.now();
    await h.app.ctx.repos.auth.createLink({ tokenHash: sha256b64url(token), attendeeId: h.seed.attendees.ordinary.id, expiresAt: new Date(now + 10 * MIN), now: new Date(now) });
    const signedIn = await h.call<TokenPair>("POST", "/auth/verify", { body: { token }, headers: { "user-agent": "UA-att" } });
    expect(signedIn.status).toBe(200);
    const lost = await refresh(signedIn.body.refresh_token, "UA-att");
    expect(lost.body.principal.kind).toBe("attendee");
    const retry = await refresh(signedIn.body.refresh_token, "UA-att");
    expect(retry.status).toBe(200);
    expect((await refresh(retry.body.refresh_token, "UA-att")).status).toBe(200);
    expect((await refresh(signedIn.body.refresh_token, "UA-att")).status).toBe(401); // the grace has passed: the child was used
  });
});

describe("A4 · allowlist age on heartbeats", () => {
  it("shows in gate health and raises one stale_allowlist alert per gate", async () => {
    const cp = h.seed.checkpoints.vip;
    const t = await h.gateToken(cp);
    const now = h.clock.now();
    expect((await heartbeat(t, cp, "vip-phone", { allowlist_issued_at: iso(now - 20 * MIN) })).status).toBe(200);
    const health = async () => (await h.call<{ items: GateHealth[] }>("GET", `/gates/health?event_id=${h.seed.eventId}`, { token: admin })).body.items.find((g) => g.checkpoint_id === cp)!;
    expect(await health()).toMatchObject({ allowlist_issued_at: iso(now - 20 * MIN), allowlist_stale: true });
    await heartbeat(t, cp, "vip-phone", { allowlist_issued_at: iso(now - 21 * MIN) });
    const alerts = (await h.app.ctx.repos.alerts.list({ eventId: h.seed.eventId, checkpointIds: [cp], limit: 100 })).filter((a) => a.kind === "stale_allowlist");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.detail).toMatch(/20 min old/);
    await heartbeat(t, cp, "vip-phone", { allowlist_issued_at: iso(now) });
    expect(await health()).toMatchObject({ allowlist_issued_at: iso(now), allowlist_stale: false });
  });
});

describe("A5 · undo a mistaken admission", () => {
  const undo = (token: string, scanId: string, eventId = h.seed.eventId) => h.call<UndoScanResult>("POST", `/scans/${scanId}/undo`, { token, body: { event_id: eventId, reason: "wrong person" } });

  it("takes the holder back out of the room and the perimeter, is idempotent and audited", async () => {
    const proj = () => h.app.ctx.scans.projection(h.seed.eventId);
    const room = h.seed.rooms.auditorium;
    const cp = h.seed.checkpoints.auditorium;
    const t = await h.gateToken(cp);
    const a = await addAttendee(h, "ORDINARY");
    const before = (await proj()).count(room);
    const first = await postScans<ScanBatchResponse>(h, [scan(h, cp, band(a.uid), { direction: "in" })]);
    expect(first.body.results[0]!.result).toBe("admitted");
    expect((await proj()).count(room)).toBe(before + 1);
    h.clock.advance(5_000);
    const u = await undo(t, first.body.results[0]!.scan_id);
    expect(u.status).toBe(200);
    expect(u.body).toMatchObject({ replayed: false, room_id: room, occupancy: before });
    expect((await proj()).count(room)).toBe(before);
    expect((await undo(t, first.body.results[0]!.scan_id)).body).toMatchObject({ replayed: true, undone_at: u.body.undone_at });
    // A re-tap is judged afresh (no duplicate_read), and a rebuilt projection agrees with the live one.
    const retap = await postScans<ScanBatchResponse>(h, [scan(h, cp, band(a.uid), { direction: "in" })]);
    expect(retap.body.results[0]!.result).toBe("admitted");
    const live = (await proj()).count(room);
    h.app.ctx.scans.forgetProjections();
    expect((await proj()).count(room)).toBe(live);
    expect((await h.app.ctx.repos.audit.all()).some((e) => e.action === "scan.undo" && e.target === `scan:${first.body.results[0]!.scan_id}`)).toBe(true);
    expect((await h.app.ctx.repos.occupancy.adjustments(h.seed.eventId)).some((x) => x.reason === "scan_undo" && x.room_id === room && x.delta === -1)).toBe(true);
  });

  it("clears anti-passback at the perimeter and the first check-in", async () => {
    const cp = h.seed.checkpoints.mainIn;
    const t = await h.gateToken(cp);
    const a = await addAttendee(h, "ORDINARY");
    const first = await postScans<ScanBatchResponse>(h, [scan(h, cp, band(a.uid))]);
    expect(first.body.results[0]!.result).toBe("admitted");
    expect((await h.app.ctx.repos.registrations.byId(a.registrationId))!.checked_in_at).not.toBeNull();
    expect((await undo(t, first.body.results[0]!.scan_id)).status).toBe(200);
    expect((await h.app.ctx.repos.registrations.byId(a.registrationId))!.checked_in_at).toBeNull();
    expect((await h.app.ctx.repos.credentials.byId(a.credentialId))!.zone_state).toBe("OUTSIDE");
    h.clock.advance(61_000);
    const again = await postScans<ScanBatchResponse>(h, [scan(h, cp, band(a.uid))]);
    expect(again.body.results[0]!.result).toBe("admitted"); // not already_inside
  });

  it("refuses someone else's scan, a refusal, and a scan past the window", async () => {
    const cp = h.seed.checkpoints.auditorium;
    const a = await addAttendee(h, "ORDINARY");
    const ok = await postScans<ScanBatchResponse>(h, [scan(h, cp, band(a.uid), { direction: "in" })]);
    const other = await h.gateToken(h.seed.checkpoints.expo);
    expect((await undo(other, ok.body.results[0]!.scan_id)).status).toBe(404);
    const pub = await addAttendee(h, "PUBLIC");
    const denied = await postScans<ScanBatchResponse>(h, [scan(h, cp, band(pub.uid), { direction: "in" })]);
    expect(denied.body.results[0]!.result).toBe("denied_room");
    const t = await h.gateToken(cp);
    expect(errCode((await undo(t, denied.body.results[0]!.scan_id)).body)).toBe("CONFLICT");
    h.clock.advance(61_000);
    expect(errCode((await undo(await h.gateToken(cp), ok.body.results[0]!.scan_id)).body)).toBe("CONFLICT");
  });
});

describe("A6 · the QR leeway is published", () => {
  it("on GET /time and GET /auth/signing-keys", async () => {
    expect((await h.call<ServerTime>("GET", "/time")).body.qr_leeway_s).toBe(h.app.ctx.config.qrLeewayS);
    expect((await h.call<SigningKeys>("GET", "/auth/signing-keys")).body.qr_leeway_s).toBe(h.app.ctx.config.qrLeewayS);
  });
});

describe("A7 · last in, and the room chips at a perimeter gate", () => {
  it("names the permitted rooms on an admission and when the holder came in on already_inside", async () => {
    const cp = h.seed.checkpoints.mainIn;
    const a = await addAttendee(h, "ORDINARY");
    const firstAt = h.clock.now();
    const first = await postScans<ScanBatchResponse>(h, [scan(h, cp, band(a.uid))]);
    const r = h.seed.rooms;
    expect(first.body.results[0]!.permitted_room_ids).toEqual([r.auditorium, r.expo, r.boardroom, r.press].sort());
    h.clock.advance(4 * MIN);
    const again = await postScans<ScanBatchResponse>(h, [scan(h, cp, band(a.uid))]);
    expect(again.body.results[0]).toMatchObject({ result: "already_inside", last_in_at: iso(firstAt) });
    expect(again.body.results[0]!.permitted_room_ids).toBeUndefined();
  });

  it("puts the same room ids, and nothing else, in a perimeter gate's allowlist", async () => {
    const cp = h.seed.checkpoints.mainIn;
    const list = await h.call<SignedAllowlist>("GET", `/events/${h.seed.eventId}/allowlist?checkpoint_id=${cp}`, { token: await h.gateToken(cp) });
    const payload = JSON.parse(Buffer.from(list.body.jws.split(".")[1]!, "base64url").toString()) as { entries: { permitted_room_ids: string[]; perimeter_room_ids?: string[]; tier: string | null }[] };
    const ordinary = payload.entries.find((e) => e.tier === "ORDINARY")!;
    expect(ordinary.permitted_room_ids).toEqual([]); // admission rule unchanged: a room-less perimeter gate
    expect(ordinary.perimeter_room_ids).toEqual([h.seed.rooms.auditorium, h.seed.rooms.expo, h.seed.rooms.boardroom, h.seed.rooms.press].sort());
    const interior = await h.call<SignedAllowlist>("GET", `/events/${h.seed.eventId}/allowlist?checkpoint_id=${h.seed.checkpoints.vip}`, { token: await h.gateToken(h.seed.checkpoints.vip) });
    const p2 = JSON.parse(Buffer.from(interior.body.jws.split(".")[1]!, "base64url").toString()) as { entries: { perimeter_room_ids?: string[] }[] };
    expect(p2.entries.every((e) => e.perimeter_room_ids === undefined)).toBe(true);
  });
});

// Last: these move the clock on by hours (past the seed's shifts).
describe("A1 · queued scans stranded by sign-out or handover", () => {
  it("are counted when synced from the same scanner by the next staff member at the gate; audited and flagged", async () => {
    const cp = h.seed.checkpoints.eastIn;
    const now = h.clock.now();
    const x = await staffWithShift(cp, now - H, now + H);
    const y = await staffWithShift(cp, now - H, now + 6 * H);
    const xt = await x.token();
    expect((await heartbeat(xt, cp, "phone-A")).status).toBe(200); // X works the shift on install phone-A
    const a = await addAttendee(h, "ORDINARY");
    const stranded = scan(h, cp, band(a.uid), { offline: true, local_result: "admitted", occurred_at: iso(now - 10 * MIN), assignment_id: x.assignmentId });
    const b = await addAttendee(h, "ORDINARY");
    const afterHandover = scan(h, cp, band(b.uid), { offline: true, local_result: "admitted", occurred_at: iso(now + 5 * MIN), assignment_id: x.assignmentId });
    expect((await h.call<HandoverSummary>("POST", `/staff-assignments/${x.assignmentId}/handover`, { token: xt })).status).toBe(200);

    h.clock.advance(2 * H); // X's shift is over and handed over; the queue is still on phone-A
    const yt = await y.token();
    // From another install: refused, and the queue is kept for a retry.
    const wrong = await postScans<ScanBatchResponse>(h, [stranded], { token: yt, deviceId: "phone-B" });
    expect(wrong.body.rejected?.[0]?.code).toBe("CHECKPOINT_NOT_ASSIGNED");
    const r = await postScans<ScanBatchResponse>(h, [stranded, afterHandover], { token: yt, deviceId: "phone-A" });
    expect(r.status).toBe(200);
    expect(r.body.results).toHaveLength(1);
    expect(r.body.results[0]).toMatchObject({ result: "admitted", late_synced: true });
    expect(r.body.rejected?.[0]).toMatchObject({ idem_key: afterHandover.idem_key, code: "OUTSIDE_SHIFT" });
    // Counted under X's shift, as late-synced, and on the record.
    const sum = await h.call<HandoverSummary>("POST", `/staff-assignments/${x.assignmentId}/handover`, { token: (await h.login(h.seed.emails.admin)).access_token });
    expect(sum.body.late_synced).toBeGreaterThanOrEqual(1);
    const audit = (await h.app.ctx.repos.audit.all()).find((e) => e.action === "scan.late_sync" && e.target === `staff_assignment:${x.assignmentId}`);
    expect(audit?.actor_id).toBe(y.id);
    expect(audit?.meta_jsonb).toMatchObject({ scans: 1, by_maker: false });
    // Idempotent: the same item again returns its original outcome.
    const again = await postScans<ScanBatchResponse>(h, [stranded], { token: yt, deviceId: "phone-A" });
    expect(again.body.results[0]).toMatchObject({ replayed: true, scan_id: r.body.results[0]!.scan_id });
  });

  it("are refused from someone not on shift at that gate, outside the named shift, or after the late window", async () => {
    const cp = h.seed.checkpoints.eastIn;
    const now = h.clock.now();
    const x = await staffWithShift(cp, now - H, now + H);
    const elsewhere = await staffWithShift(h.seed.checkpoints.mainOut, now - H, now + 20 * H);
    const xt = await x.token();
    await heartbeat(xt, cp, "phone-C");
    const a = await addAttendee(h, "ORDINARY");
    const item = scan(h, cp, band(a.uid), { offline: true, local_result: "admitted", occurred_at: iso(now - 5 * MIN), assignment_id: x.assignmentId });
    h.clock.advance(90 * MIN);
    const other = await postScans<ScanBatchResponse>(h, [item], { token: await elsewhere.token(), deviceId: "phone-C" });
    expect(other.body.rejected?.[0]?.code).toBe("CHECKPOINT_NOT_ASSIGNED");
    // Wrong time: before the named shift began.
    const early = scan(h, cp, band(a.uid), { offline: true, local_result: "admitted", occurred_at: iso(now - 2 * H), assignment_id: x.assignmentId });
    expect((await postScans<ScanBatchResponse>(h, [early], { token: await x.token(), deviceId: "phone-C" })).body.rejected?.[0]?.code).toBe("OUTSIDE_SHIFT");
    // The maker may sync it themself (past the old one-hour grace), until the late window closes.
    h.clock.advance(12 * H);
    const late = await postScans<ScanBatchResponse>(h, [item], { token: await x.token(), deviceId: "phone-C" });
    expect(late.body.rejected?.[0]).toMatchObject({ code: "OUTSIDE_SHIFT" });
    expect(late.body.rejected?.[0]?.message).toMatch(/late-sync window/);
  });
});
