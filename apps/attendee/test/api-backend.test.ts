// @vitest-environment happy-dom
/**
 * The real-API source end to end (data/api/backend.ts + remote.ts), with a fake server behind
 * `fetch` and the device's storage: the pass opens from the device, offline; codes rotate on the
 * server's clock; the pass switch offers the right passes and remembers the choice; and a session
 * the server ends leaves nothing of the person on the phone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiBackend } from "../src/data/api/backend";
import { CHOICES_KEY, CHOSEN_KEY, CODES_KEY, PASS_KEY } from "../src/data/api/store";
import { currentCode } from "../src/data/pass";
import {
  apiError,
  codeBatch,
  codeText,
  credential,
  EVENT_A,
  EVENT_B,
  EVENT_C,
  fakeFetch,
  json,
  me,
  OTHER_PERSON,
  PERSON,
  registrationItem,
  tokenPair,
  type Route,
} from "./fixtures";

const NOW = Date.parse("2026-12-01T10:00:00.000Z");
const SESSION_KEY = "syn.api.session";

function signIn(sub = PERSON, accessMs = 10 * 60_000) {
  const pair = tokenPair(NOW, { sub, accessMs });
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      access_token: pair.access_token,
      access_expires_at: pair.access_expires_at,
      refresh_token: pair.refresh_token,
      refresh_expires_at: pair.refresh_expires_at,
      sub,
      email: "ada@example.com",
      name: "Ada Lovelace",
    }),
  );
}

let onLine = true;
function server(route: Route) {
  const net = fakeFetch(route);
  vi.stubGlobal("fetch", net.fetch);
  return net.requests;
}

/** A server holding three passes: A (soonest), B (later), and C (cancelled), plus a registration with no pass. */
const holder: Route = (r) => {
  if (r.path === "/me") return json(me());
  if (r.path === "/me/registrations")
    return json({
      items: [
        registrationItem(EVENT_B, { startsAt: "2026-12-20T09:00:00.000Z", title: "Later" }),
        registrationItem(EVENT_C, { state: "cancelled", title: "Cancelled" }),
        registrationItem("dddddddd-dddd-4ddd-8ddd-dddddddddddd", { credentialState: null, title: "No pass yet" }),
        registrationItem(EVENT_A, { startsAt: "2026-12-05T09:00:00.000Z", title: "Soonest" }),
      ],
    });
  if (r.path === "/me/credential") {
    const wanted = r.query.get("event_id");
    if (wanted === EVENT_C) return apiError("NO_CREDENTIAL", 404);
    return json(credential(wanted ?? EVENT_A));
  }
  if (r.path === "/me/credential/codes") return json(codeBatch(NOW, 15, 60, NOW + 120_000));
  return apiError("NOT_FOUND", 404);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  localStorage.clear();
  onLine = true;
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => onLine });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the pass on this device", () => {
  it("opens at once from what the device kept, with no network", async () => {
    signIn();
    const requests = server(holder);
    const first = createApiBackend("http://api.test");
    await first.loadPass();
    onLine = false;
    const reloaded = createApiBackend("http://api.test");
    expect(reloaded.peekPass(null)).toMatchObject({ eventId: EVENT_A, holder: "Ada Lovelace", state: "NOT YET BOUND" });
    expect(requests.every((r) => r.token !== null)).toBe(true);
  });

  it("is never shown to another person signed in on the same phone", async () => {
    signIn();
    server(holder);
    await createApiBackend("http://api.test").loadPass();
    signIn(OTHER_PERSON);
    const reloaded = createApiBackend("http://api.test");
    expect(reloaded.peekPass(null)).toBeNull();
    expect(reloaded.passChoices()).toEqual([]);
    expect(reloaded.initialCodes()).toBeNull();
  });

  it("shows the band by its last four, and a band reported lost as lost", async () => {
    signIn();
    server((r) => {
      if (r.path === "/me/credential")
        return json(
          credential(EVENT_A, {
            carriers: [
              { kind: "nfc", state: "lost", identifier_hint: "band ••9999" },
              { kind: "nfc", state: "bound", identifier_hint: "band ••1234" },
            ],
          }),
        );
      return holder(r);
    });
    const backend = createApiBackend("http://api.test");
    const { pass } = await backend.loadPass();
    expect(pass).toMatchObject({ state: "READY", band: { hint: "••1234" }, bandLost: false });

    server((r) => (r.path === "/me/credential" ? json(credential(EVENT_A, { carriers: [{ kind: "nfc", state: "lost", identifier_hint: "band ••9999" }] })) : holder(r)));
    const lost = await createApiBackend("http://api.test").loadPass();
    expect(lost.pass).toMatchObject({ state: "NOT YET BOUND", band: null, bandLost: true });
  });
});

