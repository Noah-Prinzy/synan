import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { WS_SUBPROTOCOL, type TokenPair, type WsTicket } from "@synan/contracts/rest";
import { TelemetryServerMessage } from "@synan/contracts/ws";
import { addAttendee, band, devEmail, errCode, postScans, scan, startHarness, type Harness } from "./helpers.js";

let h: Harness;
let organiser: TokenPair;

beforeAll(async () => {
  h = await startHarness();
  organiser = await h.login(h.seed.emails.organiser);
});
afterAll(async () => {
  await h.close();
});

const wsUrl = (path: string) => h.base.replace("http", "ws") + path;

async function ticket(token: string, body: Record<string, unknown> = { channel: "/stream/telemetry", event_id: h.seed.eventId }) {
  const r = await h.call<WsTicket>("POST", "/auth/ws-ticket", { token, body });
  return r;
}

interface Conn {
  ws: WebSocket;
  messages: Array<{ at: number; msg: ReturnType<typeof TelemetryServerMessage.parse> }>;
  waitFor(pred: (m: Conn["messages"][number]["msg"]) => boolean, timeoutMs?: number): Promise<Conn["messages"][number]["msg"]>;
}

function connect(protocols: string[], opts: { path?: string; hello?: Record<string, unknown> | null; origin?: string } = {}): Promise<Conn> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl(opts.path ?? "/stream/telemetry"), protocols, opts.origin ? { origin: opts.origin } : {});
    const messages: Conn["messages"] = [];
    const waiters: Array<() => void> = [];
    ws.on("message", (raw) => {
      // Every server frame must satisfy the channel contract.
      const msg = TelemetryServerMessage.parse(JSON.parse(String(raw)));
      messages.push({ at: Date.now(), msg });
      for (const w of waiters.splice(0)) w();
    });
    ws.on("unexpected-response", (_req, res) => reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode })));
    ws.on("error", reject);
    ws.on("open", () => {
      if (opts.hello !== null) ws.send(JSON.stringify({ type: "hello", ...(opts.hello ?? {}) }));
      resolve({
        ws,
        messages,
        waitFor(pred, timeoutMs = 3000) {
          return new Promise((res, rej) => {
            const check = () => {
              const found = messages.find((m) => pred(m.msg));
              if (found) return res(found.msg);
              waiters.push(check);
            };
            setTimeout(() => rej(new Error("timeout waiting for message")), timeoutMs).unref();
            check();
          });
        },
      });
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("WebSocket ticket (P-16)", () => {
  it("mints a 30 s single-use ticket carried in Sec-WebSocket-Protocol", async () => {
    const t = await ticket(organiser.access_token);
    expect(t.status).toBe(200);
    expect(t.body.protocols[0]).toBe(WS_SUBPROTOCOL);
    expect(Date.parse(t.body.expires_at) - h.clock.now()).toBe(30_000);
    const c = await connect(t.body.protocols);
    expect(c.ws.protocol).toBe(WS_SUBPROTOCOL);
    const ready = await c.waitFor((m) => m.type === "ready");
    expect(ready).toMatchObject({ type: "ready", scope: "full", resumed: false });
    await c.waitFor((m) => m.type === "occupancy.snapshot");
    c.ws.close();
    // Second use of the same ticket is refused.
    await expect(connect(t.body.protocols)).rejects.toMatchObject({ status: 401 });
  });

  it("refuses a ticket passed in the URL instead of the subprotocol", async () => {
    const t = await ticket(organiser.access_token);
    await expect(connect([WS_SUBPROTOCOL], { path: `/stream/telemetry?ticket=${t.body.ticket}` })).rejects.toMatchObject({ status: 401 });
  });

  it("refuses an expired ticket", async () => {
    const t = await ticket(organiser.access_token);
    h.clock.advance(31_000);
    await expect(connect(t.body.protocols)).rejects.toMatchObject({ status: 401 });
  });

  it("refuses a ticket minted for a different channel", async () => {
    const t = await ticket(organiser.access_token);
    await expect(connect(t.body.protocols, { path: "/stream/alerts" })).rejects.toMatchObject({ status: 401 });
  });

  it("refuses a disallowed Origin (cross-site WebSocket hijacking)", async () => {
    const t = await ticket(organiser.access_token);
    await expect(connect(t.body.protocols, { origin: "https://evil.example" })).rejects.toMatchObject({ status: 403 });
  });

  it("requires authentication to mint, and channels not yet built answer 501", async () => {
    expect((await h.call("POST", "/auth/ws-ticket", { body: { channel: "/stream/telemetry", event_id: h.seed.eventId } })).status).toBe(401);
    const r = await ticket(organiser.access_token, { channel: "/stream/alerts", event_id: h.seed.eventId });
    expect(r.status).toBe(501);
  });

  it("per-channel authorisation: an attendee cannot subscribe to an unlisted event they are not invited to", async () => {
    await h.call("POST", "/auth/email-link", { body: { email: devEmail("ordinary") } });
    const token = /#token=([A-Za-z0-9_-]+)/.exec(h.mailer.last("auth.link")!.text)![1]!;
    const att = (await h.call<TokenPair>("POST", "/auth/verify", { body: { token } })).body;
    const r = await ticket(att.access_token, { channel: "/stream/telemetry", event_id: h.seed.privateEventId });
    expect(r.status).toBe(404);
    expect(errCode(r.body)).toBe("NOT_FOUND");
  });
});

describe("/stream/telemetry", () => {
  it("public scope suppresses counts below k = 5 (O-08)", async () => {
    await h.call("POST", "/auth/email-link", { body: { email: devEmail("vip") } });
    const token = /#token=([A-Za-z0-9_-]+)/.exec(h.mailer.last("auth.link")!.text)![1]!;
    const att = (await h.call<TokenPair>("POST", "/auth/verify", { body: { token } })).body;
    // One person in the VIP Lounge.
    const a = await addAttendee(h, "VIP");
    await postScans(h, [scan(h, h.seed.checkpoints.vip, band(a.uid))], { deviceId: "k" });
    const t = await ticket(att.access_token);
    const c = await connect(t.body.protocols);
    expect(await c.waitFor((m) => m.type === "ready")).toMatchObject({ scope: "public" });
    const snap = await c.waitFor((m) => m.type === "occupancy.snapshot");
    if (snap.type !== "occupancy.snapshot") throw new Error();
    const vip = snap.data.rooms.find((r) => r.room_id === h.seed.rooms.vip)!;
    expect(vip.occupancy).toBeNull();
    c.ws.close();
    // The operator sees the real count.
    const t2 = await ticket(organiser.access_token);
    const c2 = await connect(t2.body.protocols);
    const snap2 = await c2.waitFor((m) => m.type === "occupancy.snapshot");
    if (snap2.type !== "occupancy.snapshot") throw new Error();
    expect(snap2.data.rooms.find((r) => r.room_id === h.seed.rooms.vip)!.occupancy).toBe(1);
    c2.ws.close();
  });

  it("coalesces a burst of scans into ≤ 4 Hz deltas carrying only changed rooms", async () => {
    const people = await Promise.all(Array.from({ length: 40 }, () => addAttendee(h, "ORDINARY")));
    await sleep(300); // let any flush pending from earlier tests go out first
    const t = await ticket(organiser.access_token);
    const c = await connect(t.body.protocols);
    await c.waitFor((m) => m.type === "occupancy.snapshot");
    const proj = await h.app.ctx.scans.projection(h.seed.eventId);
    const startExpo = proj.count(h.seed.rooms.expo);

    // 40 single-scan requests as fast as possible (a doors-open burst), all into the Expo Hall.
    const t0 = Date.now();
    await Promise.all(
      people.map((p, i) =>
        postScans(h, [scan(h, h.seed.checkpoints.expo, band(p.uid))], { deviceId: `burst-${i}` }),
      ),
    );
    const burstMs = Date.now() - t0;
    await c.waitFor((m) => m.type === "occupancy.delta" && m.data.rooms.some((r) => r.room_id === h.seed.rooms.expo && r.occupancy === startExpo + 40), 3000);
    await sleep(400);

    const deltas = c.messages.filter((m) => m.msg.type === "occupancy.delta");
    // 40 changes, coalesced: far fewer frames than scans, and never faster than one per ~250 ms.
    expect(deltas.length).toBeLessThanOrEqual(Math.ceil((burstMs + 400) / 250) + 1);
    expect(deltas.length).toBeLessThan(40);
    // ≤ 4 Hz is a property of the server's flushes. Measure it there: client receive times compress
    // whenever the event loop is busy (it is, under PGlite), which says nothing about the send rate.
    const flushes = h.app.ctx.telemetry.flushTimes.filter((t) => t >= t0);
    expect(flushes.length).toBe(deltas.length);
    for (let i = 1; i < flushes.length; i++) expect(flushes[i]! - flushes[i - 1]!).toBeGreaterThanOrEqual(248); // timers may fire ~1 ms early
    for (const d of deltas) {
      if (d.msg.type !== "occupancy.delta") throw new Error();
      expect(d.msg.data.rooms.map((r) => r.room_id)).toEqual([h.seed.rooms.expo]);
    }
    c.ws.close();
  });

  it("replays exactly the missed deltas after last_event_id; an unknown cursor gets a snapshot", async () => {
    const t = await ticket(organiser.access_token);
    const c = await connect(t.body.protocols);
    await c.waitFor((m) => m.type === "occupancy.snapshot");
    const a = await addAttendee(h, "ORDINARY");
    await postScans(h, [scan(h, h.seed.checkpoints.boardroom, band(a.uid))], { deviceId: "r" });
    const seen = await c.waitFor((m) => m.type === "occupancy.delta");
    if (seen.type !== "occupancy.delta") throw new Error();
    c.ws.close();

    // While disconnected: two more changes, in two separate flush windows.
    const b = await addAttendee(h, "ORDINARY");
    await postScans(h, [scan(h, h.seed.checkpoints.press, band(b.uid))], { deviceId: "r" });
    await sleep(350);
    h.clock.advance(61_000);
    await postScans(h, [scan(h, h.seed.checkpoints.press, band(a.uid))], { deviceId: "r" });
    await sleep(350);

    const t2 = await ticket(organiser.access_token);
    const c2 = await connect(t2.body.protocols, { hello: { last_event_id: seen.id } });
    const ready = await c2.waitFor((m) => m.type === "ready");
    expect(ready).toMatchObject({ resumed: true });
    await sleep(100);
    const replayed = c2.messages.filter((m) => m.msg.type === "occupancy.delta").map((m) => m.msg);
    expect(replayed).toHaveLength(2);
    expect(c2.messages.some((m) => m.msg.type === "occupancy.snapshot")).toBe(false);
    const [seenBoot, seenSeq] = seen.id.split(".");
    expect(replayed.map((m) => (m as { id: string }).id)).toEqual([`${seenBoot}.${Number(seenSeq) + 1}`, `${seenBoot}.${Number(seenSeq) + 2}`]);
    c2.ws.close();

    const t3 = await ticket(organiser.access_token);
    const c3 = await connect(t3.body.protocols, { hello: { last_event_id: "otherboot.5" } });
    expect(await c3.waitFor((m) => m.type === "ready")).toMatchObject({ resumed: false });
    await c3.waitFor((m) => m.type === "occupancy.snapshot");
    c3.ws.close();
  });

  it("answers ping with pong, and closes on an invalid client message", async () => {
    const t = await ticket(organiser.access_token);
    const c = await connect(t.body.protocols);
    await c.waitFor((m) => m.type === "ready");
    c.ws.send(JSON.stringify({ type: "ping", t: 7 }));
    expect(await c.waitFor((m) => m.type === "pong")).toMatchObject({ t: 7 });
    const closed = new Promise<number>((r) => c.ws.on("close", (code) => r(code)));
    c.ws.send(JSON.stringify({ type: "subscribe_everything" }));
    expect(await closed).toBe(4400);
  });
});
