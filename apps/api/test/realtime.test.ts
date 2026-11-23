/** Slice 10: /stream/scans, /stream/alerts, /stream/me — scoping as REST, replay, live pass flip. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { TokenPair, WsTicket } from "@synan/contracts/rest";
import { serverMessageByChannel } from "@synan/contracts/ws";
import { band, postScans, scan, startHarness, type Harness } from "./helpers.js";

type Msg = { type: string; id?: string; data?: Record<string, unknown>; resumed?: boolean; scope?: string };
let h: Harness;
let organiser: string;
beforeAll(async () => {
  h = await startHarness();
  organiser = (await h.login(h.seed.emails.organiser)).access_token;
});
afterAll(async () => h.close());

const mint = (token: string, body: Record<string, unknown>) => h.call<WsTicket>("POST", "/auth/ws-ticket", { token, body });
async function open(token: string, body: { channel: keyof typeof serverMessageByChannel } & Record<string, unknown>, hello: Record<string, unknown> = {}) {
  const t = await mint(token, body);
  expect(t.status).toBe(200);
  const ws = new WebSocket(h.base.replace("http", "ws") + body.channel, t.body.protocols);
  const messages: Msg[] = [];
  await new Promise<void>((res, rej) => {
    ws.on("open", () => res());
    ws.on("error", rej);
  });
  ws.on("message", (raw) => messages.push(serverMessageByChannel[body.channel].parse(JSON.parse(String(raw))) as Msg));
  ws.send(JSON.stringify({ type: "hello", ...hello }));
  const waitFor = async (pred: (m: Msg) => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    for (;;) {
      const m = messages.find(pred);
      if (m) return m;
      if (Date.now() > end) throw new Error(`timeout; got ${JSON.stringify(messages.map((x) => x.type))}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  await waitFor((m) => m.type === "ready");
  return { ws, messages, waitFor };
}
async function attendeeToken(email: string) {
  await h.call("POST", "/auth/email-link", { body: { email } });
  const token = /#token=([A-Za-z0-9_-]+)/.exec(h.mailer.last("auth.link")!.text)![1]!;
  return (await h.call<TokenPair>("POST", "/auth/verify", { body: { token } })).body.access_token;
}

describe("slice 10 · /stream/scans", () => {
  it("staff follow only the checkpoint they staff now; operators see the event; nobody sees a person", async () => {
    const gate = await h.gateToken(h.seed.checkpoints.expo);
    expect((await mint(gate, { channel: "/stream/scans", event_id: h.seed.eventId, checkpoint_id: h.seed.checkpoints.vip })).status).toBe(403);
    const staff = await open(gate, { channel: "/stream/scans", event_id: h.seed.eventId });
    const ops = await open(organiser, { channel: "/stream/scans", event_id: h.seed.eventId });
    await postScans(h, [scan(h, h.seed.checkpoints.vip, band(h.seed.attendees.vip.uid))]);
    await postScans(h, [scan(h, h.seed.checkpoints.expo, band(h.seed.attendees.publicTier.uid))]);
    const mine = await staff.waitFor((m) => m.type === "scan.result");
    expect(mine.data!.checkpoint_id).toBe(h.seed.checkpoints.expo);
    await ops.waitFor((m) => m.type === "scan.result" && m.data!.checkpoint_id === h.seed.checkpoints.vip);
    await new Promise((r) => setTimeout(r, 100));
    expect(staff.messages.filter((m) => m.type === "scan.result")).toHaveLength(1);
    expect(JSON.stringify(ops.messages)).not.toContain(h.seed.attendees.vip.credentialId);
    // Replay: a reconnect with the cursor gets exactly what it missed.
    const cursor = mine.id!;
    staff.ws.close();
    await postScans(h, [scan(h, h.seed.checkpoints.expo, band(h.seed.attendees.vip.uid))]);
    const again = await open(gate, { channel: "/stream/scans", event_id: h.seed.eventId }, { last_event_id: cursor });
    expect((await again.waitFor((m) => m.type === "ready")).resumed).toBe(true);
    await again.waitFor((m) => m.type === "scan.result");
    // Heartbeat frames feed gate health.
    // Heartbeat frames feed gate health through the phone's device row (written asynchronously).
    again.ws.send(JSON.stringify({ type: "heartbeat", queue_depth: 3, clock_offset_ms: 10, online: true, device_id: "phone-1" }));
    const event = (await h.app.ctx.repos.events.byId(h.seed.eventId))!;
    let expo;
    for (let i = 0; i < 50; i++) {
      expo = (await h.app.ctx.gates.health(event)).find((g) => g.checkpoint_id === h.seed.checkpoints.expo);
      if (expo?.queue_depth === 3) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(expo).toMatchObject({ queue_depth: 3, link_state: "degraded", clock_offset_ms: 10 });
    for (const c of [again, ops]) c.ws.close();
  });
});

describe("slice 10 · /stream/alerts", () => {
  it("operators get every alert with its credential; staff only their gates and never the credential; attendees are refused", async () => {
    const att = await attendeeToken(h.seed.attendees.ordinary.email!);
    expect((await mint(att, { channel: "/stream/alerts" })).status).toBe(403);
    const gate = await h.gateToken(h.seed.checkpoints.vip);
    const staff = await open(gate, { channel: "/stream/alerts", event_id: h.seed.eventId });
    const ops = await open(organiser, { channel: "/stream/alerts" });
    const raise = (cp: string) => h.app.ctx.alerts.raise({ kind: "unauthorised_tier", severity: "medium", detail: "x" }, { eventId: h.seed.eventId, checkpointId: cp, credentialId: h.seed.attendees.ordinary.credentialId });
    await raise(h.seed.checkpoints.expo);
    await raise(h.seed.checkpoints.vip);
    const s = await staff.waitFor((m) => m.type === "alert.raised");
    expect(s.data!.checkpoint_id).toBe(h.seed.checkpoints.vip);
    expect(s.data!.credential_id).toBeNull();
    const o = await ops.waitFor((m) => m.type === "alert.raised" && m.data!.checkpoint_id === h.seed.checkpoints.vip);
    expect(o.data!.credential_id).toBe(h.seed.attendees.ordinary.credentialId);
    await new Promise((r) => setTimeout(r, 100));
    expect(staff.messages.filter((m) => m.type === "alert.raised")).toHaveLength(1);
    for (const c of [staff, ops]) c.ws.close();
  });
});

describe("slice 10 · /stream/me", () => {
  it("the pass flips to revoked live, only for its holder; staff and operators are refused", async () => {
    expect((await mint(organiser, { channel: "/stream/me" })).status).toBe(403);
    const vip = await attendeeToken(h.seed.attendees.vip.email!);
    const other = await attendeeToken(h.seed.attendees.privateInvite.email!);
    expect((await mint(other, { channel: "/stream/me", event_id: h.seed.publishedEventId })).status).toBe(404);
    const mine = await open(vip, { channel: "/stream/me", event_id: h.seed.eventId });
    const theirs = await open(other, { channel: "/stream/me" });
    await h.call("POST", `/credentials/${h.seed.attendees.vip.credentialId}/revoke`, { token: organiser, body: { reason: "test" } });
    const flip = await mine.waitFor((m) => m.type === "pass.status");
    expect(flip.data).toEqual({ event_id: h.seed.eventId, state: "revoked" });
    await new Promise((r) => setTimeout(r, 100));
    expect(theirs.messages.filter((m) => m.type === "pass.status")).toHaveLength(0);
    for (const c of [mine, theirs]) c.ws.close();
  });
});
