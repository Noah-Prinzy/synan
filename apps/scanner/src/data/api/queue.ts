/**
 * The durable scan queue (01 §8, 03 §4, D-13, D-14).
 *
 * Every scan is one record in IndexedDB, written BEFORE its verdict is shown, keyed by a
 * client-generated idempotency key. A record carries the exact request body it will be sent with,
 * so a resend is always the same scan and the server counts it once.
 *
 * Two bodies, one key. The server's idempotency fingerprint covers `offline` and `local_result`,
 * so the online attempt and the queued (offline) form of one read are different bodies:
 *   - `online`   sent at once while the link is up (offline: false); its verdict is the server's.
 *   - `offline`  the queued form (offline: true, local_result = what the gate showed, and the
 *                `assignment_id` it was made under — not part of the fingerprint).
 * If an online attempt fails ambiguously (timeout, dropped response, crash), the queue sends the
 * offline form. If the online one had in fact arrived, the server answers IDEMPOTENCY_CONFLICT
 * (nothing stored) and the queue switches to resending the online body, which replays the stored
 * outcome. Either way exactly one scan is recorded, with the right time semantics.
 *
 * Who sends (A1). A queued scan names its assignment, so it is sent by its maker, or — after the
 * maker signed out or handed over — by whoever is on shift at that gate now on this same scanner
 * install (same `device_id`). Scans with no assignment (queued before v2) go only with their maker.
 *
 * Per-item results (ScanBatchResponse):
 *   outcome                  → sent (`late_synced` when counted under a shift already over)
 *   RATE_LIMITED             → not stored by the server: stays queued unchanged, retried after a pause
 *   IDEMPOTENCY_CONFLICT     → switch to the online body when there is one; otherwise refused
 *   CHECKPOINT_NOT_ASSIGNED,
 *   OUTSIDE_SHIFT            → held: kept and listed, retried when another signer (or shift) can send it
 *   anything else            → refused (kept, shown on S4, never resent)
 * Whole-batch failures keep every item queued.
 */
import type { AttendeeTier, ScanResult } from "@synan/contracts/enums";
import type { ScanBatchResponse, ScanOutcome, ScanSubmission } from "@synan/contracts/rest";
import { UNDO_MARGIN_MS, UNDO_WINDOW_MS } from "./config";
import type { HistoryItem, LocalCheckpoint } from "./decide";
import { type Idb, SCANS } from "./idb";

/**
 * pending   waiting to be sent
 * sent      the server has it (an outcome)
 * rejected  refused for good (kept, listed, never resent)
 * held      refused for now by who sent it (CHECKPOINT_NOT_ASSIGNED / OUTSIDE_SHIFT): kept, listed,
 *           retried when someone else on shift at that gate (or the maker on a new shift) signs in
 * withheld  an offline admission undone on this device before it was ever sent: never sent, so the
 *           server reads it exactly as its own undo would (as if it had not happened)
 */
export type RecordState = "pending" | "sent" | "rejected" | "held" | "withheld";

/** What the gate screens show for a scan (mirrors data/store Scan, API mode). */
export interface ScanDisplay {
  medium: "qr" | "nfc";
  identifier: string;
  tier: AttendeeTier | null;
  rooms: string[] | null;
  lastInAt: number | null;
}

/** S3 Undo of this admission. */
export interface UndoMark {
  /**
   * withheld   never sent (offline): undone on the device
   * requested  undone on the device; the server may hold the scan (an online attempt was in flight),
   *            so the undo is sent to the server once the scan has synced
   * done       the server undid it
   * refused    the server would not (too late, not this person's shift…); the admission stands
   */
  state: "withheld" | "requested" | "done" | "refused";
  at: number;
  message: string | null;
}

