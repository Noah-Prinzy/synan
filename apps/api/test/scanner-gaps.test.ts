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
    // The event's slug and its rooms by name (the scanner's room chips), names only.
    const event = (await h.app.ctx.repos.events.byId(h.seed.eventId))!;
    const ev = r.body.items[0]!.event!;
    expect(ev.slug).toBe(event.slug);
    const want = await h.app.ctx.repos.venues.roomsByIds((await h.app.ctx.repos.events.rooms(event.id)).map((x) => x.room_id));
    expect(ev.rooms).toEqual(want.map((x) => ({ room_id: x.id, name: x.name })).sort((p, q) => p.name.localeCompare(q.name)));
    expect(ev.rooms!.length).toBeGreaterThan(0);
    expect(ev.rooms!.find((x) => x.room_id === h.seed.rooms.auditorium)).toEqual({ room_id: h.seed.rooms.auditorium, name: "Main Auditorium" });
    expect(Object.keys(ev.rooms![0]!).sort()).toEqual(["name", "room_id"]);
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
    const health = async () => (await h.call<{ items: GateHealth[] }>("GET", `/gates/health?event_id=${h.seed.eventId}`, { token: (await h.login(h.seed.emails.admin)).access_token })).body.items.find((g) => g.checkpoint_id === cp)!;
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

describe("A6 · the QR leeway and the undo window are published", () => {
  it("on GET /time and GET /auth/signing-keys", async () => {
    const time = (await h.call<ServerTime>("GET", "/time")).body;
    const keys = (await h.call<SigningKeys>("GET", "/auth/signing-keys")).body;
    expect(time.qr_leeway_s).toBe(h.app.ctx.config.qrLeewayS);
    expect(keys.qr_leeway_s).toBe(h.app.ctx.config.qrLeewayS);
    expect(time.undo_window_s).toBe(h.app.ctx.config.scanUndoWindowS);
    expect(keys.undo_window_s).toBe(h.app.ctx.config.scanUndoWindowS);
    expect(time.undo_window_s).toBe(60); // SCAN_UNDO_WINDOW_S default
  });
});

