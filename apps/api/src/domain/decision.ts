/**
 * The scan decision (docs/01-product.md §7) as a pure function.
 *
 *   1. unknown token                → unknown_token
 *   2. carrier not accepted here    → wristband_required | pass_spent
 *   3. credential revoked / review  → revoked | suspended
 *   4. same credential, same gate, within 60 s → duplicate_read
 *   5. tier not permitted here now  → denied_room
 *   6. already inside               → already_inside
 *   7. room at blocking threshold   → capacity_block (or admitted + alert under admit_with_alert)
 *   8.                              → admitted
 *
 * The first step that fails decides. No I/O, no clock: everything arrives in `DecisionInput`.
 */
import type {
  AlertKind,
  CapacityPolicy,
  CarrierKind,
  CarrierState,
  CredentialState,
  ScanDirection,
  ScanResult,
  Severity,
} from "@synan/contracts/enums";

export const DEBOUNCE_MS = 60_000;

export type UnknownReason =
  | "malformed"
  | "bad_signature"
  | "expired"
  | "not_yet_valid"
  | "unknown_credential"
  | "unknown_carrier"
  | "carrier_unbound"
  | "wrong_event";

export type ResolvedToken =
  | { known: false; medium: "qr" | "nfc"; reason: UnknownReason }
  | {
      known: true;
      medium: "qr" | "nfc";
      carrierKind: CarrierKind;
      /** Null for a portal QR, which is a signed assertion rather than a stored carrier. */
      carrierState: CarrierState | null;
      /** Emailed QR only: already redeemed once (or superseded by a resend). */
      emailSpent: boolean;
    };

export interface DecisionCheckpoint {
  perimeter: boolean;
  zoneId: string;
  roomId: string | null;
}

export interface DecisionRoom {
  occupancy: number;
  capacity: number;
  warnAtPct: number;
  blockAtPct: number;
  policy: CapacityPolicy;
}

export interface DecisionInput {
  token: ResolvedToken;
  /** Null exactly when `token.known` is false. */
  credentialState: CredentialState | null;
  /** `OUTSIDE` or `INSIDE_<zone_id>`. */
  zoneState: string;
  checkpoint: DecisionCheckpoint;
  direction: ScanDirection;
  /** Corrected time of this scan (occurred_at + clock_offset_ms), epoch ms. */
  nowMs: number;
  /** Corrected time of this credential's last passage (admitted / already_inside) at this checkpoint. */
  lastPassageHereMs: number | null;
  /** Result of the access-rule evaluation for this room at nowMs. */
  entitled: boolean;
  /** Room the credential is currently counted in (presence projection). */
  currentRoomId: string | null;
  /** Live state of the checkpoint's room; null for a checkpoint with no room. */
  room: DecisionRoom | null;
  /** Denials of this credential in the recent window, for severity escalation. */
  recentDenials: number;
}

export interface AlertSpec {
  kind: AlertKind;
  severity: Severity;
  detail: string;
}

export interface Decision {
  result: ScanResult;
  /** Which of the eight steps decided (1–8). */
  step: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  alerts: AlertSpec[];
  /** True when the person passes the gate (admitted or already_inside). */
  passes: boolean;
}

const QR_KINDS: ReadonlySet<CarrierKind> = new Set(["qr_portal", "qr_email"]);
const QR_ALERT_REASONS: ReadonlySet<UnknownReason> = new Set([
  "bad_signature",
  "expired",
  "not_yet_valid",
  "unknown_credential",
  "unknown_carrier",
]);

export function blockThreshold(room: Pick<DecisionRoom, "capacity" | "blockAtPct">): number {
  return Math.ceil((room.capacity * room.blockAtPct) / 100);
}
export function warnThreshold(room: Pick<DecisionRoom, "capacity" | "warnAtPct">): number {
  return Math.ceil((room.capacity * room.warnAtPct) / 100);
}

export function escalate(recentDenials: number): Severity {
  if (recentDenials <= 0) return "medium";
  if (recentDenials === 1) return "high";
  return "critical";
}

