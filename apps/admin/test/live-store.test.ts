// @vitest-environment happy-dom
/**
 * The Command Center's live state (live/store.ts): what operators see on event day. Snapshots and
 * deltas applied in order, the live feed coalesced, alerts raised / acknowledged / resolved, gate
 * health frames, the link dropping and coming back, and frames that arrive late, twice or from an
 * event no longer open. Fake transport, fake REST, fake timers; frames built from the contracts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BreachAlert, Checkpoint, EventLiveSummary, GateHealth, Room, Venue, Zone } from "@synan/contracts/rest";
import { AlertsServerMessage, ScansServerMessage, TelemetryServerMessage } from "@synan/contracts/ws";
import type { WsChannel } from "@synan/contracts/enums";
import { CommandStore } from "../src/live/store";
import type { ChannelMessage, CommandApi, CommandEvent, LinkStatus, LiveSummary, LiveTransport, VenueLayout } from "../src/live/transport";
import { toLiveSummary } from "../src/api/adapters";

const T0 = Date.parse("2026-12-01T10:00:00.000Z");
const EVENT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const VENUE = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const ORG = "abababab-abab-4bab-8bab-abababababab";
const ZONE = "a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0";
const ROOM_1 = "a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1";
const ROOM_2 = "a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2";
const GATE_1 = "b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1";
const GATE_2 = "b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2";
const iso = (ms: number) => new Date(ms).toISOString();
const uuid = (n: number) => `c0c0c0c0-c0c0-40c0-80c0-${String(n).padStart(12, "0")}`;

const layout: VenueLayout = {
  venue: Venue.parse({ id: VENUE, org_id: ORG, name: "Hall", address: "1 Street", timezone: "Europe/London" }),
  zones: [Zone.parse({ id: ZONE, venue_id: VENUE, name: "Ground", floor: "G", geometry: null })],
  rooms: [ROOM_1, ROOM_2].map((id, i) =>
    Room.parse({ id, venue_id: VENUE, zone_id: ZONE, name: `Room ${i + 1}`, capacity: 100, continuous: false, geometry: null }),
  ),
  checkpoints: [
    Checkpoint.parse({ id: GATE_1, venue_id: VENUE, zone_id: ZONE, room_id: null, direction: "in", perimeter: true, hardware_id: null, label: "Gate 1" }),
    Checkpoint.parse({ id: GATE_2, venue_id: VENUE, zone_id: ZONE, room_id: ROOM_2, direction: "both", perimeter: false, hardware_id: null, label: "Gate 2" }),
  ],
  grid: { w: 96, h: 60 },
  checkpoint_positions: {},
};

const summary = (onSite = 10): LiveSummary =>
  toLiveSummary(
    EventLiveSummary.parse({ event_id: EVENT, registered: 100, checked_in: 50, on_site: onSite, by_tier: { VIP: 0, ORDINARY: 0, PRIVATE_INVITE: 0, PUBLIC: 0 }, open_alerts: 0, as_of: iso(T0) }),
  );

function alert(n: number, p: Partial<BreachAlert> = {}): BreachAlert {
  return BreachAlert.parse({
    id: uuid(n),
    event_id: EVENT,
    severity: "medium",
    kind: "invalid_qr",
    checkpoint_id: GATE_1,
    credential_id: null,
    occurred_at: iso(T0 + n * 1000),
    state: "open",
    acked_by: null,
    acked_at: null,
    resolution_note: null,
    scan_ids: [],
    detail: "Forged code",
    ...p,
  });
}

function gate(id: string, p: Partial<GateHealth> = {}): GateHealth {
  return GateHealth.parse({
    checkpoint_id: id,
    label: id === GATE_1 ? "Gate 1" : "Gate 2",
    link_state: "online",
    heartbeat_age_s: 5,
    last_heartbeat_at: iso(T0 - 5000),
    queue_depth: 0,
    clock_offset_ms: 0,
    clock_fault: false,
    scans_last_minute: 0,
    ...p,
  });
}

let frameSeq = 0;
const occupancy = (type: "occupancy.snapshot" | "occupancy.delta", rooms: [string, number][]) =>
  TelemetryServerMessage.parse({
    id: `t${++frameSeq}`,
    type,
    at: iso(T0),
    data: {
      event_id: EVENT,
      rooms: rooms.map(([room_id, occ]) => ({ room_id, zone_id: ZONE, occupancy: occ, capacity: 100, level: occ >= 85 ? "warn" : "ok" })),
      zones: [],
    },
  }) as ChannelMessage<"/stream/telemetry">;
const scan = (n: number, gateId: string, result: "admitted" | "denied_room" = "admitted", offline = false, at = T0) =>
  ScansServerMessage.parse({
    id: `s${n}`,
    type: "scan.result",
    at: iso(at),
    data: { scan_id: uuid(1000 + n), event_id: EVENT, checkpoint_id: gateId, result, carrier_kind: "nfc", tier: "ORDINARY", corrected_at: iso(at), offline },
  }) as ChannelMessage<"/stream/scans">;
const alertFrame = (type: "alert.raised" | "alert.updated", a: BreachAlert) =>
  AlertsServerMessage.parse({ id: `a${++frameSeq}`, type, at: iso(T0), data: a }) as ChannelMessage<"/stream/alerts">;
const gateFrame = (g: GateHealth) => AlertsServerMessage.parse({ id: `g${++frameSeq}`, type: "gate.health", at: iso(T0), data: g }) as ChannelMessage<"/stream/alerts">;

class FakeTransport implements LiveTransport {
  handlers = new Map<WsChannel, Set<(message: never) => void>>();
  statusListeners = new Set<(status: LinkStatus) => void>();
  current: LinkStatus = "live";
  subscribe<C extends WsChannel>(channel: C, handler: (message: ChannelMessage<C>) => void) {
    const set = this.handlers.get(channel) ?? new Set();
    set.add(handler as (message: never) => void);
    this.handlers.set(channel, set);
    return () => set.delete(handler as (message: never) => void);
  }
  status() {
    return this.current;
  }
  onStatus(listener: (status: LinkStatus) => void) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }
  ping() {
    return Promise.resolve(12);
  }
  emit<C extends WsChannel>(channel: C, message: ChannelMessage<C>) {
    for (const handler of this.handlers.get(channel) ?? []) (handler as (m: ChannelMessage<C>) => void)(message);
  }
  setStatus(status: LinkStatus) {
    this.current = status;
    for (const listener of this.statusListeners) listener(status);
  }
}

const calls = (fn: unknown) => (fn as ReturnType<typeof vi.fn>).mock.calls.length;

const liveEvent: CommandEvent = { id: EVENT, slug: "summit", title: "Summit", state: "live", starts_at: iso(T0), ends_at: iso(T0 + 8 * 3600_000), venue_name: "Hall", timezone: "Europe/London" };

function makeApi(over: Partial<CommandApi> = {}) {
  return {
    now: () => Date.now(),
    layout: vi.fn(async () => layout),
    summary: vi.fn(async () => summary()),
    alerts: vi.fn(async () => [] as BreachAlert[]),
    gates: vi.fn(async () => [gate(GATE_1), gate(GATE_2)]),
    ack: vi.fn(async (id: string) => alert(Number(id.slice(-12)), { state: "acked" })),
    resolveAlert: vi.fn(),
    recount: vi.fn(),
    ...over,
  } as unknown as CommandApi;
}

async function openLive(api = makeApi()) {
  const transports: FakeTransport[] = [];
  const store = new CommandStore(api, () => {
    const t = new FakeTransport();
    transports.push(t);
    return t;
  });
  await store.open(liveEvent);
  return { store, api, transport: transports.at(-1)!, transports };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  frameSeq = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("opening an event", () => {
  it("shows the layout, alerts and every gate from REST before the first frame, then follows the streams", async () => {
    const { store } = await openLive(makeApi({ alerts: vi.fn(async () => [alert(1)]) }));
    expect(store.load.get()).toEqual({ status: "ready" });
    expect(store.layout.get()).toBe(layout);
    expect(store.alerts.get().map((a) => a.id)).toEqual([uuid(1)]);
    expect(store.gates.get().get(GATE_1)).toMatchObject({ perimeter: true, roomId: null });
    expect(store.gates.get().get(GATE_2)).toMatchObject({ perimeter: false, roomId: ROOM_2 });
    expect(store.link.get().status).toBe("live");
  });

  it("does not connect to an event that is not live", async () => {
    const connect = vi.fn();
    const store = new CommandStore(makeApi(), connect);
    await store.open({ ...liveEvent, state: "published" });
    expect(store.load.get()).toMatchObject({ status: "not-live" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("says why when the first picture cannot be loaded, and shows the link as down", async () => {
    const store = new CommandStore(makeApi({ layout: vi.fn(async () => Promise.reject(new Error("Venue not found"))) }), () => new FakeTransport());
    await store.open(liveEvent);
    expect(store.load.get()).toEqual({ status: "error", message: "Venue not found" });
    expect(store.link.get().status).toBe("offline");
  });

  it("ignores frames from an event that is no longer open", async () => {
    const { store, transport } = await openLive();
    await store.open({ ...liveEvent, state: "published" });
    transport.emit("/stream/telemetry", occupancy("occupancy.snapshot", [[ROOM_1, 50]]));
    transport.emit("/stream/alerts", alertFrame("alert.raised", alert(1)));
    expect(store.rooms.get().size).toBe(0);
    expect(store.alerts.get()).toEqual([]);
  });

  it("drops an answer for an event left while it was loading", async () => {
    let release!: (value: VenueLayout) => void;
    const api = makeApi({ layout: vi.fn(() => new Promise<VenueLayout>((resolve) => (release = resolve))) });
    const connect = vi.fn(() => new FakeTransport());
    const store = new CommandStore(api, connect);
    const opening = store.open(liveEvent);
    store.close();
    release(layout);
    await opening;
    expect(store.layout.get()).toBeNull();
    expect(connect).not.toHaveBeenCalled();
  });
});

describe("occupancy", () => {
  it("replaces every room on a snapshot and changes only the named rooms on a delta", async () => {
    const { store, transport } = await openLive();
    transport.emit("/stream/telemetry", occupancy("occupancy.snapshot", [[ROOM_1, 40], [ROOM_2, 90]]));
    transport.emit("/stream/telemetry", occupancy("occupancy.delta", [[ROOM_1, 41]]));
    expect(store.rooms.get().get(ROOM_1)).toMatchObject({ occupancy: 41, level: "ok" });
    expect(store.rooms.get().get(ROOM_2)).toMatchObject({ occupancy: 90, level: "warn" });
    // A fresh snapshot (after a reconnect without replay) is the whole truth: a room it leaves out is gone.
    transport.emit("/stream/telemetry", occupancy("occupancy.snapshot", [[ROOM_2, 12]]));
    expect([...store.rooms.get().keys()]).toEqual([ROOM_2]);
    expect(store.interp.target(`room:${ROOM_2}`)).toBe(12);
  });

  it("applies frames in the order they arrive: the last delta for a room wins", async () => {
    const { store, transport } = await openLive();
    transport.emit("/stream/telemetry", occupancy("occupancy.snapshot", [[ROOM_1, 10]]));
    for (const n of [11, 12, 13]) transport.emit("/stream/telemetry", occupancy("occupancy.delta", [[ROOM_1, n]]));
    expect(store.rooms.get().get(ROOM_1)?.occupancy).toBe(13);
    // The same frame delivered twice changes nothing.
    const frame = occupancy("occupancy.delta", [[ROOM_1, 13]]);
    transport.emit("/stream/telemetry", frame);
    transport.emit("/stream/telemetry", frame);
    expect(store.rooms.get().get(ROOM_1)?.occupancy).toBe(13);
  });

  it("polls the KPI summary every 2 s only while the link is live", async () => {
    const { api, transport } = await openLive();
    const before = calls(api.summary);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(calls(api.summary)).toBe(before + 2);
    transport.setStatus("reconnecting");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls(api.summary)).toBe(before + 2);
  });
});

describe("the live feed", () => {
  it("groups admissions at one gate within 250 ms into one row, newest first, and keeps refusals and offline scans apart", async () => {
    const { store, transport } = await openLive();
    for (let n = 0; n < 10; n++) transport.emit("/stream/scans", scan(n, GATE_1, "admitted", false, T0 + n));
    transport.emit("/stream/scans", scan(20, GATE_1, "denied_room", false, T0 + 20));
    transport.emit("/stream/scans", scan(21, GATE_1, "admitted", true, T0 + 21));
    transport.emit("/stream/scans", scan(22, GATE_2, "admitted", false, T0 + 22));
    expect(store.feed.get()).toEqual([]);
    await vi.advanceTimersByTimeAsync(250);
    const rows = store.feed.get();
    expect(rows.map((r) => (r.kind === "scan" ? [r.checkpointId === GATE_1 ? "G1" : "G2", r.result, r.count, r.offline] : r.kind))).toEqual([
      ["G2", "admitted", 1, false],
      ["G1", "admitted", 1, true],
      ["G1", "denied_room", 1, false],
      ["G1", "admitted", 10, false],
    ]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it("keeps the latest 80 rows", async () => {
    const { store, transport } = await openLive();
    for (let n = 0; n < 100; n++) {
      transport.emit("/stream/scans", scan(n, GATE_1, "denied_room", false, T0 + n));
      await vi.advanceTimersByTimeAsync(250);
    }
    expect(store.feed.get()).toHaveLength(80);
  });

  it("remembers the last five scans at each gate for the gate card", async () => {
    const { store, transport } = await openLive();
    for (let n = 0; n < 7; n++) transport.emit("/stream/scans", scan(n, GATE_1, "admitted", false, T0 + n));
    expect(store.recentScans.get(GATE_1)).toHaveLength(5);
    expect(store.recentScans.get(GATE_1)![0]!.at).toBe(T0 + 6);
  });
});

describe("alerts", () => {
  it("lists a raised alert newest first, once, even when the frame arrives twice", async () => {
    const { store, transport } = await openLive(makeApi({ alerts: vi.fn(async () => [alert(1)]) }));
    const frame = alertFrame("alert.raised", alert(2));
    transport.emit("/stream/alerts", frame);
    transport.emit("/stream/alerts", frame);
    expect(store.alerts.get().map((a) => a.id)).toEqual([uuid(2), uuid(1)]);
  });

  it("speaks one sentence for a burst of new alerts, and says a critical one assertively", async () => {
    const { store, transport } = await openLive();
    transport.emit("/stream/alerts", alertFrame("alert.raised", alert(1, { severity: "low" })));
    transport.emit("/stream/alerts", alertFrame("alert.raised", alert(2, { severity: "critical", kind: "pass_replayed" })));
    transport.emit("/stream/alerts", alertFrame("alert.raised", alert(3, { severity: "medium" })));
    await vi.advanceTimersByTimeAsync(1_500);
    expect(store.announce.get().assertive).toMatch(/^3 new alerts\. Highest: Critical alert: .* at Gate 1\.$/);
    expect(store.flash.get()).toMatchObject({ alertId: uuid(2), checkpointId: GATE_1 });
  });

  it("moves an alert from raised to acknowledged to resolved, with one feed row per change", async () => {
    const { store, transport } = await openLive();
    transport.emit("/stream/alerts", alertFrame("alert.raised", alert(1)));
    transport.emit("/stream/alerts", alertFrame("alert.updated", alert(1, { state: "acked", acked_at: iso(T0) })));
    transport.emit("/stream/alerts", alertFrame("alert.updated", alert(1, { state: "acked", acked_at: iso(T0) })));
    transport.emit("/stream/alerts", alertFrame("alert.updated", alert(1, { state: "resolved", acked_at: iso(T0), resolution_note: "Checked" })));
    await vi.advanceTimersByTimeAsync(250);
    expect(store.alerts.get()[0]?.state).toBe("resolved");
    expect(store.feed.get().filter((r) => r.kind === "alert").map((r) => (r.kind === "alert" ? r.change : null)).sort()).toEqual(["acked", "raised", "resolved"]);
  });

  it("keeps a resolved alert resolved when a late 'acknowledged' frame for it arrives", async () => {
    const { store, transport } = await openLive();
    transport.emit("/stream/alerts", alertFrame("alert.raised", alert(1)));
    transport.emit("/stream/alerts", alertFrame("alert.updated", alert(1, { state: "resolved", acked_at: iso(T0), resolution_note: "Checked" })));
    transport.emit("/stream/alerts", alertFrame("alert.updated", alert(1, { state: "acked", acked_at: iso(T0) })));
    transport.emit("/stream/alerts", alertFrame("alert.raised", alert(1)));
    await vi.advanceTimersByTimeAsync(250);
    expect(store.alerts.get()[0]?.state).toBe("resolved");
    expect(store.feed.get().filter((r) => r.kind === "alert" && r.change === "acked")).toEqual([]);
  });

  it("acknowledges at once, and puts the alert back as it was when the server refuses", async () => {
    let refuse!: (error: Error) => void;
    const api = makeApi({ alerts: vi.fn(async () => [alert(1)]), ack: vi.fn(() => new Promise<BreachAlert>((_, reject) => (refuse = reject))) });
    const { store } = await openLive(api);
    const acking = store.ack(uuid(1));
    expect(store.alerts.get()[0]?.state).toBe("acked");
    refuse(new Error("offline"));
    await acking;
    expect(store.alerts.get()[0]?.state).toBe("open");
    expect(store.announce.get().polite).toBe("Could not acknowledge the alert. Try again.");
  });

  it("keeps an alert raised while an acknowledgement was failing", async () => {
    let refuse!: (error: Error) => void;
    const api = makeApi({ alerts: vi.fn(async () => [alert(1)]), ack: vi.fn(() => new Promise<BreachAlert>((_, reject) => (refuse = reject))) });
    const { store, transport } = await openLive(api);
    const acking = store.ack(uuid(1));
    transport.emit("/stream/alerts", alertFrame("alert.raised", alert(2, { severity: "critical" })));
    refuse(new Error("offline"));
    await acking;
    expect(store.alerts.get().map((a) => [a.id, a.state])).toEqual([
      [uuid(2), "open"],
      [uuid(1), "open"],
    ]);
  });

  it("keeps an alert raised while a resolution was failing, and rethrows for the form", async () => {
    let refuse!: (error: Error) => void;
    const api = makeApi({ alerts: vi.fn(async () => [alert(1)]), resolveAlert: vi.fn(() => new Promise<BreachAlert>((_, reject) => (refuse = reject))) });
    const { store, transport } = await openLive(api);
    const resolving = store.resolve(uuid(1), " Checked ");
    expect(store.alerts.get()[0]).toMatchObject({ state: "resolved", resolution_note: "Checked" });
    transport.emit("/stream/alerts", alertFrame("alert.raised", alert(2)));
    refuse(new Error("VALIDATION_FAILED"));
    await expect(resolving).rejects.toThrow("VALIDATION_FAILED");
    expect(store.alerts.get().map((a) => [a.id, a.state])).toEqual([
      [uuid(2), "open"],
      [uuid(1), "open"],
    ]);
  });
});

describe("gate health", () => {
  it("adds a feed row when a gate's link changes, not on every frame", async () => {
    const { store, transport } = await openLive();
    transport.emit("/stream/alerts", gateFrame(gate(GATE_1, { queue_depth: 3 })));
    transport.emit("/stream/alerts", gateFrame(gate(GATE_1, { link_state: "offline", queue_depth: 4 })));
    transport.emit("/stream/alerts", gateFrame(gate(GATE_1, { link_state: "offline", queue_depth: 9 })));
    await vi.advanceTimersByTimeAsync(250);
    expect(store.feed.get().filter((r) => r.kind === "gate")).toHaveLength(1);
    expect(store.gates.get().get(GATE_1)).toMatchObject({ link_state: "offline", queue_depth: 9, perimeter: true });
  });

  it("dates a gate's outage from its last heartbeat, keeps that date while it stays down, and clears it when it is back", async () => {
    const { store, transport } = await openLive();
    const lastHeard = T0 - 70_000;
    transport.emit("/stream/alerts", gateFrame(gate(GATE_1, { link_state: "offline", last_heartbeat_at: iso(lastHeard), heartbeat_age_s: 70 })));
    expect(store.gates.get().get(GATE_1)?.offlineSince).toBe(lastHeard);
    transport.emit("/stream/alerts", gateFrame(gate(GATE_1, { link_state: "offline", last_heartbeat_at: iso(lastHeard + 1), heartbeat_age_s: 75 })));
    expect(store.gates.get().get(GATE_1)?.offlineSince).toBe(lastHeard);
    transport.emit("/stream/alerts", gateFrame(gate(GATE_1)));
    expect(store.gates.get().get(GATE_1)?.offlineSince).toBeNull();
  });

  it("says 'never heard' (no outage time) for a gate the server has never heard from", async () => {
    const { store, transport } = await openLive();
    transport.emit("/stream/alerts", gateFrame(gate(GATE_2, { link_state: "offline", last_heartbeat_at: null, heartbeat_age_s: null })));
    expect(store.gates.get().get(GATE_2)?.offlineSince).toBeNull();
  });
});

describe("the link", () => {
  it("says when it is lost and when it is restored, and remembers when it went down", async () => {
    const { store, transport } = await openLive();
    vi.setSystemTime(T0 + 5_000);
    transport.setStatus("reconnecting");
    expect(store.link.get()).toMatchObject({ status: "reconnecting", lostAt: T0 + 5_000, latencyMs: null });
    expect(store.announce.get().polite).toBe("Live connection lost. The map shows the last known state.");
    vi.setSystemTime(T0 + 9_000);
    transport.setStatus("offline");
    expect(store.link.get().lostAt).toBe(T0 + 5_000);
    transport.setStatus("live");
    expect(store.link.get()).toMatchObject({ status: "live", lostAt: null });
    expect(store.announce.get().polite).toBe("Live connection restored.");
  });

  it("keeps the last known rooms on the map while the link is down", async () => {
    const { store, transport } = await openLive();
    transport.emit("/stream/telemetry", occupancy("occupancy.snapshot", [[ROOM_1, 40]]));
    transport.setStatus("reconnecting");
    expect(store.rooms.get().get(ROOM_1)?.occupancy).toBe(40);
  });
});
