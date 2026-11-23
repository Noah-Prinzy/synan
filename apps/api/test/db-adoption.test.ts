/**
 * Adoption of @synan/db (encryption, sign-in state in the database, formats). Always runs on the SQL
 * backend (PGlite) and inspects stored rows directly.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { ENVELOPE_RE, schema } from "@synan/db";
import type { PortalCodeBatch, TokenPair, WsTicket } from "@synan/contracts/rest";
import { createApp, createAppCipher } from "../src/app.js";
import { ManualClock } from "../src/lib/clock.js";
import { MemoryMailer } from "../src/lib/mailer.js";
import { createPgliteRepos, type DrizzleRepos } from "../src/repo/drizzle.js";
import { runSecretMaintenance } from "../src/tasks/secrets.js";
import { addAttendee, band, devEmail, errCode, mfaCode, postScans, scan, startHarness, type Harness } from "./helpers.js";

const B64URL43 = /^[A-Za-z0-9_-]{43}$/;
const HEX64 = /^[0-9a-f]{64}$/;

async function q<T = Record<string, unknown>>(repos: DrizzleRepos, text: string): Promise<T[]> {
  return ((await repos.conn.db.execute(sql.raw(text))) as unknown as { rows: T[] }).rows;
}
async function attendeeTokens(h: Harness, email: string): Promise<TokenPair> {
  await h.call("POST", "/auth/email-link", { body: { email } });
  const token = /#token=([A-Za-z0-9_-]+)/.exec(h.mailer.last("auth.link")!.text)![1]!;
  const r = await h.call<TokenPair>("POST", "/auth/verify", { body: { token } });
  if (r.status !== 200) throw new Error(`verify failed ${r.status}`);
  return r.body;
}
async function steppedAdmin(h: Harness): Promise<TokenPair> {
  const admin = await h.login(h.seed.emails.admin);
  return (await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: admin.access_token, body: { code: mfaCode(h) } })).body;
}

describe("Step B: no secret is stored in the clear after normal API use", () => {
  let h: Harness;
  let repos: DrizzleRepos;
  const plaintexts: string[] = [];
  beforeAll(async () => {
    h = await startHarness({ config: { repo: "pglite" } });
    repos = h.app.ctx.repos as DrizzleRepos;
    expect(repos.kind).toBe("drizzle");
    // Normal use: attendee sign-in, operator sign-in with MFA, emailed QR resend, portal codes.
    const att = await attendeeTokens(h, devEmail("vip"));
    await h.call<PortalCodeBatch>("GET", "/me/credential/codes", { token: att.access_token });
    const admin = await steppedAdmin(h);
    await h.call("POST", `/credentials/${h.seed.attendees.ordinary.credentialId}/resend`, { token: admin.access_token });
    plaintexts.push(
      devEmail("vip"), devEmail("ordinary"), devEmail("private"), devEmail("ordinary2"),
      "Vera Ip", "Orla Dinary", "Priya Vate", "Owen Dinary", h.seed.adminMfaSecret,
    );
  });
  afterAll(async () => h.close());

  it("attendee email, name and profile are AES-GCM envelopes; the email index is a 64-hex HMAC", async () => {
    const rows = await q<{ email: string | null; full_name: string | null; profile_jsonb: Record<string, unknown>; email_hash: string | null }>(
      repos, "select email, full_name, profile_jsonb, email_hash from pii_vault.attendees",
    );
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const r of rows) {
      if (r.email !== null) expect(r.email).toMatch(ENVELOPE_RE);
      if (r.full_name !== null) expect(r.full_name).toMatch(ENVELOPE_RE);
      expect(Object.keys(r.profile_jsonb).every((k) => k === "$enc")).toBe(true);
      if (r.email_hash !== null) expect(r.email_hash).toMatch(HEX64);
    }
    const dump = JSON.stringify(rows);
    for (const p of plaintexts) expect(dump).not.toContain(p);
  });

  it("the MFA secret and the signing private keys are envelopes", async () => {
    const users = await q<{ mfa_secret_enc: string | null }>(repos, "select mfa_secret_enc from users where mfa_secret_enc is not null");
    expect(users.length).toBeGreaterThanOrEqual(1);
    for (const u of users) {
      expect(u.mfa_secret_enc).toMatch(ENVELOPE_RE);
      expect(u.mfa_secret_enc).not.toContain(h.seed.adminMfaSecret);
    }
    const keys = await q<{ private_key_enc: string; qr_kid: string | null; purpose: string }>(repos, "select private_key_enc, qr_kid, purpose from signing_keys");
    expect(keys.length).toBe(2);
    for (const k of keys) {
      expect(k.private_key_enc).toMatch(ENVELOPE_RE);
      expect(k.private_key_enc).not.toContain('"d"');
      expect(k.qr_kid).toMatch(/^[0-9a-f]{8}$/); // Step A: stored, unique
    }
  });

  it("sign-in state holds only hashes in the settled format, never a token", async () => {
    const sessions = await q<{ token_hash: string }>(repos, "select token_hash from auth_sessions");
    const links = await q<{ token_hash: string }>(repos, "select token_hash from auth_links");
    expect(sessions.length).toBeGreaterThan(0);
    expect(links.length).toBeGreaterThan(0);
    for (const r of [...sessions, ...links]) expect(r.token_hash).toMatch(B64URL43);
    // Step A: carrier identifiers (NFC and emailed QR) are base64url SHA-256; credential refs are 22.
    const carriers = await q<{ kind: string; identifier: string | null }>(repos, "select kind, identifier from carriers");
    for (const c of carriers) {
      if (c.kind === "qr_portal") expect(c.identifier).toBeNull();
      else expect(c.identifier).toMatch(B64URL43);
    }
    const creds = await q<{ token_hash: string }>(repos, "select token_hash from credentials");
    for (const c of creds) expect(c.token_hash).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("operator and staff addresses are envelopes with a 64-hex blind index; none is stored in the clear", async () => {
    const rows = await q<{ email: string; email_hash: string | null }>(repos, "select email, email_hash from users");
    expect(rows.length).toBeGreaterThanOrEqual(12);
    for (const r of rows) {
      expect(r.email).toMatch(ENVELOPE_RE);
      expect(r.email_hash).toMatch(HEX64);
    }
    const dump = JSON.stringify(rows);
    for (const e of [...Object.values(h.seed.emails), ...Object.values(h.seed.gates).map((g) => g.email)]) expect(dump).not.toContain(e);
  });

  it("operator sign-in still works, case-insensitively, through the blind index", async () => {
    const r = await h.call<TokenPair>("POST", "/auth/login", { body: { email: h.seed.emails.organiser.toUpperCase(), password: h.seed.password } });
    expect(r.status).toBe(200);
    expect(r.body.principal.email).toBe(h.seed.emails.organiser); // decrypted for the response
  });

  it("the maintenance task finds nothing left to encrypt or re-index", async () => {
    const report = await runSecretMaintenance(repos);
    expect(Object.values(report.reencrypted).every((t) => t.updated === 0 && t.raced === 0)).toBe(true);
    expect(report.reencrypted["users.email"]).toBeDefined(); // includeUserEmail is on
    expect(report.reindexed.updated).toBe(0);
    expect(report.reindexed.usersUpdated).toBe(0);
  });
});

describe("operator email, enforced by the database (@synan/db 0009–0010)", () => {
  let h: Harness;
  let repos: DrizzleRepos;
  const operator = { id: "6f1c2c3e-0000-4000-8000-00000000beef", email: devEmail("new.operator") };
  beforeAll(async () => {
    h = await startHarness({ config: { repo: "pglite" } });
    repos = h.app.ctx.repos as DrizzleRepos;
  });
  afterAll(async () => h.close());

  const login = (email: string) => h.call<TokenPair>("POST", "/auth/login", { body: { email, password: h.seed.password } });
  /** Concatenates every message and constraint name in a driver error's cause chain. */
  const failure = async (p: Promise<unknown>) => {
    let msg = "";
    try {
      await p;
    } catch (e) {
      for (let x: unknown = e; x; x = (x as { cause?: unknown }).cause) msg += ` ${(x as Error).message ?? ""} ${(x as { constraint?: string }).constraint ?? ""}`;
    }
    return msg;
  };

  it("an operator created through the repository is stored encrypted with a 64-hex hash, and signs in in any letter case", async () => {
    const { hashPassword } = await import("../src/lib/crypto.js");
    await h.app.ctx.repos.users.insert({
      id: operator.id, email: operator.email, password_hash: await hashPassword(h.seed.password, 12), role: "organiser", mfa_enrolled_at: null, mfa_secret: null,
    });
    const [row] = await q<{ email: string; email_hash: string }>(repos, `select email, email_hash from users where id = '${operator.id}'`);
    expect(row!.email).toMatch(ENVELOPE_RE);
    expect(row!.email_hash).toMatch(HEX64);
    expect(row!.email).not.toContain(operator.email);
    for (const variant of [operator.email, operator.email.toUpperCase(), devEmail("NEW.Operator")]) {
      const r = await login(variant);
      expect(r.status).toBe(200);
      expect(r.body.principal.email).toBe(operator.email);
    }
  });

  it("a case-variant duplicate operator address is refused (users_email_hash_uq)", async () => {
    const { hashPassword } = await import("../src/lib/crypto.js");
    const msg = await failure(h.app.ctx.repos.users.insert({
      id: "6f1c2c3e-0000-4000-8000-00000000cafe", email: devEmail("NEW.OPERATOR"),
      password_hash: await hashPassword("x", 12), role: "organiser", mfa_enrolled_at: null, mfa_secret: null,
    }));
    expect(msg).toContain("users_email_hash_uq");
  });

  it("a plaintext address is refused by users_email_encrypted; a missing hash by NOT NULL", async () => {
    const plain = await failure(q(repos,
      `insert into users (id, email, email_hash, password_hash, role)
       values ('6f1c2c3e-0000-4000-8000-00000000f00d', 'plain@example.com', '${"a".repeat(64)}', 'x', 'organiser')`));
    expect(plain).toContain("users_email_encrypted");
    const update = await failure(q(repos, `update users set email = 'plain@example.com' where id = '${operator.id}'`));
    expect(update).toContain("users_email_encrypted");
    const noHash = await failure(q(repos, `update users set email_hash = null where id = '${operator.id}'`));
    expect(noHash).toMatch(/email_hash/);
    expect(noHash).toMatch(/not-null|null value/i);
  });

  it("every write the API makes for an operator still succeeds: refresh, MFA secret, step-up, resend, scans, ticket", async () => {
    const op = await login(operator.email);
    expect((await h.call("POST", "/auth/refresh", { body: { refresh_token: op.body.refresh_token } })).status).toBe(200);
    await h.app.ctx.repos.users.setMfa(operator.id, "JBSWY3DPEHPK3PXP", new Date(h.clock.now()));
    const admin = await steppedAdmin(h);
    expect(admin.principal.mfa).toBe(true);
    expect((await h.call("POST", `/credentials/${h.seed.attendees.ordinary.credentialId}/resend`, { token: admin.access_token })).status).toBe(200);
    const a = await addAttendee(h, "ORDINARY");
    expect((await postScans(h, [scan(h, h.seed.checkpoints.mainIn, band(a.uid))])).status).toBe(200);
    const t = (await h.call<WsTicket>("POST", "/auth/ws-ticket", { token: op.body.access_token, body: { channel: "/stream/telemetry", event_id: h.seed.eventId } })).body.ticket;
    expect(await h.app.ctx.auth.consumeWsTicket(t)).toMatchObject({ ctx: { role: "organiser" } });
  });

  it("the maintenance task is a no-op on an enforced database", async () => {
    const report = await runSecretMaintenance(repos);
    expect(report.reencrypted["users.email"]).toEqual({ updated: 0, raced: 0 });
    expect(report.reindexed.usersUpdated).toBe(0);
  });
});

