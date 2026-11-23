import { describe, expect, it } from "vitest";
import { SCAN_RESULT_VALUES, type ScanResult } from "@synan/contracts/enums";
import { SCAN_RESULT_COPY } from "@synan/contracts/errors";
import {
  blockThreshold,
  decide,
  DEBOUNCE_MS,
  escalate,
  evaluateAccess,
  isImpossibleTravel,
  warnThreshold,
  type DecisionInput,
  type ResolvedToken,
  type RuleLike,
} from "../src/domain/decision.js";

const NOW = Date.parse("2026-11-23T12:00:00Z");
const nfc: ResolvedToken = { known: true, medium: "nfc", carrierKind: "nfc", carrierState: "active", emailSpent: false };
const portal: ResolvedToken = { known: true, medium: "qr", carrierKind: "qr_portal", carrierState: null, emailSpent: false };
const email = (spent: boolean): ResolvedToken => ({ known: true, medium: "qr", carrierKind: "qr_email", carrierState: null, emailSpent: spent });
const unknownNfc: ResolvedToken = { known: false, medium: "nfc", reason: "unknown_carrier" };

function input(over: Partial<DecisionInput> = {}): DecisionInput {
  return {
    token: nfc,
    credentialState: "active",
    zoneState: "OUTSIDE",
    checkpoint: { perimeter: false, zoneId: "z1", roomId: "r1" },
    direction: "in",
    nowMs: NOW,
    lastPassageHereMs: null,
    entitled: true,
    currentRoomId: null,
    room: { occupancy: 10, capacity: 100, warnAtPct: 85, blockAtPct: 100, policy: "block" },
    recentDenials: 0,
    ...over,
  };
}
const perimeter = { perimeter: true, zoneId: "z1", roomId: null } as const;

const seen = new Set<ScanResult>();
function expectResult(i: DecisionInput, result: ScanResult, step?: number) {
  const d = decide(i);
  seen.add(d.result);
  expect(d.result).toBe(result);
  if (step !== undefined) expect(d.step).toBe(step);
  expect(d.passes).toBe(result === "admitted" || result === "already_inside");
  return d;
}

describe("decide — step 1: known credential", () => {
  it("unknown NFC band → unknown_token, no alert (not an attack signal on its own)", () => {
    const d = expectResult(input({ token: unknownNfc, credentialState: null }), "unknown_token", 1);
    expect(d.alerts).toEqual([]);
  });
  it.each(["bad_signature", "expired", "not_yet_valid", "unknown_credential", "unknown_carrier"] as const)(
    "QR refused for %s → unknown_token with invalid_qr alert",
    (reason) => {
      const d = expectResult(input({ token: { known: false, medium: "qr", reason }, credentialState: null, checkpoint: perimeter }), "unknown_token", 1);
      expect(d.alerts.map((a) => a.kind)).toEqual(["invalid_qr"]);
    },
  );
  it.each(["malformed", "wrong_event", "carrier_unbound"] as const)("QR refused for %s → unknown_token, no alert", (reason) => {
    const d = expectResult(input({ token: { known: false, medium: "qr", reason }, credentialState: null, checkpoint: perimeter }), "unknown_token", 1);
    expect(d.alerts).toEqual([]);
  });
  it("a known token without a credential state is still unknown", () => {
    expectResult(input({ credentialState: null }), "unknown_token", 1);
  });
  it("step 1 beats everything else (unknown at an interior gate with QR, full room)", () => {
    expectResult(
      input({ token: { known: false, medium: "qr", reason: "bad_signature" }, credentialState: null, entitled: false, room: { occupancy: 100, capacity: 100, warnAtPct: 85, blockAtPct: 100, policy: "block" } }),
      "unknown_token",
      1,
    );
  });
});

