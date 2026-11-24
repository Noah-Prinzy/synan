/**
 * The durable scan queue (01 §8, 03 §4, D-13, D-14).
 *
 * Every scan is one record in IndexedDB, written BEFORE its verdict is shown, keyed by a
 * client-generated idempotency key. A record carries the exact request body it will be sent with,
 * so a resend is always byte-for-byte the same scan and the server counts it once.
 *
 * Two bodies, one key. The server's idempotency fingerprint covers `offline` and `local_result`,
 * so the online attempt and the queued (offline) form of one read are different bodies:
 *   - `online`   sent at once while the link is up (offline: false); its verdict is the server's.
 *   - `offline`  the queued form (offline: true, local_result = what the gate showed).
 * If an online attempt fails ambiguously (timeout, dropped response, crash), the queue sends the
 * offline form. If the online one had in fact arrived, the server answers IDEMPOTENCY_CONFLICT
 * (nothing stored) and the queue switches to resending the online body, which replays the stored
 * outcome. Either way exactly one scan is recorded, with the right time semantics.
 *
 * Per-item results (ScanBatchResponse):
 *   outcome                  → sent
 *   RATE_LIMITED             → not stored by the server: stays queued unchanged, retried after a pause
 *   IDEMPOTENCY_CONFLICT     → switch to the online body when there is one; otherwise refused
 *   anything else            → refused (kept, shown on S4, never resent)
 * Whole-batch failures keep every item queued.
 */
import type { AttendeeTier, ScanResult } from "@synan/contracts/enums";
import type { ScanBatchResponse, ScanOutcome, ScanSubmission } from "@synan/contracts/rest";
import type { HistoryItem, LocalCheckpoint } from "./decide";
import { type Idb, SCANS } from "./idb";

export type RecordState = "pending" | "sent" | "rejected";

/** What the gate screens show for a scan (mirrors data/store Scan, API mode). */
export interface ScanDisplay {
  medium: "qr" | "nfc";
  identifier: string;
  tier: AttendeeTier | null;
  rooms: string[] | null;
  lastInAt: number | null;
}

export interface QueueRecord {
  idem_key: string;
  /** Device time of the read, ms (ordering on the device, display). */
  at: number;
  /** Principal that scanned: only that user's session may send it (the server checks assignment by user). */
  user: string;
  event_id: string;
  device_id: string;
  offline: ScanSubmission;
  online: ScanSubmission | null;
  /** Which body goes next. */
  send_as: "offline" | "online";
  state: RecordState;
  /** The online attempt is in flight until this device time; the queue leaves it alone until then. */
  inflight_until: number;
  /** Earliest device time of the next send (RATE_LIMITED pause). */
  next_at: number;
  attempts: number;
  /** Who decided the verdict that was shown. */
  decided_by: "server" | "local";
  /** The verdict shown at the gate. */
  shown: ScanResult;
  outcome: ScanOutcome | null;
  rejection: { code: string; message: string } | null;
  /** Synced at (device ms). */
  synced_at: number | null;
  /** Local history facts for later decisions. */
  credential_key: string | null;
  checkpoint: LocalCheckpoint;
  direction: "in" | "out";
  email_cid: string | null;
  undone: boolean;
  display: ScanDisplay;
}

/** The result this record stands for now: the server's once sent, else what the gate showed. */
export function resultOf(r: QueueRecord): ScanResult {
  return r.outcome?.result ?? r.shown;
}

/** Corrected time of a record: the server's once known, else occurred_at + offset. */
export function correctedAt(r: QueueRecord): number {
  if (r.outcome) return Date.parse(r.outcome.corrected_at);
  return Date.parse(r.offline.occurred_at) + r.offline.clock_offset_ms;
}

export function historyOf(records: readonly QueueRecord[]): HistoryItem[] {
  const out: HistoryItem[] = [];
  for (const r of records) {
    if (r.state === "rejected" || !r.credential_key) continue;
    out.push({ credentialKey: r.credential_key, checkpoint: r.checkpoint, direction: r.direction, result: resultOf(r), atMs: correctedAt(r), undone: r.undone });
  }
  return out;
}

