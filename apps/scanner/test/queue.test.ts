/**
 * The durable queue (01 §8, 03 §4): written before the verdict, sent in order, each scan counted
 * exactly once across retries, reloads and two tabs. The fake server applies the API's
 * idempotency rule (apps/api scan-service: fingerprint = checkpoint, occurred_at, offline, local_result).
 */
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { ScanBatchResponse, ScanOutcome, ScanSubmission } from "@synan/contracts/rest";
import { Idb } from "../src/data/api/idb";
import { isConflict, ScanQueue, syncQueue, type QueueRecord, type SendResult, type SyncDeps } from "../src/data/api/queue";

let dbN = 0;
const freshName = () => `scanner-test-${++dbN}`;

const EVENT = "11111111-1111-4111-8111-111111111111";
const CP = "22222222-2222-4222-8222-222222222222";

function record(n: number, p: Partial<QueueRecord> = {}): QueueRecord {
  const occurred = new Date(1_800_000_000_000 + n * 1000).toISOString();
  const base = { idem_key: `key-${String(n).padStart(16, "0")}`, checkpoint_id: CP, presented: { medium: "nfc" as const, uid: "04AABBCC" }, occurred_at: occurred, clock_offset_ms: 0 };
  return {
    idem_key: base.idem_key,
    at: 1_800_000_000_000 + n * 1000,
    user: "user-1",
    event_id: EVENT,
    device_id: "scanner-a",
    offline: { ...base, offline: true, local_result: "admitted" },
    online: null,
    send_as: "offline",
    state: "pending",
    inflight_until: 0,
    next_at: 0,
    attempts: 0,
    decided_by: "local",
    shown: "admitted",
    outcome: null,
    rejection: null,
    synced_at: null,
    credential_key: "cred",
    checkpoint: { id: CP, perimeter: true, zoneId: "z", roomId: null },
    direction: "in",
    email_cid: null,
    undone: false,
    display: { medium: "nfc", identifier: "04AA…BBCC", tier: null, rooms: [], lastInAt: null },
    ...p,
  };
}

/** A server with the API's idempotency semantics, and switches for the failures under test. */
class FakeServer {
  stored = new Map<string, { fp: string; outcome: ScanOutcome }>();
  requests: ScanSubmission[][] = [];
  rateLimitOnce = new Set<string>();
  rejectCodes = new Map<string, string>();
  failNext = 0;
  invalidKeys = new Set<string>();
  private n = 0;

  private fp(s: ScanSubmission) {
    return JSON.stringify([s.checkpoint_id, Date.parse(s.occurred_at), s.offline, s.local_result ?? null]);
  }

  async send(body: { scans: ScanSubmission[] }): Promise<SendResult> {
    this.requests.push(body.scans);
    if (this.failNext > 0) {
      this.failNext--;
      return { ok: false, failure: { kind: "network" } };
    }
    if (body.scans.some((s) => this.invalidKeys.has(s.idem_key))) return { ok: false, failure: { kind: "invalid" } };
    const res: ScanBatchResponse = { results: [], rejected: [], server_time: new Date().toISOString() };
    for (const s of body.scans) {
      const prior = this.stored.get(s.idem_key);
      if (prior) {
        if (prior.fp !== this.fp(s)) res.rejected!.push({ idem_key: s.idem_key, code: "IDEMPOTENCY_CONFLICT", message: "different scan" });
        else res.results.push({ ...prior.outcome, replayed: true });
        continue;
      }
      if (this.rateLimitOnce.delete(s.idem_key)) {
        res.rejected!.push({ idem_key: s.idem_key, code: "RATE_LIMITED", message: "over limit" });
        continue;
      }
      const code = this.rejectCodes.get(s.idem_key);
      if (code) {
        res.rejected!.push({ idem_key: s.idem_key, code: code as "OUTSIDE_SHIFT", message: code });
        continue;
      }
      const outcome: ScanOutcome = {
        idem_key: s.idem_key, scan_id: `00000000-0000-4000-8000-${String(++this.n).padStart(12, "0")}`, result: s.local_result ?? "admitted",
        carrier_kind: "nfc", tier: null, room_id: null, corrected_at: s.occurred_at, replayed: false, alert_ids: [],
      };
      this.stored.set(s.idem_key, { fp: this.fp(s), outcome });
      res.results.push(outcome);
    }
    return { ok: true, body: res };
  }
}