describe("decide — step 2: carrier accepted at this gate (D-11)", () => {
  it("portal QR at an interior gate → wristband_required", () => {
    expectResult(input({ token: portal }), "wristband_required", 2);
  });
  it("emailed QR at an interior gate → wristband_required (before pass_spent)", () => {
    expectResult(input({ token: email(true) }), "wristband_required", 2);
  });
  it("spent emailed QR at the perimeter → pass_spent with pass_replayed alert", () => {
    const d = expectResult(input({ token: email(true), checkpoint: perimeter, room: null }), "pass_spent", 2);
    expect(d.alerts.map((a) => a.kind)).toEqual(["pass_replayed"]);
  });
  it("unspent emailed QR at the perimeter proceeds", () => {
    expectResult(input({ token: email(false), checkpoint: perimeter, room: null }), "admitted", 8);
  });
  it("portal QR at the perimeter proceeds", () => {
    expectResult(input({ token: portal, checkpoint: perimeter, room: null }), "admitted", 8);
  });
  it("NFC is accepted everywhere", () => {
    expectResult(input({ checkpoint: perimeter, room: null }), "admitted");
    expectResult(input(), "admitted");
  });
  it("step 2 beats step 3: revoked credential with a QR at an interior gate", () => {
    expectResult(input({ token: portal, credentialState: "revoked" }), "wristband_required", 2);
  });
  it("step 2 beats step 3: spent emailed QR on a revoked credential", () => {
    expectResult(input({ token: email(true), credentialState: "revoked", checkpoint: perimeter, room: null }), "pass_spent", 2);
  });
});

describe("decide — step 3: credential state", () => {
  it.each([
    ["revoked", "revoked"],
    ["replaced", "revoked"],
    ["suspended_review", "suspended"],
  ] as const)("credential %s → %s", (state, result) => {
    const d = expectResult(input({ credentialState: state }), result, 3);
    expect(d.alerts).toEqual([]);
  });
  it.each(["lost", "retired"] as const)("carrier %s → revoked", (carrierState) => {
    expectResult(input({ token: { ...nfc, carrierState } as ResolvedToken }), "revoked", 3);
  });
  it.each(["issued", "active"] as const)("credential %s proceeds", (state) => {
    expectResult(input({ credentialState: state }), "admitted", 8);
  });
  it("step 3 beats step 4: revoked within the debounce window", () => {
    expectResult(input({ credentialState: "revoked", lastPassageHereMs: NOW - 1000 }), "revoked", 3);
  });
  it("suspended at an exit is still refused", () => {
    expectResult(input({ credentialState: "suspended_review", direction: "out" }), "suspended", 3);
  });
});

describe("decide — step 4: debounce (60 s, same credential, same gate)", () => {
  it("1 ms inside the window → duplicate_read", () => {
    expectResult(input({ lastPassageHereMs: NOW - DEBOUNCE_MS + 1 }), "duplicate_read", 4);
  });
  it("exactly 60 s later → not a duplicate", () => {
    expectResult(input({ lastPassageHereMs: NOW - DEBOUNCE_MS }), "admitted", 8);
  });
  it("a late offline scan 30 s before the last passage is also a duplicate", () => {
    expectResult(input({ lastPassageHereMs: NOW + 30_000 }), "duplicate_read", 4);
  });
  it("step 4 beats step 5: duplicate when not entitled", () => {
    expectResult(input({ lastPassageHereMs: NOW - 5_000, entitled: false }), "duplicate_read", 4);
  });
  it("duplicate raises no alert", () => {
    expect(decide(input({ lastPassageHereMs: NOW - 1 })).alerts).toEqual([]);
  });
  it("applies to exits too", () => {
    expectResult(input({ direction: "out", lastPassageHereMs: NOW - 1 }), "duplicate_read", 4);
  });
});

describe("decide — step 5: entitlement", () => {
  it("not entitled → denied_room with an unauthorised_tier alert", () => {
    const d = expectResult(input({ entitled: false }), "denied_room", 5);
    expect(d.alerts).toHaveLength(1);
    expect(d.alerts[0]).toMatchObject({ kind: "unauthorised_tier", severity: "medium" });
  });
  it("repeat attempts escalate severity: medium → high → critical", () => {
    expect(decide(input({ entitled: false, recentDenials: 1 })).alerts[0]!.severity).toBe("high");
    expect(decide(input({ entitled: false, recentDenials: 2 })).alerts[0]!.severity).toBe("critical");
    expect(decide(input({ entitled: false, recentDenials: 9 })).alerts[0]!.severity).toBe("critical");
    expect([escalate(0), escalate(1), escalate(2)]).toEqual(["medium", "high", "critical"]);
  });
  it("step 5 beats step 6: not entitled although already inside", () => {
    expectResult(input({ entitled: false, currentRoomId: "r1" }), "denied_room", 5);
  });
  it("exits skip steps 5–7: not entitled, full room, still let out", () => {
    expectResult(
      input({ direction: "out", entitled: false, currentRoomId: "r1", room: { occupancy: 100, capacity: 100, warnAtPct: 85, blockAtPct: 100, policy: "block" } }),
      "admitted",
      8,
    );
  });
});

