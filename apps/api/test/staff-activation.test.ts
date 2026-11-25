/**
 * Staff activation (01 §3, 03 §3): the invitation links to the role's own app with the one-time
 * token in the fragment; the link can be checked without spending it; it sets a password once, for
 * 72 hours; and nothing in these public calls names an account or says whether one exists.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@synan/contracts/enums";
import type { ActivationCheck } from "@synan/contracts/rest";
import { loadConfig } from "../src/config.js";
import { devEmail, errCode, startHarness, type Harness } from "./helpers.js";

const ADMIN_APP = "https://console.example.test/admin";
const SCANNER_APP = "https://gate.example.test/scan";
const H = 3600_000;

let h: Harness;
beforeAll(async () => {
  h = await startHarness({ config: { adminAppUrl: ADMIN_APP, scannerAppUrl: SCANNER_APP } });
});
/** A fresh admin session (tests move the clock past the access token's 10 minutes). */
const adminToken = async () => (await h.login(h.seed.emails.admin)).access_token;
afterAll(async () => h.close());

let n = 0;
/** Invite a new address with this role; the emailed link, parsed. */
async function invite(role: Role, email = devEmail(`activation.${role}.${++n}`)) {
  const r = await h.call<{ id: string; role: string }>("POST", "/staff", { token: await adminToken(), body: { email, role } });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const mail = h.mailer.last("staff.invite")!;
  expect(mail.to).toBe(email);
  const link = new URL(/https?:\/\/\S+/.exec(mail.text)![0]);
  const token = /^#token=([A-Za-z0-9_-]+)$/.exec(link.hash)![1]!;
  return { id: r.body.id, email, link, token, mail };
}
const check = (token: string) => h.call<ActivationCheck>("POST", "/auth/activate/check", { body: { token } });
const activate = (token: string, password: string) => h.call("POST", "/auth/activate", { body: { token, password } });

describe("the invitation links to the role's own app", () => {
  it("security staff to the Gate Scanner; every other role to the Admin Command; the token only in the fragment", async () => {
    const where: Record<Role, string> = {
      admin: ADMIN_APP, organiser: ADMIN_APP, supervisor: ADMIN_APP, desk_clerk: ADMIN_APP, speaker: ADMIN_APP, crew: ADMIN_APP,
      security_staff: SCANNER_APP,
    };
    for (const [role, app] of Object.entries(where) as [Role, string][]) {
      const { link, token, mail } = await invite(role);
      expect(`${link.origin}${link.pathname}`, role).toBe(`${app}/activate`);
      expect(link.search, role).toBe("");
      expect(link.pathname).not.toContain(token);
      expect(mail.text, role).toContain(role === "security_staff" ? "Gate Scanner" : role === "speaker" || role === "crew" ? "no console" : "Admin Command");
      expect((await check(token)).body, role).toMatchObject({ state: "valid", role });
    }
    // Nothing on the attendee origin any more (that page only forwards links sent before).
    expect(h.mailer.last("staff.invite")!.text).not.toContain("/staff/activate");
  });

  it("the app URLs are configured, with defaults, and refuse anything that would put the token elsewhere", () => {
    const base = { ACCESS_TOKEN_TTL_S: "600" };
    expect(loadConfig(base, [])).toMatchObject({ adminAppUrl: "http://localhost:5174/admin", scannerAppUrl: "http://localhost:5175/scan" });
    expect(loadConfig({ ...base, ADMIN_APP_URL: "https://ops.example.test/admin", SCANNER_APP_URL: "https://ops.example.test/scan" }, [])).toMatchObject({
      adminAppUrl: "https://ops.example.test/admin", scannerAppUrl: "https://ops.example.test/scan",
    });
    for (const bad of ["https://ops.example.test/admin/", "https://ops.example.test/admin?x=1", "https://ops.example.test/admin#a", "ftp://ops.example.test/admin", "/admin", "https://u:p@ops.example.test/admin"]) {
      expect(() => loadConfig({ ...base, ADMIN_APP_URL: bad }, []), bad).toThrow(/ADMIN_APP_URL/);
      expect(() => loadConfig({ ...base, SCANNER_APP_URL: bad }, []), bad).toThrow(/SCANNER_APP_URL/);
    }
  });
});

