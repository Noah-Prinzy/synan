/**
 * Rogue scanner connections (03 §8.2): a refused device token, access token, stream ticket, retired
 * device or assignment mismatch raises one `rogue_scanner` alert per source and reason per window
 * (however often it retries), audited, with no token or address in the alert text.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { WS_SUBPROTOCOL, WS_TICKET_PREFIX, type TokenPair } from "@synan/contracts/rest";
import { ROGUE_CONNECTION_WINDOW_MS, ScannerTrust } from "../src/domain/scanner-trust.js";
import { errCode, mfaCode, startHarness, type Harness } from "./helpers.js";

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h.close());

const adminToken = async () => {
  const t = (await h.login(h.seed.emails.admin)).access_token;
  return (await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: t, body: { code: mfaCode(h) } })).body.access_token;
};
const rogue = async (match: RegExp) =>
  (await h.app.ctx.repos.alerts.list({ eventId: h.seed.eventId, limit: 1000 })).filter((a) => a.kind === "rogue_scanner" && match.test(a.detail));
const refusals = async () => (await h.app.ctx.repos.audit.all()).filter((a) => a.action === "security.scanner_refused");

describe("rogue scanner connections (03 §8.2)", () => {
  it("an unknown device token: a retry storm raises one alert and one audit entry, with no token anywhere", async () => {
    const junk = "J".repeat(43);
    const audited = (await refusals()).length;
    for (let i = 0; i < 6; i++) {
      expect(errCode((await h.call("POST", "/auth/device-token", { body: { device_token: junk } })).body)).toBe("INVALID_CREDENTIALS");
    }
    const alerts = await rogue(/unknown or revoked device token/);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.severity).toBe("high");
    expect(alerts[0]!.detail).not.toContain(junk);
    expect(alerts[0]!.detail).not.toMatch(/127\.0\.0\.1|::1/); // no address in the alert
    const entries = (await refusals()).slice(audited);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.meta_jsonb).toMatchObject({ reason: "unknown_device_token", alert_ids: [alerts[0]!.id] });
    expect(JSON.stringify(entries[0])).not.toContain(junk);

    // After the window, the same source alerts again.
    h.clock.advance(ROGUE_CONNECTION_WINDOW_MS);
    await h.call("POST", "/auth/device-token", { body: { device_token: junk } });
    expect(await rogue(/unknown or revoked device token/)).toHaveLength(2);
  });

  it("a retired device's heartbeat and scans are refused and alerted once, at its checkpoint", async () => {
    const adminMfa = await adminToken();
    const reg = await h.call<{ device: { id: string }; token: string }>("POST", "/devices", {
      token: adminMfa, body: { venue_id: h.seed.venueId, kind: "fixed_reader", label: "Rogue test reader", hardware_id: "RDR-ROGUE-1", checkpoint_id: h.seed.checkpoints.expo },
    });
    expect(reg.status).toBe(201);
    const access = (await h.call<{ access_token: string }>("POST", "/auth/device-token", { body: { device_token: reg.body.token } })).body.access_token;
    expect((await h.call("POST", "/devices/heartbeat", { token: access, body: { queue_depth: 0, clock_offset_ms: 0 } })).status).toBe(200);
    expect((await h.call("POST", `/devices/${reg.body.device.id}/retire`, { token: adminMfa })).status).toBe(200);
    for (let i = 0; i < 4; i++) {
      expect((await h.call("POST", "/devices/heartbeat", { token: access, body: { queue_depth: 0, clock_offset_ms: 0 } })).status).toBe(401);
    }
    const alerts = await rogue(/device is not active/);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.checkpoint_id).toBe(h.seed.checkpoints.expo);
    expect(alerts[0]!.detail).toContain(reg.body.device.id);
    expect(alerts[0]!.detail).not.toContain(reg.body.token);
    expect(alerts[0]!.detail).not.toContain(access);
  });

  it("a malformed or forged bearer on a scanner endpoint alerts; an expired one does not", async () => {
    expect((await h.call("POST", "/scans", { token: "not.a.token", body: { event_id: h.seed.eventId, device_id: "x", scans: [] } })).status).toBe(401);
    expect(await rogue(/invalid access token/)).toHaveLength(1);
    const before = (await rogue(/invalid access token/)).length;
    const t = await h.gateToken(h.seed.checkpoints.mainIn);
    h.clock.advance(11 * 60_000); // access tokens live 10 minutes
    h.clock.advance(ROGUE_CONNECTION_WINDOW_MS); // and past the dedupe window, so only expiry decides
    const r = await h.call("POST", "/gates/heartbeat", { token: t, body: { checkpoint_id: h.seed.checkpoints.mainIn, device_id: "p", queue_depth: 0, clock_offset_ms: 0, online: true } });
    expect(errCode(r.body)).toBe("TOKEN_EXPIRED");
    expect(await rogue(/invalid access token/)).toHaveLength(before);
  });

  it("a heartbeat or a scanner stream ticket for a gate the user is not staffing now alerts once per user", async () => {
    const mainIn = await h.gateToken(h.seed.checkpoints.mainIn);
    for (let i = 0; i < 3; i++) {
      const r = await h.call("POST", "/gates/heartbeat", { token: mainIn, body: { checkpoint_id: h.seed.checkpoints.vip, device_id: "p", queue_depth: 0, clock_offset_ms: 0, online: true } });
      expect(errCode(r.body)).toBe("CHECKPOINT_NOT_ASSIGNED");
    }
    let alerts = await rogue(/not assigned to this checkpoint now/);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.checkpoint_id).toBe(h.seed.checkpoints.vip); // a real checkpoint: security at that gate sees it

    const east = await h.gateToken(h.seed.checkpoints.eastIn);
    const t = await h.call("POST", "/auth/ws-ticket", { token: east, body: { channel: "/stream/scans", event_id: h.seed.eventId, checkpoint_id: h.seed.checkpoints.vip } });
    expect(errCode(t.body)).toBe("CHECKPOINT_NOT_ASSIGNED");
    alerts = await rogue(/not assigned to this checkpoint now/);
    expect(alerts).toHaveLength(2);
    expect(alerts.some((a) => a.detail.includes("/stream/scans"))).toBe(true);
  });

  it("a scanner stream with a ticket that is not valid is refused and alerted, without the ticket", async () => {
    const bogus = "T".repeat(43);
    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(h.base.replace("http", "ws") + "/stream/scans", [WS_SUBPROTOCOL, `${WS_TICKET_PREFIX}${bogus}`]);
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.on("error", () => resolve(-1));
      ws.on("open", () => {
        ws.close();
        resolve(101);
      });
    });
    expect(status).toBe(401);
    const alerts = await rogue(/invalid stream ticket/);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.detail).not.toContain(bogus);
  });

  it("many different sources in one window are capped, and the rest are counted as suppressed", async () => {
    const { repos, alerts, audit, clock } = h.app.ctx;
    const trust = new ScannerTrust({ repos, alerts, audit, clock });
    const before = (await rogue(/./)).length;
    for (let i = 0; i < 30; i++) await trust.refused({ reason: "unknown_device_token", channel: "test", ip: `10.0.0.${i}` });
    const raised = (await rogue(/./)).length - before;
    expect(raised).toBe(20);
    expect(trust.suppressed).toBe(10);
  });
});
