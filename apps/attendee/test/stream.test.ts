/**
 * `/stream/me` (data/api/stream.ts): the pass flips live (revoked, under review) only if this link
 * comes back after every drop. Reconnect with capped, jittered backoff; resume from the last event;
 * re-read the pass when the server cannot replay; treat a silent socket as dead; stop for good when
 * the session or the channel is refused. Fake timers and a fake WebSocket: nothing real is opened.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WS_CLOSE } from "@synan/contracts/ws";
import type { WsTicket } from "@synan/contracts/rest";
import { backoff, openMeStream, type MeStreamOptions } from "../src/data/api/stream";
import { ApiFailure } from "../src/data/failure";
import { EVENT_A, meFrame, wsTicket } from "./fixtures";

class FakeSocket {
  static all: FakeSocket[] = [];
  sent: unknown[] = [];
  closedWith: number | undefined;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    FakeSocket.all.push(this);
  }
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close(code?: number) {
    if (this.readyState === 3) return;
    this.closedWith = code;
    this.readyState = 3;
    this.onclose?.({ code: code ?? 1006, reason: "" });
  }
  /* server side */
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(frame: string) {
    this.onmessage?.({ data: frame });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code, reason: "" });
  }
}

const AT = "2026-12-01T10:00:00.000Z";
const ready = (resumed: boolean) =>
  meFrame({ type: "ready", channel: "/stream/me", scope: "own", resumed, heartbeat_interval_ms: 15_000 });
const passStatus = (id: string, state: "revoked" | "active" | "suspended_review") =>
  meFrame({ id, type: "pass.status", at: AT, data: { event_id: EVENT_A, state } });
const heartbeat = () => meFrame({ type: "heartbeat", server_time: AT });

let online = true;
let win: EventTarget;

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  online = true;
  win = new EventTarget();
  vi.stubGlobal("window", win);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function open(over: Partial<MeStreamOptions> = {}) {
  const options = {
    ticket: vi.fn<() => Promise<WsTicket>>(async () => wsTicket()),
    onEvent: vi.fn(),
    onResync: vi.fn(),
    onSignedOut: vi.fn(),
  };
  const stream = openMeStream({
    wsBase: "wss://api.test",
    ...options,
    WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    // Jitter at its lowest: the delay is exactly half the ceiling.
    random: () => 0,
    online: () => online,
    ...over,
  });
  return { stream, options };
}

/** Let the ticket promise settle so the socket exists. */
const settle = () => vi.advanceTimersByTimeAsync(0);
const latest = () => FakeSocket.all.at(-1)!;

describe("backoff", () => {
  it("doubles from 1 s and is capped at 30 s, with jitter only in the upper half", () => {
    const low = (n: number) => backoff(n, () => 0);
    const high = (n: number) => backoff(n, () => 1);
    expect([0, 1, 2, 3, 4, 5].map(low)).toEqual([500, 1000, 2000, 4000, 8000, 15_000]);
    expect([0, 1, 2, 3, 4, 5].map(high)).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000]);
    for (const attempt of [6, 10, 50, 2000]) {
      expect(high(attempt)).toBe(30_000);
      expect(low(attempt)).toBe(15_000);
    }
    for (let i = 0; i < 200; i++) {
      const delay = backoff(3);
      expect(delay).toBeGreaterThanOrEqual(4000);
      expect(delay).toBeLessThanOrEqual(8000);
    }
  });
});

