/**
 * The durable queue (01 §8, 03 §4): written before the verdict, sent in order, each scan counted
 * exactly once across retries, reloads and two tabs. The fake server applies the API's rules:
 * idempotency (apps/api scan-service: fingerprint = checkpoint, occurred_at, offline, local_result;
 * `assignment_id` is not part of it), and the stranded-queue rule (A1, scanner-gaps.test.ts): a
 * queued scan naming its assignment is counted from its maker, or from whoever is on shift at that
 * gate now on the scanner install it was made on, within the late-sync window.
 */
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { ErrorCode } from "@synan/contracts/errors";
import type { ScanBatchResponse, ScanOutcome, ScanSubmission } from "@synan/contracts/rest";
import { DB_NAME, Idb, KV, SCANS, upgradeScanV2 } from "../src/data/api/idb";
import {
  bodyOf,
  canSend,
  isConflict,
  ScanQueue,
  syncQueue,
  undoUntil,
  undoWindowMs,
  type QueueRecord,
  type SendResult,
  type Signer,
  type SyncDeps,
} from "../src/data/api/queue";

let dbN = 0;
const freshName = () => `scanner-test-${++dbN}`;

const EVENT = "11111111-1111-4111-8111-111111111111";
const CP = "22222222-2222-4222-8222-222222222222";
const OTHER_CP = "33333333-3333-4333-8333-333333333333";
const T0 = 1_800_000_000_000;
const MIN = 60_000;
const H = 60 * MIN;

function record(n: number, p: Partial<QueueRecord> = {}): QueueRecord {
  const occurred = new Date(T0 + n * 1000).toISOString();
  const base = { idem_key: `key-${String(n).padStart(16, "0")}`, checkpoint_id: CP, presented: { medium: "nfc" as const, uid: "04AABBCC" }, occurred_at: occurred, clock_offset_ms: 0 };
  return {
    idem_key: base.idem_key,
    at: T0 + n * 1000,
    user: "user-1",
    assignment_id: "asg-1",
    event_id: EVENT,
    device_id: "scanner-a",
    offline: { ...base, offline: true, local_result: "admitted", assignment_id: "asg-1" },
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
    undo: null,
    display: { medium: "nfc", identifier: "04AA…BBCC", tier: null, rooms: [], lastInAt: null },
    ...p,
  };
}

interface Assignment {
  user: string;
  checkpoint: string;
  start: number;
  end: number;
  handedOverAt: number | null;
  /** Scanner installs seen under this assignment (its holder's own scans and heartbeats). */
  devices: Set<string>;
}

/** A server with the API's idempotency and A1 semantics, and switches for the failures under test. */
class FakeServer {
  stored = new Map<string, { fp: string; outcome: ScanOutcome; staff: string; lateSynced: boolean }>();
  requests: ScanSubmission[][] = [];
  rateLimitOnce = new Set<string>();
  rejectCodes = new Map<string, string>();
  failNext = 0;
  invalidKeys = new Set<string>();
  /** user-1 works asg-1 at CP around T0 on install scanner-a (the default records' shift). */
  assignments = new Map<string, Assignment>([["asg-1", { user: "user-1", checkpoint: CP, start: T0 - H, end: T0 + H, handedOverAt: null, devices: new Set(["scanner-a"]) }]]);
  /** Who is calling, from which install, at what server time. */
  as = { user: "user-1", device: "scanner-a" };
  now = T0 + 10 * MIN;
  lateWindowMs = 12 * H;
  /** When false, scans without a named assignment skip the shift check (the original tests). */
  checkShifts = false;
  private n = 0;

  private fp(s: ScanSubmission) {
    return JSON.stringify([s.checkpoint_id, Date.parse(s.occurred_at), s.offline, s.local_result ?? null]);
  }

  private refusal(s: ScanSubmission): { code: ErrorCode; staff: string; late: boolean } | null {
    const at = Date.parse(s.occurred_at) + s.clock_offset_ms;
    if (s.offline && s.assignment_id) {
      const a = this.assignments.get(s.assignment_id);
      if (!a || a.checkpoint !== s.checkpoint_id) return { code: "CHECKPOINT_NOT_ASSIGNED", staff: "", late: false };
      const coverEnd = Math.min(a.end, a.handedOverAt ?? Infinity);
      if (at < a.start || at >= coverEnd) return { code: "OUTSIDE_SHIFT", staff: "", late: false };
      if (this.now >= coverEnd + this.lateWindowMs) return { code: "OUTSIDE_SHIFT", staff: "", late: false };
      if (a.user !== this.as.user) {
        const onShiftHere = [...this.assignments.values()].some((x) => x.user === this.as.user && x.checkpoint === s.checkpoint_id && x.start <= this.now && this.now < x.end && x.handedOverAt === null);
        if (!onShiftHere || !a.devices.has(this.as.device)) return { code: "CHECKPOINT_NOT_ASSIGNED", staff: "", late: false };
      }
      return null;
    }
    if (!this.checkShifts) return null;
    const mine = [...this.assignments.values()].filter((x) => x.user === this.as.user && x.checkpoint === s.checkpoint_id);
    if (mine.length === 0) return { code: "CHECKPOINT_NOT_ASSIGNED", staff: "", late: false };
    if (!mine.some((x) => at >= x.start && at < x.end)) return { code: "OUTSIDE_SHIFT", staff: "", late: false };
    return null;
  }

