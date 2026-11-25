/**
 * Regression tests for the adversarial security review (backend-security-findings.md).
 * Each block reproduces the reviewer's probe and asserts the fixed behaviour. Runs on both backends.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { BreachAlert, PortalCodeBatch, ScanBatchResponse, ScanRecord, ScanSubmission, TokenPair, WsTicket } from "@synan/contracts/rest";
import { TelemetryServerMessage } from "@synan/contracts/ws";
import { loadConfig, parseTrustProxy } from "../src/config.js";
import { ScanService } from "../src/domain/scan-service.js";
import { TelemetryHub } from "../src/realtime/telemetry-hub.js";
import type { Mailer } from "../src/lib/mailer.js";
import { totp } from "../src/lib/crypto.js";
import { createApp } from "../src/app.js";
import { addAttendee, band, devEmail, errCode, mfaCode, postScans, qr, scan, startHarness, type Harness } from "./helpers.js";

const MIN = 60_000;
const H = 3600_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function attendeeToken(h: Harness, email: string) {
  await h.call("POST", "/auth/email-link", { body: { email } });
  const token = /#token=([A-Za-z0-9_-]+)/.exec(h.mailer.last("auth.link")!.text)![1]!;
  return (await h.call<TokenPair>("POST", "/auth/verify", { body: { token } })).body.access_token;
}
async function post(h: Harness, scans: ScanSubmission[], o: { token?: string; deviceId?: string; eventId?: string } = {}) {
  const r = await postScans<ScanBatchResponse>(h, scans, o);
  if (r.status !== 200) throw new Error(`scan failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}
async function alertsOf(h: Harness, kind?: string): Promise<BreachAlert[]> {
  const op = await h.login(h.seed.emails.organiser);
  const r = await h.call<{ items: BreachAlert[] }>("GET", `/breach-alerts?limit=500`, { token: op.access_token });
  return r.body.items.filter((a) => !kind || a.kind === kind);
}
async function counts(h: Harness) {
  const p = await h.app.ctx.scans.projection(h.seed.eventId);
  const r = h.seed.rooms;
  return { auditorium: p.count(r.auditorium), expo: p.count(r.expo), vip: p.count(r.vip), boardroom: p.count(r.boardroom) };
}
const zoneState = async (h: Harness, credentialId: string) => (await h.app.ctx.repos.credentials.byId(credentialId))!.zone_state;

/* ---------------------------------------------------------------------------------------------- */
describe("#1 scan time is bounded by server receipt time", () => {
  let h: Harness;
  beforeAll(async () => (h = await startHarness()));
  afterAll(async () => h.close());

  it("(a) an off-shift scanner cannot back-date an online scan into its old shift", async () => {
    const g2 = (await h.login(h.seed.emails.gate2)).access_token; // shift ended 3 h ago
    const a = await addAttendee(h, "ORDINARY");
    const backdated = await post(h, [scan(h, h.seed.checkpoints.mainIn, band(a.uid), { occurred_at: new Date(h.clock.now() - 4 * H).toISOString() })], { token: g2 });
    expect(backdated.results).toEqual([]);
    expect(backdated.rejected?.map((x) => x.code)).toEqual(["OUTSIDE_SHIFT"]);
    const viaOffset = await post(h, [scan(h, h.seed.checkpoints.mainIn, band(a.uid), { clock_offset_ms: -4 * H })], { token: g2 });
    expect(viaOffset.rejected?.map((x) => x.code)).toEqual(["OUTSIDE_SHIFT"]);
    expect(await zoneState(h, a.credentialId)).toBe("OUTSIDE");
  });

  it("(a') flipping the offline flag does not help: an offline sync must arrive within the grace after the shift", async () => {
    const g2 = (await h.login(h.seed.emails.gate2)).access_token;
    const a = await addAttendee(h, "ORDINARY");
    const r = await post(h, [scan(h, h.seed.checkpoints.mainIn, band(a.uid), {
      occurred_at: new Date(h.clock.now() - 4 * H).toISOString(), offline: true, local_result: "admitted",
    })], { token: g2 });
    expect(r.rejected?.[0]).toMatchObject({ code: "OUTSIDE_SHIFT", message: expect.stringMatching(/grace/) });
    expect(await zoneState(h, a.credentialId)).toBe("OUTSIDE");
  });

  it("(b) an expired portal QR is refused on an online scan even when occurred_at is back-dated into its window", async () => {
    const t = await attendeeToken(h, devEmail("vip"));
    const batch = (await h.call<PortalCodeBatch>("GET", "/me/credential/codes", { token: t })).body;
    const old = batch.codes[0]!;
    h.clock.set(Date.parse(old.expires_at) + H);
    const before = (await alertsOf(h, "invalid_qr")).length;
    const r = await post(h, [scan(h, h.seed.checkpoints.eastIn, qr(old.code), { occurred_at: new Date(Date.parse(old.not_before) + 1000).toISOString() })]);
    expect(r.results[0]!.result).toBe("unknown_token");
    expect(Date.parse(r.results[0]!.corrected_at)).toBe(h.clock.now()); // judged at receipt
    expect((await alertsOf(h, "invalid_qr")).length).toBe(before + 1);
    // A code from later in the batch cannot be used early by forward-dating either.
    const future = batch.codes[batch.codes.length - 1]!;
    h.clock.set(Date.parse(batch.codes[0]!.not_before) + 1000);
    const early = await post(h, [scan(h, h.seed.checkpoints.eastIn, qr(future.code), { occurred_at: new Date(Date.parse(future.not_before) + 1000).toISOString() })]);
    expect(early.results[0]!.result).toBe("unknown_token");
  });

  it("(c) a future-dated scan does not freeze the holder's later movements", async () => {
    h.clock.advance(2 * MIN);
    const a = await addAttendee(h, "ORDINARY");
    const c0 = await counts(h);
    const fwd = await post(h, [scan(h, h.seed.checkpoints.expo, band(a.uid), { occurred_at: new Date(h.clock.now() + 5 * H).toISOString() })]);
    expect(fwd.results[0]!.result).toBe("admitted");
    expect(Date.parse(fwd.results[0]!.corrected_at)).toBe(h.clock.now());
    h.clock.advance(2 * MIN);
    const into = await post(h, [scan(h, h.seed.checkpoints.auditorium, band(a.uid), { direction: "in" })]);
    expect(into.results[0]!.result).toBe("admitted");
    const c1 = await counts(h);
    expect(c1.auditorium).toBe(c0.auditorium + 1);
    expect(c1.expo).toBe(c0.expo); // implied exit happened: presence was not frozen
    // Offline future-dated: clamped to receipt, clock_skew raised, still not frozen.
    const b = await addAttendee(h, "ORDINARY");
    const skewBefore = (await alertsOf(h, "clock_skew")).length;
    const off = await post(h, [scan(h, h.seed.checkpoints.mainIn, band(b.uid), {
      occurred_at: new Date(h.clock.now() + 3 * H).toISOString(), offline: true, local_result: "admitted",
    })], { deviceId: "future-device" });
    expect(Date.parse(off.results[0]!.corrected_at)).toBe(h.clock.now());
    expect((await alertsOf(h, "clock_skew")).length).toBe(skewBefore + 1);
    h.clock.advance(2 * MIN);
    await post(h, [scan(h, h.seed.checkpoints.mainOut, band(b.uid))]);
    expect(await zoneState(h, b.credentialId)).toBe("OUTSIDE");
  });

  it("(d) alerts are stamped with server time, not the scan's claimed time", async () => {
    const a = await addAttendee(h, "PUBLIC");
    const r = await post(h, [scan(h, h.seed.checkpoints.vip, band(a.uid), {
      occurred_at: new Date(h.clock.now() - 20 * MIN).toISOString(), offline: true, local_result: "denied_room",
    })]);
    const alert = (await alertsOf(h)).find((x) => r.results[0]!.alert_ids.includes(x.id))!;
    expect(Date.parse(alert.occurred_at)).toBe(h.clock.now());
  });

  it("(e) a device clock a day or more out is rejected for that item; a stored scan still replays", async () => {
    const a = await addAttendee(h, "ORDINARY");
    const r = await post(h, [scan(h, h.seed.checkpoints.expo, band(a.uid), { occurred_at: new Date(h.clock.now() - 30 * H).toISOString() })]);
    expect(r.rejected?.map((x) => x.code)).toEqual(["VALIDATION_FAILED"]);
    const s = scan(h, h.seed.checkpoints.boardroom, band(a.uid));
    const first = await post(h, [s]);
    h.clock.advance(30 * MIN);
    const again = await post(h, [s]); // a late replay of an online scan returns the original outcome
    expect(again.results[0]).toMatchObject({ scan_id: first.results[0]!.scan_id, replayed: true });
  });
});