/** A conflict worth showing on S4 (D-13): decided offline and the server recorded something else or raised alerts. */
export function isConflict(r: QueueRecord): boolean {
  if (r.state === "rejected") return true;
  if (!r.outcome || r.decided_by !== "local") return false;
  return r.outcome.result !== r.shown || r.outcome.alert_ids.length > 0;
}

/* ------------------------------------------------------------ store */

export class ScanQueue {
  constructor(private readonly idb: Idb) {}

  /** Write a new scan. Never overwrites an existing key. */
  add(r: QueueRecord): Promise<boolean> {
    return this.idb.add(SCANS, r);
  }

  all(): Promise<QueueRecord[]> {
    return this.idb.all<QueueRecord>(SCANS);
  }

  pending(): Promise<QueueRecord[]> {
    return this.idb.byIndex<QueueRecord>(SCANS, "state", "pending");
  }

  depth(): Promise<number> {
    return this.idb.count(SCANS, "state", "pending");
  }

  /** Update one record. A sent record is never moved back (another tab may have finished it). */
  update(key: string, fn: (r: QueueRecord) => QueueRecord | undefined): Promise<QueueRecord | undefined> {
    return this.idb.update<QueueRecord>(SCANS, key, (cur) => {
      if (!cur) return undefined;
      const next = fn(cur);
      if (!next) return undefined;
      if (cur.state === "sent" && next.state !== "sent") return undefined;
      return next;
    });
  }

  /** The online attempt answered: record the server's outcome. */
  markSent(key: string, outcome: ScanOutcome, now: number) {
    return this.update(key, (r) => ({ ...r, state: "sent", outcome: r.outcome ?? outcome, rejection: null, synced_at: r.synced_at ?? now, inflight_until: 0 }));
  }

  /** The online attempt failed or timed out: release it to the queue now. */
  release(key: string) {
    return this.update(key, (r) => (r.state === "pending" ? { ...r, inflight_until: 0 } : undefined));
  }

  setUndone(key: string) {
    return this.idb.update<QueueRecord>(SCANS, key, (cur) => (cur ? { ...cur, undone: true } : undefined));
  }

  /** Keep every unsent record; drop sent/refused ones older than `keepMs` beyond the newest `keep`. */
  async prune(now: number, keepMs: number, keep: number): Promise<void> {
    const done = (await this.all()).filter((r) => r.state !== "pending").sort((a, b) => b.at - a.at);
    const drop = done.filter((r, i) => i >= keep && now - r.at > keepMs).map((r) => r.idem_key);
    await this.idb.delete(SCANS, drop);
  }
}

/* ------------------------------------------------------------ sync */

/** How a POST /scans call failed as a whole. */
export type SendFailure =
  | { kind: "network" } // no answer, timeout, or a 5xx: the server may or may not have it
  | { kind: "auth" } // 401: refresh or sign in, then retry
  | { kind: "rate_limited"; retryAfterMs: number } // 429 for the whole request
  | { kind: "invalid" } // 400 for the whole batch (one bad item poisons it)
  | { kind: "refused"; code: string; message: string }; // 403/404/409 for the whole batch: hold

export type SendResult = { ok: true; body: ScanBatchResponse } | { ok: false; failure: SendFailure };

export interface SyncDeps {
  queue: ScanQueue;
  /** POST /scans. */
  send: (body: { event_id: string; device_id: string; scans: ScanSubmission[] }) => Promise<SendResult>;
  now: () => number;
  /** Only this user's records are sent. */
  user: string;
  batch: number;
}

export interface SyncReport {
  sent: number;
  rejected: number;
  /** Still queued and eligible; the run stopped early. */
  stoppedBy: SendFailure | null;
  /** RATE_LIMITED or held items still waiting. */
  remaining: number;
}