  async send(body: { device_id?: string; scans: ScanSubmission[] }): Promise<SendResult> {
    this.requests.push(body.scans);
    if (body.device_id) this.as = { ...this.as, device: body.device_id };
    if (this.failNext > 0) {
      this.failNext--;
      return { ok: false, failure: { kind: "network" } };
    }
    if (body.scans.some((s) => this.invalidKeys.has(s.idem_key))) return { ok: false, failure: { kind: "invalid" } };
    const res: ScanBatchResponse = { results: [], rejected: [], server_time: new Date(this.now).toISOString() };
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
        res.rejected!.push({ idem_key: s.idem_key, code: code as ErrorCode, message: code });
        continue;
      }
      const why = this.refusal(s);
      if (why) {
        res.rejected!.push({ idem_key: s.idem_key, code: why.code, message: why.code });
        continue;
      }
      const named = s.offline && s.assignment_id ? this.assignments.get(s.assignment_id) : undefined;
      const lateSynced = named ? this.now >= Math.min(named.end, named.handedOverAt ?? Infinity) : false;
      const outcome: ScanOutcome = {
        idem_key: s.idem_key, scan_id: `00000000-0000-4000-8000-${String(++this.n).padStart(12, "0")}`, result: s.local_result ?? "admitted",
        carrier_kind: "nfc", tier: null, room_id: null, corrected_at: s.occurred_at, replayed: false, alert_ids: [],
        ...(lateSynced ? { late_synced: true } : {}),
      };
      this.stored.set(s.idem_key, { fp: this.fp(s), outcome, staff: named?.user ?? this.as.user, lateSynced });
      res.results.push(outcome);
    }
    return { ok: true, body: res };
  }
}

const me = (user = "user-1", onShift: Record<string, string> = { [CP]: "asg-1" }): Signer => ({ user, onShift: new Map(Object.entries(onShift)) });

