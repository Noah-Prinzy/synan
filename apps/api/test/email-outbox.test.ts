/** Email through the outbox and the job queue: same unit of work as the state change, id-only payloads, retries, dead letters. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Mailer, MailMessage } from "../src/lib/mailer.js";
import { EMAIL_MAX_ATTEMPTS } from "../src/domain/mail.js";
import { devEmail, startHarness, type Harness } from "./helpers.js";

/** Records every job enqueued, then passes it on. */
function spyOnEnqueue(h: Harness) {
  const seen: { name: string; data: Record<string, unknown> }[] = [];
  const jobs = h.app.ctx.jobs;
  const orig = jobs.enqueue.bind(jobs);
  jobs.enqueue = async (name, data, scope) => {
    seen.push({ name, data });
    return orig(name, data, scope);
  };
  return seen;
}

describe("email outbox", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ autoDrainMail: false });
    await h.app.ctx.jobs.stop(); // no background runs: this file drains by hand
  });
  afterAll(async () => h.close());

  it("the request only enqueues: nothing is sent until the queue drains, and the job payload is the outbox id alone", async () => {
    const seen = spyOnEnqueue(h);
    const before = h.mailer.outbox.length;
    const r = await h.call("POST", "/auth/email-link", { body: { email: devEmail("vip") } });
    expect(r.status).toBe(202);
    await h.app.ctx.mail.settle(); // the off-path work has written the outbox row
    expect(h.mailer.outbox.length).toBe(before);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.name).toBe("email.send");
    expect(Object.keys(seen[0]!.data)).toEqual(["outbox_id"]);
    expect(JSON.stringify(seen)).not.toContain("@");
    await h.drainMail();
    const mail = h.mailer.outbox.slice(before);
    expect(mail.map((m) => m.tag)).toEqual(["auth.link"]);
    expect(JSON.stringify(seen)).not.toContain(/#token=([A-Za-z0-9_-]+)/.exec(mail[0]!.text)![1]!);
    // Draining again sends nothing twice.
    await h.drainMail();
    expect(h.mailer.outbox.length).toBe(before + 1);
    if (h.app.ctx.repos.kind === "drizzle") {
      const { conn } = h.app.ctx.repos as unknown as { conn: { db: { execute(q: unknown): Promise<{ rows: Record<string, unknown>[] }> } } };
      const { sql } = await import("drizzle-orm");
      const rows = (await conn.db.execute(sql`select to_enc, content_enc, state from email_outbox`)).rows;
      expect(rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(rows)).not.toContain("@");
      expect(JSON.stringify(rows)).not.toContain("#token=");
    }
  });

  it("an unknown address enqueues nothing and answers identically", async () => {
    const seen = spyOnEnqueue(h);
    const known = await h.call("POST", "/auth/email-link", { body: { email: devEmail("vip") } });
    const unknown = await h.call("POST", "/auth/email-link", { body: { email: "nobody@example.com" } });
    expect([known.status, known.body]).toEqual([unknown.status, unknown.body]);
    await h.app.ctx.mail.settle();
    expect(seen).toHaveLength(1);
  });

  it("a failed state change sends nothing: the outbox row belongs to the same unit of work", async () => {
    const { repos, mail } = h.app.ctx;
    const before = (await repos.emailOutbox.stats(EMAIL_MAX_ATTEMPTS)).queued;
    await expect(
      repos.transaction(async (s) => {
        await mail.send({ to: "rollback@example.org", tag: "test", subject: "s", text: "t" }, s);
        throw new Error("state change failed");
      }),
    ).rejects.toThrow("state change failed");
    expect((await repos.emailOutbox.stats(EMAIL_MAX_ATTEMPTS)).queued).toBe(before);
    await h.drainMail();
    expect(h.mailer.outbox.some((m) => m.to === "rollback@example.org")).toBe(false);
  });
});

