/**
 * The admin's API client (api/client.ts): the second-factor step-up every privileged action goes
 * through (rebind, resend, export, publish a live venue), and the operator's session. A fake
 * server behind `fetch`; nothing real is sent.
 */
import { describe, expect, it, vi } from "vitest";
import { BreachAlert, TokenPair } from "@synan/contracts/rest";
import { createApiClient, STEP_UP_ATTEMPTS, type StepUpAnswer, type StepUpRequest } from "../src/api/client";
import { createSessionStore, type KeyValueStorage } from "../src/api/session";

const NOW = Date.parse("2026-12-01T10:00:00.000Z");
const ALERT = "c0c0c0c0-c0c0-40c0-80c0-000000000001";
const OTHER_ALERT = "c0c0c0c0-c0c0-40c0-80c0-000000000002";
const iso = (ms: number) => new Date(ms).toISOString();

let seq = 0;
function pair(p: { accessMs?: number; mfa?: boolean } = {}): TokenPair {
  seq++;
  return TokenPair.parse({
    token_type: "Bearer",
    access_token: `access-${seq}`,
    access_expires_at: iso(NOW + (p.accessMs ?? 10 * 60_000)),
    refresh_token: `refresh-token-${String(seq).padStart(8, "0")}`,
    refresh_expires_at: iso(NOW + 12 * 3600_000),
    principal: { sub: "u1", kind: "operator", role: "organiser", email: "op@example.com", mfa: p.mfa ?? false, mfa_enrolled: true },
  });
}

const alertBody = (id: string) =>
  BreachAlert.parse({
    id,
    event_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    severity: "high",
    kind: "invalid_qr",
    checkpoint_id: null,
    credential_id: null,
    occurred_at: iso(NOW),
    state: "acked",
    acked_by: null,
    acked_at: iso(NOW),
    resolution_note: null,
    scan_ids: [],
    detail: "x",
  });

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const apiError = (code: string, status: number, headers: Record<string, string> = {}) => json({ error: { code, message: code } }, status, headers);

type Req = { method: string; path: string; body: unknown; token: string | null };

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

/**
 * A server where the alert actions need a stepped-up token: `stepped` holds the access tokens
 * that passed /auth/mfa/verify, and `good` is the one code it accepts.
 */
function setup(p: { good?: string; verify?: (body: { code: string }) => Response | null; session?: TokenPair; route?: (r: Req) => Response | null } = {}) {
  const stepped = new Set<string>();
  const requests: Req[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const r: Req = {
      method: init?.method ?? "GET",
      path: url.pathname.replace(/^\/api\/v1/, ""),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      token: headers.Authorization?.replace(/^Bearer /, "") ?? null,
    };
    requests.push(r);
    const custom = p.route?.(r);
    if (custom) return custom;
    if (r.path === "/auth/mfa/verify") {
      const answer = p.verify?.(r.body as { code: string });
      if (answer) return answer;
      if ((r.body as { code: string }).code !== (p.good ?? "123456")) return apiError("INVALID_MFA_CODE", 401);
      const next = pair({ mfa: true });
      stepped.add(next.access_token);
      return json(next);
    }
    if (r.path.startsWith("/alerts/")) {
      if (!r.token || !stepped.has(r.token)) return apiError("MFA_REQUIRED", 403);
      return json(alertBody(r.path.split("/")[2]!));
    }
    if (r.path === "/auth/refresh") return json(pair());
    return apiError("NOT_FOUND", 404);
  };
  const session = createSessionStore({ storage: memoryStorage(), now: () => NOW });
  session.save(p.session ?? pair(), "login");
  const client = createApiClient({
    baseUrl: "http://api.test/api/v1",
    session,
    fetch: fetchImpl as typeof fetch,
    now: () => NOW,
    online: () => true,
    lock: (_name, task) => task(),
  });
  const settled = vi.fn();
  client.onStepUpSettled(settled);
  const signedOut = vi.fn();
  client.onSignedOut(signedOut);
  return { client, session, requests, settled, signedOut };
}

