/** Scheduled reports (01 §10): MFA and audit on create, signed links by email with no data in the message, on_close at close. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ReportSchedule, TokenPair } from "@synan/contracts/rest";
import { JOB } from "../src/jobs.js";
import { MemoryStorage } from "../src/lib/storage.js";
import { errCode, mfaCode, startHarness, type Harness } from "./helpers.js";

let h: Harness;
const storage = new MemoryStorage();
const base = () => `/events/${h.seed.eventId}/report-schedules`;
async function adminMfa() {
  h.clock.advance(31_000); // a fresh TOTP step (codes are single-use)
  const admin = (await h.login(h.seed.emails.admin)).access_token;
  return (await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: admin, body: { code: mfaCode(h) } })).body.access_token;
}
const scheduled = () => h.mailer.outbox.filter((m) => m.tag === "report.scheduled");
const org = async () => (await h.login(h.seed.emails.organiser)).access_token;
const run = async () => {
  await h.app.ctx.jobs.runNow(JOB.scheduledReport);
  await h.drainMail(); // the run queued its emails; send them now
};

beforeAll(async () => {
  h = await startHarness({ storage });
});
afterAll(async () => h.close());

describe("scheduled reports", () => {
  it("create: operators with MFA only, validated, audited without the addresses", async () => {
    const body = { format: "csv", kind: "attendance", recipients: ["Ops@Example.org"], cadence: "daily" };
    expect((await h.call("POST", base(), { token: await h.gateToken(h.seed.checkpoints.mainIn), body })).status).toBe(403);
    expect(errCode((await h.call("POST", base(), { token: await org(), body })).body)).toBe("MFA_REQUIRED");
    const mfa = await adminMfa();
    const bad = async (b: object) => errCode((await h.call("POST", base(), { token: mfa, body: b })).body);
    expect(await bad({ ...body, kind: undefined })).toBe("VALIDATION_FAILED");
    expect(await bad({ ...body, format: "xlsx" })).toBe("VALIDATION_FAILED"); // kind only with csv
    expect(await bad({ ...body, cadence: "on_close", first_run_at: new Date(h.clock.now() + 3600_000).toISOString() })).toBe("VALIDATION_FAILED");
    expect(await bad({ ...body, first_run_at: new Date(h.clock.now() + 400 * 86_400_000).toISOString() })).toBe("VALIDATION_FAILED");
    expect(await bad({ ...body, recipients: [] })).toBe("VALIDATION_FAILED");
    // The attendee sheet goes only to operator accounts.
    expect(await bad({ format: "xlsx", include_attendees: true, recipients: ["someone@example.org"], cadence: "weekly" })).toBe("VALIDATION_FAILED");

    const r = await h.call<ReportSchedule>("POST", base(), { token: mfa, body: { ...body, recipients: ["Ops@Example.org", "ops@example.org", "finance@example.org"] } });
    expect(r.status).toBe(201);
    expect(r.body.recipients).toEqual(["ops@example.org", "finance@example.org"]);
    expect(r.body).toMatchObject({ state: "active", cadence: "daily", format: "csv", kind: "attendance", include_identity: false, failures: 0 });
    expect(Date.parse(r.body.next_run_at!)).toBe(h.clock.now()); // no first_run_at: due now (server time)
    const list = await h.call<{ items: ReportSchedule[] }>("GET", base(), { token: await org() });
    expect(list.body.items.map((s) => s.id)).toContain(r.body.id);
    const entry = (await h.app.ctx.repos.audit.all()).find((a) => a.action === "report_schedule.create")!;
    expect(entry.meta_jsonb).toMatchObject({ schedule_id: r.body.id, recipients: 2 });
    expect(JSON.stringify(entry.meta_jsonb)).not.toContain("example.org");
  });

  it("a due run emails each recipient a signed link and no data; the next run follows the cadence", async () => {
    const before = scheduled().length;
    await run();
    const mails = scheduled().slice(before);
    expect(mails.map((m) => m.to).sort()).toEqual(["finance@example.org", "ops@example.org"]);
    const url = new URL(/(https?:\/\/\S+)/.exec(mails[0]!.text)![1]!);
    // Nothing about the event or its attendees is in the message itself.
    const event = await h.app.ctx.repos.events.byId(h.seed.eventId);
    expect(mails[0]!.text).not.toContain(event!.title);
    expect(mails[0]!.subject).not.toContain(event!.title);
    const file = await fetch(`${h.base}${url.pathname}${url.search}`);
    expect(file.status).toBe(200);
    expect(await file.text()).toContain("section,tier,registered");
    const s = (await h.call<{ items: ReportSchedule[] }>("GET", base(), { token: await org() })).body.items[0]!;
    expect(s.last_run_at).not.toBeNull();
    expect(Date.parse(s.next_run_at!)).toBeGreaterThan(h.clock.now());
    expect((await h.app.ctx.repos.audit.all()).some((a) => a.action === "report.scheduled_export" && a.meta_jsonb.schedule_id === s.id)).toBe(true);
    // Not due again until a day has passed.
    await run();
    expect(scheduled().length).toBe(before + 2);
    h.clock.advance(86_400_000);
    await run();
    expect(scheduled().length).toBe(before + 4);
  });

  it("pause stops runs; resuming an identity schedule needs MFA; delete removes it", async () => {
    const mfa = await adminMfa();
    const id = (await h.call<ReportSchedule>("POST", base(), {
      token: mfa, body: { format: "xlsx", include_attendees: true, recipients: [h.seed.emails.organiser], cadence: "weekly", first_run_at: new Date(h.clock.now() + 3600_000).toISOString() },
    })).body.id;
    const path = `${base()}/${id}`;
    expect((await h.call<ReportSchedule>("PATCH", path, { token: await org(), body: { state: "paused" } })).body.state).toBe("paused");
    h.clock.advance(2 * 3600_000);
    const before = scheduled().length;
    await run();
    expect(scheduled().slice(before).filter((m) => m.to === h.seed.emails.organiser)).toHaveLength(0);
    expect(errCode((await h.call("PATCH", path, { token: await org(), body: { state: "active" } })).body)).toBe("MFA_REQUIRED");
    const mfa2 = await adminMfa();
    expect((await h.call<ReportSchedule>("PATCH", path, { token: mfa2, body: { state: "active" } })).body.state).toBe("active");
    await run();
    const sent = scheduled().slice(before).filter((m) => m.to === h.seed.emails.organiser);
    expect(sent).toHaveLength(1);
    expect((await h.call("DELETE", path, { token: await org() })).status).toBe(200);
    expect((await h.call("DELETE", path, { token: await org() })).status).toBe(404);
    expect((await h.call("PATCH", `/events/${h.seed.eventId}/report-schedules/${h.seed.eventId}`, { token: await org(), body: { state: "paused" } })).status).toBe(404);
    const actions = (await h.app.ctx.repos.audit.all()).map((a) => a.action);
    for (const a of ["report_schedule.pause", "report_schedule.resume", "report_schedule.delete", "report.export_identity"]) expect(actions).toContain(a);
  });

  it("repository semantics match on both backends: month ends clamp, missed periods are skipped, three failures fail it, leases exclude", async () => {
    const r = h.app.ctx.repos.reportSchedules;
    const t0 = new Date("2027-01-31T09:00:00.000Z");
    const id = await r.create({ eventId: h.seed.eventId, format: "pdf", kind: null, includeIdentity: false, recipients: ["x@example.org"], cadence: "monthly", firstRunAt: t0, createdBy: null, now: t0 });
    const claimed = await r.claimDue(new Date("2027-01-31T09:00:00.000Z"), { limit: 10, leaseMinutes: 15 });
    expect(claimed.map((s) => s.id)).toContain(id);
    expect((await r.claimDue(new Date("2027-01-31T09:05:00.000Z"), { limit: 10, leaseMinutes: 15 })).map((s) => s.id)).not.toContain(id); // leased
    expect((await r.finish(id, { ok: true, error: null, now: new Date("2027-02-01T00:00:00.000Z") })).next_run_at?.toISOString()).toBe("2027-02-28T09:00:00.000Z");
    expect((await r.finish(id, { ok: true, error: null, now: new Date("2027-05-01T00:00:00.000Z") })).next_run_at?.toISOString()).toBe("2027-05-28T09:00:00.000Z");
    for (let i = 0; i < 2; i++) expect((await r.finish(id, { ok: false, error: "boom", now: t0 })).state).toBe("active");
    expect((await r.finish(id, { ok: false, error: "boom", now: t0 })).state).toBe("failed");
    expect(await r.setState(id, "active", t0)).toBe(true);
    expect((await r.list(h.seed.eventId)).find((s) => s.id === id)).toMatchObject({ state: "active", failures: 0, recipients: ["x@example.org"] });
    expect(await r.delete(id)).toBe(true);
  });

  it("an on_close schedule runs once, when the event closes", async () => {
    const mfa = await adminMfa();
    const id = (await h.call<ReportSchedule>("POST", base(), { token: mfa, body: { format: "pdf", recipients: ["board@example.org"], cadence: "on_close" } })).body.id;
    await run();
    expect(scheduled().some((m) => m.to === "board@example.org")).toBe(false);
    expect((await h.call("POST", `/events/${h.seed.eventId}/state`, { token: await org(), body: { state: "closed" } })).status).toBe(200);
    await run(); // the close kicked the job; running it again here makes the test deterministic
    expect(scheduled().filter((m) => m.to === "board@example.org")).toHaveLength(1);
    const s = (await h.call<{ items: ReportSchedule[] }>("GET", base(), { token: await org() })).body.items.find((x) => x.id === id)!;
    expect(s.state).toBe("done");
    h.clock.advance(7 * 86_400_000);
    await run();
    expect(scheduled().filter((m) => m.to === "board@example.org")).toHaveLength(1);
    expect(errCode((await h.call("PATCH", `${base()}/${id}`, { token: await org(), body: { state: "paused" } })).body)).toBe("CONFLICT");
  });
});