/* ---------------------------------------------------------------------------------------------- */
describe("#10 one bad item never blocks a batch; #1 offline sync grace", () => {
  let h: Harness;
  beforeAll(async () => (h = await startHarness()));
  afterAll(async () => h.close());

  it("a mixed offline batch applies the valid scans, rejects only the late one, and retries do not flood alerts", async () => {
    const shiftEnd = h.clock.now() + 10 * H; // gate-expo's shift
    h.clock.set(shiftEnd + 10 * MIN); // syncing after the shift, inside the 1 h grace
    const people = await Promise.all([1, 2, 3].map(() => addAttendee(h, "ORDINARY")));
    const batch = [
      scan(h, h.seed.checkpoints.expo, band(people[0]!.uid), { occurred_at: new Date(shiftEnd - 5 * MIN).toISOString(), offline: true, local_result: "admitted" }),
      scan(h, h.seed.checkpoints.expo, band(people[1]!.uid), { occurred_at: new Date(shiftEnd - 4 * MIN).toISOString(), offline: true, local_result: "admitted" }),
      scan(h, h.seed.checkpoints.expo, band(people[2]!.uid), { occurred_at: new Date(shiftEnd + 2_000).toISOString(), offline: true, local_result: "admitted" }),
    ];
    const rogueBefore = (await alertsOf(h, "rogue_scanner")).length;
    const r1 = await post(h, batch, { deviceId: "expo-1" });
    expect(r1.results.map((x) => x.result)).toEqual(["admitted", "admitted"]);
    expect(r1.rejected).toEqual([{ idem_key: batch[2]!.idem_key, code: "OUTSIDE_SHIFT", message: expect.any(String) }]);
    const r2 = await post(h, batch, { deviceId: "expo-1" });
    expect(r2.results.every((x) => x.replayed)).toBe(true);
    expect(r2.rejected?.map((x) => x.idem_key)).toEqual([batch[2]!.idem_key]);
    expect((await alertsOf(h, "rogue_scanner")).length).toBe(rogueBefore + 1); // one alert, not one per retry
  });

  it("after the grace period the same shift's offline scans are refused", async () => {
    h.clock.advance(2 * H);
    const a = await addAttendee(h, "ORDINARY");
    const r = await post(h, [scan(h, h.seed.checkpoints.expo, band(a.uid), {
      occurred_at: new Date(h.clock.now() - 2 * H - 20 * MIN).toISOString(), offline: true, local_result: "admitted",
    })], { deviceId: "expo-2" });
    expect(r.rejected?.map((x) => x.code)).toEqual(["OUTSIDE_SHIFT"]);
  });
});

