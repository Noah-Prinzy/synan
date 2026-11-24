/**
 * The runtime's pure parts: pairing from GET /me/assignments alone (A2), the refresh retry inside
 * the server's reuse grace (A3), and the heartbeat bodies carrying the allowlist's age (A4).
 */
import { describe, expect, it } from "vitest";
import { GateHeartbeat, type StaffAssignment, type TokenPair } from "@synan/contracts/rest";
import { ClientHeartbeat } from "@synan/contracts/ws";
import { ApiFailure, refreshWithRetry } from "../src/data/api/client";
import { decideLocally, indexAllowlist, type Resolution } from "../src/data/api/decide";
import { gatesFromAssignments, heartbeatAllowlistAt, offlineAllowlist } from "../src/data/api/runtime";
import { ALLOWLIST_END_GRACE_MS } from "../src/data/api/crypto";
import { heartbeatFrame } from "../src/data/api/stream";
import { entry, nfcId, payload } from "./helpers";

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
    expect(gatesFromAssignments([assignment(1, { event_id: null, event: null })], T)).toEqual({ gates: [], event: null, roomNames: {}, slugsWithoutRooms: [] });
  });

  it("names the room chips from each item's event.rooms (no public event read: unlisted events too) and the gate's own room", () => {
    const rooms = [
      { room_id: "r-hall", name: "Hall A" },
      { room_id: "r-box", name: "Boardroom" },
    ];
    const ev = { id: EVENT, title: "Private dinner", slug: "private-dinner", rooms };
    const { roomNames, slugsWithoutRooms } = gatesFromAssignments([assignment(1, { event: ev }), assignment(2, { event: ev })], T);
    expect(roomNames).toEqual({ "r-hall": "Hall A", "r-box": "Boardroom", room: "Main Auditorium" });
    expect(slugsWithoutRooms).toEqual([]);
    // An event with no rooms is named, and needs nothing more.
    expect(gatesFromAssignments([assignment(1, { event: { ...ev, rooms: [] } })], T)).toMatchObject({ roomNames: {}, slugsWithoutRooms: [] });
  });

  it("an older server (no rooms on the item): the event's slug is handed on for GET /events/:slug, once", () => {
    const ev = { id: EVENT, title: "Summit", slug: "summit" };
    const out = gatesFromAssignments([assignment(1, { event: ev }), assignment(2, { event: ev })], T);
    expect(out.slugsWithoutRooms).toEqual(["summit"]);
    expect(out.roomNames).toEqual({ room: "Main Auditorium" });
    // No slug either: nothing to read (the chips are left out).
    expect(gatesFromAssignments([assignment(1)], T).slugsWithoutRooms).toEqual([]);
  });
});

describe("the allowlist age on heartbeats after a user switch on one phone (B1)", () => {
  const CP1 = "22222222-2222-4222-8222-000000000001";
  const held = { checkpointId: CP1, issuedAtMs: T - 8 * 60_000, user: "user-x" };

  it("the person who fetched it reports its issued_at at that gate", () => {
    expect(heartbeatAllowlistAt(held, CP1, "user-x")).toBe(iso(T - 8 * 60_000));
  });

  it("the next person on the same phone reports null until their own list is fetched, then that list's", () => {
    expect(heartbeatAllowlistAt(held, CP1, "user-y")).toBeNull();
    expect(heartbeatAllowlistAt({ ...held, issuedAtMs: T - 2 * 60_000, user: "user-y" }, CP1, "user-y")).toBe(iso(T - 2 * 60_000));
  });

  it("null with no list, another gate's list, no one signed in, or a list stored before its fetcher was recorded", () => {
    expect(heartbeatAllowlistAt(null, CP1, "user-x")).toBeNull();
    expect(heartbeatAllowlistAt(held, "22222222-2222-4222-8222-000000000002", "user-x")).toBeNull();
    expect(heartbeatAllowlistAt(held, CP1, null)).toBeNull();
    expect(heartbeatAllowlistAt({ ...held, user: null }, CP1, "user-x")).toBeNull();
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

describe("an allowlist past its signed window: two hours' grace, then no list", () => {
  const EV = "11111111-1111-4111-8111-111111111111";
  const CP = "22222222-2222-4222-8222-222222222222";
  const band = nfcId("04A1B2C3D4E5F6");
  const list = payload([entry({ credential_hash: "cred-1", nfc_hashes: [band] })], { window_start: iso(T - H), window_end: iso(T + H) }, { event_id: EV, checkpoint_id: CP });
  const held = { idx: indexAllowlist(list), eventId: EV, checkpointId: CP };
  const gate = { id: CP, perimeter: true, zoneId: "zone", roomId: null };

  /** What the runtime does with a band read offline at `at` (server time). */
  const GRACE = ALLOWLIST_END_GRACE_MS;
  const offlineRead = (at: number) => {
    const { idx } = offlineAllowlist(held, EV, CP, at);
    const live = idx?.byNfc.get(band);
    const resolution: Resolution = live
      ? { known: true, credentialKey: live.credential_hash, carrier: "nfc", entry: live, deadBand: false, emailCid: null }
      : { known: false, credentialKey: band };
    return decideLocally({ resolution, medium: "nfc", checkpoint: gate, direction: "in", nowMs: at, history: [], spentEmailCids: new Set() }).result;
  };

  it("inside the window the list decides: a known band is admitted", () => {
    expect(offlineAllowlist(held, EV, CP, T)).toEqual({ idx: held.idx, trust: "inside" });
    expect(offlineRead(T)).toBe("admitted");
  });

  it("past window_end, within the grace, it still decides offline, flagged as out of date", () => {
    expect(offlineAllowlist(held, EV, CP, T + H)).toEqual({ idx: held.idx, trust: "grace" });
    expect(offlineRead(T + H)).toBe("admitted");
    expect(offlineRead(T + H + GRACE - 1)).toBe("admitted");
  });

  it("past the grace the list is no list: the same band is refused (fail closed), and the screens are told", () => {
    expect(offlineAllowlist(held, EV, CP, T + H + GRACE)).toEqual({ idx: null, trust: "untrusted" });
    expect(offlineRead(T + H + GRACE)).toBe("unknown_token");
    expect(offlineRead(T + 10 * H)).toBe("unknown_token");
  });

  it("before window_start (past the clock tolerance) it decides nothing either", () => {
    expect(offlineAllowlist(held, EV, CP, T - 2 * H)).toEqual({ idx: null, trust: "untrusted" });
    expect(offlineRead(T - 2 * H)).toBe("unknown_token");
  });

  it("a list for another event or gate is not trusted there; with none held there is nothing to say", () => {
    expect(offlineAllowlist(held, EV, "22222222-2222-4222-8222-000000000009", T)).toEqual({ idx: null, trust: "untrusted" });
    expect(offlineAllowlist(held, "11111111-1111-4111-8111-000000000009", CP, T)).toEqual({ idx: null, trust: "untrusted" });
    expect(offlineAllowlist(null, EV, CP, T)).toEqual({ idx: null, trust: null });
  });
});