describe("the live link", () => {
  it("connects with the ticket in the protocol list, never in the URL, and says hello", async () => {
    open();
    await settle();
    const socket = latest();
    expect(socket.url).toBe("wss://api.test/stream/me");
    expect(socket.protocols).toEqual(wsTicket().protocols);
    socket.open();
    expect(socket.sent).toEqual([{ type: "hello" }]);
  });

  it("hands over pass changes and resumes from the last one after a drop", async () => {
    const { options } = open();
    await settle();
    latest().open();
    latest().receive(ready(true));
    latest().receive(passStatus("ev-7", "suspended_review"));
    latest().receive(passStatus("ev-8", "active"));
    expect(options.onEvent).toHaveBeenCalledTimes(2);
    expect(options.onEvent.mock.calls[0]![0]).toMatchObject({ type: "pass.status", data: { state: "suspended_review" } });

    latest().drop();
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeSocket.all).toHaveLength(2);
    latest().open();
    expect(latest().sent).toEqual([{ type: "hello", last_event_id: "ev-8" }]);
  });

  it("re-reads the pass when the server cannot replay what was missed, not when it can", async () => {
    const { options } = open();
    await settle();
    latest().open();
    latest().receive(ready(true));
    expect(options.onResync).not.toHaveBeenCalled();
    latest().receive(ready(false));
    expect(options.onResync).toHaveBeenCalledTimes(1);
  });

  it("backs off 0.5 s, 1 s, 2 s … between failed attempts, and starts again from the bottom once connected", async () => {
    const ticket = vi.fn<() => Promise<WsTicket>>(async () => {
      throw new ApiFailure("NETWORK", 0);
    });
    open({ ticket });
    await settle();
    expect(ticket).toHaveBeenCalledTimes(1);
    for (const [wait, calls] of [[500, 2], [1000, 3], [2000, 4], [4000, 5]] as const) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(ticket).toHaveBeenCalledTimes(calls - 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(ticket).toHaveBeenCalledTimes(calls);
    }
    ticket.mockImplementation(async () => wsTicket());
    await vi.advanceTimersByTimeAsync(8000);
    latest().open();
    latest().receive(ready(true));
    latest().drop();
    // Connected once: the next drop waits the shortest delay again.
    await vi.advanceTimersByTimeAsync(499);
    const before = ticket.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1);
    expect(ticket.mock.calls.length).toBe(before + 1);
  });

  it("closes a socket silent for 45 s (three missed heartbeats) and reconnects; any frame keeps it alive", async () => {
    open();
    await settle();
    const first = latest();
    first.open();
    await vi.advanceTimersByTimeAsync(30_000);
    first.receive(heartbeat());
    await vi.advanceTimersByTimeAsync(44_999);
    expect(first.readyState).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(first.readyState).toBe(3);
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("ignores a frame that is not JSON or not in the contract, and keeps the resume cursor", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { options } = open();
    await settle();
    latest().open();
    latest().receive(passStatus("ev-1", "active"));
    latest().receive("not json");
    latest().receive(JSON.stringify({ id: "ev-2", type: "pass.status", at: AT, data: { event_id: EVENT_A, state: "teleported" } }));
    expect(options.onEvent).toHaveBeenCalledTimes(1);
    latest().drop();
    await vi.advanceTimersByTimeAsync(500);
    latest().open();
    expect(latest().sent).toEqual([{ type: "hello", last_event_id: "ev-1" }]);
  });
});

describe("stopping", () => {
  it("stops for good, and says the session is over, when the ticket is refused as unauthenticated", async () => {
    const ticket = vi.fn<() => Promise<WsTicket>>(async () => {
      throw new ApiFailure("UNAUTHENTICATED", 401);
    });
    const { options } = open({ ticket });
    await settle();
    expect(options.onSignedOut).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(ticket).toHaveBeenCalledTimes(1);
  });

  it("stops for good when the server closes with FORBIDDEN (not this person's stream)", async () => {
    const { options } = open();
    await settle();
    latest().open();
    latest().drop(WS_CLOSE.FORBIDDEN);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(options.ticket).toHaveBeenCalledTimes(1);
  });

  it("closes the socket normally and never reconnects after close()", async () => {
    const { stream, options } = open();
    await settle();
    latest().open();
    stream.close();
    expect(latest().closedWith).toBe(WS_CLOSE.NORMAL);
    win.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(options.ticket).toHaveBeenCalledTimes(1);
  });
});

describe("offline", () => {
  it("waits for the browser to come back online instead of spinning, then reconnects at once", async () => {
    const { options } = open();
    await settle();
    latest().open();
    online = false;
    win.dispatchEvent(new Event("offline"));
    expect(latest().readyState).toBe(3);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(options.ticket).toHaveBeenCalledTimes(1);

    online = true;
    win.dispatchEvent(new Event("online"));
    await settle();
    expect(options.ticket).toHaveBeenCalledTimes(2);
    expect(FakeSocket.all).toHaveLength(2);
  });
});