const RATE_PAUSE_MS = (attempts: number) => Math.min(60_000, 2_000 * 2 ** Math.min(attempts, 5));

function bodyOf(r: QueueRecord): ScanSubmission {
  return r.send_as === "online" && r.online ? r.online : r.offline;
}

/**
 * Send the queue in order, oldest first, until it is empty or the link fails. Safe to run in two
 * tabs at once (the runtime also serialises it with a Web Lock): every item carries its idempotency
 * key, and a sent record is never moved back.
 */
export async function syncQueue(d: SyncDeps): Promise<SyncReport> {
  const report: SyncReport = { sent: 0, rejected: 0, stoppedBy: null, remaining: 0 };
  // Items that failed validation on their own, isolated by splitting the batch.
  for (let round = 0; round < 1000; round++) {
    const now = d.now();
    const all = (await d.queue.pending()).filter((r) => r.user === d.user).sort((a, b) => a.at - b.at || (a.idem_key < b.idem_key ? -1 : 1));
    const eligible = all.filter((r) => r.inflight_until <= now && r.next_at <= now);
    report.remaining = all.length;
    if (eligible.length === 0) return report;
    // One event and device per request; the oldest event's scans first.
    const first = eligible[0]!;
    const group = eligible.filter((r) => r.event_id === first.event_id && r.device_id === first.device_id).slice(0, d.batch);
    const res = await sendGroup(d, group, report);
    if (!res) return report;
  }
  return report;
}

/** Returns false when the run must stop. */
async function sendGroup(d: SyncDeps, group: QueueRecord[], report: SyncReport): Promise<boolean> {
  const first = group[0]!;
  const out = await d.send({ event_id: first.event_id, device_id: first.device_id, scans: group.map(bodyOf) });
  const now = d.now();
  if (!out.ok) {
    const f = out.failure;
    if (f.kind === "invalid") {
      if (group.length > 1) {
        // Split until the bad item is alone; the good ones go through.
        const mid = Math.ceil(group.length / 2);
        return (await sendGroup(d, group.slice(0, mid), report)) && (await sendGroup(d, group.slice(mid), report));
      }
      await d.queue.update(first.idem_key, (r) => ({ ...r, state: "rejected", rejection: { code: "VALIDATION_FAILED", message: "The server could not read this scan." }, attempts: r.attempts + 1 }));
      report.rejected++;
      return true;
    }
    report.stoppedBy = f;
    return false;
  }
  const byKey = new Map(group.map((r) => [r.idem_key, r]));
  const answered = new Set<string>();
  for (const o of out.body.results) {
    if (!byKey.has(o.idem_key)) continue;
    answered.add(o.idem_key);
    await d.queue.markSent(o.idem_key, o, now);
    report.sent++;
  }
  for (const j of out.body.rejected ?? []) {
    const rec = byKey.get(j.idem_key);
    if (!rec) continue;
    answered.add(j.idem_key);
    if (j.code === "RATE_LIMITED") {
      // Not stored on the server: resend the same body later.
      await d.queue.update(j.idem_key, (r) => ({ ...r, attempts: r.attempts + 1, next_at: now + RATE_PAUSE_MS(r.attempts) }));
    } else if (j.code === "IDEMPOTENCY_CONFLICT" && rec.send_as === "offline" && rec.online) {
      // The online attempt reached the server after all: replay it.
      await d.queue.update(j.idem_key, (r) => ({ ...r, send_as: "online", attempts: r.attempts + 1 }));
    } else {
      await d.queue.update(j.idem_key, (r) => ({ ...r, state: "rejected", rejection: { code: j.code, message: j.message }, attempts: r.attempts + 1 }));
      report.rejected++;
    }
  }
  // Neither applied nor refused (should not happen): pause it rather than loop.
  for (const r of group) {
    if (!answered.has(r.idem_key)) await d.queue.update(r.idem_key, (x) => ({ ...x, attempts: x.attempts + 1, next_at: now + RATE_PAUSE_MS(x.attempts) }));
  }
  return true;
}
