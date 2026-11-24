/** The offline decision mirrors apps/api domain/decision.ts for what a scanner can know (01 §7, §8). */
import { describe, expect, it } from "vitest";
import type { ScanResult } from "@synan/contracts/enums";
import { decideLocally, type HistoryItem, type LocalCheckpoint, type LocalInput, type Resolution } from "../src/data/api/decide";
import { entry, ref16 } from "./helpers";

const ZONE = "zone-ground";
const ROOM = "room-auditorium";
const front: LocalCheckpoint = { id: "cp-front", perimeter: true, zoneId: ZONE, roomId: null };
const east: LocalCheckpoint = { id: "cp-east", perimeter: true, zoneId: ZONE, roomId: null };
const doors: LocalCheckpoint = { id: "cp-doors", perimeter: false, zoneId: ZONE, roomId: ROOM };
const T = 1_800_000_000_000;
const KEY = ref16(1);

const known = (p: Partial<Extract<Resolution, { known: true }>> = {}, e: Parameters<typeof entry>[0] = { credential_hash: KEY }): Resolution => ({
  known: true,
  credentialKey: KEY,
  carrier: "nfc",
  entry: entry({ permitted_room_ids: [ROOM], ...e }),
  deadBand: false,
  emailCid: null,
  ...p,
});

const run = (p: Partial<LocalInput>): ScanResult =>
  decideLocally({ resolution: known(), medium: "nfc", checkpoint: front, direction: "in", nowMs: T, history: [], spentEmailCids: new Set(), ...p }).result;

const h = (checkpoint: LocalCheckpoint, atMs: number, result: ScanResult = "admitted", direction: "in" | "out" = "in", undone = false): HistoryItem => ({
  credentialKey: KEY,
  checkpoint,
  direction,
  result,
  atMs,
  undone,
});

describe("local decision, in the server's order", () => {
  it("1 — fails closed: anything not resolved against a trusted list is unknown_token", () => {
    expect(run({ resolution: { known: false, credentialKey: null } })).toBe("unknown_token");
  });

  it("2 — a QR inside is wristband_required (before its state is looked at); a spent emailed code is pass_spent", () => {
    expect(run({ resolution: known({ carrier: "qr_portal" }, { credential_hash: KEY, state: "revoked" }), medium: "qr", checkpoint: doors })).toBe("wristband_required");
    expect(run({ resolution: known({ carrier: "qr_email", emailCid: "c1" }, { credential_hash: KEY, qr_email_spent: true }), medium: "qr" })).toBe("pass_spent");
    expect(run({ resolution: known({ carrier: "qr_email", emailCid: "c1" }), medium: "qr", spentEmailCids: new Set(["c1"]) })).toBe("pass_spent");
    expect(run({ resolution: known({ carrier: "qr_email", emailCid: "c2" }), medium: "qr", spentEmailCids: new Set(["c1"]) })).toBe("admitted");
  });

  it("3 — revoked, replaced and lost bands read revoked; under review reads suspended", () => {
    expect(run({ resolution: known({}, { credential_hash: KEY, revoked: true }) })).toBe("revoked");
    expect(run({ resolution: known({}, { credential_hash: KEY, state: "replaced" }) })).toBe("revoked");
    expect(run({ resolution: known({ deadBand: true }) })).toBe("revoked");
    expect(run({ resolution: known({}, { credential_hash: KEY, state: "suspended_review" }) })).toBe("suspended");
  });

  it("4 — same credential, same gate, within 60 s of the last passage is duplicate_read; undone passages do not count", () => {
    expect(run({ history: [h(front, T - 59_000)] })).toBe("duplicate_read");
    expect(run({ history: [h(front, T - 59_000, "already_inside")] })).toBe("duplicate_read");
    expect(run({ history: [h(front, T - 59_000, "denied_room")] })).toBe("admitted");
    expect(run({ history: [h(front, T - 59_000, "admitted", "in", true)] })).toBe("admitted");
    expect(run({ history: [h(front, T - 61_000)] })).toBe("already_inside");
  });

  it("exits pass steps 1–4 and are admitted, even where the tier may not enter", () => {
    expect(run({ checkpoint: doors, direction: "out", resolution: known({}, { credential_hash: KEY, permitted_room_ids: [] }) })).toBe("admitted");
    expect(run({ checkpoint: doors, direction: "out", resolution: known({}, { credential_hash: KEY, revoked: true }) })).toBe("revoked");
  });

  it("5 — a room gate refuses a pass without that room; a perimeter gate with no room admits any valid pass", () => {
    expect(run({ checkpoint: doors, resolution: known({}, { credential_hash: KEY, permitted_room_ids: [] }) })).toBe("denied_room");
    expect(run({ checkpoint: front, resolution: known({}, { credential_hash: KEY, permitted_room_ids: [] }) })).toBe("admitted");
  });

  it("6 — already inside: by zone at a perimeter gate (any perimeter gate seen by this device), by room inside", () => {
    expect(run({ checkpoint: east, history: [h(front, T - 10 * 60_000)] })).toBe("already_inside");
    // Re-entry after an out scan is allowed.
    expect(run({ history: [h(front, T - 10 * 60_000), h({ ...front, id: "cp-exit" }, T - 5 * 60_000, "admitted", "out")] })).toBe("admitted");
    expect(run({ checkpoint: doors, history: [h(doors, T - 5 * 60_000)] })).toBe("already_inside");
    // Moving between rooms in one zone is not blocked.
    expect(run({ checkpoint: doors, history: [h({ ...doors, id: "cp-other", roomId: "room-expo" }, T - 5 * 60_000)] })).toBe("admitted");
    const d = decideLocally({ resolution: known(), medium: "nfc", checkpoint: east, direction: "in", nowMs: T, history: [h(front, T - 4 * 60_000)], spentEmailCids: new Set() });
    expect(d).toEqual({ result: "already_inside", step: 6, lastInAtMs: T - 4 * 60_000 });
  });

  it("8 — otherwise admitted (capacity is not knowable offline; the server catches it at sync)", () => {
    expect(run({})).toBe("admitted");
    expect(run({ checkpoint: doors })).toBe("admitted");
  });
});
