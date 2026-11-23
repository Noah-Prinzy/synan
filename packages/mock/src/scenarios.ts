/**
 * The named scenarios in docs/02 §8. Each one schedules steps on the mock clock, so
 * a paused or fast-forwarded clock replays it deterministically. Names are used in
 * the demo script and the acceptance tests ("show me a breach" is one call).
 */
import type { MockGate, MockRealtime } from "./realtime";

export const SCENARIO_NAMES = [
  "doors_open",
  "capacity_overflow",
  "breach_restricted_room",
  "gate_offline",
  "credential_revoked_mid_pass",
  "impossible_travel",
  "offline_conflict",
  "occupancy_drift",
  "clock_skew",
] as const;

export type ScenarioName = (typeof SCENARIO_NAMES)[number];

export interface ScenarioContext {
  rt: MockRealtime;
  /** Run `fn` `ms` after the scenario starts, in virtual time. */
  at(ms: number, fn: () => void): void;
}

function gate(rt: MockRealtime, index: number): MockGate {
  return rt.gates[index] as MockGate;
}

function roomIds(rt: MockRealtime): string[] {
  return [...rt.rooms.keys()];
}

export const SCENARIOS: Record<ScenarioName, (ctx: ScenarioContext) => void> = {
  /** Burst of 40 scans per second for 10 s across the perimeter gates. */
  doors_open({ rt, at }) {
    const rooms = roomIds(rt);
    for (let i = 0; i < 400; i++) {
      at(i * 25, () => {
        const g = gate(rt, i % 3);
        const roll = (i * 7919) % 100;
        const result = roll < 90 ? "admitted" : roll < 96 ? "already_inside" : "duplicate_read";
        rt.scan({ gate: g, result, tier: roll % 10 === 0 ? "VIP" : "ORDINARY" });
        if (result === "admitted" && rooms.length > 0) rt.adjustRoom(rooms[i % rooms.length] as string, 1);
      });
    }
  },

  /** A room passes its warn threshold, then its block threshold. */
  capacity_overflow({ rt, at }) {
    const roomId = roomIds(rt)[1];
    if (!roomId) return;
    const room = rt.rooms.get(roomId);
    if (!room) return;
    const start = Math.floor(room.capacity * 0.8);
    rt.setRoom(roomId, start);
    for (let n = 1; n <= room.capacity - start; n++) {
      at(n * 300, () => {
        rt.adjustRoom(roomId, 1);
        rt.scan({ gate: gate(rt, 3), result: "admitted", carrier: "nfc" });
        const now = rt.rooms.get(roomId);
        if (now && now.occupancy === Math.ceil(now.capacity * 0.85)) {
          rt.alert({ kind: "capacity_warn", severity: "medium", detail: "Room passed its warning threshold", checkpoint_id: gate(rt, 3).id });
        }
      });
    }
    at((room.capacity - start + 1) * 300, () => {
      rt.scan({ gate: gate(rt, 3), result: "capacity_block", carrier: "nfc" });
    });
  },

  /** A tier is denied at a restricted room and an alert is raised. */
  breach_restricted_room({ rt, at }) {
    at(500, () => {
      const scanId = rt.scan({ gate: gate(rt, 3), result: "denied_room", carrier: "nfc", tier: "PUBLIC" });
      rt.alert({
        kind: "unauthorised_tier",
        severity: "high",
        detail: "Public tier presented at a restricted room",
        checkpoint_id: gate(rt, 3).id,
        scan_ids: [scanId],
      });
    });
  },

  /** A gate loses its link, queues locally, then reconnects and drains. */
  gate_offline({ rt, at }) {
    const g = gate(rt, 2);
    at(0, () => rt.gateHealth(g, { link_state: "online", scans_last_minute: 22 }));
    at(1000, () => {
      rt.gateHealth(g, { link_state: "offline", last_heartbeat_at: new Date(rt.clock.now() - 61_000).toISOString() });
      rt.alert({ kind: "gate_offline", severity: "high", detail: "No heartbeat for more than 60 seconds", checkpoint_id: g.id });
    });
    for (let s = 1; s <= 8; s++) {
      at(1000 + s * 1500, () => rt.gateHealth(g, { link_state: "offline", queue_depth: s * 23, last_heartbeat_at: null }));
    }
    at(14_000, () => {
      rt.gateHealth(g, { link_state: "online", queue_depth: 0, scans_last_minute: 184 });
      for (let i = 0; i < 12; i++) rt.scan({ gate: g, result: "admitted", offline: true });
    });
  },

  /** The attendee's pass flips to revoked while A4 is open. */
  credential_revoked_mid_pass({ rt, at }) {
    at(3000, () => rt.passStatus("revoked"));
  },

  /** One credential at two distant gates too fast: suspended for review. */
  impossible_travel({ rt, at }) {
    let first = "";
    at(500, () => {
      first = rt.scan({ gate: gate(rt, 0), result: "admitted" });
    });
    at(2500, () => {
      const second = rt.scan({ gate: gate(rt, 2), result: "suspended" });
      rt.alert({
        kind: "impossible_travel",
        severity: "critical",
        detail: "Scanned at Gate 1 · North and Gate 3 · West within 20 s; minimum transit 4 min",
        checkpoint_id: gate(rt, 2).id,
        scan_ids: [first, second],
      });
      rt.passStatus("suspended_review");
    });
  },

  /**
   * Two offline gates accept the same single-use emailed QR; caught at sync.
   * The gates' links are carried by gate.health; the client's own link stays up.
   */
  offline_conflict({ rt, at }) {
    const a = gate(rt, 0);
    const b = gate(rt, 1);
    at(0, () => {
      rt.gateHealth(a, { link_state: "offline", queue_depth: 14, last_heartbeat_at: null });
      rt.gateHealth(b, { link_state: "offline", queue_depth: 9, last_heartbeat_at: null });
    });
    for (let s = 1; s <= 4; s++) {
      at(s * 1000, () => {
        rt.gateHealth(a, { link_state: "offline", queue_depth: 14 + s * 3, last_heartbeat_at: null });
        rt.gateHealth(b, { link_state: "offline", queue_depth: 9 + s * 2, last_heartbeat_at: null });
      });
    }
    at(5000, () => {
      rt.gateHealth(a, { link_state: "online", queue_depth: 0 });
      rt.gateHealth(b, { link_state: "online", queue_depth: 0 });
      const s1 = rt.scan({ gate: a, result: "admitted", carrier: "qr_email", offline: true, correctedOffsetMs: -4200 });
      const s2 = rt.scan({ gate: b, result: "admitted", carrier: "qr_email", offline: true, correctedOffsetMs: -3100 });
      rt.alert({
        kind: "offline_conflict_pass_reuse",
        severity: "high",
        detail: "Single-use emailed pass accepted at two offline gates",
        scan_ids: [s1, s2],
      });
    });
  },

  /** Nobody taps out: counts climb, then implied exits and the session-end reset correct them. */
  occupancy_drift({ rt, at }) {
    const [hall, workshop] = roomIds(rt);
    if (!hall || !workshop) return;
    for (let i = 1; i <= 20; i++) at(i * 200, () => rt.adjustRoom(workshop, 1));
    // The same people are admitted to the hall: implied exits remove them from the workshop.
    for (let i = 1; i <= 20; i++) {
      at(4500 + i * 150, () => {
        rt.adjustRoom(hall, 1);
        rt.adjustRoom(workshop, -1);
        rt.scan({ gate: gate(rt, 0), result: "implied_exit", carrier: "nfc" });
      });
    }
    // The workshop's session ends: its count returns to zero.
    at(9000, () => rt.setRoom(workshop, 0));
  },

  /** A scanner with a wrong clock syncs; corrected times order the scans. */
  clock_skew({ rt, at }) {
    const g = gate(rt, 1);
    at(0, () => {
      rt.gateHealth(g, { link_state: "online", clock_offset_ms: 185_000, clock_fault: true });
      rt.alert({ kind: "clock_skew", severity: "low", detail: "Scanner clock is 3 min 5 s fast", checkpoint_id: g.id });
    });
    for (let i = 0; i < 6; i++) {
      at(1000 + i * 200, () => rt.scan({ gate: g, result: "admitted", offline: true, correctedOffsetMs: -185_000 + i * 1000 }));
    }
  },
};