/* ---------------------------------------------------------------------------------------------- */
describe("#2 perimeter anti-passback survives an interior admission in another zone; #15 pass-back detection", () => {
  let h: Harness;
  beforeAll(async () => (h = await startHarness()));
  afterAll(async () => h.close());

  it("Main Entrance → Boardroom (Level 1) → Main Entrance again is already_inside", async () => {
    const a = await addAttendee(h, "ORDINARY");
    await post(h, [scan(h, h.seed.checkpoints.mainIn, band(a.uid))]);
    h.clock.advance(2 * MIN);
    await post(h, [scan(h, h.seed.checkpoints.boardroom, band(a.uid))]);
    expect(await zoneState(h, a.credentialId)).toBe(`INSIDE_${h.seed.zones.ground}`); // perimeter state persisted
    h.clock.advance(2 * MIN);
    const again = await post(h, [scan(h, h.seed.checkpoints.mainIn, band(a.uid))]);
    expect(again.results[0]!.result).toBe("already_inside");
  });

  it("the offline variant at East Entrance raises offline_conflict_passback and suspends", async () => {
    const a = await addAttendee(h, "ORDINARY");
    const entry = await post(h, [scan(h, h.seed.checkpoints.mainIn, band(a.uid))]);
    h.clock.advance(2 * MIN);
    await post(h, [scan(h, h.seed.checkpoints.press, band(a.uid))]); // interior room in Level 1
    h.clock.advance(2 * MIN);
    const r = await post(h, [scan(h, h.seed.checkpoints.eastIn, band(a.uid), { offline: true, local_result: "admitted" })]);
    expect(r.results[0]!.result).toBe("already_inside");
    const alert = (await alertsOf(h, "offline_conflict_passback")).find((x) => r.results[0]!.alert_ids.includes(x.id));
    expect(alert).toBeDefined();
    // #15: the alert names the entry it conflicts with as well as the syncing scan.
    expect(alert!.scan_ids).toEqual(expect.arrayContaining([entry.results[0]!.scan_id, r.results[0]!.scan_id]));
    expect((await h.app.ctx.repos.credentials.byId(a.credentialId))!.state).toBe("suspended_review");
  });

  it("#15 pass-back at a gate the holder used earlier in the day is still detected", async () => {
    const a = await addAttendee(h, "ORDINARY");
    await post(h, [scan(h, h.seed.checkpoints.mainIn, band(a.uid))]);
    h.clock.advance(2 * MIN);
    await post(h, [scan(h, h.seed.checkpoints.mainOut, band(a.uid))]);
    h.clock.advance(2 * MIN);
    const east = await post(h, [scan(h, h.seed.checkpoints.eastIn, band(a.uid))]);
    h.clock.advance(2 * MIN);
    const r = await post(h, [scan(h, h.seed.checkpoints.mainIn, band(a.uid), { offline: true, local_result: "admitted" })]);
    expect(r.results[0]!.result).toBe("already_inside");
    const alert = (await alertsOf(h, "offline_conflict_passback")).find((x) => r.results[0]!.alert_ids.includes(x.id));
    expect(alert?.scan_ids).toEqual(expect.arrayContaining([east.results[0]!.scan_id, r.results[0]!.scan_id]));
    expect((await h.app.ctx.repos.credentials.byId(a.credentialId))!.state).toBe("suspended_review");
  });

  it("#15 an emailed-QR reuse alert names the scan that first redeemed it", async () => {
    const a = await addAttendee(h, "ORDINARY");
    const { code } = await h.app.ctx.credentials.sendEmailedQr(a.credentialId);
    const t = h.clock.now();
    const first = await post(h, [scan(h, h.seed.checkpoints.mainIn, qr(code), { occurred_at: new Date(t - 2 * MIN).toISOString(), offline: true, local_result: "admitted" })], { deviceId: "m" });
    const second = await post(h, [scan(h, h.seed.checkpoints.eastIn, qr(code), { occurred_at: new Date(t - MIN).toISOString(), offline: true, local_result: "admitted" })], { deviceId: "e" });
    const alert = (await alertsOf(h, "offline_conflict_pass_reuse")).find((x) => second.results[0]!.alert_ids.includes(x.id));
    expect(alert?.scan_ids).toEqual(expect.arrayContaining([first.results[0]!.scan_id, second.results[0]!.scan_id]));
  });
});