describe("decide — step 6: anti-passback", () => {
  it("perimeter: already inside this zone → already_inside (amber, passes, no alert)", () => {
    const d = expectResult(input({ checkpoint: perimeter, room: null, zoneState: "INSIDE_z1" }), "already_inside", 6);
    expect(d.alerts).toEqual([]);
  });
  it("perimeter: inside a different zone → admitted", () => {
    expectResult(input({ checkpoint: perimeter, room: null, zoneState: "INSIDE_z2" }), "admitted", 8);
  });
  it("perimeter: re-entry after an out scan (OUTSIDE) → admitted", () => {
    expectResult(input({ checkpoint: perimeter, room: null, zoneState: "OUTSIDE" }), "admitted", 8);
  });
  it("interior: already counted in this room → already_inside", () => {
    expectResult(input({ currentRoomId: "r1", zoneState: "INSIDE_z1" }), "already_inside", 6);
  });
  it("interior: counted in another room of the same zone → admitted (implied exit is the caller's job)", () => {
    expectResult(input({ currentRoomId: "r2", zoneState: "INSIDE_z1" }), "admitted", 8);
  });
  it("step 6 beats step 7: already inside a full room", () => {
    expectResult(
      input({ currentRoomId: "r1", room: { occupancy: 100, capacity: 100, warnAtPct: 85, blockAtPct: 100, policy: "block" } }),
      "already_inside",
      6,
    );
  });
});

describe("decide — step 7: capacity", () => {
  const room = (occupancy: number, over: Partial<NonNullable<DecisionInput["room"]>> = {}) => ({
    occupancy, capacity: 100, warnAtPct: 85, blockAtPct: 100, policy: "block" as const, ...over,
  });
  it("at the blocking threshold → capacity_block, no alert", () => {
    const d = expectResult(input({ room: room(100) }), "capacity_block", 7);
    expect(d.alerts).toEqual([]);
  });
  it("one below the blocking threshold → admitted", () => {
    expectResult(input({ room: room(99) }), "admitted", 8);
  });
  it("over the threshold (offline overrun) → still capacity_block", () => {
    expectResult(input({ room: room(130) }), "capacity_block", 7);
  });
  it("block_at_pct below 100 uses the rounded-up percentage", () => {
    expect(blockThreshold({ capacity: 10, blockAtPct: 90 })).toBe(9);
    expectResult(input({ room: room(9, { capacity: 10, blockAtPct: 90 }) }), "capacity_block", 7);
    expectResult(input({ room: room(8, { capacity: 10, blockAtPct: 90 }) }), "admitted", 8);
  });
  it("a zero-capacity room blocks everyone", () => {
    expectResult(input({ room: room(0, { capacity: 0 }) }), "capacity_block", 7);
  });
  it("admit_with_alert policy → admitted with capacity_exceeded alert", () => {
    const d = expectResult(input({ room: room(100, { policy: "admit_with_alert" }) }), "admitted", 7);
    expect(d.alerts.map((a) => a.kind)).toEqual(["capacity_exceeded"]);
  });
  it("crossing the warning threshold raises capacity_warn once", () => {
    expect(warnThreshold({ capacity: 100, warnAtPct: 85 })).toBe(85);
    expect(decide(input({ room: room(84) })).alerts.map((a) => a.kind)).toEqual(["capacity_warn"]);
    expect(decide(input({ room: room(85) })).alerts).toEqual([]);
    expect(decide(input({ room: room(83) })).alerts).toEqual([]);
  });
  it("a checkpoint without a room skips capacity", () => {
    expectResult(input({ checkpoint: perimeter, room: null }), "admitted", 8);
  });
});