export function decide(input: DecisionInput): Decision {
  const { token, checkpoint } = input;

  // 1 — known credential?
  if (!token.known || input.credentialState === null) {
    const alerts: AlertSpec[] = [];
    // A random third-party QR is not an attack; a forged, expired or replayed code of ours is (03 §8.2).
    if (!token.known && token.medium === "qr" && QR_ALERT_REASONS.has(token.reason)) {
      alerts.push({ kind: "invalid_qr", severity: "medium", detail: `QR refused (${token.reason})` });
    }
    return { result: "unknown_token", step: 1, alerts, passes: false };
  }

  // 2 — carrier accepted at this gate? (D-11)
  if (QR_KINDS.has(token.carrierKind) && !checkpoint.perimeter) {
    return { result: "wristband_required", step: 2, alerts: [], passes: false };
  }
  if (token.carrierKind === "qr_email" && token.emailSpent) {
    return {
      result: "pass_spent",
      step: 2,
      alerts: [{ kind: "pass_replayed", severity: "high", detail: "Single-use emailed QR presented again" }],
      passes: false,
    };
  }

  // 3 — credential state. A lost or retired carrier is treated as revoked (it no longer opens anything).
  const cs = input.credentialState;
  if (cs === "revoked" || cs === "replaced" || token.carrierState === "lost" || token.carrierState === "retired") {
    return { result: "revoked", step: 3, alerts: [], passes: false };
  }
  if (cs === "suspended_review") {
    return { result: "suspended", step: 3, alerts: [], passes: false };
  }

  // 4 — debounce: same credential, same gate, within 60 s of the last passage.
  if (input.lastPassageHereMs !== null && Math.abs(input.nowMs - input.lastPassageHereMs) < DEBOUNCE_MS) {
    return { result: "duplicate_read", step: 4, alerts: [], passes: false };
  }

  // Exits: steps 5–7 concern entry only. An exit that survives 1–4 is recorded as admitted.
  if (input.direction === "out") {
    return { result: "admitted", step: 8, alerts: [], passes: true };
  }

  // 5 — entitlement.
  if (!input.entitled) {
    return {
      result: "denied_room",
      step: 5,
      alerts: [
        {
          kind: "unauthorised_tier",
          severity: escalate(input.recentDenials),
          detail: `Entry refused by access rules${input.recentDenials > 0 ? ` (attempt ${input.recentDenials + 1})` : ""}`,
        },
      ],
      passes: false,
    };
  }

  // 6 — anti-passback. Perimeter: already inside this zone. Interior: already counted in this room.
  const alreadyInside = checkpoint.perimeter
    ? input.zoneState === `INSIDE_${checkpoint.zoneId}`
    : checkpoint.roomId !== null && input.currentRoomId === checkpoint.roomId;
  if (alreadyInside) {
    return { result: "already_inside", step: 6, alerts: [], passes: true };
  }

  // 7 — capacity.
  const alerts: AlertSpec[] = [];
  if (input.room) {
    const room = input.room;
    const block = blockThreshold(room);
    if (room.occupancy >= block) {
      if (room.policy === "admit_with_alert") {
        alerts.push({
          kind: "capacity_exceeded",
          severity: "high",
          detail: `Admitted over blocking threshold (${room.occupancy + 1}/${room.capacity})`,
        });
        return { result: "admitted", step: 7, alerts, passes: true };
      }
      return { result: "capacity_block", step: 7, alerts: [], passes: false };
    }
    const warn = warnThreshold(room);
    if (room.occupancy < warn && room.occupancy + 1 >= warn) {
      alerts.push({
        kind: "capacity_warn",
        severity: "low",
        detail: `Room reached warning threshold (${room.occupancy + 1}/${room.capacity})`,
      });
    }
  }

  // 8
  return { result: "admitted", step: 8, alerts, passes: true };
}

/** Results that count as a passage for debounce and presence. */
export function isPassage(result: ScanResult): boolean {
  return result === "admitted" || result === "already_inside";
}

/** Results counted as `denied` in gate_rate_rollups. */
export function isDenial(result: ScanResult): boolean {
  return (
    result === "denied_room" ||
    result === "capacity_block" ||
    result === "revoked" ||
    result === "suspended" ||
    result === "unknown_token" ||
    result === "wristband_required" ||
    result === "pass_spent"
  );
}

/* ------------------------------------------------------------ entitlement */

export interface RuleLike {
  subject_kind: "tier" | "role";
  subject: string;
  room_id: string;
  window_start: number | null;
  window_end: number | null;
  effect: "permit" | "deny";
}

/**
 * Access-rule evaluation (01 §4): credential → registration (tier) → event room → rule.
 * Default deny. A matching `deny` overrides any `permit`. Windows are [start, end).
 * A checkpoint without a room is a perimeter/zone gate: any valid credential for the event passes.
 */
export function evaluateAccess(
  rules: readonly RuleLike[],
  subject: { kind: "tier" | "role"; value: string },
  roomId: string | null,
  atMs: number,
): boolean {
  if (roomId === null) return true;
  let permitted = false;
  for (const r of rules) {
    if (r.room_id !== roomId || r.subject_kind !== subject.kind || r.subject !== subject.value) continue;
    if (r.window_start !== null && atMs < r.window_start) continue;
    if (r.window_end !== null && atMs >= r.window_end) continue;
    if (r.effect === "deny") return false;
    permitted = true;
  }
  return permitted;
}

/* ------------------------------------------------------- impossible travel */

/**
 * True when the credential was read at `from` and then at `to` sooner than the
 * configured minimum transit time (01 §7). Pairs with no configured time never trip.
 */
export function isImpossibleTravel(
  prev: { checkpointId: string; atMs: number } | null,
  current: { checkpointId: string; atMs: number },
  minTransitSeconds: (from: string, to: string) => number | null,
): boolean {
  if (!prev || prev.checkpointId === current.checkpointId) return false;
  const min = minTransitSeconds(prev.checkpointId, current.checkpointId);
  if (min === null) return false;
  const elapsed = Math.abs(current.atMs - prev.atMs);
  return elapsed < min * 1000;
}

/** Clock-offset fault threshold (D-14). */
export const CLOCK_FAULT_MS = 120_000;