/* ---------------------------------------------------------------------------------------------- */
describe("#3 gate staff see and ack alerts only at their own checkpoints, now", () => {
  let h: Harness;
  beforeAll(async () => (h = await startHarness()));
  afterAll(async () => h.close());

  it("scopes the list and redacts the person link", async () => {
    const pub = await addAttendee(h, "PUBLIC");
    await post(h, [scan(h, h.seed.checkpoints.vip, band(pub.uid))]); // unauthorised_tier at VIP door
    const vipGate = await h.gateToken(h.seed.checkpoints.vip);
    const mainGate = await h.gateToken(h.seed.checkpoints.mainIn);
    const op = (await h.login(h.seed.emails.organiser)).access_token;
    const all = (await h.call<{ items: BreachAlert[] }>("GET", "/breach-alerts", { token: op })).body.items;
    expect(all.some((a) => a.checkpoint_id === h.seed.checkpoints.vip && a.credential_id !== null)).toBe(true);
    const mine = (await h.call<{ items: BreachAlert[] }>("GET", "/breach-alerts", { token: vipGate })).body.items;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((a) => a.checkpoint_id === h.seed.checkpoints.vip && a.credential_id === null && a.scan_ids.length === 0)).toBe(true);
    const other = (await h.call<{ items: BreachAlert[] }>("GET", "/breach-alerts", { token: mainGate })).body.items;
    expect(other.some((a) => a.checkpoint_id === h.seed.checkpoints.vip)).toBe(false);
    // Off-shift staff see nothing.
    const g2 = (await h.login(h.seed.emails.gate2)).access_token;
    expect((await h.call<{ items: BreachAlert[] }>("GET", "/breach-alerts", { token: g2 })).body.items).toEqual([]);
  });
});