async function setup(name = freshName()) {
  const idb = await Idb.open(name);
  const queue = new ScanQueue(idb);
  const server = new FakeServer();
  let clock = 1_900_000_000_000;
  const deps = (signer: Signer = me()): SyncDeps => ({ queue, send: (b) => server.send(b), now: () => clock, signer, batch: 2 });
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
    delete online.assignment_id;
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
    server.rejectCodes.set(record(1).idem_key, "NOT_FOUND");
    const rep = await syncQueue(deps());
    expect(rep).toMatchObject({ sent: 1, rejected: 1 });
    const refused = (await queue.all()).find((x) => x.idem_key === record(1).idem_key)!;
    expect(refused.state).toBe("rejected");
    expect(refused.rejection!.code).toBe("NOT_FOUND");
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

  it("sends someone else's scans only when they name an assignment and the signer is on shift at that gate", async () => {
    const { queue, server, deps } = await setup();
    await queue.add(record(1, { user: "someone-else" })); // names asg-1 at CP
    await queue.add(record(2, { user: "someone-else", assignment_id: null, offline: { ...record(2).offline, assignment_id: undefined } })); // stored before v2
    await queue.add(record(3, { user: "someone-else", checkpoint: { id: OTHER_CP, perimeter: true, zoneId: "z", roomId: null } }));
    const offShift = await syncQueue(deps(me("user-1", {})));
    expect(offShift).toMatchObject({ sent: 0, remaining: 0 });
    expect(server.requests).toHaveLength(0);
    const rep = await syncQueue(deps());
    expect(rep.sent).toBe(1);
    expect(server.requests.flat().map((s) => s.idem_key)).toEqual([record(1).idem_key]);
    expect(await queue.depth()).toBe(2); // never dropped: they wait for their maker or their gate's staff
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

  it("the queued form carries its assignment; the online form does not; neither changes the fingerprint", () => {
    const r = record(1);
    expect(bodyOf(r).assignment_id).toBe("asg-1");
    const online: ScanSubmission = { ...r.offline, offline: false };
    delete online.local_result;
    delete online.assignment_id;
    expect(bodyOf({ ...r, online, send_as: "online" })).toEqual(online);
    // A record stored before v2 gains it at send time when the migration found it.
    const legacy = record(2, { assignment_id: "asg-9", offline: { ...record(2).offline, assignment_id: undefined } });
    expect(bodyOf(legacy).assignment_id).toBe("asg-9");
  });
});

describe("a queue left by one staff member, synced by the next one at the same gate (A1)", () => {
  /** Staff A worked asg-A at CP on install scanner-a and left 3 offline scans; B now holds asg-B at CP. */
  async function handover(name = freshName()) {
    const s = await setup(name);
    const { server } = s;
    server.checkShifts = true;
    server.assignments.set("asg-A", { user: "staff-a", checkpoint: CP, start: T0 - H, end: T0 + H, handedOverAt: null, devices: new Set(["scanner-a"]) });
    server.assignments.set("asg-B", { user: "staff-b", checkpoint: CP, start: T0 - H, end: T0 + 8 * H, handedOverAt: null, devices: new Set() });
    for (const n of [1, 2, 3]) await s.queue.add(record(n, { user: "staff-a", assignment_id: "asg-A", offline: { ...record(n).offline, assignment_id: "asg-A" } }));
    return s;
  }
  const A = me("staff-a", { [CP]: "asg-A" });
  const B = me("staff-b", { [CP]: "asg-B" });

  it("A signs out with scans unsent: they stay; B, on shift at that gate on the same install, sends them; counted once, for A, as late", async () => {
    const { queue, server, deps, name, idb } = await handover();
    // A hands over and signs out; the device reloads; nothing is lost.
    server.assignments.get("asg-A")!.handedOverAt = T0 + 30 * MIN;
    idb.close();
    const reopened = new ScanQueue(await Idb.open(name));
    expect((await reopened.pending()).map((r) => r.user)).toEqual(["staff-a", "staff-a", "staff-a"]);
    expect([...(await reopened.pending())].every((r) => canSend(r, B))).toBe(true);

    server.now = T0 + 2 * H; // A's shift is over
    server.as = { user: "staff-b", device: "scanner-a" };
    const rep = await syncQueue({ ...deps(B), queue: reopened });
    expect(rep).toMatchObject({ sent: 3, held: 0, rejected: 0 });
    expect(server.requests.flat().every((s) => s.assignment_id === "asg-A")).toBe(true);
    expect([...server.stored.values()].map((x) => [x.staff, x.lateSynced])).toEqual([["staff-a", true], ["staff-a", true], ["staff-a", true]]);
    const sent = await reopened.all();
    expect(sent.every((r) => r.state === "sent" && r.outcome?.late_synced === true)).toBe(true);
    // Again (another tab, a retry): nothing more is counted.
    expect((await syncQueue({ ...deps(B), queue: reopened })).sent).toBe(0);
    expect(server.stored.size).toBe(3);
    void queue;
  });

  it("refused from another install: held (kept, listed), not retried by the same signer, then sent by the maker", async () => {
    const { queue, server, deps } = await handover();
    server.now = T0 + 20 * MIN;
    server.assignments.get("asg-A")!.devices = new Set(["scanner-other"]); // A never used this install under asg-A
    server.as = { user: "staff-b", device: "scanner-a" };
    const first = await syncQueue(deps(B));
    expect(first).toMatchObject({ sent: 0, held: 3 });
    const held = await queue.all();
    expect(held.every((r) => r.state === "held" && r.rejection?.code === "CHECKPOINT_NOT_ASSIGNED" && r.held_for === "staff-b|asg-B")).toBe(true);
    expect(held.every(isConflict)).toBe(true);
    // Same signer, same shift: not sent again (no loop, no alert storm).
    const requests = server.requests.length;
    expect((await syncQueue(deps(B))).sent).toBe(0);
    expect(server.requests.length).toBe(requests);
    // The maker signs back in: retried and counted, in time.
    server.as = { user: "staff-a", device: "scanner-a" };
    const back = await syncQueue(deps(A));
    expect(back).toMatchObject({ sent: 3, held: 0 });
    expect([...server.stored.values()].every((x) => x.staff === "staff-a" && !x.lateSynced)).toBe(true);
  });

  it("OUTSIDE_SHIFT past the late window: held, never dropped", async () => {
    const { queue, server, deps } = await handover();
    server.now = T0 + 14 * H;
    server.assignments.get("asg-B")!.end = T0 + 20 * H;
    server.as = { user: "staff-b", device: "scanner-a" };
    const rep = await syncQueue(deps(B));
    expect(rep).toMatchObject({ sent: 0, held: 3 });
    expect((await queue.unsent()).length).toBe(3);
    await queue.prune(1_900_000_000_000 + 48 * H, 0, 0);
    expect((await queue.unsent()).length).toBe(3);
  });

  it("someone on shift elsewhere cannot send them; they wait", async () => {
    const { queue, server, deps } = await handover();
    expect((await syncQueue(deps(me("staff-c", { [OTHER_CP]: "asg-C" })))).sent).toBe(0);
    expect(server.requests).toHaveLength(0);
    expect(await queue.depth()).toBe(3);
  });
});

describe("IndexedDB v1 → v2", () => {
  /** A database exactly as v1 of the scanner left it. */
  function openV1(name: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => {
        const s = r.result.createObjectStore(SCANS, { keyPath: "idem_key" });
        s.createIndex("state", "state");
        s.createIndex("at", "at");
        r.result.createObjectStore(KV);
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  const put = (db: IDBDatabase, store: string, value: unknown, key?: IDBValidKey) =>
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  /** A v1 record: no assignment, no undo mark, no assignment in its queued body. */
  const v1 = (n: number, p: Partial<QueueRecord> = {}) => {
    const r = record(n, p) as Partial<QueueRecord>;
    delete r.assignment_id;
    delete r.undo;
    const offline = { ...r.offline! };
    delete offline.assignment_id;
    return { ...r, offline };
  };

  it("keeps every queued scan, names the shift that covered it from the cached gate list, and they still send", async () => {
    const name = freshName();
    const db = await openV1(name);
    await put(db, KV, { user: "user-1", event: null, roomNames: {}, gates: [{ id: CP, api: { assignmentId: "asg-1", shiftStart: T0 - H, shiftEnd: T0 + H } }] }, "gates");
    await put(db, SCANS, v1(1));
    await put(db, SCANS, v1(2, { user: "someone-else" }));
    await put(db, SCANS, v1(3, { at: T0 + 2 * H, offline: { ...record(3).offline, occurred_at: new Date(T0 + 2 * H).toISOString() } }));
    await put(db, SCANS, v1(4, { state: "sent" }));
    db.close();

    const idb = await Idb.open(name);
    const queue = new ScanQueue(idb);
    const all = new Map((await queue.all()).map((r) => [r.idem_key, r]));
    expect(all.size).toBe(4);
    expect(all.get(record(1).idem_key)!.assignment_id).toBe("asg-1");
    expect(all.get(record(2).idem_key)!.assignment_id).toBeNull(); // another user's: unknown
    expect(all.get(record(3).idem_key)!.assignment_id).toBeNull(); // outside the cached shift
    expect(all.get(record(4).idem_key)!.state).toBe("sent");
    expect((await queue.pending()).length).toBe(3);

    const server = new FakeServer();
    const rep = await syncQueue({ queue, send: (b) => server.send(b), now: () => 1_900_000_000_000, signer: me(), batch: 10 });
    expect(rep.sent).toBe(2); // the maker's two; the other user's stays for its maker
    expect(server.requests.flat().find((s) => s.idem_key === record(1).idem_key)!.assignment_id).toBe("asg-1");
    expect(server.requests.flat().find((s) => s.idem_key === record(3).idem_key)!.assignment_id).toBeUndefined();
    idb.close();
  });

  it("upgradeScanV2 leaves a v2 record alone", () => {
    expect(upgradeScanV2({ assignment_id: "x" }, null)).toEqual({ assignment_id: "x" });
    expect(upgradeScanV2({ user: "u" }, undefined)).toEqual({ user: "u", assignment_id: null });
  });

  it("opens a fresh database at v2", async () => {
    const idb = await Idb.open(`${DB_NAME}-fresh-${++dbN}`);
    expect(await new ScanQueue(idb).all()).toEqual([]);
    idb.close();
  });
});

describe("S3 undo, queue-aware", () => {
  const outcome = (o: Partial<ScanOutcome> = {}): ScanOutcome => ({
    idem_key: "k", scan_id: "00000000-0000-4000-8000-000000000001", result: "admitted", carrier_kind: "nfc", tier: null, room_id: null,
    corrected_at: new Date(T0 + 1000).toISOString(), replayed: false, alert_ids: [], ...o,
  });

  it("is offered for the maker's own admitted entry at a gate on shift, for the window", () => {
    const r = record(1);
    expect(undoUntil(r, me())).toBe(r.at + 60_000); // never sent: withheld on the device, whole window
    expect(undoUntil({ ...r, online: { ...r.offline, offline: false } }, me())).toBe(r.at + 57_000);
    expect(undoUntil({ ...r, state: "sent", outcome: outcome() }, me())).toBe(r.at + 57_000);
    expect(undoUntil(r, me("someone-else"))).toBeNull();
    expect(undoUntil(r, me("user-1", {}))).toBeNull();
    expect(undoUntil(r, null)).toBeNull();
    expect(undoUntil({ ...r, direction: "out" }, me())).toBeNull();
    expect(undoUntil({ ...r, shown: "already_inside" }, me())).toBeNull();
    expect(undoUntil({ ...r, state: "sent", outcome: outcome({ result: "duplicate_read" }) }, me())).toBeNull();
    expect(undoUntil({ ...r, undone: true }, me())).toBeNull();
    expect(undoUntil({ ...r, state: "rejected" }, me())).toBeNull();
    // The server's time for the scan is earlier than the device's read: the earlier one counts.
    expect(undoUntil({ ...r, state: "sent", outcome: outcome({ corrected_at: new Date(r.at - 10_000).toISOString() }) }, me())).toBe(r.at - 10_000 + 57_000);
  });

  it("follows the server's undo_window_s (GET /time, GET /auth/signing-keys), 60 s until it has said, keeping the margin", () => {
    expect(undoWindowMs(undefined)).toBe(60_000);
    expect(undoWindowMs(null)).toBe(60_000);
    expect(undoWindowMs(-1)).toBe(60_000);
    expect(undoWindowMs(Number.NaN)).toBe(60_000);
    expect(undoWindowMs(20)).toBe(20_000);
    expect(undoWindowMs(0)).toBe(0);
    const r = record(1);
    const w = undoWindowMs(20);
    expect(undoUntil(r, me(), w)).toBe(r.at + 20_000); // never sent: the whole window
    expect(undoUntil({ ...r, online: { ...r.offline, offline: false } }, me(), w)).toBe(r.at + 17_000);
    expect(undoUntil({ ...r, state: "sent", outcome: outcome() }, me(), w)).toBe(r.at + 17_000);
    expect(undoUntil({ ...r, state: "sent", outcome: outcome() }, me(), undoWindowMs(300))).toBe(r.at + 297_000);
    // A window shorter than the margin: a scan the server must agree to is never offered in time.
    expect(undoUntil({ ...r, state: "sent", outcome: outcome() }, me(), undoWindowMs(2))!).toBeLessThan(r.at);
  });

  it("an offline admission is withheld: never sent, kept on the device, not queued", async () => {
    const { queue, server, deps } = await setup();
    await queue.add(record(1));
    await queue.add(record(2));
    const w = await queue.undoLocally(record(1).idem_key, T0);
    expect(w).toMatchObject({ state: "withheld", undone: true, undo: { state: "withheld" } });
    const rep = await syncQueue(deps());
    expect(rep.sent).toBe(1);
    expect(server.requests.flat().map((s) => s.idem_key)).toEqual([record(2).idem_key]);
    expect((await queue.all()).find((x) => x.idem_key === record(1).idem_key)!.state).toBe("withheld");
    expect(await queue.depth()).toBe(0);
  });

  it("a scan the server may hold (online attempt) or holds is marked for a server undo instead", async () => {
    const { queue } = await setup();
    const r = record(1);
    await queue.add({ ...r, online: { ...r.offline, offline: false } });
    expect(await queue.undoLocally(r.idem_key, T0)).toMatchObject({ state: "pending", undone: true, undo: { state: "requested" } });
    await queue.add(record(2, { state: "sent", outcome: outcome() }));
    expect(await queue.undoLocally(record(2).idem_key, T0)).toMatchObject({ state: "sent", undo: { state: "requested" } });
    // The server refused it: the admission stands again on the device, and S4 lists it.
    const refused = await queue.settleUndo(record(2).idem_key, false, T0, "The undo window for this scan has passed.");
    expect(refused).toMatchObject({ undone: false, undo: { state: "refused" } });
    expect(isConflict(refused!)).toBe(true);
    expect(await queue.settleUndo(r.idem_key, true, T0)).toMatchObject({ undone: true, undo: { state: "done" } });
  });

  it("withheld while its batch was on the way: the server's answer wins, and it is marked for a server undo", async () => {
    const { queue } = await setup();
    await queue.add(record(1));
    await queue.undoLocally(record(1).idem_key, T0);
    const sent = await queue.markSent(record(1).idem_key, outcome({ idem_key: record(1).idem_key }), T0);
    expect(sent).toMatchObject({ state: "sent", undone: true, undo: { state: "requested" } });
  });
});
