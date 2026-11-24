/**
 * The pass at the door (A4): which of the five states it shows for every credential state the API
 * can send, and which rotating code is on screen at a given moment (data/pass.ts currentCode,
 * data/shared.ts displayState). The screen shows `currentCode(batch, now())`, where now() is the
 * server's clock (see api-backend.test.ts for the offset).
 */
import { describe, expect, it, vi } from "vitest";
import { CredentialState } from "@synan/contracts/enums";
import { CREDENTIAL_STATES, currentCode } from "../src/data/pass";
import { displayState, hasBand } from "../src/data/shared";
import { codeBatch, codeText, credential, EVENT_A } from "./fixtures";

vi.mock("../src/data/backend", () => ({ backend: {} }));

describe("the pass's state", () => {
  it.each(CredentialState.options)("maps %s to one of the five states the pass shows", (state) => {
    for (const band of [true, false]) expect(CREDENTIAL_STATES).toContain(displayState(state, band));
  });

  it("is READY only for a usable pass with a live band, and NOT YET BOUND for one without", () => {
    expect(displayState("issued", true)).toBe("READY");
    expect(displayState("active", true)).toBe("READY");
    expect(displayState("issued", false)).toBe("NOT YET BOUND");
    expect(displayState("active", false)).toBe("NOT YET BOUND");
  });

  it("says REVOKED, REPLACED or UNDER REVIEW whatever the band, so a stopped pass never reads as ready", () => {
    for (const band of [true, false]) {
      expect(displayState("revoked", band)).toBe("REVOKED");
      expect(displayState("replaced", band)).toBe("REPLACED");
      expect(displayState("suspended_review", band)).toBe("UNDER REVIEW");
    }
  });

  it("counts a band as live only when it is an NFC carrier that is bound or active", () => {
    const withBand = (state: "bound" | "active" | "lost" | "retired" | "assigned" | "stock") =>
      credential(EVENT_A, { carriers: [{ kind: "nfc", state, identifier_hint: "band ••1234" }] });
    expect(hasBand(withBand("bound"))).toBe(true);
    expect(hasBand(withBand("active"))).toBe(true);
    for (const state of ["lost", "retired", "assigned", "stock"] as const) expect(hasBand(withBand(state))).toBe(false);
    expect(hasBand(credential(EVENT_A, { carriers: [{ kind: "qr_portal", state: "active", identifier_hint: "app" }] }))).toBe(false);
  });
});

describe("the code on screen", () => {
  const start = Date.parse("2026-12-01T10:00:00.000Z");
  const batch = codeBatch(start, 15);

  it("is the code whose window holds the moment: from not_before (inclusive) to expires_at (exclusive)", () => {
    expect(currentCode(batch, start)?.code).toBe(codeText(0));
    expect(currentCode(batch, start + 59_999)?.code).toBe(codeText(0));
    // The countdown reaches zero exactly when the next code takes over: never a second with none.
    expect(currentCode(batch, start + 60_000)?.code).toBe(codeText(1));
    expect(currentCode(batch, start + 14 * 60_000 + 30_000)?.code).toBe(codeText(14));
  });

  it("is none before the batch starts, and none once the batch has run out (the 'needs a connection' state)", () => {
    expect(currentCode(batch, start - 1)).toBeNull();
    expect(currentCode(batch, start + 15 * 60_000 - 1)?.code).toBe(codeText(14));
    expect(currentCode(batch, start + 15 * 60_000)).toBeNull();
  });

  it("follows the server's clock: a phone 2 minutes slow still shows the code the gate expects", () => {
    const deviceNow = start + 30_000;
    const offset = 120_000; // server time minus device time
    expect(currentCode(batch, deviceNow + offset)?.code).toBe(codeText(2));
    expect(currentCode(batch, deviceNow)?.code).toBe(codeText(0));
  });

  it("shows nothing in a gap between codes rather than a code outside its window", () => {
    const gappy = { ...batch, codes: [batch.codes[0]!, batch.codes[2]!] };
    expect(currentCode(gappy, start + 90_000)).toBeNull();
  });
});
