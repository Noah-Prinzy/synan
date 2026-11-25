/**
 * The attendee's API client (data/api/client.ts): the session behind every pass load. Refresh
 * before expiry, one refresh at a time, one retry after a refused token, sign-out only when the
 * server refuses the session, and the server's contract enforced on every answer.
 */
import { describe, expect, it, vi } from "vitest";
import { authEndpoints, eventEndpoints, meEndpoints, type TokenPair } from "@synan/contracts/rest";
import { createApiClient, REFRESH_RETRY_DELAY_MS, REFRESH_TIMEOUT_MS } from "../src/data/api/client";
import type { SessionStore, StoredSession } from "../src/data/api/session";
import { ApiFailure } from "../src/data/failure";
import { apiError, fakeFetch, json, me, tokenPair, type Route } from "./fixtures";

const NOW = Date.parse("2026-12-01T10:00:00.000Z");

/** The device's session store, in memory: what the client reads, saves and clears. */
function memorySession(initial: TokenPair | null): SessionStore & { current: StoredSession | null } {
  const toStored = (pair: TokenPair, name: string | null = null): StoredSession => ({
    access_token: pair.access_token,
    access_expires_at: pair.access_expires_at,
    refresh_token: pair.refresh_token,
    refresh_expires_at: pair.refresh_expires_at,
    sub: pair.principal.sub,
    email: pair.principal.email ?? "",
    name,
  });
  const store = {
    current: initial ? toStored(initial) : null,
    read: () => store.current,
    save(pair: TokenPair, name?: string | null) {
      store.current = toStored(pair, name ?? store.current?.name ?? null);
      return store.current;
    },
    setName(name: string) {
      if (store.current) store.current = { ...store.current, name };
    },
    clear() {
      store.current = null;
    },
  };
  return store;
}

function setup(session: TokenPair | null, route: Route) {
  const store = memorySession(session);
  const net = fakeFetch(route);
  const onSignedOut = vi.fn();
  const client = createApiClient({
    baseUrl: "http://api.test",
    session: store,
    refresh: authEndpoints.refresh,
    onSignedOut,
    fetch: net.fetch,
    now: () => NOW,
    online: () => true,
    lock: (_name, task) => task(),
  });
  return { client, store, requests: net.requests, onSignedOut };
}

const refreshes = <T extends { path: string }>(requests: T[]) => requests.filter((r) => r.path === "/auth/refresh");

