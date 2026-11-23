/** Slice 11: background jobs — invitation expiry, session-end reset, rollup rebuild, purge after the grace period. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JOB_QUEUES } from "@synan/db";
import { band, devEmail, postScans, scan, startHarness, type Harness } from "./helpers.js";

let h: Harness;
let organiser: string;
const H = 3600_000;
beforeAll(async () => {
  h = await startHarness();
  organiser = (await h.login(h.seed.emails.organiser)).access_token;
});
afterAll(async () => h.close());
const run = (q: string) => h.app.ctx.jobs.runNow(q);

describe("slice 11 · jobs", () => {
  it("every job is registered under the database's queue names", async () => {
    for (const q of [JOB_QUEUES.purge, JOB_QUEUES.sessionReset, JOB_QUEUES.rollupRebuild, JOB_QUEUES.authCleanup, JOB_QUEUES.invitationExpiry, JOB_QUEUES.webhookDelivery, JOB_QUEUES.reportExport, JOB_QUEUES.dataRequest]) {
      await expect(run(q)).resolves.toBeUndefined();
    }
  });

  it("invitations past their expiry are marked expired", async () => {
    await h.call("POST", "/invitations", { token: organiser, body: { event_id: h.seed.privateEventId, emails: [devEmail("late.guest")], expires_at: new Date(h.clock.now() + 60_000).toISOString() } });
    h.clock.advance(120_000);
    await run(JOB_QUEUES.invitationExpiry);
    const rows = await h.app.ctx.repos.invitations.forEvent(h.seed.privateEventId);
    expect(rows.some((i) => i.state === "expired")).toBe(true);
  });

  it("a session's end resets its room to zero (D-10); rollups follow the live data", async () => {
    await postScans(h, [scan(h, h.seed.checkpoints.auditorium, band(h.seed.attendees.vip.uid), { direction: "in" })]);
    const count = async () => (await h.app.ctx.scans.projection(h.seed.eventId)).roomView(h.seed.rooms.auditorium).occupancy;
    expect(await count()).toBe(1);
    await run(JOB_QUEUES.sessionReset);
    expect(await count()).toBe(1); // the keynote has not ended
    h.clock.advance(1 * H);
    await run(JOB_QUEUES.sessionReset);
    expect(await count()).toBe(0);
    await run(JOB_QUEUES.rollupRebuild);
    const peaks = await h.app.ctx.repos.reports.run("peak_occupancy", h.seed.eventId, { limit: 50 });
    expect(peaks.rows.find((r) => r[0] === h.seed.rooms.auditorium)![4]).toBe(1);
  });

  it("the purge runs only after the grace period, and is audited", async () => {
    organiser = (await h.login(h.seed.emails.organiser)).access_token;
    expect((await h.call("POST", `/events/${h.seed.eventId}/state`, { token: organiser, body: { state: "closed" } })).status).toBe(200);
    await run(JOB_QUEUES.purge);
    expect(await h.app.ctx.repos.reports.purgedAt(h.seed.eventId)).toBeNull();
    expect((await h.app.ctx.repos.scans.forEvent(h.seed.eventId)).length).toBeGreaterThan(0);
    h.clock.advance(73 * H); // grace 72 h
    await run(JOB_QUEUES.purge);
    expect(await h.app.ctx.repos.reports.purgedAt(h.seed.eventId)).not.toBeNull();
    expect(await h.app.ctx.repos.scans.forEvent(h.seed.eventId)).toHaveLength(0);
    expect((await h.app.ctx.repos.audit.all()).map((a) => a.action)).toContain("event.purge");
  });
});