describe("activation", () => {
  it("check does not spend the link; a refused password leaves it usable; it sets the password once; then the person signs in", async () => {
    const { id, email, token } = await invite("supervisor");
    const valid = await check(token);
    expect(valid.body).toEqual({ state: "valid", role: "supervisor", expires_at: expect.any(String) });
    expect(Date.parse(valid.body.expires_at!) - h.clock.now()).toBeGreaterThan(71 * H);
    expect((await check(token)).body.state).toBe("valid");
    // The rules: 12 to 200 characters. A refusal spends nothing.
    expect(errCode((await activate(token, "too short")).body)).toBe("VALIDATION_FAILED");
    expect(errCode((await activate(token, "x".repeat(201))).body)).toBe("VALIDATION_FAILED");
    expect((await check(token)).body.state).toBe("valid");
    expect(errCode((await h.call("POST", "/auth/login", { body: { email, password: "" } })).body)).toBe("VALIDATION_FAILED");

    const password = "twelve chars and more";
    expect((await activate(token, password)).status).toBe(200);
    expect((await check(token)).body).toEqual({ state: "used" });
    expect(errCode((await activate(token, "another long secret")).body)).toBe("LINK_INVALID");
    expect((await h.call("POST", "/auth/login", { body: { email, password } })).status).toBe(200);
    expect(errCode((await h.call("POST", "/auth/login", { body: { email, password: "another long secret" } })).body)).toBe("INVALID_CREDENTIALS");

    // Audited once, as the person; the token and the password are nowhere in the audit log.
    const audit = await h.app.ctx.repos.audit.all();
    expect(audit.filter((a) => a.action === "staff.activate" && a.target === `user:${id}`)).toHaveLength(1);
    expect(audit.find((a) => a.action === "staff.activate" && a.target === `user:${id}`)!.actor_id).toBe(id);
    expect(JSON.stringify(audit)).not.toContain(token);
    expect(JSON.stringify(audit)).not.toContain(password);
    // An activated account cannot be invited again (no password reset by invitation).
    expect(errCode((await h.call("POST", "/staff", { token: await adminToken(), body: { email, role: "supervisor" } })).body)).toBe("CONFLICT");
  });

  it("after 72 hours the link has expired, for check and for activate", async () => {
    const { token } = await invite("desk_clerk");
    h.clock.advance(72 * H + 1_000);
    expect((await check(token)).body).toEqual({ state: "expired" });
    expect(errCode((await activate(token, "twelve chars and more")).body)).toBe("LINK_EXPIRED");
  });

  it("an admin's new invitation replaces the earlier link (which then reads invalid) and keeps one account", async () => {
    const first = await invite("security_staff");
    h.clock.advance(73 * H); // the first link has expired: the person asks for a new one
    const mark = h.mailer.outbox.length;
    const again = await invite("security_staff", first.email);
    expect(again.id).toBe(first.id);
    expect(again.token).not.toBe(first.token);
    expect(h.mailer.outbox.length).toBe(mark + 1);
    expect((await check(first.token)).body).toEqual({ state: "invalid" });
    expect((await check(again.token)).body).toMatchObject({ state: "valid", role: "security_staff" });
    const audit = (await h.app.ctx.repos.audit.all()).filter((a) => a.action === "staff.invite" && a.target === `user:${first.id}`);
    expect(audit.map((a) => a.meta_jsonb)).toEqual([{ role: "security_staff" }, { role: "security_staff", reinvite: true }]);
    expect(errCode((await activate(first.token, "twelve chars and more")).body)).toBe("LINK_INVALID");
    expect((await activate(again.token, "twelve chars and more")).status).toBe(200);
  });

  it("F2: a re-invite never changes the role; that is PATCH /staff/:id, with the second factor and a reason", async () => {
    const first = await invite("security_staff");
    const mark = h.mailer.outbox.length;
    const r = await h.call<{ error: { code: string; message: string } }>("POST", "/staff", { token: await adminToken(), body: { email: first.email, role: "admin" } });
    expect(r.body.error.code).toBe("CONFLICT");
    expect(r.body.error.message).toContain("PATCH /staff/:id");
    expect((await h.app.ctx.repos.users.byId(first.id))!.role).toBe("security_staff");
    expect(h.mailer.outbox.length, "no new link was mailed").toBe(mark);
    expect((await check(first.token)).body, "the earlier link still stands").toMatchObject({ state: "valid", role: "security_staff" });
    expect((await h.app.ctx.repos.audit.all()).filter((a) => a.action === "staff.invite" && a.target === `user:${first.id}`)).toHaveLength(1);
  });

  it("F2: a passwordless account that was never invited (a crew record) is not pending: no invitation, no role change", async () => {
    const email = devEmail(`activation.crew-record.${++n}`);
    const id = randomUUID();
    await h.app.ctx.repos.users.insert({ id, email, password_hash: "", role: "crew", mfa_enrolled_at: null, mfa_secret: null, display_name: null });
    const mark = h.mailer.outbox.length;
    for (const role of ["admin", "crew"] as const) {
      expect(errCode((await h.call("POST", "/staff", { token: await adminToken(), body: { email, role } })).body), role).toBe("CONFLICT");
    }
    expect((await h.app.ctx.repos.users.byId(id))!.role).toBe("crew");
    expect(h.mailer.outbox.length).toBe(mark);
  });

  it("F1: a live link to an account that already has a password cannot set one (the stale re-invite, made deterministic)", async () => {
    const { id, email, token } = await invite("supervisor");
    const password = "the first password set";
    expect((await activate(token, password)).status).toBe(200);
    // What an overlapping re-invite would leave behind: an invitation created after the activation.
    const stale = await h.app.ctx.repos.userInvites.create({ userId: id, createdBy: null, now: new Date(h.clock.now()) });
    expect((await check(stale)).body, "it reads as used, not valid").toEqual({ state: "used" });
    expect(errCode((await activate(stale, "a password set by the link")).body)).toBe("LINK_INVALID");
    // At the point of use too, bypassing the route's own check: nothing is written, nothing is spent.
    expect((await h.app.ctx.repos.userInvites.activate(stale, "not-a-real-hash", new Date(h.clock.now()))).status).toBe("account_active");
    expect((await h.app.ctx.repos.userInvites.peek(stale, new Date(h.clock.now()))).status).toBe("account_active");
    expect((await h.call("POST", "/auth/login", { body: { email, password } })).status, "the password is unchanged").toBe(200);
    expect(errCode((await h.call("POST", "/auth/login", { body: { email, password: "a password set by the link" } })).body)).toBe("INVALID_CREDENTIALS");
    expect((await h.app.ctx.repos.audit.all()).filter((a) => a.action === "staff.activate" && a.target === `user:${id}`)).toHaveLength(1);
  });

  it("ten activations of one link at once: exactly one sets the password; a re-invite racing them never resets it", async () => {
    const { id, email, token } = await invite("organiser");
    const tries = Array.from({ length: 10 }, (_, i) => `concurrent password number ${i}`);
    const results = await Promise.all(tries.map((p) => activate(token, p)));
    const won = results.flatMap((r, i) => (r.status === 200 ? [tries[i]!] : []));
    expect(won, JSON.stringify(results.map((r) => r.status))).toHaveLength(1);
    expect(results.filter((r) => r.status !== 200).every((r) => errCode(r.body) === "LINK_INVALID")).toBe(true);
    expect((await h.call("POST", "/auth/login", { body: { email, password: won[0]! } })).status).toBe(200);
    // A re-invite and an activation with a link made meanwhile, at once: the account keeps its password.
    const stale = await h.app.ctx.repos.userInvites.create({ userId: id, createdBy: null, now: new Date(h.clock.now()) });
    const [again, reset] = await Promise.all([
      h.call("POST", "/staff", { token: await adminToken(), body: { email, role: "organiser" } }),
      activate(stale, "a password set by a stale link"),
    ]);
    expect(errCode(again.body)).toBe("CONFLICT");
    expect(errCode(reset.body)).toBe("LINK_INVALID");
    expect((await h.call("POST", "/auth/login", { body: { email, password: won[0]! } })).status).toBe(200);
  });

  it("a made-up link is invalid and says nothing about any account", async () => {
    const madeUp = ["not", "a", "real", "activation", "token"].join("-");
    expect((await check(madeUp)).body).toEqual({ state: "invalid" });
    expect(errCode((await activate(madeUp, "twelve chars and more")).body)).toBe("LINK_INVALID");
    expect(errCode((await check("short")).body)).toBe("VALIDATION_FAILED");
    const r = await activate(madeUp, "twelve chars and more");
    expect(JSON.stringify(r.body)).not.toMatch(/@|user|email/i);
  });
});

describe("rate limit", () => {
  let limited: Harness;
  beforeAll(async () => {
    limited = await startHarness({ config: { rateLimits: { authPerMin: 3, scanPerMin: 100_000, resendPerHour: 100 } } });
  });
  afterAll(async () => limited.close());

  it("F3: check and activate share one per-address bucket; a link that cannot be used counts as a failure on either", async () => {
    const madeUp = ["not", "a", "real", "activation", "token"].join("-");
    const seen: string[] = [];
    const checkOnce = async () => {
      const r = await limited.call<{ state?: string; error?: { code: string } }>("POST", "/auth/activate/check", { body: { token: madeUp } });
      seen.push(r.body.state ?? r.body.error!.code);
    };
    const activateOnce = async () => seen.push(errCode((await limited.call("POST", "/auth/activate", { body: { token: madeUp, password: "twelve chars and more" } })).body));
    await checkOnce();
    await activateOnce();
    await checkOnce();
    await activateOnce(); // the fourth attempt across the two paths: the shared quota of 3 is spent
    await checkOnce();
    expect(seen).toEqual(["invalid", "LINK_INVALID", "invalid", "RATE_LIMITED", "RATE_LIMITED"]);
  });
});
