/** Fixed-reader authentication (O-17): device tokens, device principals, scan ingest without shifts, retirement. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenPair } from "@synan/contracts/rest";
import { band, errCode, mfaCode, scan, startHarness, type Harness } from "./helpers.js";

let h: Harness;
let adminMfa: string;
let organiser: string;
beforeAll(async () => {
  h = await startHarness();
  const admin = (await h.login(h.seed.emails.admin)).access_token;
  adminMfa = (await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: admin, body: { code: mfaCode(h) } })).body.access_token;
  organiser = (await h.login(h.seed.emails.organiser)).access_token;
});
afterAll(async () => h.close());

describe("fixed readers", () => {
  let deviceId: string;
  let deviceToken: string;
  let access: string;
  const ingest = (token: string, cp: string, uid: string) =>
    h.call<{ results: { result: string }[]; rejected: { code: string }[] }>("POST", "/scans", {
      token, body: { event_id: h.seed.eventId, device_id: "claimed-name", scans: [scan(h, cp, band(uid))] },
    });

  it("an admin registers a reader at one checkpoint with MFA; the token is shown once; audited", async () => {
    const body = { venue_id: h.seed.venueId, kind: "fixed_reader", label: "Expo reader", hardware_id: "RDR-0001", checkpoint_id: h.seed.checkpoints.expo };
    expect((await h.call("POST", "/devices", { token: organiser, body })).status).toBe(403);
    expect(errCode((await h.call("POST", "/devices", { token: adminMfa, body: { ...body, checkpoint_id: null } })).body)).toBe("VALIDATION_FAILED");
    const r = await h.call<{ device: { id: string; state: string }; token: string }>("POST", "/devices", { token: adminMfa, body });
    expect(r.status).toBe(201);
    deviceId = r.body.device.id;
    deviceToken = r.body.token;
    expect(deviceToken.length).toBeGreaterThan(20);
    expect(errCode((await h.call("POST", "/devices", { token: adminMfa, body })).body)).toBe("CONFLICT");
    const list = await h.call<{ items: Record<string, unknown>[] }>("GET", "/devices", { token: organiser });
    expect(JSON.stringify(list.body)).not.toContain(deviceToken);
    expect((await h.app.ctx.repos.audit.all()).map((a) => a.action)).toContain("device.register");
  });

  it("the token buys a device access token that scans at its own checkpoint at any time, and nowhere else", async () => {
    expect(errCode((await h.call("POST", "/auth/device-token", { body: { device_token: "x".repeat(43) } })).body)).toBe("INVALID_CREDENTIALS");
    const t = await h.call<{ access_token: string; checkpoint_id: string }>("POST", "/auth/device-token", { body: { device_token: deviceToken } });
    expect(t.status).toBe(200);
    expect(t.body.checkpoint_id).toBe(h.seed.checkpoints.expo);
    access = t.body.access_token;
    const ok = await ingest(access, h.seed.checkpoints.expo, h.seed.attendees.publicTier.uid);
    expect(ok.body.results[0]!.result).toBe("admitted");
    const elsewhere = await ingest(access, h.seed.checkpoints.vip, h.seed.attendees.vip.uid);
    expect(elsewhere.body.rejected[0]!.code).toBe("CHECKPOINT_NOT_ASSIGNED");
    const row = (await h.app.ctx.repos.scans.page(h.seed.eventId, { checkpointId: h.seed.checkpoints.expo, limit: 1 }))[0]!;
    expect(row.device_id).toBe(`device:${deviceId}`); // the authenticated id, not what the request claimed
    expect(row.staff_user_id).toBeNull();
    // A device is not a user: other endpoints refuse it.
    expect((await h.call("GET", "/credentials", { token: access })).status).toBe(403);
    expect((await h.call("GET", `/events/${h.seed.eventId}/allowlist`, { token: access })).status).toBe(200);
  });

  it("rotating the token ends access tokens minted from the old one", async () => {
    const r = await h.call<{ token: string }>("POST", `/devices/${deviceId}/rotate-token`, { token: adminMfa });
    expect(r.status).toBe(200);
    expect((await ingest(access, h.seed.checkpoints.expo, h.seed.attendees.vip.uid)).status).toBe(401);
    expect(errCode((await h.call("POST", "/auth/device-token", { body: { device_token: deviceToken } })).body)).toBe("INVALID_CREDENTIALS");
    deviceToken = r.body.token;
    access = (await h.call<{ access_token: string }>("POST", "/auth/device-token", { body: { device_token: deviceToken } })).body.access_token;
    expect((await ingest(access, h.seed.checkpoints.expo, h.seed.attendees.vip.uid)).status).toBe(200);
  });

  it("heartbeats feed gate health; retiring the device stops it on its next request", async () => {
    expect((await h.call("POST", "/devices/heartbeat", { token: access, body: { queue_depth: 0, clock_offset_ms: 40 } })).status).toBe(200);
    const health = await h.call<{ items: { checkpoint_id: string; link_state: string }[] }>("GET", `/gates/health?event_id=${h.seed.eventId}`, { token: organiser });
    expect(health.body.items.find((g) => g.checkpoint_id === h.seed.checkpoints.expo)!.link_state).toBe("online");
    expect((await h.app.ctx.repos.devices.byId(deviceId))!.last_clock_offset_ms).toBe(40);
    expect((await h.call("POST", `/devices/${deviceId}/retire`, { token: adminMfa })).status).toBe(200);
    expect((await ingest(access, h.seed.checkpoints.expo, h.seed.attendees.vip.uid)).status).toBe(401);
    expect(errCode((await h.call("POST", "/auth/device-token", { body: { device_token: deviceToken } })).body)).toBe("INVALID_CREDENTIALS");
  });
});
