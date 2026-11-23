/**
 * POST /me/credential/resend — "Email me a copy" on the attendee pass screen: the attendee's own pass
 * for one event, through the email outbox, strict per-attendee limit, the same answer whether or not
 * anything was sent, audited without the address.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenPair } from "@synan/contracts/rest";
import { errCode, startHarness, type Harness } from "./helpers.js";

let h: Harness;
beforeAll(async () => {
  h = await startHarness({ config: { selfResendPerHour: 3 } });
});
afterAll(async () => h.close());

async function signIn(email: string): Promise<string> {
  await h.call("POST", "/auth/email-link", { body: { email } });
  const token = /#token=([A-Za-z0-9_-]+)/.exec(h.mailer.last("auth.link")!.text)![1]!;
  return (await h.call<TokenPair>("POST", "/auth/verify", { body: { token } })).body.access_token;
}
const passMails = (to: string) => h.mailer.outbox.filter((m) => m.tag === "pass.email_qr" && m.to === to);
const resend = (token: string, eventId: string) => h.call<{ accepted: boolean }>("POST", "/me/credential/resend", { token, body: { event_id: eventId } });

describe("attendee pass resend", () => {
  it("emails a fresh single-use copy of the caller's own pass through the outbox; the previous copy stops working; audited without the address", async () => {
    const a = h.seed.attendees.vip;
    const me = await signIn(a.email!);
    const before = passMails(a.email!).length;
    const oldEmailed = (await h.app.ctx.repos.carriers.forCredential(a.credentialId)).filter((c) => c.kind === "qr_email" && c.state !== "retired");

    const r = await resend(me, h.seed.eventId);
    expect([r.status, r.body]).toEqual([202, { accepted: true }]);
    expect(passMails(a.email!)).toHaveLength(before + 1);
    expect(passMails(a.email!).at(-1)!.text).toMatch(/QR: /);

    const carriers = await h.app.ctx.repos.carriers.forCredential(a.credentialId);
    for (const o of oldEmailed) expect(carriers.find((c) => c.id === o.id)!.state).toBe("retired");
    expect(carriers.filter((c) => c.kind === "qr_email" && c.state === "active")).toHaveLength(1);

    const entry = (await h.app.ctx.repos.audit.all()).filter((e) => e.action === "credential.resend_self").at(-1)!;
    expect(entry.target).toBe(`credential:${a.credentialId}`);
    expect(entry.meta_jsonb).toMatchObject({ event_id: h.seed.eventId });
    expect(JSON.stringify(entry)).not.toContain(a.email!);
    expect(JSON.stringify(entry)).not.toContain("@");
  });

  it("answers the same when nothing is sent: an event the caller is not registered for, an unusable pass", async () => {
    const a = h.seed.attendees.ordinary2;
    const me = await signIn(a.email!);
    const sent = () => passMails(a.email!).length;
    const n0 = sent();
    for (const eventId of [randomUUID(), h.seed.privateEventId]) {
      const r = await resend(me, eventId);
      expect([r.status, r.body]).toEqual([202, { accepted: true }]);
    }
    expect(sent()).toBe(n0);
    const organiser = (await h.login(h.seed.emails.organiser)).access_token;
    expect((await h.call("POST", `/credentials/${a.credentialId}/revoke`, { token: organiser, body: { reason: "refund" } })).status).toBe(200);
    const r = await resend(me, h.seed.eventId);
    expect([r.status, r.body]).toEqual([202, { accepted: true }]);
    expect(sent()).toBe(n0);
  });

  it("is for attendees only and validates its body", async () => {
    const organiser = (await h.login(h.seed.emails.organiser)).access_token;
    expect((await resend(organiser, h.seed.eventId)).status).toBe(403);
    expect((await h.call("POST", "/me/credential/resend", { body: { event_id: h.seed.eventId } })).status).toBe(401);
    const me = await signIn(h.seed.attendees.ordinary.email!);
    expect(errCode((await h.call("POST", "/me/credential/resend", { token: me, body: {} })).body)).toBe("VALIDATION_FAILED");
  });

  it("is limited per attendee per hour, silently: over the limit the answer is the same and nothing is sent", async () => {
    const a = h.seed.attendees.ordinary;
    let me = await signIn(a.email!);
    const n0 = passMails(a.email!).length;
    for (let i = 0; i < 5; i++) expect((await resend(me, h.seed.eventId)).body).toEqual({ accepted: true });
    expect(passMails(a.email!).length - n0).toBe(3);
    h.clock.advance(3_600_000);
    me = await signIn(a.email!);
    await resend(me, h.seed.eventId);
    expect(passMails(a.email!).length - n0).toBe(4);
  });
});
