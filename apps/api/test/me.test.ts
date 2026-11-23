/** Slice 9: attendee self-service and the data-request queue. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenPair } from "@synan/contracts/rest";
import { MemoryStorage } from "../src/lib/storage.js";
import { errCode, mfaCode, startHarness, type Harness } from "./helpers.js";

let h: Harness;
let organiser: string;
let adminMfa: string;
beforeAll(async () => {
  h = await startHarness({ storage: new MemoryStorage() });
  organiser = (await h.login(h.seed.emails.organiser)).access_token;
  const admin = (await h.login(h.seed.emails.admin)).access_token;
  adminMfa = (await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: admin, body: { code: mfaCode(h) } })).body.access_token;
});
afterAll(async () => h.close());

async function signIn(email: string): Promise<TokenPair> {
  await h.call("POST", "/auth/email-link", { body: { email } });
  const token = /#token=([A-Za-z0-9_-]+)/.exec(h.mailer.last("auth.link")!.text)![1]!;
  return (await h.call<TokenPair>("POST", "/auth/verify", { body: { token } })).body;
}
type Req = { id: string; state: string; kind: string; attendee_id: string };

describe("slice 9 · attendee self-service", () => {
  it("sessions and notifications are the caller's own", async () => {
    const me = (await signIn(h.seed.attendees.ordinary.email!)).access_token;
    const s = await h.call<{ items: { title: string }[] }>("GET", "/me/sessions", { token: me });
    expect(s.body.items.map((x) => x.title)).toContain("Opening Keynote");
    expect((await h.call("GET", "/me/sessions", { token: organiser })).status).toBe(403);
    const n = await h.call<{ items: { kind: string; title: string }[] }>("GET", "/me/notifications", { token: me });
    expect(n.body.items.some((x) => x.kind === "pass" && x.title === "Your pass is ready")).toBe(true);
    await h.call("POST", `/credentials/${h.seed.attendees.ordinary.credentialId}/revoke`, { token: organiser, body: { reason: "refund" } });
    const after = await h.call<{ items: { title: string }[] }>("GET", "/me/notifications", { token: me });
    expect(after.body.items.map((x) => x.title)).toContain("Your pass was cancelled");
  });

  it("an export is queued, built by the job, and downloadable only by its owner", async () => {
    const me = (await signIn(h.seed.attendees.vip.email!)).access_token;
    const r = await h.call<{ request_id: string; state: string }>("POST", "/me/data-export", { token: me });
    expect(r.status).toBe(202);
    await h.app.ctx.jobs.runNow("data_request.process");
    const mine = await h.call<{ items: Req[] }>("GET", "/me/data-requests", { token: me });
    expect(mine.body.items[0]!.state).toBe("completed");
    const x = await h.call<{ data: { identity: { email: string }; registrations: unknown[] } }>("GET", `/me/data-export/${r.body.request_id}`, { token: me });
    expect(x.body.data.identity.email).toBe(h.seed.attendees.vip.email);
    expect(x.body.data.registrations.length).toBeGreaterThan(0);
    const other = (await signIn(h.seed.attendees.privateInvite.email!)).access_token;
    expect((await h.call("GET", `/me/data-export/${r.body.request_id}`, { token: other })).status).toBe(404);
  });

  it("erasure waits for an admin (MFA, audited); processing scrubs identity and ends the attendee's sessions", async () => {
    const pair = await signIn(h.seed.attendees.ordinary2.email!);
    const r = await h.call<{ request_id: string }>("POST", "/me/data-erasure", { token: pair.access_token, body: { confirm: true } });
    expect(r.status).toBe(202);
    const queue = await h.call<{ items: Req[] }>("GET", "/data-requests?kind=erasure&state=requested", { token: organiser });
    const row = queue.body.items.find((q) => q.id === r.body.request_id)!;
    expect(row.attendee_id).toBe(h.seed.attendees.ordinary2.id);
    expect(JSON.stringify(queue.body)).not.toContain(h.seed.attendees.ordinary2.email!);
    expect((await h.call("POST", `/data-requests/${row.id}/process`, { token: organiser })).status).toBe(403);
    const plain = (await h.login(h.seed.emails.admin)).access_token;
    expect(errCode((await h.call("POST", `/data-requests/${row.id}/process`, { token: plain })).body)).toBe("MFA_REQUIRED");
    const done = await h.call<Req>("POST", `/data-requests/${row.id}/process`, { token: adminMfa });
    expect(done.body.state).toBe("completed");
    const person = (await h.app.ctx.repos.attendees.byId(h.seed.attendees.ordinary2.id))!;
    expect(person.email).toBeNull();
    expect(person.full_name).toBeNull();
    expect((await h.call("POST", "/auth/refresh", { body: { refresh_token: pair.refresh_token } })).status).toBe(401);
    expect((await h.app.ctx.repos.audit.all()).map((a) => a.action)).toEqual(expect.arrayContaining(["attendee.erase", "data_request.process"]));
    expect(errCode((await h.call("POST", `/data-requests/${row.id}/process`, { token: adminMfa })).body)).toBe("CONFLICT");
  });

  it("an admin can decline a request with a note; the attendee is told", async () => {
    const pair = await signIn(h.seed.attendees.privateInvite.email!);
    const r = await h.call<{ request_id: string }>("POST", "/me/data-erasure", { token: pair.access_token, body: { confirm: true } });
    const rej = await h.call<Req & { note: string }>("POST", `/data-requests/${r.body.request_id}/reject`, { token: adminMfa, body: { note: "Open legal hold" } });
    expect(rej.body.state).toBe("rejected");
    const n = await h.call<{ items: { title: string }[] }>("GET", "/me/notifications", { token: pair.access_token });
    expect(n.body.items.map((x) => x.title)).toContain("Your erasure request was declined");
  });
});
