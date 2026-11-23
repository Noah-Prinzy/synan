/** Gate health from the devices table: staff phones register as scanner devices; link states and the degraded rule. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GateHealth } from "@synan/contracts/rest";
import { errCode, startHarness, type Harness } from "./helpers.js";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h.close());

const health = async () => {
  const organiser = (await h.login(h.seed.emails.organiser)).access_token;
  const r = await h.call<{ items: GateHealth[] }>("GET", `/gates/health?event_id=${h.seed.eventId}`, { token: organiser });
  return (id: string) => r.body.items.find((g) => g.checkpoint_id === id)!;
};
const beat = async (cp: string, over: Record<string, unknown> = {}) =>
  h.call("POST", "/gates/heartbeat", { token: await h.gateToken(cp), body: { checkpoint_id: cp, device_id: "phone-A", queue_depth: 0, clock_offset_ms: 0, online: true, ...over } });

describe("gate health", () => {
  it("a gate never heard from is offline with no heartbeat age; a phone heartbeat registers it as a scanner device", async () => {
    const cp = h.seed.checkpoints.mainIn;
    expect((await health())(cp)).toMatchObject({ link_state: "offline", heartbeat_age_s: null, queue_depth: 0 });
    expect((await beat(cp)).status).toBe(200);
    expect((await health())(cp)).toMatchObject({ link_state: "online", heartbeat_age_s: 0, queue_depth: 0, clock_fault: false });
    const devices = await h.app.ctx.repos.devices.list(h.seed.venueId);
    const phone = devices.filter((d) => d.kind === "scanner" && d.checkpoint_id === cp);
    expect(phone).toHaveLength(1);
    // The phone's own id never reaches the row in the clear, and it carries no device token.
    expect(phone[0]!.hardware_id).not.toContain("phone-A");
    expect(phone[0]!.hardware_id).toMatch(/^phone:[0-9a-f]{40}$/);
    await beat(cp);
    expect((await h.app.ctx.repos.devices.list(h.seed.venueId)).filter((d) => d.kind === "scanner" && d.checkpoint_id === cp)).toHaveLength(1);
  });

  it("degraded = link up with scans still queued, or a clock fault; offline after 60 s of silence", async () => {
    const cp = h.seed.checkpoints.mainIn;
    await beat(cp, { queue_depth: 4 });
    expect((await health())(cp)).toMatchObject({ link_state: "degraded", queue_depth: 4 });
    await beat(cp, { queue_depth: 0, online: false }); // a phone in offline mode holds scans
    expect((await health())(cp).link_state).toBe("degraded");
    await beat(cp, { queue_depth: 0, clock_offset_ms: 180_000 });
    expect((await health())(cp)).toMatchObject({ link_state: "degraded", clock_fault: true, queue_depth: 0 });
    await beat(cp, { clock_offset_ms: 0 });
    expect((await health())(cp).link_state).toBe("online");
    h.clock.advance(61_000);
    expect((await health())(cp)).toMatchObject({ link_state: "offline", heartbeat_age_s: 61 });
  });

  it("a heartbeat only for the checkpoint the user staffs now; the dashboard counts offline gates from the same source", async () => {
    expect(errCode((await h.call("POST", "/gates/heartbeat", {
      token: await h.gateToken(h.seed.checkpoints.mainIn),
      body: { checkpoint_id: h.seed.checkpoints.vip, device_id: "phone-A", queue_depth: 0, clock_offset_ms: 0, online: true },
    })).body)).toBe("CHECKPOINT_NOT_ASSIGNED");
    await beat(h.seed.checkpoints.mainIn);
    const organiser = (await h.login(h.seed.emails.organiser)).access_token;
    const d = await h.call<{ gates_offline: number }>("GET", "/dashboard", { token: organiser });
    const items = Object.values(h.seed.checkpoints).length;
    expect(d.body.gates_offline).toBe(items - 1);
  });
});