/* ---------------------------------------------------------------------------------------------- */
describe("#4 public telemetry and on_site reveal nothing below k", () => {
  let h: Harness;
  beforeAll(async () => (h = await startHarness()));
  afterAll(async () => h.close());

  function connect(protocols: string[], hello: Record<string, unknown> = {}) {
    return new Promise<{ ws: WebSocket; msgs: ReturnType<typeof TelemetryServerMessage.parse>[] }>((resolve, reject) => {
      const ws = new WebSocket(h.base.replace("http", "ws") + "/stream/telemetry", protocols);
      const msgs: ReturnType<typeof TelemetryServerMessage.parse>[] = [];
      ws.on("message", (raw) => msgs.push(TelemetryServerMessage.parse(JSON.parse(String(raw)))));
      ws.on("error", reject);
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "hello", ...hello }));
        resolve({ ws, msgs });
      });
    });
  }
  const ticket = async (token: string) =>
    (await h.call<WsTicket>("POST", "/auth/ws-ticket", { token, body: { channel: "/stream/telemetry", event_id: h.seed.eventId } })).body.protocols;

  it("a sub-k change produces no public frame (the full scope still gets it), and public never replays", async () => {
    const att = await attendeeToken(h, devEmail("vip"));
    const op = (await h.login(h.seed.emails.organiser)).access_token;
    const pub = await connect(await ticket(att));
    const full = await connect(await ticket(op));
    await sleep(150);
    const a = await addAttendee(h, "ORDINARY");
    await post(h, [scan(h, h.seed.checkpoints.mainIn, band(a.uid))]);
    h.clock.advance(2 * MIN);
    await post(h, [scan(h, h.seed.checkpoints.boardroom, band(a.uid))]);
    await sleep(700);
    expect(full.msgs.filter((m) => m.type === "occupancy.delta").length).toBeGreaterThan(0);
    expect(pub.msgs.filter((m) => m.type === "occupancy.delta")).toEqual([]);
    const snap = pub.msgs.find((m) => m.type === "occupancy.snapshot")!;
    const boot = (snap as { id: string }).id.split(".")[0];
    pub.ws.close();
    full.ws.close();
    const again = await connect(await ticket(att), { last_event_id: `${boot}.0` });
    await sleep(150);
    expect(again.msgs.find((m) => m.type === "ready")).toMatchObject({ resumed: false });
    expect(again.msgs.some((m) => m.type === "occupancy.delta")).toBe(false);
    again.ws.close();
  });

  it("a suppressed room shows level ok, not block, in the public view", async () => {
    // Fill the Boardroom (capacity 3): below k, so the public view must not say it is full.
    for (let i = 0; i < 3; i++) {
      const p = await addAttendee(h, "ORDINARY");
      await post(h, [scan(h, h.seed.checkpoints.boardroom, band(p.uid))]);
    }
    const pubSnap = h.app.ctx.telemetry.snapshot(h.seed.eventId, "public");
    const fullSnap = h.app.ctx.telemetry.snapshot(h.seed.eventId, "full");
    if (pubSnap.type !== "occupancy.snapshot" || fullSnap.type !== "occupancy.snapshot") throw new Error();
    expect(fullSnap.data.rooms.find((r) => r.room_id === h.seed.rooms.boardroom)!.level).toBe("block");
    expect(pubSnap.data.rooms.find((r) => r.room_id === h.seed.rooms.boardroom)).toMatchObject({ occupancy: null, level: "ok" });
  });

  it("no public frame or sequence of frames lets a suppressed room's count be derived from the totals", async () => {
    type Frame = { type: string; data: { rooms: { room_id: string; occupancy: number | null }[]; zones: { zone_id: string; occupancy: number | null }[]; totals?: { on_site: number | null; in_rooms: number | null } } };
    const frames: Frame[] = [];
    const sub = h.app.ctx.telemetry.subscribe(h.seed.eventId, "public", (m) => frames.push(m as unknown as Frame));
    for (const m of sub.catchUp) frames.push(m as unknown as Frame);
    try {
      // Enough people in the Auditorium to be shown; two in the Expo Hall (same zone), below k.
      for (let i = 0; i < 6; i++) {
        const p = await addAttendee(h, "VIP");
        await post(h, [scan(h, h.seed.checkpoints.auditorium, band(p.uid), { direction: "in" })], { deviceId: `aud${i}` });
      }
      for (let i = 0; i < 2; i++) {
        const p = await addAttendee(h, "VIP");
        await post(h, [scan(h, h.seed.checkpoints.expo, band(p.uid))], { deviceId: `expo${i}` });
      }
      await sleep(400);
      const full = h.app.ctx.telemetry.snapshot(h.seed.eventId, "full");
      if (full.type !== "occupancy.snapshot") throw new Error();
      const press = full.data.rooms.find((r) => r.room_id === h.seed.rooms.expo)!.occupancy!;
      expect(press).toBeGreaterThan(0);
      expect(press).toBeLessThan(h.app.ctx.config.kAnon);
      // Replay the public stream as a viewer would and check every state it ever showed.
      const rooms = new Map<string, number | null>();
      const zones = new Map<string, number | null>();
      const shown = (m: Map<string, number | null>) => [...m.values()].reduce<number>((n, v) => n + (v ?? 0), 0);
      for (const f of [...frames, h.app.ctx.telemetry.snapshot(h.seed.eventId, "public") as unknown as Frame]) {
        if (f.type === "occupancy.snapshot") (rooms.clear(), zones.clear());
        for (const r of f.data.rooms) rooms.set(r.room_id, r.occupancy);
        for (const z of f.data.zones) zones.set(z.zone_id, z.occupancy);
        if (!f.data.totals) continue;
        // A total is either hidden or exactly the sum of what is shown: it adds nothing to subtract.
        if (f.data.totals.in_rooms !== null) expect(f.data.totals.in_rooms).toBe(shown(rooms));
        if (f.data.totals.on_site !== null) expect(f.data.totals.on_site).toBe(shown(zones));
        expect(rooms.get(h.seed.rooms.expo) ?? null).toBeNull();
      }
    } finally {
      sub.unsubscribe();
    }
  });

  it("on_site minus the visible public zones is never a suppressed count", async () => {
    for (let i = 0; i < 6; i++) {
      const p = await addAttendee(h, "ORDINARY");
      await post(h, [scan(h, h.seed.checkpoints.mainIn, band(p.uid))], { deviceId: `g${i}` });
    }
    const e = (await h.call<{ items: { slug: string; on_site: number | null }[] }>("GET", "/events")).body.items.find((x) => x.slug === h.seed.eventSlug)!;
    const snap = h.app.ctx.telemetry.snapshot(h.seed.eventId, "public");
    if (snap.type !== "occupancy.snapshot") throw new Error();
    const visible = snap.data.zones.reduce((s, z) => s + (z.occupancy ?? 0), 0);
    expect(e.on_site).toBe(visible === 0 ? null : visible);
    // The upper zone holds the Boardroom's 3 (and 1 from the first test): suppressed, and not recoverable.
    expect(snap.data.zones.find((z) => z.zone_id === h.seed.zones.upper)!.occupancy).toBeNull();
  });
});

/* ---------------------------------------------------------------------------------------------- */
describe("#5 TRUST_PROXY never trusts a client-supplied X-Forwarded-For chain", () => {
  it("parses hop counts and address lists, and refuses 'true'", () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy("0")).toBe(false);
    expect(parseTrustProxy("1")).toBe(1);
    expect(parseTrustProxy("10.0.0.0/8, 127.0.0.1")).toEqual(["10.0.0.0/8", "127.0.0.1"]);
    expect(() => parseTrustProxy("true")).toThrow();
    expect(() => parseTrustProxy("everyone")).toThrow();
  });

  it("with one trusted hop, forged leftmost entries share the proxy-seen address's bucket", async () => {
    const h = await startHarness({ config: { trustProxy: 1, rateLimits: { authPerMin: 3, scanPerMin: 100, resendPerHour: 5 } } });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await h.call("POST", "/auth/login", {
          body: { email: `x${i}@example.com`, password: "nope" },
          headers: { "x-forwarded-for": `198.51.100.${i}, 203.0.113.5` },
        });
        statuses.push(r.status);
      }
      expect(statuses).toEqual([401, 401, 401, 429, 429]);
    } finally {
      await h.close();
    }
  });
});