describe("refreshing the session", () => {
  it("uses a fresh access token as it is, with no refresh", async () => {
    const pair = tokenPair(NOW, { accessMs: 5 * 60_000 });
    const { client, requests } = setup(pair, () => json(me()));
    await client.call(meEndpoints.me);
    expect(requests.map((r) => r.path)).toEqual(["/me"]);
    expect(requests[0]!.token).toBe(pair.access_token);
  });

  it("refreshes first when the access token expires within 30 seconds, then calls with the new one", async () => {
    const stale = tokenPair(NOW, { accessMs: 20_000 });
    const next = tokenPair(NOW);
    const { client, store, requests } = setup(stale, (r) => (r.path === "/auth/refresh" ? json(next) : json(me())));
    await client.call(meEndpoints.me);
    expect(requests.map((r) => r.path)).toEqual(["/auth/refresh", "/me"]);
    expect(requests[0]!.body).toEqual({ refresh_token: stale.refresh_token });
    expect(requests[0]!.token).toBeNull();
    expect(requests[1]!.token).toBe(next.access_token);
    expect(store.current?.refresh_token).toBe(next.refresh_token);
  });

  it("sends exactly one refresh when several calls find the token stale at once", async () => {
    const stale = tokenPair(NOW, { accessMs: 0 });
    const next = tokenPair(NOW);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const { client, requests } = setup(stale, async (r) => {
      if (r.path === "/auth/refresh") {
        await held;
        return json(next);
      }
      return json(me());
    });
    const calls = [client.call(meEndpoints.me), client.call(meEndpoints.me), client.call(meEndpoints.me)];
    release();
    await Promise.all(calls);
    expect(refreshes(requests)).toHaveLength(1);
    expect(requests.filter((r) => r.path === "/me").every((r) => r.token === next.access_token)).toBe(true);
  });

  it("uses the pair another tab stored while this one waited for the lock, without refreshing again", async () => {
    const stale = tokenPair(NOW, { accessMs: 0 });
    const otherTab = tokenPair(NOW);
    const store = memorySession(stale);
    const net = fakeFetch(() => json(me()));
    const client = createApiClient({
      baseUrl: "http://api.test",
      session: store,
      refresh: authEndpoints.refresh,
      fetch: net.fetch,
      now: () => NOW,
      online: () => true,
      // The other tab held the lock and rotated the token meanwhile.
      lock: async (_name, task) => {
        store.save(otherTab);
        return task();
      },
    });
    await client.call(meEndpoints.me);
    expect(refreshes(net.requests)).toHaveLength(0);
    expect(net.requests[0]!.token).toBe(otherTab.access_token);
  });

  it("refreshes once and retries once when a fresh-looking token is refused", async () => {
    const pair = tokenPair(NOW);
    const next = tokenPair(NOW);
    const { client, requests } = setup(pair, (r) => {
      if (r.path === "/auth/refresh") return json(next);
      return r.token === pair.access_token ? apiError("TOKEN_EXPIRED", 401) : json(me());
    });
    await expect(client.call(meEndpoints.me)).resolves.toMatchObject({ full_name: "Ada Lovelace" });
    expect(requests.map((r) => r.path)).toEqual(["/me", "/auth/refresh", "/me"]);
  });

  it("does not loop when the retried call is refused again", async () => {
    const { client, requests } = setup(tokenPair(NOW), (r) => (r.path === "/auth/refresh" ? json(tokenPair(NOW)) : apiError("UNAUTHENTICATED", 401)));
    await expect(client.call(meEndpoints.me)).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    expect(requests.map((r) => r.path)).toEqual(["/me", "/auth/refresh", "/me"]);
  });

  it("ends the session on this device, once, when the server refuses the refresh", async () => {
    const { client, store, onSignedOut } = setup(tokenPair(NOW, { accessMs: 0 }), (r) =>
      r.path === "/auth/refresh" ? apiError("UNAUTHENTICATED", 401) : json(me()),
    );
    await expect(client.call(meEndpoints.me)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(store.current).toBeNull();
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    // Signed out now: the next protected call fails at once, without the network.
    await expect(client.call(meEndpoints.me)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it("keeps the session when the refresh got no answer: being offline is not being signed out", async () => {
    const pair = tokenPair(NOW, { accessMs: 0 });
    const { client, store, onSignedOut } = setup(pair, () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(client.call(meEndpoints.me)).rejects.toMatchObject({ code: "NETWORK", status: 0 });
    expect(store.current?.refresh_token).toBe(pair.refresh_token);
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  // The server rotates the refresh token and re-issues it only if the SAME token comes back within
  // its 10 s reuse grace (apps/api auth-service, REFRESH_REUSE_GRACE_S). So, as the scanner's
  // refreshWithRetry, a refresh whose answer is lost (venue Wi-Fi) is sent once more at once with the
  // same token: REFRESH_TIMEOUT_MS + REFRESH_RETRY_DELAY_MS + REFRESH_TIMEOUT_MS fits inside the grace.
  it("retries a refresh whose answer was lost with the same refresh token, at once, inside the server's grace", async () => {
    const stale = tokenPair(NOW, { accessMs: 0 });
    const next = tokenPair(NOW);
    let attempts = 0;
    const { client, requests } = setup(stale, (r) => {
      if (r.path === "/auth/refresh") {
        attempts++;
        if (attempts === 1) throw new TypeError("Failed to fetch"); // the server rotated it; the answer was lost
        return json(next);
      }
      return json(me());
    });
    await expect(client.call(meEndpoints.me)).resolves.toMatchObject({ full_name: "Ada Lovelace" });
    const sent = refreshes(requests);
    expect(sent).toHaveLength(2);
    expect(sent[0]!.body).toEqual({ refresh_token: stale.refresh_token });
    expect(sent[1]!.body).toEqual({ refresh_token: stale.refresh_token });
    expect(REFRESH_TIMEOUT_MS + REFRESH_RETRY_DELAY_MS + REFRESH_TIMEOUT_MS).toBeLessThan(10_000);
  });
});

describe("public endpoints", () => {
  it("answer without a token when nobody is signed in", async () => {
    const { client, requests } = setup(null, () => json({ items: [], next_cursor: null }));
    await client.call(eventEndpoints.listEvents, { query: { limit: 10 } });
    expect(requests[0]!.token).toBeNull();
  });

  it("are still answered, without a token, when the session turns out to be over", async () => {
    const { client, requests, onSignedOut } = setup(tokenPair(NOW, { accessMs: 0 }), (r) =>
      r.path === "/auth/refresh" ? apiError("UNAUTHENTICATED", 401) : json({ items: [], next_cursor: null }),
    );
    await expect(client.call(eventEndpoints.listEvents, { query: { limit: 10 } })).resolves.toEqual({ items: [], next_cursor: null });
    expect(requests.at(-1)!.token).toBeNull();
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it("fail as offline, not anonymous, when the refresh could not be sent", async () => {
    const store = memorySession(tokenPair(NOW, { accessMs: 0 }));
    const client = createApiClient({
      baseUrl: "http://api.test",
      session: store,
      refresh: authEndpoints.refresh,
      fetch: (() => Promise.reject(new TypeError("offline"))) as typeof fetch,
      now: () => NOW,
      online: () => false,
      lock: (_name, task) => task(),
    });
    await expect(client.call(eventEndpoints.listEvents, { query: { limit: 10 } })).rejects.toMatchObject({ code: "OFFLINE" });
  });
});

describe("answers", () => {
  it("are failures with the server's code and field issues", async () => {
    const issues = [{ path: "body.phone", message: "Too short" }];
    const { client } = setup(tokenPair(NOW), () => apiError("VALIDATION_FAILED", 400, issues));
    const error = await client.call(meEndpoints.updateMyProfile, { body: { phone: "1" } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiFailure);
    expect(error).toMatchObject({ code: "VALIDATION_FAILED", status: 400, issues });
  });

  it("are classified by status when the error body is not the contract's, and as INTERNAL when the status is unknown", async () => {
    const answers: Record<number, string> = { 404: "NOT_FOUND", 409: "CONFLICT", 429: "RATE_LIMITED", 500: "INTERNAL", 502: "INTERNAL" };
    for (const [status, code] of Object.entries(answers)) {
      const { client } = setup(tokenPair(NOW), () => new Response("<html>gateway</html>", { status: Number(status) }));
      await expect(client.call(meEndpoints.me)).rejects.toMatchObject({ code, status: Number(status) });
    }
  });

  it("degrade to a status-based code when the server sends an error code this build does not know", async () => {
    const { client } = setup(tokenPair(NOW), () => apiError("BRAND_NEW_CODE", 409));
    await expect(client.call(meEndpoints.me)).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("are refused as INTERNAL when a success does not match the contract", async () => {
    const { client } = setup(tokenPair(NOW), () => json({ id: "not-a-uuid" }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(client.call(meEndpoints.me)).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("fail as OFFLINE when the device is offline and as NETWORK when it is online but nothing answered", async () => {
    for (const [onLine, code] of [[false, "OFFLINE"], [true, "NETWORK"]] as const) {
      const client = createApiClient({
        baseUrl: "http://api.test",
        session: memorySession(tokenPair(NOW)),
        refresh: authEndpoints.refresh,
        fetch: (() => Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch,
        now: () => NOW,
        online: () => onLine,
        lock: (_name, task) => task(),
      });
      await expect(client.call(meEndpoints.me)).rejects.toMatchObject({ code, status: 0 });
    }
  });
});
