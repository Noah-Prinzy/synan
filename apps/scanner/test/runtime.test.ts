/**
 * The runtime's pure parts: pairing from GET /me/assignments alone (A2), the refresh retry inside
 * the server's reuse grace (A3), and the heartbeat bodies carrying the allowlist's age (A4).
 */
import { describe, expect, it } from "vitest";
import { GateHeartbeat, type StaffAssignment, type TokenPair } from "@synan/contracts/rest";
import { ClientHeartbeat } from "@synan/contracts/ws";
import { ApiFailure, refreshWithRetry } from "../src/data/api/client";
import { gatesFromAssignments } from "../src/data/api/runtime";
import { heartbeatFrame } from "../src/data/api/stream";

const EVENT = "11111111-1111-4111-8111-111111111111";
const T = Date.parse("2026-11-24T12:00:00.000Z");
const H = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();

function assignment(n: number, p: Partial<StaffAssignment> = {}): StaffAssignment {
  const cp = `22222222-2222-4222-8222-00000000000${n}`;
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${n}`,
    user_id: "u",
    checkpoint_id: cp,
    shift_start: iso(T - H),
    shift_end: iso(T + H),
    event_id: EVENT,
    handed_over_at: null,
    checkpoint: { id: cp, label: `Gate ${n}`, perimeter: n === 1, direction: n === 1 ? "in" : "both", zone_id: "zone", zone_name: "Ground", room_id: n === 1 ? null : "room", room_name: n === 1 ? null : "Main Auditorium" },
    event: { id: EVENT, title: "Summit" },
    ...p,
  };
}

describe("pairing from GET /me/assignments alone", () => {
  it("builds each gate from the embedded checkpoint and event", () => {
    const { gates, event } = gatesFromAssignments([assignment(1), assignment(2)], T);
    expect(event).toEqual({ id: EVENT, title: "Summit" });
    expect(gates).toHaveLength(2);
    expect(gates[0]).toMatchObject({ label: "Gate 1", perimeter: true, roomId: null, api: { eventId: EVENT, eventTitle: "Summit", zoneId: "zone", direction: "in", shiftStart: T - H, shiftEnd: T + H } });
    expect(gates[1]).toMatchObject({ label: "Gate 2", perimeter: false, roomId: "room", roomName: "Main Auditorium", api: { direction: "both" } });
  });

  it("one row per gate: the current shift over a later one; ended, handed-over and between-event shifts left out", () => {
    const later = assignment(1, { id: "later", shift_start: iso(T + 2 * H), shift_end: iso(T + 3 * H) });
    const { gates } = gatesFromAssignments([later, assignment(1)], T);
    expect(gates.map((g) => g.api!.assignmentId)).toEqual([assignment(1).id]);
    expect(gatesFromAssignments([later], T).gates[0]!.api!.assignmentId).toBe("later");
    expect(gatesFromAssignments([assignment(1, { shift_end: iso(T - 1) })], T).gates).toHaveLength(0);
    expect(gatesFromAssignments([assignment(1, { handed_over_at: iso(T - 1) })], T).gates).toHaveLength(0);
    expect(gatesFromAssignments([assignment(1, { event_id: null, event: null })], T)).toEqual({ gates: [], event: null });
  });
});

describe("refresh retry inside the server's grace", () => {
  const pair = { access_token: "a2", refresh_token: "r2" } as TokenPair;

  it("a lost answer: the SAME token is sent once more, and its re-issued pair is used", async () => {
    const sent: string[] = [];
    let n = 0;
    const out = await refreshWithRetry(
      "r1",
      async (t) => {
        sent.push(t);
        if (n++ === 0) throw new ApiFailure("network", 0, null, "No answer from the server.");
        return pair;
      },
      async () => undefined,
    );
    expect(out).toBe(pair);
    expect(sent).toEqual(["r1", "r1"]);
  });

  it("a refusal is not retried (reuse, expiry, revocation end the session); a second lost answer gives up", async () => {
    const sent: string[] = [];
    const refused = new ApiFailure("http", 401, "UNAUTHENTICATED", "no");
    await expect(refreshWithRetry("r1", async (t) => (sent.push(t), Promise.reject(refused)), async () => undefined)).rejects.toBe(refused);
    expect(sent).toEqual(["r1"]);
    const lost = new ApiFailure("network", 503, null, "down");
    await expect(refreshWithRetry("r1", async (t) => (sent.push(t), Promise.reject(lost)), async () => undefined)).rejects.toBe(lost);
    expect(sent).toEqual(["r1", "r1", "r1"]);
  });
});

describe("heartbeats carry the device id and the allowlist's issued_at", () => {
  const body = { queue_depth: 3, clock_offset_ms: -120, online: true, device_id: "scanner-abc", allowlist_issued_at: iso(T) };

  it("the stream frame", () => {
    expect(ClientHeartbeat.parse(heartbeatFrame(body))).toEqual({ type: "heartbeat", ...body });
    expect(ClientHeartbeat.parse(heartbeatFrame({ ...body, allowlist_issued_at: null })).allowlist_issued_at).toBeNull();
  });

  it("the REST body", () => {
    expect(GateHeartbeat.parse({ checkpoint_id: "22222222-2222-4222-8222-000000000001", ...body })).toMatchObject({ device_id: "scanner-abc", allowlist_issued_at: iso(T) });
  });
});