async function setup(name = freshName()) {
  const idb = await Idb.open(name);
  const queue = new ScanQueue(idb);
  const server = new FakeServer();
  let clock = 1_900_000_000_000;
  const deps = (): SyncDeps => ({ queue, send: (b) => server.send(b), now: () => clock, user: "user-1", batch: 2 });
  return { idb, queue, server, deps, advance: (ms: number) => (clock += ms), name };
}

describe("durable queue", () => {
  it("keeps a scan across a reload (new connection to the same database) and never overwrites a key", async () => {
    const { idb, queue, name } = await setup();
    expect(await queue.add(record(1))).toBe(true);
    expect(await queue.add(record(1, { shown: "revoked" }))).toBe(false);
    idb.close();
    const again = new ScanQueue(await Idb.open(name));
    const pending = await again.pending();
    expect(pending.map((r) => [r.idem_key, r.shown])).toEqual([[record(1).idem_key, "admitted"]]);
  });

  it("sends in order, in batches, and the server counts each scan once", async () => {
    const { queue, server, deps } = await setup();
    for (const n of [3, 1, 2]) await queue.add(record(n));
    const rep = await syncQueue(deps());
    expect(rep).toMatchObject({ sent: 3, rejected: 0, stoppedBy: null });
    expect(server.requests.map((b) => b.map((s) => s.idem_key))).toEqual([[record(1).idem_key, record(2).idem_key], [record(3).idem_key]]);
    expect(server.stored.size).toBe(3);
    expect(await queue.depth()).toBe(0);
  });

  it("keeps everything queued when the link fails, then resends the same bodies (a replay, not a second count)", async () => {
    const { queue, server, deps } = await setup();
    await queue.add(record(1));
    server.failNext = 1;
    const first = await syncQueue(deps());
    expect(first.stoppedBy).toEqual({ kind: "network" });
    expect(await queue.depth()).toBe(1);
    // The response was lost after the server stored it: the same body comes back as a replay.
    await server.send({ scans: [record(1).offline] });
    const second = await syncQueue(deps());
    expect(second.sent).toBe(1);
    expect(server.stored.size).toBe(1);
    expect(server.requests.at(-1)![0]).toEqual(server.requests[0]![0]);
  });

  it("RATE_LIMITED: not stored, stays queued unchanged, paused, then resent byte-for-byte", async () => {
    const { queue, server, deps, advance } = await setup();
    await queue.add(record(1));
    server.rateLimitOnce.add(record(1).idem_key);
    const rep = await syncQueue(deps());
    expect(rep.sent).toBe(0);
    const [held] = await queue.pending();
    expect(held!.offline).toEqual(record(1).offline);
    expect(held!.next_at).toBeGreaterThan(0);
    expect((await syncQueue(deps())).sent).toBe(0); // still paused
    advance(120_000);
    expect((await syncQueue(deps())).sent).toBe(1);
    expect(server.requests.at(-1)![0]).toEqual(server.requests[0]![0]);
    expect(server.stored.size).toBe(1);
  });

  it("an online attempt that reached the server: the offline form conflicts, the online body replays it, counted once", async () => {
    const { queue, server, deps } = await setup();
    const r = record(1);
    const online: ScanSubmission = { ...r.offline, offline: false, local_result: undefined };
    delete online.local_result;
    await queue.add({ ...r, online });
    await server.send({ scans: [online] }); // arrived, but the answer never came back
    const rep = await syncQueue(deps());
    expect(rep).toMatchObject({ sent: 1, rejected: 0 });
    const [done] = (await queue.all()).filter((x) => x.idem_key === r.idem_key);
    expect(done!.state).toBe("sent");
    expect(done!.outcome!.replayed).toBe(true);
    expect(server.stored.size).toBe(1);
  });

  it("an online attempt that never arrived: the offline form is stored once, with what the gate showed", async () => {
    const { queue, server, deps } = await setup();
    const r = record(1, { shown: "unknown_token", offline: { ...record(1).offline, local_result: "unknown_token" } });
    await queue.add({ ...r, online: { ...r.offline, offline: false } });
    expect((await syncQueue(deps())).sent).toBe(1);
    expect(server.stored.get(r.idem_key)!.outcome.result).toBe("unknown_token");
  });

  it("leaves an online attempt in flight alone until its deadline", async () => {
    const { queue, server, deps } = await setup();
    await queue.add(record(1, { inflight_until: 1_900_000_010_000 }));
    expect((await syncQueue(deps())).sent).toBe(0);
    expect(server.requests).toHaveLength(0);
  });

  it("parks refused items (shown on S4) and lets the rest of the batch through", async () => {
    const { queue, server, deps } = await setup();
    await queue.add(record(1));
    await queue.add(record(2));
    server.rejectCodes.set(record(1).idem_key, "OUTSIDE_SHIFT");
    const rep = await syncQueue(deps());
    expect(rep).toMatchObject({ sent: 1, rejected: 1 });
    const refused = (await queue.all()).find((x) => x.idem_key === record(1).idem_key)!;
    expect(refused.state).toBe("rejected");
    expect(refused.rejection!.code).toBe("OUTSIDE_SHIFT");
    expect(isConflict(refused)).toBe(true);
    expect(await queue.depth()).toBe(0);
  });

  it("isolates one malformed item by splitting the batch", async () => {
    const { queue, server, deps } = await setup();
    for (const n of [1, 2]) await queue.add(record(n));
    server.invalidKeys.add(record(2).idem_key);
    const rep = await syncQueue(deps());
    expect(rep).toMatchObject({ sent: 1, rejected: 1 });
    expect(server.stored.has(record(1).idem_key)).toBe(true);
  });

  it("sends only the signed-in user's scans", async () => {
    const { queue, server, deps } = await setup();
    await queue.add(record(1, { user: "someone-else" }));
    const rep = await syncQueue(deps());
    expect(rep.sent).toBe(0);
    expect(rep.remaining).toBe(0);
    expect(server.requests).toHaveLength(0);
    expect(await queue.depth()).toBe(1);
  });

  it("two tabs syncing at once never count a scan twice, and a sent record never goes back to pending", async () => {
    const { queue, server, deps, name } = await setup();
    for (const n of [1, 2, 3, 4, 5]) await queue.add(record(n));
    const tab2 = new ScanQueue(await Idb.open(name));
    const [a, b] = await Promise.all([syncQueue(deps()), syncQueue({ ...deps(), queue: tab2 })]);
    expect(a.sent + b.sent).toBeGreaterThanOrEqual(5);
    expect(server.stored.size).toBe(5);
    const r = (await queue.all()).find((x) => x.idem_key === record(1).idem_key)!;
    await queue.update(r.idem_key, (x) => ({ ...x, state: "pending" }));
    expect((await queue.all()).find((x) => x.idem_key === r.idem_key)!.state).toBe("sent");
  });

  it("isConflict: an offline admission the server recorded with alerts, or as something else", () => {
    const sent = (o: Partial<ScanOutcome>, shown: QueueRecord["shown"] = "admitted") =>
      record(1, { state: "sent", shown, outcome: { idem_key: "k", scan_id: "s", result: "admitted", carrier_kind: "nfc", tier: null, room_id: null, corrected_at: new Date().toISOString(), replayed: false, alert_ids: [], ...o } });
    expect(isConflict(sent({}))).toBe(false);
    expect(isConflict(sent({ alert_ids: ["a"] }))).toBe(true);
    expect(isConflict(sent({ result: "duplicate_read" }))).toBe(true);
    expect(isConflict({ ...sent({ alert_ids: ["a"] }), decided_by: "server" })).toBe(false);
  });
});