describe("emails stuck in sending (claim lease)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ autoDrainMail: false });
    await h.app.ctx.jobs.stop();
  });
  afterAll(async () => h.close());
  const sentTo = (to: string) => h.mailer.outbox.filter((m) => m.to === to);

  it("a worker that crashed mid-send leaves the email `sending`; once the lease runs out a sweep reclaims and sends it once", async () => {
    const { mail, repos } = h.app.ctx;
    const to = "crash@example.org";
    const id = await mail.send({ to, tag: "test", subject: "s", text: "t" });
    // Simulated crash: a worker claims the email and dies before sending or finishing.
    const claimed = await repos.emailOutbox.claim(id, { maxAttempts: EMAIL_MAX_ATTEMPTS, now: new Date(h.clock.now()) });
    expect(claimed?.attempts).toBe(1);
    expect((await repos.emailOutbox.stats(EMAIL_MAX_ATTEMPTS)).sending).toBe(1);

    // Under a live lease it is in flight: not due, not claimable, not sent twice.
    h.clock.advance(60_000);
    expect(await repos.emailOutbox.due({ maxAttempts: EMAIL_MAX_ATTEMPTS, limit: 10, now: new Date(h.clock.now()) })).not.toContain(id);
    await h.drainMail();
    expect(sentTo(to)).toHaveLength(0);

    // Past the lease (120 s from the claim) it is due again; the lost try counted as an attempt.
    h.clock.advance(61_000);
    expect(await repos.emailOutbox.due({ maxAttempts: EMAIL_MAX_ATTEMPTS, limit: 10, now: new Date(h.clock.now()) })).toContain(id);
    await h.drainMail();
    expect(sentTo(to)).toHaveLength(1);
    expect(sentTo(to)[0]!.idempotencyKey).toBe(id); // the same key on every attempt, for provider-side dedupe
    await h.drainMail();
    expect(sentTo(to)).toHaveLength(1);
    expect((await repos.emailOutbox.stats(EMAIL_MAX_ATTEMPTS)).sending).toBe(0);
  });

  it("a slow worker whose claim was taken over cannot overwrite the new claim's outcome", async () => {
    const { mail, repos } = h.app.ctx;
    const id = await mail.send({ to: "slow@example.org", tag: "test", subject: "s", text: "t" });
    const now = () => new Date(h.clock.now());
    const first = await repos.emailOutbox.claim(id, { maxAttempts: EMAIL_MAX_ATTEMPTS, now: now() });
    h.clock.advance(121_000);
    const second = await repos.emailOutbox.claim(id, { maxAttempts: EMAIL_MAX_ATTEMPTS, now: now() });
    expect([first?.attempts, second?.attempts]).toEqual([1, 2]);
    // The first worker finally reports (here: a failure) — ignored, the row belongs to attempt 2.
    expect(await repos.emailOutbox.finish(id, { ok: false, error: "late", now: now(), attempt: 1 })).toBeNull();
    expect((await repos.emailOutbox.stats(EMAIL_MAX_ATTEMPTS)).sending).toBe(1);
    expect(await repos.emailOutbox.finish(id, { ok: true, error: null, now: now(), attempt: 2 })).toBe("sent");
    expect(await repos.emailOutbox.finish(id, { ok: true, error: null, now: now(), attempt: 1 })).toBeNull();
  });

  it("the mail timeout must stay well inside the claim lease", async () => {
    const { loadConfig } = await import("../src/config.js");
    expect(loadConfig({ MAIL_SEND_TIMEOUT_MS: "60000" }, []).mailSendTimeoutMs).toBe(60_000);
    expect(() => loadConfig({ MAIL_SEND_TIMEOUT_MS: "90000" }, [])).toThrow(/MAIL_SEND_TIMEOUT_MS/);
  });
});

describe("email retries", () => {
  let h: Harness;
  const attempts = new Map<string, number>();
  const flaky: Mailer & { sent: MailMessage[] } = {
    sent: [],
    async send(m) {
      const n = (attempts.get(m.to) ?? 0) + 1;
      attempts.set(m.to, n);
      if (m.to.startsWith("never") || (m.to.startsWith("twice") && n <= 2)) throw new Error(`mailbox ${m.to} unavailable`);
      if (m.to.startsWith("hang")) return new Promise<void>(() => {});
      this.sent.push(m);
    },
  };
  beforeAll(async () => {
    h = await startHarness({ mailer: flaky, autoDrainMail: false, config: { mailSendTimeoutMs: 200 } });
    await h.app.ctx.jobs.stop();
  });
  afterAll(async () => h.close());

  it("a failing send is retried, then succeeds; one that always fails is dead after the attempt limit; a hanging provider times out", async () => {
    const { mail, repos } = h.app.ctx;
    for (const to of ["twice@example.org", "never@example.org", "hang@example.org"]) await mail.send({ to, tag: "test", subject: "s", text: "t" });
    for (let i = 0; i < EMAIL_MAX_ATTEMPTS + 2; i++) await h.drainMail();
    expect(flaky.sent.map((m) => m.to)).toEqual(["twice@example.org"]);
    expect(attempts.get("twice@example.org")).toBe(3);
    expect(attempts.get("never@example.org")).toBe(EMAIL_MAX_ATTEMPTS); // no attempt past the limit
    expect(attempts.get("hang@example.org")).toBe(EMAIL_MAX_ATTEMPTS);
    const stats = await repos.emailOutbox.stats(EMAIL_MAX_ATTEMPTS);
    expect(stats.dead).toBe(2);
    expect(stats.sent).toBeGreaterThanOrEqual(1);
    if (repos.kind === "drizzle") {
      // The stored error never carries the address the provider echoed back.
      const { conn } = repos as unknown as { conn: { db: { execute(q: unknown): Promise<{ rows: Record<string, unknown>[] }> } } };
      const { sql } = await import("drizzle-orm");
      const rows = (await conn.db.execute(sql`select last_error from email_outbox where last_error is not null`)).rows;
      expect(rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(rows)).not.toContain("@");
    }
  });
});
