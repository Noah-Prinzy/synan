/**
 * The Command Center's link to the real API (api/stream.ts): one socket per channel, resumed from
 * the last real event after a drop, the alert list and gate health re-read when the server cannot
 * replay, and a status the store can trust (connecting, live, reconnecting, offline). Fake timers,
 * a fake WebSocket and a fake API client.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WS_SUBPROTOCOL } from "@synan/contracts/brand";
import { BreachAlert, GateHealth } from "@synan/contracts/rest";
import { AlertsServerMessage, TelemetryServerMessage, WS_CLOSE } from "@synan/contracts/ws";
import type { ApiClient } from "../src/api/client";
import { ApiFailure } from "../src/api/failure";
import { backoff, openLiveStream } from "../src/api/stream";
import type { LinkStatus } from "../src/live/transport";

class FakeSocket {
  static all: FakeSocket[] = [];
  sent: unknown[] = [];
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
  close(code = 1006) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code, reason: "" });
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

const EVENT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const GATE = "b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1";
const AT = "2026-12-01T10:00:00.000Z";
const ready = (channel: string, resumed: boolean) => ({ type: "ready", channel, scope: "full", resumed, heartbeat_interval_ms: 15_000 });
const alert = (state: "open" | "acked" = "open") =>
  BreachAlert.parse({
    id: "c0c0c0c0-c0c0-40c0-80c0-000000000001", event_id: EVENT, severity: "high", kind: "invalid_qr", checkpoint_id: GATE, credential_id: null,
    occurred_at: AT, state, acked_by: null, acked_at: null, resolution_note: null, scan_ids: [], detail: "x",
  });
const gate = () =>
  GateHealth.parse({ checkpoint_id: GATE, label: "Gate 1", link_state: "online", last_heartbeat_at: AT, queue_depth: 0, clock_offset_ms: 0, clock_fault: false, scans_last_minute: 0 });

let online = true;
beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  online = true;
});
afterEach(() => vi.useRealTimers());

function setup(call?: (name: string, input: unknown) => Promise<unknown>) {
  const calls: { name: string; input: unknown }[] = [];
  const client = {
    wsBase: "ws://api.test",
    offsetMs: () => 0,
    call: vi.fn(async (name: string, input: unknown) => {
      calls.push({ name, input });
      if (call) return call(name, input);
      if (name === "wsTicket") return { ticket: "t", expires_at: AT, protocols: [WS_SUBPROTOCOL, "ticket.x"], channel: "/stream/alerts" };
      if (name === "gateHealth") return { items: [gate()] };
      if (name === "listAlerts") return { items: [alert("acked")], next_cursor: null };
      throw new Error(name);
    }),
  } as unknown as ApiClient;
  const stream = openLiveStream({ eventId: EVENT, client, WebSocketImpl: FakeSocket as unknown as typeof WebSocket, random: () => 0, online: () => online });
  const statuses: LinkStatus[] = [];
  stream.onStatus((s) => statuses.push(s));
  return { stream, calls, statuses };
}

const settle = () => vi.advanceTimersByTimeAsync(0);
const socketFor = (channel: string) => FakeSocket.all.filter((s) => s.url.endsWith(channel)).at(-1)!;

describe("the Command Center's live link", () => {
  it("backs off from 1 s to a 30 s cap, with jitter in the upper half", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 40].map((n) => backoff(n, () => 1))).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
    expect(backoff(40, () => 0)).toBe(15_000);
  });

  it("opens one socket per followed channel, with the ticket in the protocol list", async () => {
    const { stream } = setup();
    const telemetry = vi.fn();
    stream.subscribe("/stream/telemetry", telemetry);
    stream.subscribe("/stream/telemetry", vi.fn());
    await settle();
    expect(FakeSocket.all.map((s) => s.url)).toEqual(["ws://api.test/stream/telemetry"]);
    expect(FakeSocket.all[0]!.protocols).toEqual([WS_SUBPROTOCOL, "ticket.x"]);
  });

  it("is live only once every followed channel is ready, and reconnecting (not connecting) after a drop", async () => {
    const { stream, statuses } = setup();
    stream.subscribe("/stream/telemetry", vi.fn());
    stream.subscribe("/stream/scans", vi.fn());
    await settle();
    socketFor("/stream/telemetry").open();
    socketFor("/stream/telemetry").receive(ready("/stream/telemetry", true));
    expect(stream.status()).toBe("connecting");
    socketFor("/stream/scans").open();
    socketFor("/stream/scans").receive(ready("/stream/scans", true));
    expect(stream.status()).toBe("live");
    socketFor("/stream/scans").close();
    expect(stream.status()).toBe("reconnecting");
    expect(statuses).toEqual(["live", "reconnecting"]);
  });

  it("resumes from the last real event, never from a frame it made up from a REST read", async () => {
    const { stream } = setup();
    const handler = vi.fn();
    stream.subscribe("/stream/alerts", handler);
    await settle();
    const first = socketFor("/stream/alerts");
    first.open();
    first.receive(ready("/stream/alerts", true));
    first.receive(AlertsServerMessage.parse({ id: "ev-41", type: "alert.raised", at: AT, data: alert() }));
    // The gate-health read on subscribe arrived as a synthetic `poll:` frame.
    expect(handler.mock.calls.some(([m]) => String(m.id).startsWith("poll:"))).toBe(true);
    first.close();
    await vi.advanceTimersByTimeAsync(500);
    const second = socketFor("/stream/alerts");
    second.open();
    expect(second.sent).toEqual([{ type: "hello", last_event_id: "ev-41" }]);
  });

  it("re-reads the alert list and gate health when the alerts channel cannot replay", async () => {
    const { stream, calls } = setup();
    const handler = vi.fn();
    stream.subscribe("/stream/alerts", handler);
    await settle();
    socketFor("/stream/alerts").open();
    socketFor("/stream/alerts").receive(ready("/stream/alerts", false));
    await settle();
    expect(calls.map((c) => c.name)).toEqual(["gateHealth", "wsTicket", "listAlerts", "gateHealth"]);
    const updates = handler.mock.calls.map(([m]) => m).filter((m) => m.type === "alert.updated");
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ data: { state: "acked" } });
    expect(String(updates[0].id)).toMatch(/^resync:/);
  });

  it("drops a frame that is not in the contract instead of handing it to the store", async () => {
    const { stream } = setup();
    const handler = vi.fn();
    stream.subscribe("/stream/telemetry", handler);
    await settle();
    socketFor("/stream/telemetry").open();
    socketFor("/stream/telemetry").receive({ id: "x", type: "occupancy.delta", at: AT, data: { event_id: EVENT, rooms: "lots", zones: [] } });
    expect(handler).not.toHaveBeenCalled();
    const good = TelemetryServerMessage.parse({ id: "t1", type: "occupancy.delta", at: AT, data: { event_id: EVENT, rooms: [], zones: [] } });
    socketFor("/stream/telemetry").receive(good);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("treats a socket silent for 45 s as dead and reconnects", async () => {
    const { stream } = setup();
    stream.subscribe("/stream/scans", vi.fn());
    await settle();
    const first = socketFor("/stream/scans");
    first.open();
    first.receive(ready("/stream/scans", true));
    await vi.advanceTimersByTimeAsync(45_000);
    expect(first.readyState).toBe(3);
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("stops a channel for good, and shows offline, when its ticket is refused or the server says FORBIDDEN", async () => {
    const refused = setup(async (name) => {
      if (name === "wsTicket") throw new ApiFailure("FORBIDDEN", 403);
      return { items: [] };
    });
    refused.stream.subscribe("/stream/scans", vi.fn());
    await vi.advanceTimersByTimeAsync(120_000);
    expect(refused.calls.filter((c) => c.name === "wsTicket")).toHaveLength(1);
    expect(refused.stream.status()).toBe("offline");

    FakeSocket.all = [];
    const closed = setup();
    closed.stream.subscribe("/stream/scans", vi.fn());
    await settle();
    socketFor("/stream/scans").open();
    socketFor("/stream/scans").close(WS_CLOSE.FORBIDDEN);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(closed.stream.status()).toBe("offline");
  });

  it("keeps retrying when the ticket request gets no answer", async () => {
    let fail = true;
    const { stream, calls } = setup(async (name) => {
      if (name === "wsTicket") {
        if (fail) throw new ApiFailure("INTERNAL", 0, { kind: "network" });
        return { ticket: "t", expires_at: AT, protocols: [WS_SUBPROTOCOL, "ticket.x"], channel: "/stream/scans" };
      }
      return { items: [] };
    });
    stream.subscribe("/stream/scans", vi.fn());
    await vi.advanceTimersByTimeAsync(500 + 1000 + 2000);
    expect(calls.filter((c) => c.name === "wsTicket")).toHaveLength(4);
    fail = false;
    await vi.advanceTimersByTimeAsync(4000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("shows offline while the browser is offline, without retrying, and closes every socket when the last subscriber leaves", async () => {
    const { stream } = setup();
    const stop = stream.subscribe("/stream/scans", vi.fn());
    await settle();
    socketFor("/stream/scans").open();
    online = false;
    socketFor("/stream/scans").close();
    expect(stream.status()).toBe("offline");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeSocket.all).toHaveLength(1);
    stop();
    expect(stream.status()).toBe("offline");
  });
});
