/**
 * The job runner on a real PostgreSQL server (roadmap fault 12, step 5.1). Runs only in the realpg mode
 * (vitest.config.ts includes test/realpg/ there and nowhere else).
 *
 * The API is wired exactly as in production on PostgreSQL: PgBossJobs (pg-boss as the app_api login)
 * works every registered queue, and the maintenance instance (startJobMaintenance, the app_jobs login)
 * supervises and writes the cron schedules. Every queue the API registers is sent one job through
 * pg-boss and must finish `completed`; where a job has an effect it is checked, with the app's manual
 * clock moved past the deadline the job looks for (the purge drops a real scan partition).
 */
import { randomUUID } from "node:crypto";
import { createJobs, JOB_QUEUES, JOB_SCHEDULES } from "@synan/db";
import type { TokenPair } from "@synan/contracts/rest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, type RunningApp } from "../../src/app.js";
import { ManualClock } from "../../src/lib/clock.js";
import { MemoryMailer } from "../../src/lib/mailer.js";
import { PgBossJobs, startJobMaintenance, type JobMaintenance } from "../../src/lib/pgboss-jobs.js";
import { totp } from "../../src/lib/crypto.js";
import { backend, band, devEmail, REPO_UNDER_TEST, type Backend } from "../helpers.js";

const H = 3600_000;
const fast = { pollingIntervalSeconds: 0.5, cronMonitorIntervalSeconds: 1, cronWorkerIntervalSeconds: 1 };