/* ---------------------------------------------------------------------------------------------- */
describe("#6 MFA codes: per-account failure limit, replay guard by time-step", () => {
  let h: Harness;
  beforeAll(async () => (h = await startHarness()));
  afterAll(async () => h.close());

  it("A accepted, B accepted, A again refused", async () => {
    let tok = (await h.login(h.seed.emails.admin)).access_token;
    const A = mfaCode(h);
    const r1 = await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: tok, body: { code: A } });
    expect(r1.status).toBe(200);
    tok = r1.body.access_token;
    h.clock.advance(30_000);
    const B = mfaCode(h);
    expect(B).not.toBe(A);
    const r2 = await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: tok, body: { code: B } });
    expect(r2.status).toBe(200);
    const r3 = await h.call("POST", "/auth/mfa/verify", { token: r2.body.access_token, body: { code: A } });
    expect(errCode(r3.body)).toBe("INVALID_MFA_CODE");
  });

  it("5 wrong codes lock the account's MFA for 15 minutes, even with the right code next and from fresh tokens", async () => {
    h.clock.advance(16 * MIN); // the replay in the previous test counted as one failure; start a fresh window
    const secret = h.seed.adminMfaSecret;
    const wrong = (n: number) => String((Number(totp(secret, h.clock.now())) + 1 + n) % 1_000_000).padStart(6, "0");
    for (let i = 0; i < 5; i++) {
      const tok = (await h.login(h.seed.emails.admin)).access_token;
      expect(errCode((await h.call("POST", "/auth/mfa/verify", { token: tok, body: { code: wrong(i * 7919) } })).body)).toBe("INVALID_MFA_CODE");
    }
    const tok = (await h.login(h.seed.emails.admin)).access_token;
    expect(errCode((await h.call("POST", "/auth/mfa/verify", { token: tok, body: { code: mfaCode(h) } })).body)).toBe("RATE_LIMITED");
    h.clock.advance(16 * MIN);
    const tok2 = (await h.login(h.seed.emails.admin)).access_token;
    expect((await h.call("POST", "/auth/mfa/verify", { token: tok2, body: { code: mfaCode(h) } })).status).toBe(200);
  });
});

/* ---------------------------------------------------------------------------------------------- */
describe("#7 anonymous traffic cannot exhaust the buckets signed-in users depend on", () => {
  it("1,200 tokenless scan posts from the venue address do not block an on-shift scanner there", async () => {
    const h = await startHarness({ config: { rateLimits: { authPerMin: 3, scanPerMin: 2, resendPerHour: 5 } } });
    try {
      const statuses = new Set<number>();
      for (let i = 0; i < 8; i++) statuses.add((await h.call("POST", "/scans", { body: {} })).status);
      expect([...statuses].sort()).toEqual([401, 429]); // anonymous traffic is limited per address...
      const a = await addAttendee(h, "ORDINARY");
      const ok = await postScans(h, [scan(h, h.seed.checkpoints.mainIn, band(a.uid))]);
      expect(ok.status).toBe(200); // ...but the signed-in scanner is limited per token, not per address
      // Successful sign-ins do not consume the address's auth bucket either.
      for (let i = 0; i < 6; i++) expect((await h.call("POST", "/auth/login", { body: { email: h.seed.emails.organiser, password: h.seed.password } })).status).toBe(200);
    } finally {
      await h.close();
    }
  });
});