describe("the pass switch", () => {
  it("offers only passes that stand, soonest event first", async () => {
    signIn();
    server(holder);
    const backend = createApiBackend("http://api.test");
    await backend.loadPass();
    expect(backend.passChoices().map((c) => c.title)).toEqual(["Soonest", "Later"]);
  });

  it("shows the API's current pass when nothing was chosen", async () => {
    signIn();
    const requests = server(holder);
    const backend = createApiBackend("http://api.test");
    await backend.loadPass();
    const asked = requests.filter((r) => r.path === "/me/credential");
    expect(asked).toHaveLength(1);
    expect(asked[0]!.query.has("event_id")).toBe(false);
  });

  it("fetches the chosen pass and remembers the choice across a reload", async () => {
    signIn();
    const requests = server(holder);
    const backend = createApiBackend("http://api.test");
    await backend.loadPass();
    backend.selectPass(EVENT_B);
    const { pass } = await backend.loadPass();
    expect(pass?.eventId).toBe(EVENT_B);
    expect(requests.filter((r) => r.path === "/me/credential").at(-1)!.query.get("event_id")).toBe(EVENT_B);

    const reloaded = createApiBackend("http://api.test");
    expect(reloaded.peekPass(null)?.eventId).toBe(EVENT_B);
    await reloaded.loadPass();
    expect(requests.filter((r) => r.path === "/me/credential").at(-1)!.query.get("event_id")).toBe(EVENT_B);
  });

  it("switches back to a pass seen earlier at once, without waiting for the network", async () => {
    signIn();
    server(holder);
    const backend = createApiBackend("http://api.test");
    await backend.loadPass();
    backend.selectPass(EVENT_B);
    await backend.loadPass();
    backend.selectPass(EVENT_A);
    expect(backend.peekPass(null)?.eventId).toBe(EVENT_A);
  });

  it("drops a choice that no longer holds (the registration was cancelled) and shows the current pass", async () => {
    signIn();
    const requests = server(holder);
    const backend = createApiBackend("http://api.test");
    backend.selectPass(EVENT_C);
    const { pass } = await backend.loadPass();
    expect(pass?.eventId).toBe(EVENT_A);
    const asked = requests.filter((r) => r.path === "/me/credential").map((r) => r.query.get("event_id"));
    expect(asked).toEqual([EVENT_C, null]);
    expect(localStorage.getItem(CHOSEN_KEY)).toBeNull();
  });
});

describe("rotating codes", () => {
  it("rotate on the server's clock, measured from the batch, and keep doing so after a reload", async () => {
    signIn();
    server(holder);
    const backend = createApiBackend("http://api.test");
    await backend.loadPass();
    const batch = await backend.getCodes();
    // The server is 2 minutes ahead of this phone.
    expect(backend.now()).toBe(NOW + 120_000);
    expect(currentCode(batch, backend.now())?.code).toBe(codeText(2));

    const reloaded = createApiBackend("http://api.test");
    expect(reloaded.now()).toBe(NOW + 120_000);
    expect(currentCode(reloaded.initialCodes()!, reloaded.now())?.code).toBe(codeText(2));
  });

  it("are served from the device when offline, and fail as offline when none are kept", async () => {
    signIn();
    server(holder);
    const backend = createApiBackend("http://api.test");
    await backend.loadPass();
    onLine = false;
    await expect(backend.getCodes()).rejects.toMatchObject({ code: "OFFLINE" });
    onLine = true;
    await backend.getCodes();
    onLine = false;
    const requests = server(() => {
      throw new TypeError("offline");
    });
    await expect(backend.getCodes()).resolves.toMatchObject({ codes: expect.any(Array) });
    expect(requests).toHaveLength(0);
  });

  it("are not offered at start-up once every kept code has expired on the server's clock", async () => {
    signIn();
    server(holder);
    const backend = createApiBackend("http://api.test");
    await backend.loadPass();
    await backend.getCodes();
    // The batch runs to NOW + 15 min on the server's clock, which is 2 minutes ahead of this phone.
    vi.setSystemTime(NOW + 13 * 60_000 - 1);
    expect(createApiBackend("http://api.test").initialCodes()).not.toBeNull();
    vi.setSystemTime(NOW + 13 * 60_000);
    expect(createApiBackend("http://api.test").initialCodes()).toBeNull();
  });

  it("are never another event's: switching passes does not show the first pass's codes", async () => {
    signIn();
    server(holder);
    const backend = createApiBackend("http://api.test");
    await backend.loadPass();
    await backend.getCodes();
    backend.selectPass(EVENT_B);
    await backend.loadPass();
    expect(backend.initialCodes()).toBeNull();
  });
});

describe("when the server ends the session", () => {
  it("forgets the pass, its codes, the passes held and the choice", async () => {
    signIn();
    server(holder);
    const backend = createApiBackend("http://api.test");
    await backend.loadPass();
    backend.selectPass(EVENT_B);
    await backend.loadPass();
    await backend.getCodes();
    expect(localStorage.getItem(CODES_KEY)).not.toBeNull();

    // The access token has expired and the refresh is refused (signed out elsewhere, or erased).
    vi.setSystemTime(NOW + 11 * 60_000);
    server((r) => (r.path === "/auth/refresh" ? apiError("UNAUTHENTICATED", 401) : holder(r)));
    await expect(backend.loadPass()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    for (const key of [SESSION_KEY, PASS_KEY, CODES_KEY, CHOICES_KEY, CHOSEN_KEY]) expect(localStorage.getItem(key)).toBeNull();
    expect(backend.peekPass(null)).toBeNull();
    expect(backend.passChoices()).toEqual([]);
  });
});