describe.runIf(REPO_UNDER_TEST === "postgres")("pg-boss on PostgreSQL: every API job runs through the queue", () => {
  let be: Backend;
  let app: RunningApp;
  let base: string;
  let jobs: PgBossJobs;
  let maintenance: JobMaintenance;
  let probe: ReturnType<typeof createJobs>;
  const clock = new ManualClock(Date.now());
  const mailer = new MemoryMailer();
  const errors: string[] = [];
  const admin = <T = Record<string, unknown>>(text: string) => be.database!.execAsAdmin<T>(text);

  const call = async <T = unknown>(method: string, path: string, o: { token?: string; body?: unknown } = {}) => {
    const r = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { ...(o.body !== undefined ? { "content-type": "application/json" } : {}), ...(o.token ? { authorization: `Bearer ${o.token}` } : {}) },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
    const text = await r.text();
    return { status: r.status, body: (text ? JSON.parse(text) : undefined) as T };
  };
  const until = async <T>(what: string, f: () => Promise<T | null | undefined | false>, ms = 30_000): Promise<T> => {
    for (const end = Date.now() + ms; ; ) {
      const v = await f();
      if (v) return v;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}; pg-boss errors: ${errors.join(" / ") || "none"}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  /** One job through pg-boss (no payload: the handler drains what is due); resolves when completed. */
  const viaBoss = async (queue: string) => {
    const id = (await probe.send(queue, {}))!;
    const job = await until(`${queue} job ${id}`, async () => {
      const j = await probe.getJobById(queue, id);
      return j && ["completed", "failed", "cancelled"].includes(j.state) ? j : null;
    });
    expect({ queue, state: job.state, output: job.state === "completed" ? null : job.output }).toEqual({ queue, state: "completed", output: null });
  };
  const login = async (email: string, password: string) => (await call<TokenPair>("POST", "/auth/login", { body: { email, password } })).body;

  beforeAll(async () => {
    be = await backend();
    jobs = new PgBossJobs(createJobs({ connectionString: be.config.databaseUrl!, options: fast }));
    app = await createApp({
      clock, mailer, seed: true, jobs,
      config: { ...be.config, rateLimits: { authPerMin: 10_000, scanPerMin: 100_000, resendPerHour: 10_000 } },
    });
    base = await app.listen(0, "127.0.0.1");
    await jobs.ready;
    maintenance = await startJobMaintenance(be.database!.urls.jobs, fast);
    maintenance.boss.on("error", (e: unknown) => errors.push(String((e as Error).message)));
    probe = createJobs({ connectionString: be.database!.urls.api });
    probe.on("error", (e: unknown) => errors.push(String((e as Error).message)));
    await probe.start();
  }, 180_000);

  afterAll(async () => {
    await probe?.stop({ graceful: false, wait: true } as never);
    await maintenance?.stop();
    await app?.close();
    await be?.release();
  });

  it("startJobMaintenance (the worker's app_jobs login) writes a schedule for every queue the API registers", async () => {
    const schedules = await maintenance.boss.getSchedules();
    expect(schedules.map((s) => `${s.name} ${s.cron}`).sort()).toEqual(JOB_SCHEDULES.map((s) => `${s.queue} ${s.cron}`).sort());
    // Every queue is scheduled, so none depends on a kick alone (report.export and email.send were not).
    const registered = Object.values(JOB_QUEUES);
    expect(new Set(JOB_SCHEDULES.map((s) => s.queue))).toEqual(new Set(registered));
  });

  it("email.send: an outbox job written in the request's transaction is delivered by the worker", async () => {
    const vip = devEmail("vip");
    expect((await call("POST", "/auth/email-link", { body: { email: vip } })).status).toBe(202);
    const msg = await until("the sign-in email", async () => mailer.last("auth.link"));
    expect(msg.to).toBe(vip);
    await viaBoss(JOB_QUEUES.email); // the sweep: nothing left due
  });

  it("invitations.expire, occupancy.session_reset and rollups.rebuild act on the app clock", async () => {
    const seed = app.seed!;
    const organiser = (await login(seed.emails.organiser, seed.password)).access_token;
    await call("POST", "/invitations", { token: organiser, body: { event_id: seed.privateEventId, emails: [devEmail("late.guest")], expires_at: new Date(clock.now() + 60_000).toISOString() } });
    clock.advance(120_000);
    await viaBoss(JOB_QUEUES.invitationExpiry);
    expect((await app.ctx.repos.invitations.forEvent(seed.privateEventId)).some((i) => i.state === "expired")).toBe(true);

    const gate = (await login(seed.gateEmailByCheckpoint[seed.checkpoints.auditorium]!, seed.password)).access_token;
    const s = { idem_key: `k${randomUUID()}`, checkpoint_id: seed.checkpoints.auditorium, presented: band(seed.attendees.vip.uid), occurred_at: new Date(clock.now()).toISOString(), clock_offset_ms: 0, offline: false, direction: "in" };
    expect((await call("POST", "/scans", { token: gate, body: { event_id: seed.eventId, device_id: "scanner-1", scans: [s] } })).status).toBe(200);
    const count = async () => (await app.ctx.scans.projection(seed.eventId)).roomView(seed.rooms.auditorium).occupancy;
    expect(await count()).toBe(1);
    clock.advance(1 * H); // past the keynote's end
    await viaBoss(JOB_QUEUES.sessionReset);
    expect(await count()).toBe(0);
    await viaBoss(JOB_QUEUES.rollupRebuild);
    const peaks = await app.ctx.repos.reports.run("peak_occupancy", seed.eventId, { limit: 50 });
    expect(peaks.rows.find((r) => r[0] === seed.rooms.auditorium)![4]).toBe(1);
  });

  it("report.export (kicked by the request), report.scheduled and data_request.process", async () => {
    const seed = app.seed!;
    const adminTok = (await login(seed.emails.admin, seed.password)).access_token;
    const mfa = (await call<TokenPair>("POST", "/auth/mfa/verify", { token: adminTok, body: { code: totp(seed.adminMfaSecret, clock.now()) } })).body.access_token;
    const r = await call<{ id: string }>("POST", `/reports/${seed.eventId}/export`, { token: mfa, body: { kind: "attendance", format: "csv" } });
    expect(r.status).toBe(202);
    await until("the export built by the worker", async () => {
      const list = await call<{ items: { id: string; state: string }[] }>("GET", "/reports", { token: mfa });
      return list.body.items.find((x) => x.id === r.body.id && x.state === "ready");
    });
    await viaBoss(JOB_QUEUES.reportExport);
    await viaBoss(JOB_QUEUES.scheduledReport);

    const links = () => mailer.outbox.filter((m) => m.tag === "auth.link" && m.to === seed.attendees.vip.email);
    const before = links().length;
    await call("POST", "/auth/email-link", { body: { email: seed.attendees.vip.email } });
    const link = await until("a new sign-in link", async () => links().length > before && links().at(-1));
    const token = /#token=([A-Za-z0-9_-]+)/.exec(link.text)![1]!;
    const me = (await call<TokenPair>("POST", "/auth/verify", { body: { token } })).body.access_token;
    const dr = await call<{ request_id: string }>("POST", "/me/data-export", { token: me });
    expect(dr.status).toBe(202);
    await viaBoss(JOB_QUEUES.dataRequest);
    const mine = await call<{ items: { id: string; state: string }[] }>("GET", "/me/data-requests", { token: me });
    expect(mine.body.items.find((x) => x.id === dr.body.request_id)?.state).toBe("completed");
  });

  it("auth.cleanup, webhook.deliver and delivery.cleanup run to completion", async () => {
    await viaBoss(JOB_QUEUES.authCleanup);
    await viaBoss(JOB_QUEUES.webhookDelivery);
    clock.advance(8 * 24 * H); // past the 7-day export retention
    await viaBoss(JOB_QUEUES.deliveryCleanup);
    const files = await admin<{ n: number }>(`select count(*)::int n from exported_files where deleted_at is null`);
    expect(files[0]!.n).toBe(0); // the export and the data-request file are past retention and deleted
  });

  it("audit.prune removes entries over 12 months old, keeps the chain verifying, and is audited", async () => {
    await admin(`
      set session_replication_role = replica;
      update audit_log set at = now() - interval '13 months' where id in (select id from audit_log order by id limit 3);
      do $$
      declare r record; prev text := coalesce((select pruned_anchor_hash from audit_chain_head), repeat('0', 64));
      begin
        for r in select * from audit_log order by id loop
          update audit_log set prev_hash = prev,
            hash = audit_entry_hash(prev, r.id, r.actor_id, r.action, r.target, r.meta_jsonb, r.at) where id = r.id
          returning hash into prev;
        end loop;
        update audit_chain_head set last_hash = prev;
      end $$;
      set session_replication_role = origin;
    `);
    await viaBoss(JOB_QUEUES.auditPrune);
    expect((await app.ctx.repos.audit.all()).map((a) => a.action)).toContain("retention.audit_pruned");
    expect(await app.ctx.repos.audit.verify()).toBe(-1);
  });

  it("event.purge after the grace period drops the event's real scan partition", async () => {
    const seed = app.seed!;
    const part = async () =>
      (await admin<{ p: string | null }>(`select to_regclass('public.' || public.scan_partition_name('${seed.eventId}'))::text p`))[0]!.p;
    expect(await part()).not.toBeNull();
    const organiser = (await login(seed.emails.organiser, seed.password)).access_token;
    expect((await call("POST", `/events/${seed.eventId}/state`, { token: organiser, body: { state: "closed" } })).status).toBe(200);
    await viaBoss(JOB_QUEUES.purge);
    expect(await part()).not.toBeNull(); // inside the grace period
    clock.advance(73 * H); // grace 72 h
    await viaBoss(JOB_QUEUES.purge);
    expect(await app.ctx.repos.reports.purgedAt(seed.eventId)).not.toBeNull();
    expect(await part()).toBeNull();
    expect((await app.ctx.repos.audit.all()).map((a) => a.action)).toContain("event.purge");
    expect(errors).toEqual([]);
  });
});
