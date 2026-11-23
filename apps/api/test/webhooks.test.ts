/** Slice 7: webhooks — CRUD, HMAC-signed delivery mirroring alerts, retries with backoff, delivery log. */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenPair, WebhookDelivery, WebhookEndpoint } from "@synan/contracts/rest";
import { errCode, mfaCode, startHarness, type Harness } from "./helpers.js";

const sent: { url: string; address: string; body: string; headers: Record<string, string> }[] = [];
let status = 200;
/** Fake DNS: hooks.example.com is public until the test points it at a private address. */
const dns: Record<string, string[]> = { "hooks.example.com": ["93.184.216.34"], "rebind.example.com": ["10.1.2.3"] };
let h: Harness;
let adminMfa: string;
let organiser: string;
beforeAll(async () => {
  h = await startHarness({
    webhookTransport: { post: async (url, address, body, headers) => (sent.push({ url, address, body, headers }), { status }) },
    webhookResolver: async (host) => dns[host] ?? [],
  });
  const admin = (await h.login(h.seed.emails.admin)).access_token;
  adminMfa = (await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: admin, body: { code: mfaCode(h) } })).body.access_token;
  organiser = (await h.login(h.seed.emails.organiser)).access_token;
});
afterAll(async () => h.close());

const raise = () =>
  h.app.ctx.alerts.raise(
    { kind: "unauthorised_tier", severity: "medium", detail: "tier not permitted" },
    { eventId: h.seed.eventId, checkpointId: h.seed.checkpoints.vip, credentialId: h.seed.attendees.ordinary.credentialId },
  );
const freshMfa = async () => {
  h.clock.advance(31_000); // a new TOTP step
  const admin = (await h.login(h.seed.emails.admin)).access_token;
  adminMfa = (await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: admin, body: { code: mfaCode(h) } })).body.access_token;
};
const settle = async () => {
  await new Promise((r) => setTimeout(r, 20));
  await h.app.ctx.webhooks.drain();
};

describe("slice 7 · webhooks", () => {
  let hook: WebhookEndpoint & { secret: string };

  it("admin only, MFA for changes, https to a public host only; the secret is shown once", async () => {
    const body = { url: "https://hooks.example.com/synan", events: ["alert.raised"] };
    expect((await h.call("POST", "/webhooks", { token: organiser, body })).status).toBe(403);
    const plain = (await h.login(h.seed.emails.admin)).access_token;
    expect(errCode((await h.call("POST", "/webhooks", { token: plain, body })).body)).toBe("MFA_REQUIRED");
    expect((await h.call("POST", "/webhooks", { token: adminMfa, body: { ...body, url: "http://hooks.example.com/x" } })).status).toBe(400);
    for (const url of ["https://10.0.0.5/x", "https://127.0.0.1/x", "https://localhost/x", "https://[::1]/x", "https://rebind.example.com/x", "https://nowhere.example.com/x"]) {
      expect(errCode((await h.call("POST", "/webhooks", { token: adminMfa, body: { ...body, url } })).body)).toBe("VALIDATION_FAILED");
    }
    const r = await h.call<WebhookEndpoint & { secret: string }>("POST", "/webhooks", { token: adminMfa, body });
    expect(r.status).toBe(201);
    hook = r.body;
    expect(hook.secret).toMatch(/^whsec_/);
    const list = await h.call<{ items: Record<string, unknown>[] }>("GET", "/webhooks", { token: plain });
    expect(list.body.items[0]).not.toHaveProperty("secret");
    expect(JSON.stringify(await h.app.ctx.repos.audit.all())).not.toContain(hook.secret);
  });

  it("an alert is delivered signed with HMAC over the exact body, without the credential link", async () => {
    sent.length = 0;
    await raise();
    await settle();
    expect(sent).toHaveLength(1);
    const d = sent[0]!;
    expect(d.headers["X-Synan-Event"]).toBe("alert.raised");
    const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(d.headers["X-Synan-Signature"]!)!;
    expect(createHmac("sha256", hook.secret).update(`${m[1]}.${d.body}`).digest("hex")).toBe(m[2]);
    const env = JSON.parse(d.body);
    expect(env.data.kind).toBe("unauthorised_tier");
    expect(env.data.credential_id).toBeNull();
    expect(d.address).toBe("93.184.216.34"); // the request is pinned to the vetted address
  });

  it("the host is re-resolved at delivery: a name that now points inside is refused and the attempt logged", async () => {
    sent.length = 0;
    dns["hooks.example.com"] = ["192.168.1.10"];
    await raise();
    await settle();
    expect(sent).toHaveLength(0);
    dns["hooks.example.com"] = ["93.184.216.34"];
  });

  it("a failing receiver is retried with backoff and dead after eight attempts; the log shows it", async () => {
    sent.length = 0;
    status = 500;
    const alert = await raise();
    await settle();
    for (const wait of [30_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000]) {
      h.clock.advance(wait - 1);
      await h.app.ctx.webhooks.drain(); // not yet due
      h.clock.advance(1);
      await h.app.ctx.webhooks.drain();
    }
    expect(sent.filter((s) => JSON.parse(s.body).data.id === alert.id)).toHaveLength(8);
    await freshMfa();
    const log = await h.call<{ items: WebhookDelivery[] }>("GET", `/webhooks/${hook.id}/deliveries`, { token: adminMfa });
    const last = log.body.items.find((x) => x.state === "dead")!;
    expect(last.attempts).toBe(8);
    expect(last.last_status).toBe(500);
    expect(log.body.items.some((x) => x.state === "succeeded")).toBe(true);
    status = 200;
  });

  it("rotating changes the secret; disabling stops deliveries; delete removes it", async () => {
    const r = await h.call<{ secret: string }>("POST", `/webhooks/${hook.id}/rotate-secret`, { token: adminMfa });
    expect(r.body.secret).not.toBe(hook.secret);
    sent.length = 0;
    expect((await h.call("PATCH", `/webhooks/${hook.id}`, { token: adminMfa, body: { active: false } })).status).toBe(200);
    await raise();
    await settle();
    expect(sent).toHaveLength(0);
    expect((await h.call("DELETE", `/webhooks/${hook.id}`, { token: adminMfa })).status).toBe(200);
    expect((await h.call("GET", `/webhooks/${hook.id}/deliveries`, { token: adminMfa })).status).toBe(404);
    expect((await h.app.ctx.repos.audit.all()).map((a) => a.action)).toEqual(expect.arrayContaining(["webhook.create", "webhook.rotate_secret", "webhook.update", "webhook.delete"]));
  });
});