describe("B1 · one phone handed from one person to the next is one device", () => {
  it("keeps one device row; the next user's allowlist age replaces the previous one's, with no false stale flag or alert", async () => {
    const cp = h.seed.checkpoints.boardroom;
    const T = h.clock.now();
    const x = await staffWithShift(cp, T - H, T + H);
    const y = await staffWithShift(cp, T - H, T + H);
    const xt = await x.token();
    const health = async () => (await h.call<{ items: GateHealth[] }>("GET", `/gates/health?event_id=${h.seed.eventId}`, { token: (await h.login(h.seed.emails.admin)).access_token })).body.items.find((g) => g.checkpoint_id === cp)!;
    const phones = async () => (await h.app.ctx.repos.devices.list(h.seed.venueId)).filter((d) => d.kind === "scanner" && d.checkpoint_id === cp && d.state === "active");

    // 08:20: X's heartbeat reports an allowlist issued 08:12. X hands over.
    expect((await heartbeat(xt, cp, "shared-phone", { allowlist_issued_at: iso(T - 8 * MIN) })).status).toBe(200);
    expect(await health()).toMatchObject({ allowlist_issued_at: iso(T - 8 * MIN), allowlist_stale: false });
    expect((await h.call("POST", `/staff-assignments/${x.assignmentId}/handover`, { token: xt })).status).toBe(200);

    // 08:22: Y signs in on the same phone; its first heartbeat holds no allowlist yet. X's is not shown.
    h.clock.advance(2 * MIN);
    const yt = await y.token();
    expect((await heartbeat(yt, cp, "shared-phone")).status).toBe(200);
    expect(await phones()).toHaveLength(1);
    expect((await health()).allowlist_issued_at).toBeNull();
    // Then Y's phone fetches the allowlist issued 08:18 and reports it.
    expect((await heartbeat(yt, cp, "shared-phone", { allowlist_issued_at: iso(T - 2 * MIN) })).status).toBe(200);

    // 08:29: X's 08:12 would be 17 minutes old (stale); the phone holds 08:18 (11 minutes): not stale.
    h.clock.advance(7 * MIN);
    expect((await heartbeat(yt, cp, "shared-phone", { allowlist_issued_at: iso(T - 2 * MIN) })).status).toBe(200);
    expect(await phones()).toHaveLength(1);
    expect(await health()).toMatchObject({ allowlist_issued_at: iso(T - 2 * MIN), allowlist_stale: false, link_state: "online" });
    const event = (await h.app.ctx.repos.events.byId(h.seed.eventId))!;
    expect((await h.app.ctx.gates.health(event)).find((g) => g.checkpoint_id === cp)!.allowlist_stale).toBe(false); // what the gate.health feed publishes
    expect((await h.app.ctx.repos.alerts.list({ eventId: h.seed.eventId, checkpointIds: [cp], limit: 100 })).filter((a) => a.kind === "stale_allowlist")).toHaveLength(0);

    // The takeover is on the record, once.
    const phoneId = (await phones())[0]!.id;
    const changes = (await h.app.ctx.repos.audit.all()).filter((e) => e.action === "scanner.user_change" && e.target === `device:${phoneId}`);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ actor_id: y.id, meta_jsonb: { checkpoint_id: cp, previous_user_id: x.id } });
  });

  it("an install's row moves with it to another gate, leaving nothing behind; a different install is another device", async () => {
    const T = h.clock.now();
    const a = h.seed.checkpoints.press;
    const z = await staffWithShift(a, T - H, T + H);
    const zt = await z.token();
    expect((await heartbeat(zt, a, "phone-Z", { queue_depth: 3 })).status).toBe(200);
    expect((await heartbeat(zt, a, "phone-Z2")).status).toBe(200);
    const atGate = async (cp: string) => (await h.app.ctx.repos.devices.list(h.seed.venueId)).filter((d) => d.kind === "scanner" && d.checkpoint_id === cp && d.state === "active");
    expect(await atGate(a)).toHaveLength(2);
    // The hardware id is a hash: the install id never reaches the row.
    for (const d of await atGate(a)) expect(d.hardware_id).toMatch(/^phone:[0-9a-f]{40}$/);
    expect((await atGate(a)).some((d) => d.hardware_id.includes("phone-Z"))).toBe(false);
    const health = async (cp: string) => (await h.call<{ items: GateHealth[] }>("GET", `/gates/health?event_id=${h.seed.eventId}`, { token: (await h.login(h.seed.emails.admin)).access_token })).body.items.find((g) => g.checkpoint_id === cp)!;
    expect((await health(a)).queue_depth).toBe(3);
    // phone-Z is carried to the Boardroom door and used there by the person staffing it.
    const b = h.seed.checkpoints.boardroom;
    const w = await staffWithShift(b, T - H, T + H);
    const before = (await atGate(b)).length;
    expect((await heartbeat(await w.token(), b, "phone-Z")).status).toBe(200);
    expect(await atGate(a)).toHaveLength(1);
    expect(await atGate(b)).toHaveLength(before + 1);
    expect((await health(a)).queue_depth).toBe(0); // its 3 queued scans no longer count at the gate it left
  });
});

describe("B2 · the handover summary leaves undone admissions out", () => {
  it("counts them as undone, not admitted or let through, on both backends", async () => {
    const cp = h.seed.checkpoints.press;
    const now = h.clock.now();
    const x = await staffWithShift(cp, now - MIN, now + H);
    const t = await x.token();
    const ids: string[] = [];
    for (let k = 0; k < 3; k++) {
      const a = await addAttendee(h, "ORDINARY");
      const r = await postScans<ScanBatchResponse>(h, [scan(h, cp, band(a.uid), { direction: "in" })], { token: t });
      expect(r.body.results[0]!.result).toBe("admitted");
      ids.push(r.body.results[0]!.scan_id);
      h.clock.advance(1_000);
    }
    for (const id of [ids[0]!, ids[2]!]) {
      expect((await h.call<UndoScanResult>("POST", `/scans/${id}/undo`, { token: t, body: { event_id: h.seed.eventId, reason: "wrong person" } })).status).toBe(200);
    }
    const sum = await h.call<HandoverSummary>("POST", `/staff-assignments/${x.assignmentId}/handover`, { token: t });
    expect(sum.status).toBe(200);
    expect(sum.body).toMatchObject({ admitted: 1, let_through: 1, undone: 2, scans: 3, by_result: { admitted: 1 } });
    // Asked again (re-read, not re-stamped): the same figures; the audit entry carries them too.
    expect((await h.call<HandoverSummary>("POST", `/staff-assignments/${x.assignmentId}/handover`, { token: t })).body).toMatchObject({ admitted: 1, undone: 2 });
    const entry = (await h.app.ctx.repos.audit.all()).find((e) => e.action === "staff.handover" && e.target === `staff_assignment:${x.assignmentId}`);
    expect(entry?.meta_jsonb).toMatchObject({ let_through: 1, undone: 2 });
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