describe("decide — step 8 and coverage", () => {
  it("otherwise → admitted, no alert", () => {
    const d = expectResult(input(), "admitted", 8);
    expect(d.alerts).toEqual([]);
  });

  it("every gate-facing result in the vocabulary is reachable from decide()", () => {
    // implied_exit is system-generated by the ingest; offline_queued is a client-side state.
    const expected = SCAN_RESULT_VALUES.filter((r) => r !== "implied_exit" && r !== "offline_queued");
    expect([...seen].sort()).toEqual([...expected].sort());
  });

  it("every result has UI copy, and copy agrees with decide() on who passes", () => {
    for (const r of SCAN_RESULT_VALUES) expect(SCAN_RESULT_COPY[r]).toBeDefined();
    expect(SCAN_RESULT_COPY.admitted.admits && SCAN_RESULT_COPY.already_inside.admits).toBe(true);
    for (const r of ["denied_room", "capacity_block", "revoked", "suspended", "unknown_token", "wristband_required", "pass_spent"] as const) {
      expect(SCAN_RESULT_COPY[r].admits).toBe(false);
      expect(SCAN_RESULT_COPY[r].tone).toBe("red");
    }
  });
});

describe("evaluateAccess", () => {
  const rule = (over: Partial<RuleLike> = {}): RuleLike => ({
    subject_kind: "tier", subject: "VIP", room_id: "r1", window_start: null, window_end: null, effect: "permit", ...over,
  });
  const vip = { kind: "tier" as const, value: "VIP" };

  it("default deny when no rule matches", () => {
    expect(evaluateAccess([], vip, "r1", NOW)).toBe(false);
    expect(evaluateAccess([rule({ room_id: "r2" })], vip, "r1", NOW)).toBe(false);
    expect(evaluateAccess([rule({ subject: "ORDINARY" })], vip, "r1", NOW)).toBe(false);
    expect(evaluateAccess([rule({ subject_kind: "role" })], vip, "r1", NOW)).toBe(false);
  });
  it("permit matches", () => {
    expect(evaluateAccess([rule()], vip, "r1", NOW)).toBe(true);
  });
  it("deny overrides permit regardless of order", () => {
    expect(evaluateAccess([rule(), rule({ effect: "deny" })], vip, "r1", NOW)).toBe(false);
    expect(evaluateAccess([rule({ effect: "deny" }), rule()], vip, "r1", NOW)).toBe(false);
  });
  it("time windows are [start, end)", () => {
    const w = rule({ window_start: NOW, window_end: NOW + 1000 });
    expect(evaluateAccess([w], vip, "r1", NOW - 1)).toBe(false);
    expect(evaluateAccess([w], vip, "r1", NOW)).toBe(true);
    expect(evaluateAccess([w], vip, "r1", NOW + 999)).toBe(true);
    expect(evaluateAccess([w], vip, "r1", NOW + 1000)).toBe(false);
  });
  it("a deny outside its window does not apply", () => {
    expect(evaluateAccess([rule(), rule({ effect: "deny", window_start: NOW + 1 })], vip, "r1", NOW)).toBe(true);
  });
  it("a checkpoint with no room (perimeter) admits any valid credential", () => {
    expect(evaluateAccess([], vip, null, NOW)).toBe(true);
  });
});

describe("isImpossibleTravel", () => {
  const table = (from: string, to: string) => (from === "a" && to === "b" ? 300 : null);
  it("same checkpoint never trips", () => {
    expect(isImpossibleTravel({ checkpointId: "a", atMs: NOW }, { checkpointId: "a", atMs: NOW + 1 }, table)).toBe(false);
  });
  it("no previous read never trips", () => {
    expect(isImpossibleTravel(null, { checkpointId: "b", atMs: NOW }, table)).toBe(false);
  });
  it("pairs without a configured transit time never trip", () => {
    expect(isImpossibleTravel({ checkpointId: "b", atMs: NOW }, { checkpointId: "c", atMs: NOW + 1 }, table)).toBe(false);
  });
  it("faster than the minimum trips; exactly the minimum does not", () => {
    expect(isImpossibleTravel({ checkpointId: "a", atMs: NOW }, { checkpointId: "b", atMs: NOW + 299_999 }, table)).toBe(true);
    expect(isImpossibleTravel({ checkpointId: "a", atMs: NOW }, { checkpointId: "b", atMs: NOW + 300_000 }, table)).toBe(false);
  });
  it("uses absolute elapsed time, so reordered offline scans still trip", () => {
    expect(isImpossibleTravel({ checkpointId: "a", atMs: NOW + 10_000 }, { checkpointId: "b", atMs: NOW }, table)).toBe(true);
  });
});