describe("Step C: sign-in state lives in the database", () => {
  let h: Harness;
  let repos: DrizzleRepos;
  beforeAll(async () => {
    h = await startHarness({ config: { repo: "pglite" } });
    repos = h.app.ctx.repos as DrizzleRepos;
  });
  afterAll(async () => h.close());

  it("refresh-token reuse revokes the whole family (reason reuse_detected)", async () => {
    const t1 = await h.login(h.seed.emails.organiser);
    const t2 = (await h.call<TokenPair>("POST", "/auth/refresh", { body: { refresh_token: t1.refresh_token } })).body;
    expect(t2.refresh_token).toBeTruthy();
    expect(errCode((await h.call("POST", "/auth/refresh", { body: { refresh_token: t1.refresh_token } })).body)).toBe("UNAUTHENTICATED");
    expect((await h.call("POST", "/auth/refresh", { body: { refresh_token: t2.refresh_token } })).status).toBe(401);
    const rows = await q<{ family_id: string; revoke_reason: string | null }>(repos,
      `select family_id, revoke_reason from auth_sessions where user_id = '${h.seed.users.organiser}'`); // users.email is ciphertext now
    const families = new Map<string, (string | null)[]>();
    for (const r of rows) families.set(r.family_id, [...(families.get(r.family_id) ?? []), r.revoke_reason]);
    expect([...families.values()].some((reasons) => reasons.length === 2 && reasons.every((x) => x === "reuse_detected"))).toBe(true);
  });

  it("a refreshed token's lifetime is chosen by its holder inside the exchange (operator 12 h, attendee 30 days)", async () => {
    const op = await h.login(h.seed.emails.organiser);
    const opNext = (await h.call<TokenPair>("POST", "/auth/refresh", { body: { refresh_token: op.refresh_token } })).body;
    expect(Date.parse(opNext.refresh_expires_at) - h.clock.now()).toBe(h.app.ctx.config.operatorRefreshTtlS * 1000);
    const att = await attendeeTokens(h, devEmail("vip"));
    const attNext = (await h.call<TokenPair>("POST", "/auth/refresh", { body: { refresh_token: att.refresh_token } })).body;
    expect(Date.parse(attNext.refresh_expires_at) - h.clock.now()).toBe(h.app.ctx.config.attendeeRefreshTtlS * 1000);
    const stored = await q<{ expires_at: Date | string }>(repos,
      `select expires_at from auth_sessions where token_hash = '${(await import("../src/lib/crypto.js")).sha256b64url(opNext.refresh_token)}'`);
    expect(new Date(stored[0]!.expires_at).getTime()).toBe(Date.parse(opNext.refresh_expires_at));
  });

  it("an email link works once", async () => {
    await h.call("POST", "/auth/email-link", { body: { email: devEmail("ordinary2") } });
    const token = /#token=([A-Za-z0-9_-]+)/.exec(h.mailer.last("auth.link")!.text)![1]!;
    expect((await h.call("POST", "/auth/verify", { body: { token } })).status).toBe(200);
    expect(errCode((await h.call("POST", "/auth/verify", { body: { token } })).body)).toBe("LINK_EXPIRED");
    expect(errCode((await h.call("POST", "/auth/verify", { body: { token: "x".repeat(43) } })).body)).toBe("LINK_INVALID");
  });

  it("a WebSocket ticket works once, and not after logout", async () => {
    const op = await h.login(h.seed.emails.organiser);
    const mint = async (token: string) =>
      (await h.call<WsTicket>("POST", "/auth/ws-ticket", { token, body: { channel: "/stream/telemetry", event_id: h.seed.eventId } })).body.ticket;
    const t = await mint(op.access_token);
    const first = await h.app.ctx.auth.consumeWsTicket(t);
    expect(first).toMatchObject({ channel: "/stream/telemetry", ctx: { role: "organiser", kind: "operator" } });
    expect(await h.app.ctx.auth.consumeWsTicket(t)).toBeNull();
    const t2 = await mint(op.access_token);
    expect((await h.call("POST", "/auth/logout", { token: op.access_token })).status).toBe(200);
    expect(await h.app.ctx.auth.consumeWsTicket(t2)).toBeNull(); // its session family is revoked
    expect((await h.call("POST", "/auth/refresh", { body: { refresh_token: op.refresh_token } })).status).toBe(401);
  });

  it("MFA step-up revokes the old family with reason mfa_step_up", async () => {
    const admin = await h.login(h.seed.emails.admin);
    const stepped = await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: admin.access_token, body: { code: mfaCode(h) } });
    expect(stepped.status).toBe(200);
    expect((await h.call("POST", "/auth/refresh", { body: { refresh_token: admin.refresh_token } })).status).toBe(401);
    const reasons = await q<{ revoke_reason: string }>(repos, "select revoke_reason from auth_sessions where revoke_reason = 'mfa_step_up'");
    expect(reasons.length).toBeGreaterThan(0);
  });
});