/* ---------------------------------------------------------------------------------------------- */
describe("#8 a manual recount is an anchor", () => {
  let h: Harness;
  beforeAll(async () => (h = await startHarness()));
  afterAll(async () => h.close());
  const recount = async (roomId: string, count: number, eventId = h.seed.eventId) => {
    const op = (await h.login(h.seed.emails.organiser)).access_token;
    return h.call<{ occupancy: number }>("POST", `/rooms/${roomId}/recount`, { token: op, body: { event_id: eventId, count } });
  };
  const rebuilt = async () => {
    const c = h.app.ctx;
    const fresh = new ScanService(c.repos, c.qr, c.alerts, c.audit, new TelemetryHub(c.clock, { kAnon: 5 }), c.clock);
    const p = await fresh.projection(h.seed.eventId);
    return { boardroom: p.count(h.seed.rooms.boardroom), vip: p.count(h.seed.rooms.vip) };
  };

  it("a late offline scan from before the recount is not counted again, raises no conflict, and live equals rebuilt", async () => {
    await recount(h.seed.rooms.boardroom, 3);
    h.clock.advance(5 * MIN);
    const a = await addAttendee(h, "ORDINARY");
    const before = (await alertsOf(h, "offline_conflict_capacity")).length;
    const r = await post(h, [scan(h, h.seed.checkpoints.boardroom, band(a.uid), {
      occurred_at: new Date(h.clock.now() - 15 * MIN).toISOString(), offline: true, local_result: "admitted",
    })]);
    expect(r.results[0]!.result).toBe("admitted");
    expect((await counts(h)).boardroom).toBe(3);
    expect((await alertsOf(h, "offline_conflict_capacity")).length).toBe(before);
    expect((await rebuilt()).boardroom).toBe(3);
  });

  it("a recount to zero un-counts everyone: a re-tap counts again, and a later move does not under-count", async () => {
    const A = await addAttendee(h, "VIP");
    const B = await addAttendee(h, "VIP");
    await post(h, [scan(h, h.seed.checkpoints.vip, band(A.uid))]);
    expect((await counts(h)).vip).toBe(1);
    h.clock.advance(MIN);
    await recount(h.seed.rooms.vip, 0);
    h.clock.advance(2 * MIN);
    expect((await post(h, [scan(h, h.seed.checkpoints.vip, band(A.uid))])).results[0]!.result).toBe("admitted");
    expect((await counts(h)).vip).toBe(1);
    await post(h, [scan(h, h.seed.checkpoints.vip, band(B.uid))]);
    expect((await counts(h)).vip).toBe(2);
    h.clock.advance(6 * MIN); // VIP door → Expo: no transit rule
    const faults = (await alertsOf(h, "reconciliation_fault")).length;
    await post(h, [scan(h, h.seed.checkpoints.expo, band(A.uid))]);
    expect((await counts(h)).vip).toBe(1); // B is still inside
    expect((await alertsOf(h, "reconciliation_fault")).length).toBe(faults);
    expect((await rebuilt()).vip).toBe(1);
  });
});

/* ---------------------------------------------------------------------------------------------- */
describe("#9 ids are canonical: a case-variant event id is the same event, and the same lock", () => {
  let h: Harness;
  beforeAll(async () => (h = await startHarness()));
  afterAll(async () => h.close());

  it("concurrent batches under canonical, upper and mixed-case ids are serialised (capacity holds)", async () => {
    const warm = await Promise.all([1, 2].map(() => addAttendee(h, "ORDINARY")));
    for (const p of warm) await post(h, [scan(h, h.seed.checkpoints.boardroom, band(p.uid))]);
    const people = await Promise.all([1, 2, 3].map(() => addAttendee(h, "ORDINARY")));
    const id = h.seed.eventId;
    const mixed = [...id].map((c, i) => (i % 2 ? c.toUpperCase() : c)).join("");
    const out = await Promise.all(
      [id, id.toUpperCase(), mixed].map((eventId, i) => post(h, [scan(h, h.seed.checkpoints.boardroom, band(people[i]!.uid))], { eventId, deviceId: `c${i}` })),
    );
    expect(out.map((o) => o.results[0]!.result).sort()).toEqual(["admitted", "capacity_block", "capacity_block"]);
    expect((await counts(h)).boardroom).toBe(3);
  });

  it("a recount sent with an upper-cased event id reaches the live projection", async () => {
    const op = (await h.login(h.seed.emails.organiser)).access_token;
    const r = await h.call("POST", `/rooms/${h.seed.rooms.boardroom.toUpperCase()}/recount`, {
      token: op, body: { event_id: h.seed.eventId.toUpperCase(), count: 1 },
    });
    expect(r.status).toBe(200);
    expect((await counts(h)).boardroom).toBe(1);
  });
});

/* ---------------------------------------------------------------------------------------------- */
describe("#11 per-person movement history only through the audited lookup", () => {
  let h: Harness;
  beforeAll(async () => (h = await startHarness()));
  afterAll(async () => h.close());

  it("GET /scans carries no stable per-person id; GET /credentials/:id/scans does, and is audited", async () => {
    const a = await addAttendee(h, "ORDINARY");
    await post(h, [scan(h, h.seed.checkpoints.mainIn, band(a.uid))]);
    h.clock.advance(2 * MIN);
    await post(h, [scan(h, h.seed.checkpoints.expo, band(a.uid))]);
    const op = (await h.login(h.seed.emails.organiser)).access_token;
    const list = (await h.call<{ items: ScanRecord[] }>("GET", `/scans?event_id=${h.seed.eventId}`, { token: op })).body.items;
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.every((s) => s.ephemeral_id === null)).toBe(true);

    const auditBefore = (await h.app.ctx.repos.audit.all()).length;
    const hist = await h.call<{ items: ScanRecord[] }>("GET", `/credentials/${a.credentialId}/scans`, { token: op });
    expect(hist.status).toBe(200);
    expect(hist.body.items.map((s) => s.checkpoint_id).sort()).toEqual([h.seed.checkpoints.expo, h.seed.checkpoints.mainIn].sort());
    expect(new Set(hist.body.items.map((s) => s.ephemeral_id)).size).toBe(1);
    const audit = await h.app.ctx.repos.audit.all();
    expect(audit.length).toBe(auditBefore + 1);
    expect(audit.at(-1)).toMatchObject({ action: "credential.access_history", target: `credential:${a.credentialId}` });
    // Not for gate staff.
    expect((await h.call("GET", `/credentials/${a.credentialId}/scans`, { token: await h.gateToken(h.seed.checkpoints.mainIn) })).status).toBe(403);
  });
});

