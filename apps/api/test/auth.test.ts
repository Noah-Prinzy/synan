import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { endpoints, type TokenPair } from "@synan/contracts/rest";
import { verifyChain } from "../src/domain/audit.js";
import { REPO_UNDER_TEST } from "./helpers.js";
import { devEmail, errCode, mfaCode, startHarness, type Harness } from "./helpers.js";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

describe("operator login and tokens", () => {
  it("logs in with a valid password and returns a contract-valid token pair", async () => {
    const r = await h.call<TokenPair>("POST", "/auth/login", { body: { email: h.seed.emails.organiser, password: h.seed.password } });
    expect(r.status).toBe(200);
    expect(() => endpoints.login.response.parse(r.body)).not.toThrow();
    expect(r.body.principal).toMatchObject({ kind: "operator", role: "organiser", mfa: false });
    // Opaque refresh token, not a DB id.
    expect(r.body.refresh_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("refuses a wrong password and an unknown email with the same error", async () => {
    const a = await h.call("POST", "/auth/login", { body: { email: h.seed.emails.organiser, password: "nope" } });
    const b = await h.call("POST", "/auth/login", { body: { email: devEmail("nobody"), password: "nope" } });
    expect([a.status, b.status]).toEqual([401, 401]);
    expect([errCode(a.body), errCode(b.body)]).toEqual(["INVALID_CREDENTIALS", "INVALID_CREDENTIALS"]);
  });

  it("rejects malformed bodies with VALIDATION_FAILED and field issues", async () => {
    const r = await h.call("POST", "/auth/login", { body: { email: "not-an-email" } });
    expect(r.status).toBe(400);
    expect(errCode(r.body)).toBe("VALIDATION_FAILED");
    expect((r.body as { error: { issues: { path: string }[] } }).error.issues.map((i) => i.path)).toEqual(
      expect.arrayContaining(["body.email", "body.password"]),
    );
  });

  it("requires a token on protected routes, rejects garbage, and expires tokens", async () => {
    expect(errCode((await h.call("GET", "/breach-alerts")).body)).toBe("UNAUTHENTICATED");
    expect(errCode((await h.call("GET", "/breach-alerts", { token: "abc.def.ghi" })).body)).toBe("UNAUTHENTICATED");
    const t = await h.login(h.seed.emails.organiser);
    expect((await h.call("GET", "/breach-alerts", { token: t.access_token })).status).toBe(200);
    h.clock.advance(11 * 60_000);
    const expired = await h.call("GET", "/breach-alerts", { token: t.access_token });
    expect(expired.status).toBe(401);
    expect(errCode(expired.body)).toBe("TOKEN_EXPIRED");
  });

  it("rotates refresh tokens and revokes the family on reuse", async () => {
    const t1 = await h.login(h.seed.emails.organiser);
    const r2 = await h.call<TokenPair>("POST", "/auth/refresh", { body: { refresh_token: t1.refresh_token } });
    expect(r2.status).toBe(200);
    expect(r2.body.refresh_token).not.toBe(t1.refresh_token);
    // Replaying the old one is treated as theft: refused, and the new one dies too.
    const replay = await h.call("POST", "/auth/refresh", { body: { refresh_token: t1.refresh_token } });
    expect(replay.status).toBe(401);
    const after = await h.call("POST", "/auth/refresh", { body: { refresh_token: r2.body.refresh_token } });
    expect(after.status).toBe(401);
  });
});

describe("attendee email-link sign-in", () => {
  it("answers 202 for known and unknown addresses alike, and mails only the known one", async () => {
    const before = h.mailer.outbox.length;
    const unknown = await h.call("POST", "/auth/email-link", { body: { email: "stranger@example.com" } });
    expect(unknown.status).toBe(202);
    expect(h.mailer.outbox.length).toBe(before);
    const known = await h.call("POST", "/auth/email-link", { body: { email: devEmail("vip") } });
    expect(known.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    expect(h.mailer.outbox.length).toBe(before + 1);
  });

  it("verifies a link once, putting the token in the URL fragment", async () => {
    await h.call("POST", "/auth/email-link", { body: { email: devEmail("ordinary") } });
    const mail = h.mailer.last("auth.link")!;
    expect(mail.to).toBe(devEmail("ordinary"));
    const token = /#token=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
    const ok = await h.call<TokenPair>("POST", "/auth/verify", { body: { token } });
    expect(ok.status).toBe(200);
    expect(ok.body.principal).toMatchObject({ kind: "attendee", role: null });
    const again = await h.call("POST", "/auth/verify", { body: { token } });
    expect(again.status).toBe(400);
    expect(errCode(again.body)).toBe("LINK_EXPIRED");
  });

  it("refuses an expired link", async () => {
    await h.call("POST", "/auth/email-link", { body: { email: devEmail("ordinary2") } });
    const token = /#token=([A-Za-z0-9_-]+)/.exec(h.mailer.last("auth.link")!.text)![1]!;
    h.clock.advance(16 * 60_000);
    expect(errCode((await h.call("POST", "/auth/verify", { body: { token } })).body)).toBe("LINK_EXPIRED");
  });

  it("attendees have no password login", async () => {
    const r = await h.call("POST", "/auth/login", { body: { email: devEmail("vip"), password: h.seed.password } });
    expect(r.status).toBe(401);
  });
});

describe("RBAC", () => {
  let attendee: TokenPair;
  let organiser: TokenPair;
  let gate: TokenPair;
  beforeAll(async () => {
    await h.call("POST", "/auth/email-link", { body: { email: devEmail("vip") } });
    const token = /#token=([A-Za-z0-9_-]+)/.exec(h.mailer.last("auth.link")!.text)![1]!;
    attendee = (await h.call<TokenPair>("POST", "/auth/verify", { body: { token } })).body;
    organiser = await h.login(h.seed.emails.organiser);
    gate = await h.login(h.seed.emails.gate);
  });

  it("an attendee cannot post scans or read alerts", async () => {
    const body = { event_id: h.seed.eventId, device_id: "d", scans: [] };
    expect(errCode((await h.call("POST", "/scans", { token: attendee.access_token, body })).body)).toBe("FORBIDDEN");
    expect(errCode((await h.call("GET", "/breach-alerts", { token: attendee.access_token })).body)).toBe("FORBIDDEN");
  });

  it("an organiser cannot post scans; a scanner cannot revoke credentials", async () => {
    const body = { event_id: h.seed.eventId, device_id: "d", scans: [] };
    expect((await h.call("POST", "/scans", { token: organiser.access_token, body })).status).toBe(403);
    const revoke = await h.call("POST", `/credentials/${h.seed.attendees.ordinary.credentialId}/revoke`, {
      token: gate.access_token,
      body: { reason: "test" },
    });
    expect(revoke.status).toBe(403);
  });

  it("an operator cannot use attendee self-service", async () => {
    expect((await h.call("GET", "/me/credential", { token: organiser.access_token })).status).toBe(403);
  });

  it("unimplemented endpoints enforce RBAC before answering 501", async () => {
    // GET /reports is still unbuilt (slice 8).
    expect((await h.call("GET", "/reports", { token: attendee.access_token })).status).toBe(403);
    const r = await h.call("GET", "/reports", { token: organiser.access_token });
    expect(r.status).toBe(501);
    expect(errCode(r.body)).toBe("NOT_IMPLEMENTED");
  });

  it("a client cannot state its own tier: registration create rejects a tier field", async () => {
    const r = await h.call("POST", "/registrations", {
      token: attendee.access_token,
      body: { event_id: h.seed.eventId, zone_presence_consent: true, tier: "VIP" },
    });
    expect(r.status).toBe(400);
  });
});

describe("MFA step-up and audit", () => {
  it("privileged action requires MFA; TOTP step-up unlocks it; the action is audited in an intact chain", async () => {
    const admin = await h.login(h.seed.emails.admin);
    const credId = h.seed.attendees.privateInvite.credentialId;
    const denied = await h.call("POST", `/credentials/${credId}/resend`, { token: admin.access_token });
    expect(denied.status).toBe(403);
    expect(errCode(denied.body)).toBe("MFA_REQUIRED");

    const wrong = await h.call("POST", "/auth/mfa/verify", { token: admin.access_token, body: { code: "000000" === mfaCode(h) ? "111111" : "000000" } });
    expect(errCode(wrong.body)).toBe("INVALID_MFA_CODE");

    const code = mfaCode(h);
    const stepped = await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: admin.access_token, body: { code } });
    expect(stepped.status).toBe(200);
    expect(stepped.body.principal.mfa).toBe(true);
    // The same code cannot be replayed.
    const replay = await h.call("POST", "/auth/mfa/verify", { token: stepped.body.access_token, body: { code } });
    expect(errCode(replay.body)).toBe("INVALID_MFA_CODE");

    const ok = await h.call("POST", `/credentials/${credId}/resend`, { token: stepped.body.access_token });
    expect(ok.status).toBe(200);
    expect(h.mailer.last("pass.email_qr")!.to).toBe(devEmail("private"));

    const rows = await h.app.ctx.repos.audit.all();
    expect(rows.some((r) => r.action === "credential.resend" && r.target === `credential:${credId}`)).toBe(true);
    expect(await h.app.ctx.repos.audit.verify()).toBe(-1);
    if (REPO_UNDER_TEST === "memory") {
      // Tampering with any entry breaks the chain at that entry.
      const tampered = rows.map((r) => ({ ...r }));
      tampered[0]!.meta_jsonb = { forged: true };
      expect(verifyChain(tampered)).toBe(0);
    }
    // (On PostgreSQL the audit_log triggers reject UPDATE/DELETE outright; covered by @synan/db tests.)

    // Step-up expires after 15 minutes.
    h.clock.advance(16 * 60_000);
    const fresh = await h.call<TokenPair>("POST", "/auth/refresh", { body: { refresh_token: stepped.body.refresh_token } });
    const stale = await h.call("POST", `/credentials/${credId}/resend`, { token: fresh.body.access_token });
    expect(errCode(stale.body)).toBe("MFA_REQUIRED");
  });

  it("a user without an enrolled factor gets MFA_NOT_ENROLLED", async () => {
    const org = await h.login(h.seed.emails.organiser);
    const r = await h.call("POST", "/auth/mfa/verify", { token: org.access_token, body: { code: "123456" } });
    expect(errCode(r.body)).toBe("MFA_NOT_ENROLLED");
  });
});

describe("public endpoints", () => {
  it("serves public signing keys only (no private material)", async () => {
    const r = await h.call<{ keys: Record<string, unknown>[] }>("GET", "/auth/signing-keys");
    expect(r.status).toBe(200);
    expect(r.body.keys.map((k) => k.purpose).sort()).toEqual(["allowlist", "qr"]);
    for (const k of r.body.keys) {
      expect(k).not.toHaveProperty("d");
      expect(JSON.stringify(k)).not.toContain('"d"');
    }
  });

  it("serves server time for clock-offset measurement", async () => {
    const r = await h.call<{ epoch_ms: number; server_time: string }>("GET", "/time");
    expect(r.body.epoch_ms).toBe(h.clock.now());
    expect(Date.parse(r.body.server_time)).toBe(h.clock.now());
  });

  it("unknown routes are a contract-shaped 404", async () => {
    const r = await h.call("GET", "/nope");
    expect(r.status).toBe(404);
    expect(errCode(r.body)).toBe("NOT_FOUND");
  });
});

describe("rate limiting", () => {
  it("limits login per IP and sets Retry-After", async () => {
    const tight = await startHarness({ config: { rateLimits: { authPerMin: 3, scanPerMin: 2, resendPerHour: 5 } } });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        statuses.push((await tight.call("POST", "/auth/login", { body: { email: devEmail(`x${i}`), password: "x" } })).status);
      }
      expect(statuses).toEqual([401, 401, 401, 429]);
      const last = await tight.call("POST", "/auth/login", { body: { email: devEmail("y"), password: "x" } });
      expect(errCode(last.body)).toBe("RATE_LIMITED");
      expect(Number(last.headers.get("retry-after"))).toBeGreaterThan(0);
      tight.clock.advance(61_000);
      expect((await tight.call("POST", "/auth/login", { body: { email: devEmail("z"), password: "x" } })).status).toBe(401);
    } finally {
      await tight.close();
    }
  });

  it("limits login per account across IPs (5 per 15 min)", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await h.call("POST", "/auth/login", { body: { email: devEmail("speaker"), password: "wrong" } })).status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it("limits scan ingest per token", async () => {
    const tight = await startHarness({ config: { rateLimits: { authPerMin: 100, scanPerMin: 2, resendPerHour: 5 } } });
    try {
      const gate = await tight.login(tight.seed.emails.gate);
      const body = { event_id: tight.seed.eventId, device_id: "d1", scans: [] };
      const statuses: number[] = [];
      for (let i = 0; i < 3; i++) statuses.push((await tight.call("POST", "/scans", { token: gate.access_token, body })).status);
      // Empty batches are invalid (400) but still count towards the limit.
      expect(statuses).toEqual([400, 400, 429]);
    } finally {
      await tight.close();
    }
  });
});
