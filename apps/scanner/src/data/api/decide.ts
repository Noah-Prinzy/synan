/**
 * The offline decision: apps/api `domain/decision.ts` (docs/01 §7) restricted to what a scanner can
 * know — the verified allowlist and this device's own scans. First failing step decides.
 *
 *   1. unknown token (no trusted allowlist, bad/expired QR, not on the list) → unknown_token  (fail closed)
 *   2. QR at an interior gate → wristband_required; spent emailed QR → pass_spent
 *   3. revoked / replaced / lost band → revoked; under review → suspended
 *   4. same credential, same gate, within 60 s of the last passage → duplicate_read
 *      (exits stop here: admitted)
 *   5. room not in the entry's permitted rooms → denied_room
 *   6. already inside (zone at a perimeter gate, room at an interior gate; this device's scans only) → already_inside
 *   7. capacity: NOT KNOWABLE OFFLINE (the allowlist carries no counts); the server catches it at sync (D-13)
 *   8. → admitted
 *
 * Pure: no I/O, no clock.
 */
import type { AllowlistEntry, AllowlistPayload } from "@synan/contracts/rest";
import type { ScanDirection, ScanResult } from "@synan/contracts/enums";

export const DEBOUNCE_MS = 60_000;

export interface LocalCheckpoint {
  id: string;
  perimeter: boolean;
  zoneId: string;
  roomId: string | null;
}

/** One earlier scan on this device, as the decision needs it. */
export interface HistoryItem {
  /** The allowlist `credential_hash` (or, without one, the carrier's own hash). */
  credentialKey: string;
  checkpoint: LocalCheckpoint;
  direction: ScanDirection;
  result: ScanResult;
  /** Server-corrected time of the scan, ms. */
  atMs: number;
  undone: boolean;
}

export type Resolution =
  | { known: false; credentialKey: string | null }
  | {
      known: true;
      credentialKey: string;
      carrier: "qr_portal" | "qr_email" | "nfc";
      entry: AllowlistEntry;
      /** The band is on the entry's lost/retired list. */
      deadBand: boolean;
      /** Emailed QR: its carrier id (single use). */
      emailCid: string | null;
    };

export interface LocalDecision {
  result: ScanResult;
  step: 1 | 2 | 3 | 4 | 5 | 6 | 8;
  /** For ALREADY INSIDE: when the passage that put them inside happened (corrected ms). */
  lastInAtMs: number | null;
}

/** Allowlist lookups, built once per verified list. */
export interface AllowlistIndex {
  payload: AllowlistPayload;
  byCredential: Map<string, AllowlistEntry>;
  byNfc: Map<string, AllowlistEntry>;
  byDeadNfc: Map<string, AllowlistEntry>;
}

export function indexAllowlist(payload: AllowlistPayload): AllowlistIndex {
  const byCredential = new Map<string, AllowlistEntry>();
  const byNfc = new Map<string, AllowlistEntry>();
  const byDeadNfc = new Map<string, AllowlistEntry>();
  for (const e of payload.entries) {
    byCredential.set(e.credential_hash, e);
    for (const h of e.nfc_hashes) byNfc.set(h, e);
    for (const h of e.dead_nfc_hashes) byDeadNfc.set(h, e);
  }
  return { payload, byCredential, byNfc, byDeadNfc };
}

const passage = (r: ScanResult) => r === "admitted" || r === "already_inside";

/** Where this device last saw the credential: perimeter zone and room (mirrors the server's projection). */
export function presenceOf(history: readonly HistoryItem[], key: string): { zoneId: string | null; zoneAt: number | null; roomId: string | null; roomAt: number | null } {
  let zoneId: string | null = null;
  let zoneAt: number | null = null;
  let roomId: string | null = null;
  let roomAt: number | null = null;
  const mine = history.filter((h) => h.credentialKey === key && !h.undone && passage(h.result)).sort((a, b) => a.atMs - b.atMs);
  for (const h of mine) {
    const cp = h.checkpoint;
    if (h.result === "already_inside") {
      if (cp.perimeter && zoneId === null) {
        zoneId = cp.zoneId;
        zoneAt = h.atMs;
      }
      continue;
    }
    if (h.direction === "in") {
      if (cp.perimeter) {
        zoneId = cp.zoneId;
        zoneAt = h.atMs;
      }
      if (cp.roomId) {
        roomId = cp.roomId;
        roomAt = h.atMs;
      }
    } else {
      if (cp.roomId && roomId === cp.roomId) {
        roomId = null;
        roomAt = null;
      }
      if (cp.perimeter) {
        zoneId = zoneAt = roomId = roomAt = null;
      }
    }
  }
  return { zoneId, zoneAt, roomId, roomAt };
}

export interface LocalInput {
  resolution: Resolution;
  medium: "qr" | "nfc";
  checkpoint: LocalCheckpoint;
  direction: ScanDirection;
  /** Server-corrected time of this read, ms. */
  nowMs: number;
  history: readonly HistoryItem[];
  /** Emailed-QR carrier ids this device has already admitted. */
  spentEmailCids: ReadonlySet<string>;
}

export function decideLocally(input: LocalInput): LocalDecision {
  const { resolution: r, checkpoint: cp } = input;
  const out = (result: ScanResult, step: LocalDecision["step"], lastInAtMs: number | null = null): LocalDecision => ({ result, step, lastInAtMs });

  // 1 — known? (No trusted allowlist resolves as unknown: fail closed.)
  if (!r.known) return out("unknown_token", 1);

  // 2 — carrier accepted here (D-11)?
  if (r.carrier !== "nfc" && !cp.perimeter) return out("wristband_required", 2);
  if (r.carrier === "qr_email" && (r.entry.qr_email_spent || (r.emailCid !== null && input.spentEmailCids.has(r.emailCid)))) {
    return out("pass_spent", 2);
  }

  // 3 — state. A lost or retired band no longer opens anything.
  const st = r.entry.state;
  if (r.entry.revoked || st === "revoked" || st === "replaced" || r.deadBand) return out("revoked", 3);
  if (st === "suspended_review") return out("suspended", 3);

  // 4 — debounce from the last passage at this gate.
  const here = input.history
    .filter((h) => h.credentialKey === r.credentialKey && h.checkpoint.id === cp.id && !h.undone && passage(h.result))
    .reduce<number | null>((m, h) => (m === null || h.atMs > m ? h.atMs : m), null);
  if (here !== null && Math.abs(input.nowMs - here) < DEBOUNCE_MS) return out("duplicate_read", 4);

  // Exits: steps 5–7 concern entry only.
  if (input.direction === "out") return out("admitted", 8);

  // 5 — entitlement. A gate with no room admits any valid credential for the event.
  if (cp.roomId !== null && !r.entry.permitted_room_ids.includes(cp.roomId)) return out("denied_room", 5);

  // 6 — anti-passback, as far as this device knows.
  const p = presenceOf(input.history, r.credentialKey);
  if (cp.perimeter ? p.zoneId === cp.zoneId : cp.roomId !== null && p.roomId === cp.roomId) {
    return out("already_inside", 6, cp.perimeter ? p.zoneAt : p.roomAt);
  }

  // 7 — capacity is not knowable offline. 8:
  return out("admitted", 8);
}