/** A prompt that answers from a script, recording what it was asked. */
function prompt(...answers: StepUpAnswer[]) {
  const asked: StepUpRequest[] = [];
  const handler = vi.fn(async (request: StepUpRequest) => {
    asked.push(request);
    return answers.shift() ?? { cancel: true as const };
  });
  return { handler, asked };
}

const ack = (client: ReturnType<typeof setup>["client"], id = ALERT) => client.call("ackAlert", { params: { id } });

describe("the second-factor step-up", () => {
  it("asks once, verifies the code, then repeats the original call with the stepped-up token", async () => {
    const { client, requests, settled, session } = setup();
    const { handler, asked } = prompt({ code: " 123456 " });
    client.onStepUp(handler);
    await expect(ack(client)).resolves.toMatchObject({ id: ALERT, state: "acked" });
    expect(asked).toEqual([{ kind: "mfa_required", operation: "ackAlert", attempt: 1, problem: null }]);
    expect(requests.map((r) => r.path)).toEqual([`/alerts/${ALERT}/ack`, "/auth/mfa/verify", `/alerts/${ALERT}/ack`]);
    expect(requests[1]!.body).toEqual({ code: "123456" });
    expect(settled).toHaveBeenCalledWith({ ok: true });
    expect(session.read()?.mfa_until).toBe(NOW + 15 * 60_000);
  });

  it("asks again after a wrong code, saying why, and succeeds with the right one", async () => {
    const { client, settled } = setup();
    const { handler, asked } = prompt({ code: "000000" }, { code: "123456" });
    client.onStepUp(handler);
    await expect(ack(client)).resolves.toMatchObject({ id: ALERT });
    expect(asked.map((a) => [a.attempt, a.problem?.code ?? null])).toEqual([
      [1, null],
      [2, "INVALID_MFA_CODE"],
    ]);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("asks again, without sending it, when the code is not six digits", async () => {
    const { client, requests } = setup();
    const { handler, asked } = prompt({ code: "12345" }, { code: "123456" });
    client.onStepUp(handler);
    await ack(client);
    expect(asked[1]!.problem).toMatchObject({ code: "VALIDATION_FAILED", status: 0 });
    expect(requests.filter((r) => r.path === "/auth/mfa/verify")).toHaveLength(1);
  });

  it(`gives up after ${STEP_UP_ATTEMPTS} wrong codes: the call fails and the prompt is told`, async () => {
    const { client, settled, requests } = setup();
    const { handler } = prompt(...Array.from({ length: 5 }, () => ({ code: "000000" })));
    client.onStepUp(handler);
    await expect(ack(client)).rejects.toMatchObject({ code: "INVALID_MFA_CODE" });
    expect(handler).toHaveBeenCalledTimes(STEP_UP_ATTEMPTS);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled.mock.calls[0]![0]).toMatchObject({ ok: false });
    expect(requests.filter((r) => r.path === `/alerts/${ALERT}/ack`)).toHaveLength(1);
  });

  it("fails the call with MFA_REQUIRED when the operator cancels, and tells the prompt", async () => {
    const { client, settled } = setup();
    client.onStepUp(prompt({ cancel: true }).handler);
    await expect(ack(client)).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    expect(settled).toHaveBeenCalledWith({ ok: false, error: expect.objectContaining({ code: "MFA_REQUIRED" }) });
  });

  it("stops at once, without asking again, when the server rate-limits the codes", async () => {
    const { client, settled } = setup({ verify: () => apiError("RATE_LIMITED", 429, { "Retry-After": "60" }) });
    const { handler } = prompt({ code: "123456" }, { code: "123456" });
    client.onStepUp(handler);
    await expect(ack(client)).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterS: 60 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(settled.mock.calls[0]![0]).toMatchObject({ ok: false });
  });

  it("shares one prompt between calls that need it at the same time, then repeats each of them", async () => {
    const { client, requests, settled } = setup();
    let answer!: (a: StepUpAnswer) => void;
    const handler = vi.fn(() => new Promise<StepUpAnswer>((resolve) => (answer = resolve)));
    client.onStepUp(handler);
    const first = ack(client, ALERT);
    const second = ack(client, OTHER_ALERT);
    await vi.waitFor(() => expect(handler).toHaveBeenCalled());
    // Let the second call reach its own MFA_REQUIRED before the code is given.
    await new Promise((resolve) => setTimeout(resolve, 0));
    answer({ code: "123456" });
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(requests.filter((r) => r.path === "/auth/mfa/verify")).toHaveLength(1);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("fails with MFA_REQUIRED when no prompt is registered, or when the caller asked for no prompt", async () => {
    const { client } = setup();
    await expect(ack(client)).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    const { handler } = prompt({ code: "123456" });
    client.onStepUp(handler);
    await expect(client.call("ackAlert", { params: { id: ALERT } }, { noStepUp: true })).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("forgets a prompt once it is unregistered", async () => {
    const { client } = setup();
    const { handler } = prompt({ code: "123456" });
    const unregister = client.onStepUp(handler);
    unregister();
    await expect(ack(client)).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("the operator's session", () => {
  it("refreshes ahead of expiry, once for several calls", async () => {
    const { client, requests } = setup({ session: pair({ accessMs: 10_000 }), route: (r) => (r.path === "/time" ? json({ server_time: iso(NOW), epoch_ms: NOW, qr_leeway_s: 5, undo_window_s: 60 }) : null) });
    await Promise.all([client.call("dashboard").catch(() => null), client.call("dashboard").catch(() => null)]);
    expect(requests.filter((r) => r.path === "/auth/refresh")).toHaveLength(1);
  });

  it("ends the session, once, when the server refuses the refresh", async () => {
    const { client, session, signedOut } = setup({ session: pair({ accessMs: 0 }), route: (r) => (r.path === "/auth/refresh" ? apiError("UNAUTHENTICATED", 401) : null) });
    await expect(ack(client)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(session.read()).toBeNull();
    expect(signedOut).toHaveBeenCalledTimes(1);
  });

  it("keeps the session when the refresh got no answer", async () => {
    const { client, session, signedOut } = setup({
      session: pair({ accessMs: 0 }),
      route: (r) => {
        if (r.path === "/auth/refresh") throw new TypeError("Failed to fetch");
        return null;
      },
    });
    await expect(ack(client)).rejects.toMatchObject({ kind: "network" });
    expect(session.read()).not.toBeNull();
    expect(signedOut).not.toHaveBeenCalled();
  });

  // As in the attendee client: the server re-issues a rotated refresh token only when the same token
  // comes back within its 10 s reuse grace, so a refresh whose answer was lost is sent once more at
  // once with the same token (as the scanner's refreshWithRetry), not on the next call, too late.
  it("retries a refresh whose answer was lost with the same refresh token, at once", async () => {
    const stale = pair({ accessMs: 0 });
    let attempts = 0;
    const { client, requests } = setup({
      session: stale,
      good: "123456",
      route: (r) => {
        if (r.path !== "/auth/refresh") return null;
        attempts++;
        if (attempts === 1) throw new TypeError("Failed to fetch");
        return json(pair({ mfa: true }));
      },
    });
    client.onStepUp(prompt({ code: "123456" }).handler);
    await expect(ack(client)).resolves.toMatchObject({ id: ALERT });
    const sent = requests.filter((r) => r.path === "/auth/refresh");
    expect(sent.map((r) => r.body)).toEqual([{ refresh_token: stale.refresh_token }, { refresh_token: stale.refresh_token }]);
  });

  it("checks a request against the contract before sending it", async () => {
    const { client, requests } = setup();
    await expect(client.call("ackAlert", { params: { id: "not-a-uuid" } })).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 0 });
    expect(requests).toHaveLength(0);
  });

  it("measures the server's clock from GET /time, halfway through the round trip", async () => {
    let now = NOW;
    const session = createSessionStore({ storage: memoryStorage(), now: () => now });
    const client = createApiClient({
      baseUrl: "http://api.test",
      session,
      now: () => now,
      fetch: (async () => {
        now += 200; // the answer takes 200 ms; the server stamped it 100 ms in, 5 s ahead
        return json({ server_time: iso(NOW + 5_100), epoch_ms: NOW + 5_100, qr_leeway_s: 5, undo_window_s: 60 });
      }) as typeof fetch,
    });
    await expect(client.syncTime()).resolves.toBe(5_000);
    expect(client.offsetMs()).toBe(5_000);
  });
});
