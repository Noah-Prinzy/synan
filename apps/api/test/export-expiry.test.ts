/**
 * A deleted export is not offered (03 §6): the report list follows the register of exported files.
 * Once a file's retention runs out, or the retention job deletes it, its row keeps `state: "ready"`
 * with `expired_at` set and no `download_url`, and a genuine signed link to it answers 410
 * EXPORT_EXPIRED instead of a bare 404.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenPair } from "@synan/contracts/rest";
import { MemoryStorage } from "../src/lib/storage.js";
import { errCode, mfaCode, startHarness, type Harness } from "./helpers.js";

const DAY = 86_400_000;
type Row = { id: string; state: string; download_url: string | null; expired_at?: string | null };

const storage = new MemoryStorage();
let h: Harness;
beforeAll(async () => {
  h = await startHarness({ storage });
});
afterAll(async () => h.close());

const organiser = async () => (await h.login(h.seed.emails.organiser)).access_token;
const rows = async () => (await h.call<{ items: Row[] }>("GET", `/reports/${h.seed.eventId}`, { token: await organiser() })).body.items;
const local = (url: string) => {
  const u = new URL(url);
  return `${h.base}${u.pathname}${u.search}`;
};

describe("exports after retention", () => {
  it("a ready export is listed with a link until its file's retention ends; then expired, without a link, and its download is refused typed", async () => {
    const admin = (await h.login(h.seed.emails.admin)).access_token;
    const stepped = (await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: admin, body: { code: mfaCode(h) } })).body.access_token;
    const r = await h.call<Row>("POST", `/reports/${h.seed.eventId}/export`, { token: stepped, body: { kind: "attendance", format: "csv" } });
    expect(r.status).toBe(202);
    expect(r.body.expired_at ?? null).toBeNull();
    await h.app.ctx.reportExports.drain();

    const ready = (await rows()).find((x) => x.id === r.body.id)!;
    expect(ready).toMatchObject({ state: "ready", expired_at: null });
    expect((await fetch(local(ready.download_url!))).status).toBe(200);

    // Six days on: still kept, still offered (a fresh link: the first one lived ten minutes).
    h.clock.advance(6 * DAY);
    await h.app.ctx.jobs.runNow("delivery.cleanup");
    const kept = (await rows()).find((x) => x.id === r.body.id)!;
    expect(kept.expired_at).toBeNull();
    expect((await fetch(local(kept.download_url!))).status).toBe(200);

    // Past seven days, before the retention job has run: no longer offered (the promised period is over).
    h.clock.advance(1 * DAY + 60_000);
    const overdue = (await rows()).find((x) => x.id === r.body.id)!;
    expect(overdue).toMatchObject({ state: "ready", download_url: null });
    expect(Date.parse(overdue.expired_at!)).toBeLessThanOrEqual(h.clock.now());

    // The job deletes the file: still expired, now at the deletion time, everywhere the row appears.
    await h.app.ctx.jobs.runNow("delivery.cleanup");
    expect(storage.objects.size).toBe(0);
    const gone = (await rows()).find((x) => x.id === r.body.id)!;
    expect(gone).toMatchObject({ state: "ready", download_url: null });
    const file = (await h.app.ctx.repos.exportedFiles.list({ reportId: r.body.id }))[0]!;
    expect(gone.expired_at).toBe(file.deleted_at!.toISOString());
    const summary = await h.call<{ downloads: Row[] }>("GET", `/events/${h.seed.eventId}/post-event-summary`, { token: await organiser() });
    expect(summary.body.downloads.find((x) => x.id === r.body.id)).toMatchObject({ download_url: null, expired_at: gone.expired_at });
    const all = await h.call<{ items: Row[] }>("GET", "/reports", { token: await organiser() });
    expect(all.body.items.find((x) => x.id === r.body.id)).toMatchObject({ download_url: null, expired_at: gone.expired_at });

    // A genuine signed link, made now (as the list used to hand out): a clear, typed refusal.
    const stored = (await h.app.ctx.repos.reports.list({ eventId: h.seed.eventId, offset: 0, limit: 50 })).find((x) => x.id === r.body.id)!;
    const link = h.app.ctx.reportExports.downloadUrl(stored)!;
    const res = await fetch(local(link));
    expect(res.status).toBe(410);
    expect(errCode(await res.json())).toBe("EXPORT_EXPIRED");
    // A forged link still learns nothing: refused before the register is read.
    const forged = new URL(local(link));
    forged.searchParams.set("sig", "not-a-signature");
    expect((await fetch(forged)).status).toBe(403);
  });

  it("a new export after that is offered as usual: expiry is per file, not per event", async () => {
    h.clock.advance(31_000);
    const admin = (await h.login(h.seed.emails.admin)).access_token;
    const stepped = (await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: admin, body: { code: mfaCode(h) } })).body.access_token;
    const r = await h.call<Row>("POST", `/reports/${h.seed.eventId}/export`, { token: stepped, body: { format: "pdf" } });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ download_url: null, expired_at: null }); // not built yet
    await h.app.ctx.reportExports.drain();
    const list = await rows();
    const fresh = list.find((x) => x.id === r.body.id)!;
    expect(fresh).toMatchObject({ state: "ready", expired_at: null });
    expect((await fetch(local(fresh.download_url!))).status).toBe(200);
    expect(list.filter((x) => x.expired_at).length).toBe(1); // the first one only
  });
});
