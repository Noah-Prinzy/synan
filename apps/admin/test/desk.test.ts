// @vitest-environment happy-dom
/**
 * The registration desk (desk/): the band number a reader or a clerk types, the attendee search
 * (debounced, results always for the latest query), and the offline banner when the venue's
 * Wi-Fi goes nowhere. The desk's client is faked; nothing is sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { RegistrationRow } from "@synan/contracts/rest";
import type { DeskRegistration, DeskRegistrationPage } from "@synan/mock/command";
import { ApiFailure } from "../src/api/failure";
import { bandProblem, maskBand, normaliseBand } from "../src/desk/copy";
import { cleanup, renderHook } from "./render-hook";

const registrations = vi.hoisted(() => vi.fn<(eventId: string, query: { q?: string; limit?: number }) => Promise<DeskRegistrationPage>>());
vi.mock("../src/desk/desk-api", () => ({
  desk: { registrations, mock: { isOffline: () => false } },
  isOffline: () => false,
}));

const { useDeskSearch } = await import("../src/desk/use-desk-search");
const { track, useOffline } = await import("../src/desk/use-online");

const EVENT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
let seq = 0;
function row(name: string): DeskRegistration {
  seq++;
  const id = `d1d1d1d1-d1d1-41d1-81d1-${String(seq).padStart(12, "0")}`;
  return {
    ...RegistrationRow.parse({
      id, event_id: EVENT, tier: "ORDINARY", state: "confirmed", zone_presence_consent_at: null, created_at: "2026-11-01T09:00:00.000Z",
      attendee: { id, full_name: name, email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com` },
    }),
    carrier_id: null,
    pass_sent_at: null,
  };
}
const page = (...names: string[]): DeskRegistrationPage => ({ items: names.map(row), next_cursor: null });

let onLine = true;
beforeEach(() => {
  vi.useFakeTimers();
  registrations.mockReset();
  onLine = true;
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => onLine });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the band number", () => {
  it("is tidied as readers and printed labels write it: separators dropped, capitals", () => {
    expect(normaliseBand(" 04:a1-b2 c3d4 ")).toBe("04A1B2C3D4");
    expect(normaliseBand("04-A1-B2-C3")).toBe("04A1B2C3");
  });

  it("is accepted when it is 8 to 32 hex characters, whatever the separators", () => {
    for (const raw of ["04A1B2C3", "04:a1:b2:c3:d4:e5:f6", "0".repeat(32)]) expect(bandProblem(raw), raw).toBeNull();
  });

  it("is refused in words a clerk can act on: nothing scanned, an O for a zero, a stray letter, too short, too long", () => {
    expect(bandProblem("  ")).toBe("Scan the band, or type the number printed inside it.");
    expect(bandProblem("04A1BOC3")).toMatch(/Is that an O where a zero should be\?/);
    expect(bandProblem("04A1BXC3")).toMatch(/“X” is not one of them/);
    expect(bandProblem("04A1B2")).toBe("That is 6 characters; a band number has at least 8. Scan it again.");
    expect(bandProblem("0".repeat(33))).toMatch(/at most 32\. Clear the field and scan once\./);
    // Two scans run together read as one long number: the clerk is told to clear the field.
    expect(bandProblem("04A1B2C3D4E5F60704A1B2C3D4E5F60707")).toMatch(/Clear the field/);
  });

  it("is masked to its last four, as the server's band hint reads", () => {
    expect(maskBand("04:a1:b2:c3")).toBe("••••B2C3");
    expect(maskBand("ab")).toBe("AB");
  });
});

describe("the attendee search", () => {
  const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

  it("searches 150 ms after typing stops, once, for the final text", async () => {
    registrations.mockResolvedValue(page("Ada Lovelace"));
    const view = renderHook((q: string) => useDeskSearch(EVENT, q), "ad");
    await advance(100);
    view.rerender("ada");
    await advance(100);
    view.rerender("ada l");
    await advance(149);
    expect(registrations).not.toHaveBeenCalled();
    await advance(1);
    expect(registrations).toHaveBeenCalledTimes(1);
    expect(registrations).toHaveBeenCalledWith(EVENT, { q: "ada l", limit: 20 });
    expect(view.result.current.state).toMatchObject({ forQuery: "ada l", loading: false });
    expect(view.result.current.state.items?.map((r) => r.attendee.full_name)).toEqual(["Ada Lovelace"]);
  });

  it("does not search for fewer than two characters, and says so", async () => {
    const view = renderHook((q: string) => useDeskSearch(EVENT, q), " a ");
    await advance(1000);
    expect(registrations).not.toHaveBeenCalled();
    expect(view.result.current.tooShort).toBe(true);
    view.rerender("");
    expect(view.result.current.tooShort).toBe(false);
  });

  it("keeps the server's order, and never shows an older search's answer over a newer one", async () => {
    let answerOld!: (p: DeskRegistrationPage) => void;
    registrations.mockImplementationOnce(() => new Promise((resolve) => (answerOld = resolve)));
    registrations.mockResolvedValueOnce(page("Grace Hopper", "Grace Kelly"));
    const view = renderHook((q: string) => useDeskSearch(EVENT, q), "ada");
    await advance(150);
    view.rerender("grace");
    await advance(150);
    expect(view.result.current.state.items?.map((r) => r.attendee.full_name)).toEqual(["Grace Hopper", "Grace Kelly"]);
    await act(async () => answerOld(page("Ada Lovelace")));
    expect(view.result.current.state.forQuery).toBe("grace");
    expect(view.result.current.state.items?.map((r) => r.attendee.full_name)).toEqual(["Grace Hopper", "Grace Kelly"]);
  });

  it("keeps the last results on screen when a search fails, and runs it again when the connection is back", async () => {
    registrations.mockResolvedValueOnce(page("Ada Lovelace"));
    const view = renderHook((q: string) => useDeskSearch(EVENT, q), "ada");
    await advance(150);
    registrations.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    view.rerender("ada lo");
    await advance(150);
    expect(view.result.current.state.error).toBeInstanceOf(TypeError);
    expect(view.result.current.state.items?.map((r) => r.attendee.full_name)).toEqual(["Ada Lovelace"]);

    registrations.mockResolvedValueOnce(page("Ada Lovelace", "Ada Lowe"));
    await act(async () => window.dispatchEvent(new Event("online")));
    await advance(150);
    expect(view.result.current.state).toMatchObject({ forQuery: "ada lo", error: null });
    expect(view.result.current.state.items).toHaveLength(2);
  });

  it("puts a fresher copy of one registration in the results after a bind", async () => {
    registrations.mockResolvedValue(page("Ada Lovelace", "Ada Lowe"));
    const view = renderHook((q: string) => useDeskSearch(EVENT, q), "ada");
    await advance(150);
    const first = view.result.current.state.items![0]!;
    act(() => view.result.current.patch({ ...first, band_hint: "••81BF" }));
    expect(view.result.current.state.items![0]!.band_hint).toBe("••81BF");
    expect(view.result.current.state.items![1]!.band_hint).toBeUndefined();
  });
});

describe("the offline banner", () => {
  it("shows when a desk request could not reach the server (the mock's TypeError), and clears on the next success", async () => {
    const view = renderHook(() => useOffline(), undefined);
    await act(async () => track(Promise.reject(new TypeError("Failed to fetch"))).catch(() => undefined));
    expect(view.result.current).toBe(true);
    await act(async () => track(Promise.resolve("ok")));
    expect(view.result.current).toBe(false);
  });

  it("shows when the real API got no answer although the browser says it is online", async () => {
    const view = renderHook(() => useOffline(), undefined);
    const noAnswer = new ApiFailure("INTERNAL", 0, { kind: "network", detail: "POST /carriers/bind: no answer" });
    await act(async () => track(Promise.reject(noAnswer)).catch(() => undefined));
    expect(view.result.current).toBe(true);
    await act(async () => track(Promise.resolve("ok")));
    expect(view.result.current).toBe(false);
  });

  it("does not show for a refusal the server did answer", async () => {
    const view = renderHook(() => useOffline(), undefined);
    await act(async () => track(Promise.reject(new ApiFailure("CONFLICT", 409))).catch(() => undefined));
    expect(view.result.current).toBe(false);
  });

  it("shows whenever the browser says it is offline", async () => {
    onLine = false;
    const view = renderHook(() => useOffline(), undefined);
    expect(view.result.current).toBe(true);
  });
});
