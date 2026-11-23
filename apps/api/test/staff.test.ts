/** Slice 6: staff, assignments, handover, invite and activation, MFA enrolment, REST heartbeat. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HandoverSummary, StaffAssignment, TokenPair } from "@synan/contracts/rest";
import { totp } from "../src/lib/crypto.js";
import { band, devEmail, errCode, postScans, scan, startHarness, type Harness } from "./helpers.js";

let h: Harness;
let admin: string;
let organiser: string;
beforeAll(async () => {
  h = await startHarness();
  admin = (await h.login(h.seed.emails.admin)).access_token;
  organiser = (await h.login(h.seed.emails.organiser)).access_token;
});
afterAll(async () => h.close());
const H = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("slice 6 · staff and assignments", () => {
  it("only an admin lists staff; organisers and gates are refused", async () => {
    const r = await h.call<{ items: { email: string; role: string; mfa_enrolled: boolean }[] }>("GET", "/staff?limit=500", { token: admin });
    expect(r.status).toBe(200);
    expect(r.body.items.find((u) => u.email === h.seed.emails.admin)?.mfa_enrolled).toBe(true);
    expect((await h.call("GET", "/staff", { token: organiser })).status).toBe(403);
  });

  it("creates assignments; an overlapping shift for one person is refused; audited", async () => {
    const userId = h.seed.users.gate2;
    const now = h.clock.now();
    const body = { user_id: userId, checkpoint_id: h.seed.checkpoints.eastIn, shift_start: iso(now + 20 * H), shift_end: iso(now + 24 * H), event_id: h.seed.eventId };
    expect((await h.call("POST", "/staff-assignments", { token: organiser, body })).status).toBe(403);
    const r = await h.call<StaffAssignment>("POST", "/staff-assignments", { token: admin, body });
    expect(r.status).toBe(201);
    expect(r.body.event_id).toBe(h.seed.eventId);
    const clash = await h.call("POST", "/staff-assignments", { token: admin, body: { ...body, checkpoint_id: h.seed.checkpoints.mainOut, shift_start: iso(now + 23 * H), shift_end: iso(now + 26 * H) } });
    expect(errCode(clash.body)).toBe("CONFLICT");
    expect(errCode((await h.call("POST", "/staff-assignments", { token: admin, body: { ...body, user_id: h.seed.users.organiser } })).body)).toBe("VALIDATION_FAILED");
    const list = await h.call<{ items: StaffAssignment[] }>("GET", `/staff-assignments?user_id=${userId}`, { token: organiser });
    expect(list.body.items).toHaveLength(2);
    expect((await h.app.ctx.repos.audit.all()).map((a) => a.action)).toContain("staff_assignment.create");
  });

  it("a gate user sees only their own current and upcoming shifts", async () => {
    const gate2 = (await h.login(h.seed.emails.gate2)).access_token;
    const mine = await h.call<{ items: StaffAssignment[] }>("GET", "/me/assignments", { token: gate2 });
    expect(mine.body.items).toHaveLength(1); // the finished shift is gone; the new one is listed
    expect(mine.body.items[0]!.checkpoint_id).toBe(h.seed.checkpoints.eastIn);
  });

  it("handover summarises the shift's scans; only the assignee or an operator may hand over", async () => {
    const gate = await h.gateToken(h.seed.checkpoints.expo);
    await postScans(h, [scan(h, h.seed.checkpoints.expo, band(h.seed.attendees.ordinary.uid)), scan(h, h.seed.checkpoints.expo, band("DEADBEEF00"))]);
    const a = (await h.call<{ items: StaffAssignment[] }>("GET", "/me/assignments", { token: gate })).body.items[0]!;
    const other = await h.gateToken(h.seed.checkpoints.vip);
    expect((await h.call("POST", `/staff-assignments/${a.id}/handover`, { token: other })).status).toBe(404);
    const r = await h.call<HandoverSummary>("POST", `/staff-assignments/${a.id}/handover`, { token: gate });
    expect(r.status).toBe(200);
    expect(r.body.admitted).toBe(1);
    expect(r.body.refused).toBe(1);
    expect(r.body.by_result.unknown_token).toBe(1);
    expect((await h.app.ctx.repos.audit.all()).map((x) => x.action)).toContain("staff_assignment.handover");
  });
});

describe("slice 6 · invite and activation", () => {
  it("an admin invites; the link sets a password once; the new user can sign in", async () => {
    const email = devEmail("new.crew");
    const r = await h.call<{ id: string; role: string }>("POST", "/staff", { token: admin, body: { email, role: "security_staff" } });
    expect(r.status).toBe(201);
    expect((await h.call("POST", "/auth/login", { body: { email, password: "" } })).status).toBe(400);
    const token = /#token=([A-Za-z0-9_-]+)/.exec(h.mailer.last("staff.invite")!.text)![1]!;
    expect((await h.call("POST", "/auth/activate", { body: { token, password: "a long enough secret" } })).status).toBe(200);
    expect(errCode((await h.call("POST", "/auth/activate", { body: { token, password: "another long secret" } })).body)).toBe("LINK_INVALID");
    expect((await h.call("POST", "/auth/login", { body: { email, password: "a long enough secret" } })).status).toBe(200);
    expect(errCode((await h.call("POST", "/staff", { token: admin, body: { email, role: "crew" } })).body)).toBe("CONFLICT");
  });
});

describe("slice 6 · MFA enrolment and heartbeat", () => {
  it("an organiser enrols a TOTP secret by confirming a code, then can step up", async () => {
    const start = await h.call<{ secret: string; otpauth_url: string }>("POST", "/auth/mfa/enrol", { token: organiser });
    expect(start.status).toBe(201);
    expect(start.body.otpauth_url).toContain("otpauth://totp/");
    expect(errCode((await h.call("POST", "/auth/mfa/enrol/confirm", { token: organiser, body: { code: "000000" } })).body)).toBe("INVALID_MFA_CODE");
    const code = totp(start.body.secret, h.clock.now());
    expect((await h.call("POST", "/auth/mfa/enrol/confirm", { token: organiser, body: { code } })).status).toBe(200);
    h.clock.advance(31_000);
    const step = await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: organiser, body: { code: totp(start.body.secret, h.clock.now()) } });
    expect(step.status).toBe(200);
    expect(step.body.principal.mfa).toBe(true);
    // Re-enrolling an enrolled account needs a fresh step-up.
    const plain = (await h.login(h.seed.emails.organiser)).access_token;
    expect(errCode((await h.call("POST", "/auth/mfa/enrol", { token: plain })).body)).toBe("MFA_REQUIRED");
  });

  it("the REST heartbeat feeds gate health for the caller's own checkpoint only", async () => {
    const gate = await h.gateToken(h.seed.checkpoints.press);
    const body = { checkpoint_id: h.seed.checkpoints.press, device_id: "tab-7", queue_depth: 4, clock_offset_ms: 150, online: true };
    expect((await h.call("POST", "/gates/heartbeat", { token: gate, body })).status).toBe(200);
    expect(errCode((await h.call("POST", "/gates/heartbeat", { token: gate, body: { ...body, checkpoint_id: h.seed.checkpoints.vip } })).body)).toBe("CHECKPOINT_NOT_ASSIGNED");
    const health = await h.call<{ items: { checkpoint_id: string; queue_depth: number; link_state: string }[] }>("GET", `/gates/health?event_id=${h.seed.eventId}`, { token: organiser });
    const g = health.body.items.find((i) => i.checkpoint_id === h.seed.checkpoints.press)!;
    expect(g.queue_depth).toBe(4);
    expect(g.link_state).toBe("degraded");
  });
});

describe("operator profile", () => {
  it("GET /me/operator: who is signed in, their role and the shift in progress", async () => {
    const gate = await h.gateToken(h.seed.checkpoints.press);
    const r = await h.call<{ role: string; current_shift: { checkpoint_id: string; checkpoint_label: string } | null }>("GET", "/me/operator", { token: gate });
    expect(r.status).toBe(200);
    expect(r.body.role).toBe("security_staff");
    expect(r.body.current_shift?.checkpoint_label).toBe("Press Room Door");
    const ops = await h.call<{ current_shift: unknown; mfa_fresh: boolean }>("GET", "/me/operator", { token: organiser });
    expect(ops.body.current_shift).toBeNull();
  });
});