/* ---------------------------------------------------------------------------------------------- */
describe("#12 email-link answers the same whatever the mail provider does", () => {
  it("a failing or hanging provider still yields 202, promptly, for a known address", async () => {
    let calls = 0;
    const hanging: Mailer = { send: () => { calls++; return new Promise(() => {}); } };
    const failing: Mailer = { send: async () => { calls++; throw new Error("provider down"); } };
    for (const mailer of [hanging, failing]) {
      // The request path never touches the provider: the outbox job does, later (and times out a hanging one).
      const h = await startHarness({ mailer, autoDrainMail: false, config: { mailSendTimeoutMs: 100 } });
      const start = calls;
      try {
        const t0 = Date.now();
        const known = await h.call("POST", "/auth/email-link", { body: { email: devEmail("vip") } });
        const unknown = await h.call("POST", "/auth/email-link", { body: { email: "nobody@example.com" } });
        expect([known.status, unknown.status]).toEqual([202, 202]);
        expect(known.body).toEqual(unknown.body);
        expect(Date.now() - t0).toBeLessThan(2_000);
        await h.drainMail();
        expect(calls).toBeGreaterThan(start); // the known address reached the provider (and is retried while it fails)
      } finally {
        await h.close();
      }
    }
    expect(calls).toBeGreaterThanOrEqual(2); // the known address did trigger a send each time (retries may add more)
  });
});

/* ---------------------------------------------------------------------------------------------- */
describe("#13 / #14 configuration fails closed", () => {
  it("seeding is opt-in", () => {
    expect(loadConfig({}, []).seed).toBe("none");
    expect(loadConfig({ SEED: "dev" }, []).seed).toBe("dev");
    expect(loadConfig({}, ["--seed=dev"]).seed).toBe("dev");
    expect(loadConfig({ SEED: "yes please" }, []).seed).toBe("none");
  });

  it("production refuses the dev seed, the console mailer, and missing keys", () => {
    const prod = {
      NODE_ENV: "production", ACCESS_TOKEN_PRIVATE_JWK: "{}", MAIL_TRANSPORT: "memory", REPO: "postgres",
      DATABASE_URL: "postgres://api@db/app", DATABASE_VAULT_URL: "postgres://vault@db/app", DATABASE_SCAN_URL: "postgres://scan@db/app",
      DB_DATA_KEYS: "k1:AAAA", DB_BLIND_INDEX_KEYS: "bi1:AAAA",
      ADMIN_APP_URL: "https://ops.example.test/admin", SCANNER_APP_URL: "https://ops.example.test/scan", ATTENDEE_APP_ORIGIN: "https://example.test",
      API_PUBLIC_ORIGIN: "https://api.example.test", ALLOWED_ORIGINS: "https://example.test,https://ops.example.test",
    };
    expect(() => loadConfig(prod, [])).not.toThrow();
    expect(() => loadConfig({ ...prod, SEED: "dev" }, [])).toThrow(/SEED/);
    expect(() => loadConfig({ ...prod, MAIL_TRANSPORT: "console" }, [])).toThrow(/MAIL_TRANSPORT/);
    // Step D: production runs only on PostgreSQL with separated roles and real data keys.
    expect(() => loadConfig({ ...prod, REPO: "pglite" }, [])).toThrow(/REPO=postgres/);
    for (const k of ["DATABASE_VAULT_URL", "DATABASE_SCAN_URL", "DB_DATA_KEYS", "DB_BLIND_INDEX_KEYS"]) {
      expect(() => loadConfig({ ...prod, [k]: "" }, [])).toThrow(new RegExp(k));
    }
  });

  it("a malformed or out-of-range QR leeway stops startup", async () => {
    expect(() => loadConfig({ QR_LEEWAY_S: "5s" }, [])).toThrow(/QR_LEEWAY_S/);
    expect(() => loadConfig({ QR_LEEWAY_S: "1000000000000" }, [])).toThrow(/QR_LEEWAY_S/);
    expect(() => loadConfig({ QR_CODE_TTL_S: "70000" }, [])).toThrow(/QR_CODE_TTL_S/);
    await expect(createApp({ seed: false, config: { qrLeewayS: Number.NaN } })).rejects.toThrow(/QR_LEEWAY_S/);
  });

  it("the QR window check itself fails closed on a non-finite leeway", async () => {
    const h = await startHarness();
    try {
      const t = await attendeeToken(h, devEmail("vip"));
      const batch = (await h.call<PortalCodeBatch>("GET", "/me/credential/codes", { token: t })).body;
      const { QrService } = await import("../src/domain/qr.js");
      const broken = new QrService(h.app.ctx.keys, { codeTtlS: 60, leewayS: Number.NaN });
      const old = batch.codes[0]!;
      expect(await broken.verify(old.code, Date.parse(old.expires_at) + 30 * 86400_000)).toMatchObject({ ok: false });
      const last = batch.codes.at(-1)!;
      expect(await broken.verify(last.code, h.clock.now())).toMatchObject({ ok: false });
    } finally {
      await h.close();
    }
  });
});
