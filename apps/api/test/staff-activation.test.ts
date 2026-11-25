/**
 * Staff activation (01 §3, 03 §3): the invitation links to the role's own app with the one-time
 * token in the fragment; the link can be checked without spending it; it sets a password once, for
 * 72 hours; and nothing in these public calls names an account or says whether one exists.
 */
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

  it("an admin's new invitation replaces the earlier link (which then reads invalid), keeps one account, and may correct the role", async () => {
    const first = await invite("security_staff");
    h.clock.advance(73 * H); // the first link has expired: the person asks for a new one
    const again = await invite("supervisor", first.email);
    expect(again.id).toBe(first.id);
    expect(again.token).not.toBe(first.token);
    expect(`${again.link.origin}${again.link.pathname}`).toBe(`${ADMIN_APP}/activate`); // the corrected role's app
    expect((await check(first.token)).body).toEqual({ state: "invalid" });
    expect((await check(again.token)).body).toMatchObject({ state: "valid", role: "supervisor" });
    const audit = (await h.app.ctx.repos.audit.all()).filter((a) => a.action === "staff.invite" && a.target === `user:${first.id}`);
    expect(audit.map((a) => a.meta_jsonb)).toEqual([{ role: "security_staff" }, { role: "supervisor", reinvite: true, from_role: "security_staff" }]);
    expect(errCode((await activate(first.token, "twelve chars and more")).body)).toBe("LINK_INVALID");
    expect((await activate(again.token, "twelve chars and more")).status).toBe(200);
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

  it("a link that cannot be used counts as a failed attempt, per address, on check and on activate alike", async () => {
    const madeUp = ["not", "a", "real", "activation", "token"].join("-");
    const checks: (string | number)[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await limited.call<{ state?: string; error?: { code: string } }>("POST", "/auth/activate/check", { body: { token: madeUp } });
      checks.push(r.body.state ?? r.body.error!.code);
    }
    expect(checks).toEqual(["invalid", "invalid", "invalid", "RATE_LIMITED"]);
    const activations: string[] = [];
    for (let i = 0; i < 4; i++) activations.push(errCode((await limited.call("POST", "/auth/activate", { body: { token: madeUp, password: "twelve chars and more" } })).body));
    expect(activations).toEqual(["LINK_INVALID", "LINK_INVALID", "LINK_INVALID", "RATE_LIMITED"]);
  });
});
