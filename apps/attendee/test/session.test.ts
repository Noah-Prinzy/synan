// @vitest-environment happy-dom
/**
 * The token pair kept on the phone (data/api/session.ts): a session whose refresh token has expired
 * is over whatever the access token says, a refresh keeps the name the pass shows offline, and a
 * different person signing in on the same phone never inherits the last one's name.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionStore } from "../src/data/api/session";
import { SESSION_EVENT } from "../src/data/shared";
import { OTHER_PERSON, PERSON, tokenPair } from "./fixtures";

const NOW = Date.parse("2026-12-01T10:00:00.000Z");

beforeEach(() => localStorage.clear());

describe("the stored session", () => {
  it("is over once the refresh token has expired, and is removed from the device", () => {
    let now = NOW;
    const store = createSessionStore(() => now);
    store.save(tokenPair(NOW, { refreshMs: 60_000 }));
    expect(store.read()).not.toBeNull();
    now = NOW + 60_000;
    expect(store.read()).toBeNull();
    expect(localStorage.getItem("syn.api.session")).toBeNull();
  });

  it("keeps the name on a refresh, so the pass still shows it offline, without telling the screens", () => {
    const store = createSessionStore(() => NOW);
    store.save(tokenPair(NOW), "Ada Lovelace");
    const heard = vi.fn();
    window.addEventListener(SESSION_EVENT, heard);
    const refreshed = store.save(tokenPair(NOW));
    window.removeEventListener(SESSION_EVENT, heard);
    expect(refreshed.name).toBe("Ada Lovelace");
    expect(heard).not.toHaveBeenCalled();
  });

  it("does not carry one person's name over to another who signs in on the same phone", () => {
    const store = createSessionStore(() => NOW);
    store.save(tokenPair(NOW, { sub: PERSON }), "Ada Lovelace");
    const heard = vi.fn();
    window.addEventListener(SESSION_EVENT, heard);
    const next = store.save(tokenPair(NOW, { sub: OTHER_PERSON, email: "grace@example.com" }));
    window.removeEventListener(SESSION_EVENT, heard);
    expect(next).toMatchObject({ sub: OTHER_PERSON, name: null, email: "grace@example.com" });
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("lasts for the page when storage is refused (private browsing)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const store = createSessionStore(() => NOW);
    const pair = tokenPair(NOW);
    store.save(pair);
    expect(store.read()?.refresh_token).toBe(pair.refresh_token);
    vi.restoreAllMocks();
  });
});