describe("Step C: sessions, links, tickets and keys survive a restart (a second app over the same database)", () => {
  it("refresh, link redemption, ticket consumption and QR verification all work on the new instance", async () => {
    const clock = new ManualClock(Date.now());
    const mailer = new MemoryMailer();
    const repos = await createPgliteRepos({ cipher: await createAppCipher({}) });
    const cfg = { repo: "pglite" as const, rateLimits: { authPerMin: 10_000, scanPerMin: 100_000, resendPerHour: 10_000 } };
    const app1 = await createApp({ clock, mailer, repos, seed: true, config: cfg });
    const seed = app1.seed!;
    try {
      const base1 = await app1.listen(0, "127.0.0.1");
      const call = async <T>(base: string, method: string, path: string, body?: unknown, token?: string) => {
        const r = await fetch(`${base}/api/v1${path}`, {
          method,
          headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
        const text = await r.text();
        return { status: r.status, body: (text ? JSON.parse(text) : undefined) as T };
      };
      const op = (await call<TokenPair>(base1, "POST", "/auth/login", { email: seed.emails.organiser, password: seed.password })).body;
      await call(base1, "POST", "/auth/email-link", { email: devEmail("vip") });
      const linkToken = /#token=([A-Za-z0-9_-]+)/.exec(mailer.last("auth.link")!.text)![1]!;
      const ticket = (await call<WsTicket>(base1, "POST", "/auth/ws-ticket", { channel: "/stream/telemetry", event_id: seed.eventId }, op.access_token)).body.ticket;
      await app1.close(); // the repository (database) stays open: it belongs to the caller

      const app2 = await createApp({ clock, mailer, repos, seed: false, config: cfg });
      try {
        const base2 = await app2.listen(0, "127.0.0.1");
        const refreshed = await call<TokenPair>(base2, "POST", "/auth/refresh", { refresh_token: op.refresh_token });
        expect(refreshed.status).toBe(200);
        const att = await call<TokenPair>(base2, "POST", "/auth/verify", { token: linkToken });
        expect(att.status).toBe(200);
        expect(await app2.ctx.auth.consumeWsTicket(ticket)).toMatchObject({ channel: "/stream/telemetry" });
        // The QR signing key (encrypted at rest) was decrypted and reused, not regenerated.
        const codes = (await call<PortalCodeBatch>(base2, "GET", "/me/credential/codes", undefined, att.body.access_token)).body;
        expect((await app2.ctx.qr.verify(codes.codes[0]!.code, clock.now())).ok).toBe(true);
        const keys = await q(repos, "select id from signing_keys");
        expect(keys.length).toBe(2);
      } finally {
        await app2.close();
      }
    } finally {
      await repos.close?.();
    }
  });
});

describe("@synan/db enforcement: every write still succeeds with both enforcement functions on", () => {
  let h: Harness;
  let repos: DrizzleRepos;
  beforeAll(async () => {
    h = await startHarness({ config: { repo: "pglite" } });
    repos = h.app.ctx.repos as DrizzleRepos;
    // Flows before enforcement, so VALIDATE runs over real rows.
    await attendeeTokens(h, devEmail("vip"));
    const admin = await steppedAdmin(h);
    await h.call("POST", `/credentials/${h.seed.attendees.ordinary.credentialId}/resend`, { token: admin.access_token });
    await postScans(h, [scan(h, h.seed.checkpoints.mainIn, band(h.seed.attendees.vip.uid))]);
  });
  afterAll(async () => h.close());

  it("enforce_encrypted_secrets() and enforce_hash_formats() validate against the existing rows", async () => {
    await q(repos, "select public.enforce_encrypted_secrets()");
    await q(repos, "select public.enforce_hash_formats()");
    const names = (await q<{ conname: string }>(repos, "select conname from pg_constraint where conname like '%_encrypted' or conname like '%_format'")).map((r) => r.conname);
    expect(names).toEqual(expect.arrayContaining([
      "attendees_email_encrypted", "users_mfa_secret_encrypted", "signing_keys_private_key_encrypted",
      "credentials_token_hash_format", "carriers_identifier_format", "auth_sessions_token_hash_format", "ws_tickets_ticket_hash_format",
    ]));
  });

  it("then: new attendee, credential, band, sign-ins, refresh, MFA, resend, link, ticket, scans and audit all write", async () => {
    const a = await addAttendee(h, "ORDINARY"); // createAttendee + credential + NFC carrier
    expect((await postScans(h, [scan(h, h.seed.checkpoints.mainIn, band(a.uid))])).status).toBe(200);
    const att = await attendeeTokens(h, devEmail("ordinary"));
    expect((await h.call("POST", "/auth/refresh", { body: { refresh_token: att.refresh_token } })).status).toBe(200);
    h.clock.advance(60_000);
    const admin = await steppedAdmin(h);
    expect((await h.call("POST", `/credentials/${a.credentialId}/resend`, { token: admin.access_token })).status).toBe(200);
    const t = (await h.call<WsTicket>("POST", "/auth/ws-ticket", { token: admin.access_token, body: { channel: "/stream/telemetry", event_id: h.seed.eventId } })).body.ticket;
    expect(await h.app.ctx.auth.consumeWsTicket(t)).not.toBeNull();
    const op = await h.login(h.seed.emails.organiser);
    expect((await h.call("POST", `/credentials/${a.credentialId}/revoke`, { token: op.access_token, body: { reason: "test" } })).status).toBe(200);
    await h.app.ctx.repos.users.setMfa(h.seed.users.organiser, "JBSWY3DPEHPK3PXP", new Date(h.clock.now()));
  });

  it("and a plaintext secret or a malformed hash is now refused by the database (by the enforcement constraint)", async () => {
    const failsWith = async (p: Promise<unknown>, constraint: string) => {
      let msg = "";
      try {
        await p;
      } catch (e) {
        for (let x: unknown = e; x; x = (x as { cause?: unknown }).cause) msg += ` ${(x as Error).message ?? ""} ${(x as { constraint?: string }).constraint ?? ""}`;
      }
      expect(msg).toContain(constraint);
    };
    await failsWith(
      repos.conn.db.update(schema.users).set({ mfa_secret_enc: "JBSWY3DPEHPK3PXP" }).where(sql`${schema.users.id} = ${h.seed.users.admin}`),
      "users_mfa_secret_encrypted",
    );
    await failsWith(
      q(repos, `update credentials set token_hash = 'too-short' where id = '${h.seed.attendees.vip.credentialId}'`),
      "credentials_token_hash_format",
    );
  });
});
