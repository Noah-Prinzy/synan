/**
 * Per-checkpoint scan limit (03 §4): on top of the per-person request limit and the 60 s debounce.
 * Counted per minute of judged time, so an offline backlog synced at once is never throttled; refused
 * items come back RATE_LIMITED (not stored, resendable), are counted in gate health, and raise one alert.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GateHealth, ScanBatchResponse } from "@synan/contracts/rest";
import { loadConfig } from "../src/config.js";
import { band, postScans, scan, startHarness, type Harness } from "./helpers.js";

const LIMIT = 60;
let h: Harness;
beforeAll(async () => {
  h = await startHarness({ config: { checkpointScansPerMin: LIMIT } });
});
afterAll(async () => h.close());

const uid = () => band(randomBytes(7).toString("hex").toUpperCase());
const health = async () => {
  const organiser = (await h.login(h.seed.emails.organiser)).access_token;
  const r = await h.call<{ items: GateHealth[] }>("GET", `/gates/health?event_id=${h.seed.eventId}`, { token: organiser });
  return (id: string) => r.body.items.find((g) => g.checkpoint_id === id)!;
};

describe("per-checkpoint scan limit (03 §4)", () => {
  it("the default allows 3,000 scans per minute at one checkpoint and is configurable within bounds", () => {
    expect(loadConfig({}, []).checkpointScansPerMin).toBe(3000);
    expect(loadConfig({ RATE_CHECKPOINT_SCANS_PER_MIN: "6000" }, []).checkpointScansPerMin).toBe(6000);
    expect(() => loadConfig({ RATE_CHECKPOINT_SCANS_PER_MIN: "10" }, [])).toThrow(/RATE_CHECKPOINT_SCANS_PER_MIN/);
  });

  it("over the limit, items are refused RATE_LIMITED, counted and alerted once; other gates are unaffected; a refused item can be resent", async () => {
    // Start of a fresh minute, so the whole batch falls in one bucket.
    h.clock.set(Math.ceil(h.clock.now() / 60_000) * 60_000 + 1_000);
    const cp = h.seed.checkpoints.mainIn;
    const items = Array.from({ length: LIMIT + 5 }, () => scan(h, cp, uid()));
    const r = await postScans<ScanBatchResponse>(h, items);
    expect(r.status).toBe(200);
    expect(r.body.results).toHaveLength(LIMIT);
    expect(r.body.rejected).toHaveLength(5);
    expect(r.body.rejected!.every((x) => x.code === "RATE_LIMITED")).toBe(true);
    const refused = r.body.rejected!.map((x) => x.idem_key);
    expect(refused).toEqual(items.slice(LIMIT).map((s) => s.idem_key));

    // Another retry in the same minute is refused again; still one alert for the flood.
    const again = await postScans<ScanBatchResponse>(h, items.slice(LIMIT));
    expect(again.body.rejected!.map((x) => x.code)).toEqual(Array(5).fill("RATE_LIMITED"));
    const alerts = (await h.app.ctx.repos.alerts.list({ eventId: h.seed.eventId, limit: 500 })).filter((a) => a.kind === "rogue_scanner" && a.detail.includes("scan limit"));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.checkpoint_id).toBe(cp);
    expect((await health())(cp).scans_rate_limited_15m).toBe(10);

    // A different checkpoint has its own budget.
    const other = await postScans<ScanBatchResponse>(h, [scan(h, h.seed.checkpoints.vip, uid())]);
    expect(other.body.rejected).toEqual([]);
    expect((await health())(h.seed.checkpoints.vip).scans_rate_limited_15m).toBe(0);

    // Not stored: next minute the same items (same idem_keys) are applied, not replayed.
    h.clock.advance(60_000);
    const later = await postScans<ScanBatchResponse>(h, items.slice(LIMIT).map((s) => ({ ...s, occurred_at: new Date(h.clock.now()).toISOString() })));
    expect(later.body.rejected).toEqual([]);
    expect(later.body.results.map((x) => x.replayed)).toEqual(Array(5).fill(false));
  });

  it("an offline backlog is counted in the minutes it happened in, so a large sync of a busy gate is not throttled", async () => {
    h.clock.advance(5 * 60_000);
    const cp = h.seed.checkpoints.mainOut;
    const now = h.clock.now();
    // Three minutes at 40 per minute each = 120 scans in one sync, twice the per-minute limit.
    const backlog = [1, 2, 3].flatMap((m) =>
      Array.from({ length: 40 }, (_, i) => scan(h, cp, uid(), { offline: true, occurred_at: new Date(now - m * 60_000 - 30_000 + i * 100).toISOString(), direction: "out" })),
    );
    const r = await postScans<ScanBatchResponse>(h, backlog);
    expect(r.status).toBe(200);
    expect(r.body.rejected).toEqual([]);
    expect(r.body.results).toHaveLength(120);
    expect((await health())(cp).scans_rate_limited_15m).toBe(0);
  });
});