export interface QueueRecord {
  idem_key: string;
  /** Device time of the read, ms (ordering on the device, display). */
  at: number;
  /** Principal that scanned. */
  user: string;
  /** The staff assignment the scan was made under; null for scans queued before it was recorded. */
  assignment_id: string | null;
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
  /** held: the signer (`signerKey`) it was refused for; another signer may try again. */
  held_for?: string | null;
  /** Synced at (device ms). */
  synced_at: number | null;
  /** Local history facts for later decisions. */
  credential_key: string | null;
  checkpoint: LocalCheckpoint;
  direction: "in" | "out";
  email_cid: string | null;
  /** Treated as not having happened (local history): undone on the device or on the server. */
  undone: boolean;
  undo?: UndoMark | null;
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

/** Still to reach the server (counted as queued, on heartbeats and on screen). */
export const unsent = (r: QueueRecord) => r.state === "pending" || r.state === "held";

/**
 * Worth listing on S4 (D-13): refused or held by the server, decided offline and recorded otherwise
 * or with alerts, or an undo the server would not take.
 */
export function isConflict(r: QueueRecord): boolean {
  if (r.state === "rejected" || r.state === "held") return true;
  if (r.undo?.state === "refused") return true;
  if (!r.outcome || r.decided_by !== "local") return false;
  return r.outcome.result !== r.shown || r.outcome.alert_ids.length > 0;
}

/* ------------------------------------------------------------ who may send */

/** The signed-in staff member, and where they are on shift now (checkpoint id → assignment id). */
export interface Signer {
  user: string;
  onShift: ReadonlyMap<string, string>;
}

/** May this signer send this record? Its maker, or (named assignment) whoever is on shift at its gate now. */
export function canSend(r: QueueRecord, s: Signer): boolean {
  return r.user === s.user || (r.assignment_id !== null && s.onShift.has(r.checkpoint.id));
}

/** Identifies one signer for one record: a held record is retried only under a different one. */
export function signerKey(r: QueueRecord, s: Signer): string {
  return `${s.user}|${s.onShift.get(r.checkpoint.id) ?? "-"}`;
}

/** To send now, by this signer. */
export function due(r: QueueRecord, s: Signer, now: number): boolean {
  if (!canSend(r, s)) return false;
  if (r.state === "held") return r.held_for !== signerKey(r, s);
  return r.state === "pending" && r.inflight_until <= now && r.next_at <= now;
}

/* ------------------------------------------------------------ undo */

/**
 * Until when (device ms) S3 may offer Undo for this record, or null. Only the maker's own `admitted`
 * entry scan, at a gate the maker is on shift at now, within the server's window (06 S3):
 *   - never sent (offline):        withheld on the device, so the whole window;
 *   - sent, or possibly sent:      the server must agree, so the window less a margin, from the
 *                                  earlier of the read and the server's time for it.
 * `windowMs` is the server's (`undo_window_s`, see undoWindowMs), 60 s until it has said.
 */
export function undoUntil(r: QueueRecord, s: Signer | null, windowMs: number = UNDO_WINDOW_MS): number | null {
  if (!s || r.user !== s.user || !s.onShift.has(r.checkpoint.id)) return null;
  if (r.undone || r.undo || r.direction !== "in" || resultOf(r) !== "admitted") return null;
  if (r.state === "pending") return r.online === null ? r.at + windowMs : r.at + windowMs - UNDO_MARGIN_MS;
  if (r.state !== "sent" || !r.outcome) return null;
  const serverAt = Date.parse(r.outcome.corrected_at) - r.offline.clock_offset_ms;
  return Math.min(r.at, Number.isFinite(serverAt) ? serverAt : r.at) + windowMs - UNDO_MARGIN_MS;
}

/** The undo window in ms from the server's `undo_window_s` (GET /time, GET /auth/signing-keys); 60 s when it has not said. */
export function undoWindowMs(undoWindowS: unknown): number {
  return typeof undoWindowS === "number" && Number.isFinite(undoWindowS) && undoWindowS >= 0 ? undoWindowS * 1000 : UNDO_WINDOW_MS;
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

  /** Pending and held: everything that has not reached the server yet. */
  async unsent(): Promise<QueueRecord[]> {
    return [...(await this.pending()), ...(await this.idb.byIndex<QueueRecord>(SCANS, "state", "held"))];
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

  /** The server answered with an outcome: record it (a withheld record that raced a sync becomes sent too). */
  markSent(key: string, outcome: ScanOutcome, now: number) {
    return this.update(key, (r) => ({
      ...r,
      state: "sent",
      outcome: r.outcome ?? outcome,
      rejection: null,
      held_for: null,
      synced_at: r.synced_at ?? now,
      inflight_until: 0,
      // Undone on the device while it was on its way: the server now holds it, so it must undo it there.
      undo: r.undo?.state === "withheld" ? { ...r.undo, state: "requested" } : r.undo,
    }));
  }

  /** The online attempt failed or timed out: release it to the queue now. */
  release(key: string) {
    return this.update(key, (r) => (r.state === "pending" ? { ...r, inflight_until: 0 } : undefined));
  }

  /**
   * S3 Undo on the device. A scan that never left it (no online attempt, still pending) is withheld:
   * never sent. Otherwise the undo is requested from the server after the scan has synced.
   */
  undoLocally(key: string, now: number) {
    return this.update(key, (r) => {
      if (r.undone || r.undo) return undefined;
      if (r.state === "pending" && r.online === null) return { ...r, state: "withheld", undone: true, undo: { state: "withheld", at: now, message: null } };
      if (r.state === "pending" || r.state === "sent") return { ...r, undone: true, undo: { state: "requested", at: now, message: null } };
      return undefined;
    });
  }

  /** The server's answer to an undo. */
  settleUndo(key: string, ok: boolean, now: number, message: string | null = null) {
    return this.update(key, (r) => (r.undo ? { ...r, undone: ok, undo: { state: ok ? "done" : "refused", at: now, message } } : undefined));
  }

  /** Keep every unsent record; drop sent/refused/withheld ones older than `keepMs` beyond the newest `keep`. */
  async prune(now: number, keepMs: number, keep: number): Promise<void> {
    const done = (await this.all()).filter((r) => !unsent(r) && !(r.undo?.state === "requested")).sort((a, b) => b.at - a.at);
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
  /** Who is signed in: their own scans, and stranded ones at gates they are on shift at now. */
  signer: Signer;
  batch: number;
}

export interface SyncReport {
  sent: number;
  rejected: number;
  /** Refused for now (CHECKPOINT_NOT_ASSIGNED / OUTSIDE_SHIFT): kept for another signer. */
  held: number;
  /** Still queued and eligible; the run stopped early. */
  stoppedBy: SendFailure | null;
  /** Unsent items this signer may send, still waiting (paused, in flight, or held). */
  remaining: number;
}

const RATE_PAUSE_MS = (attempts: number) => Math.min(60_000, 2_000 * 2 ** Math.min(attempts, 5));

/** Codes that refuse a scan for this sender or shift, not for good: the scan is held for another. */
const HOLD_CODES = new Set(["CHECKPOINT_NOT_ASSIGNED", "OUTSIDE_SHIFT"]);

export function bodyOf(r: QueueRecord): ScanSubmission {
  if (r.send_as === "online" && r.online) return r.online;
  // The assignment travels with the queued form (scans stored before v2 gain it here when known).
  return r.assignment_id && !r.offline.assignment_id ? { ...r.offline, assignment_id: r.assignment_id } : r.offline;
}

/**
 * Send the queue in order, oldest first, until it is empty or the link fails. Safe to run in two
 * tabs at once (the runtime also serialises it with a Web Lock): every item carries its idempotency
 * key, and a sent record is never moved back.
 */
export async function syncQueue(d: SyncDeps): Promise<SyncReport> {
  const report: SyncReport = { sent: 0, rejected: 0, held: 0, stoppedBy: null, remaining: 0 };
  const tried = new Set<string>(); // held items go once per run
  for (let round = 0; round < 1000; round++) {
    const now = d.now();
    const mine = (await d.queue.unsent()).filter((r) => canSend(r, d.signer)).sort((a, b) => a.at - b.at || (a.idem_key < b.idem_key ? -1 : 1));
    const eligible = mine.filter((r) => due(r, d.signer, now) && !tried.has(r.idem_key));
    report.remaining = mine.length;
    if (eligible.length === 0) return report;
    // One event and device per request; the oldest event's scans first.
    const first = eligible[0]!;
    const group = eligible.filter((r) => r.event_id === first.event_id && r.device_id === first.device_id).slice(0, d.batch);
    for (const r of group) if (r.state === "held") tried.add(r.idem_key);
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
      await d.queue.update(first.idem_key, (r) =>
        r.state === "withheld" ? undefined : { ...r, state: "rejected", rejection: { code: "VALIDATION_FAILED", message: "The server could not read this scan." }, attempts: r.attempts + 1 },
      );
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
    } else if (HOLD_CODES.has(j.code)) {
      // Not this sender's to count (or not now): kept and listed, tried again by the next one.
      // (Undone on the device meanwhile: it stays withheld, never sent.)
      const key = signerKey(rec, d.signer);
      await d.queue.update(j.idem_key, (r) => (r.state === "withheld" ? undefined : { ...r, state: "held", held_for: key, rejection: { code: j.code, message: j.message }, attempts: r.attempts + 1 }));
      report.held++;
    } else {
      await d.queue.update(j.idem_key, (r) => (r.state === "withheld" ? undefined : { ...r, state: "rejected", rejection: { code: j.code, message: j.message }, attempts: r.attempts + 1 }));
      report.rejected++;
    }
  }
  // Neither applied nor refused (should not happen): pause it rather than loop.
  for (const r of group) {
    if (!answered.has(r.idem_key)) await d.queue.update(r.idem_key, (x) => ({ ...x, attempts: x.attempts + 1, next_at: now + RATE_PAUSE_MS(x.attempts) }));
  }
  return true;
}
