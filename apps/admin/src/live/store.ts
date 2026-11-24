/**
 * The Command Center's live state for one event: REST for the initial picture
 * (layout, summary, alerts, gate health), then the three streams for change
 * (docs/06 §2.1 D1: stream/telemetry, stream/alerts, GET /dashboard; scans for the
 * live feed). Written against `LiveTransport` and `CommandApi` only.
 *
 * Rates:
 *   occupancy      ≤ 4 Hz from the server → `rooms` slice + interpolator targets
 *   live feed      coalesced to ≤ 4 Hz here, whatever the scan rate
 *   summary (KPIs) polled every 2 s (requested: totals on the telemetry stream)
 *   latency        ping every 5 s
 * Nothing here runs per frame; the interpolator does that, outside React.
 */
import type { OccupancyLevel } from "@synan/contracts/ws";
import type { BreachAlert, GateHealth } from "@synan/contracts/rest";
import type { ScanResult } from "@synan/contracts/enums";
import { ALERT_KIND_LABEL, SEVERITY_VIEW, severityRank } from "./alert-copy";
import { Interpolator } from "./interpolator";
import { Slice } from "./slice";
import type {
  ChannelMessage,
  CommandApi,
  CommandEvent,
  LinkStatus,
  LiveSummary,
  LiveTransport,
  VenueLayout,
} from "./transport";

export interface RoomLive {
  id: string;
  occupancy: number;
  capacity: number;
  level: OccupancyLevel;
}

export interface GateLive extends GateHealth {
  /** When the link was first seen down (server heartbeat time if known). */
  offlineSince: number | null;
  perimeter: boolean;
  roomId: string | null;
}

export type FeedItem =
  | {
      kind: "scan";
      id: string;
      at: number;
      checkpointId: string;
      result: ScanResult;
      /** Admissions at one gate within one 250 ms window are one row. */
      count: number;
      offline: boolean;
    }
  | { kind: "alert"; id: string; at: number; alert: BreachAlert; change: "raised" | "acked" | "resolved" }
  | { kind: "gate"; id: string; at: number; checkpointId: string; link: GateHealth["link_state"]; queue: number }
  | { kind: "recount"; id: string; at: number; roomId: string; previous: number; next: number };

/** One scan as the scans stream delivers it (tier, carrier, corrected time). */
export type LiveScan = Extract<ChannelMessage<"/stream/scans">, { type: "scan.result" }>["data"];

export type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "not-live"; event: CommandEvent }
  | { status: "ready" };

export interface LinkState {
  status: LinkStatus | "idle";
  latencyMs: number | null;
  /** Server time of the last telemetry frame. */
  lastFrameAt: number | null;
  /** Server time the link went down, while it is down. */
  lostAt: number | null;
}

export interface Flash {
  key: number;
  alertId: string;
  roomId: string | null;
  checkpointId: string | null;
}

/** Kept deep enough that the 'notable' view still has 12 rows during a burst of admissions. */
const FEED_LENGTH = 80;
const FEED_FLUSH_MS = 250;
const SUMMARY_POLL_MS = 2_000;
const PING_MS = 5_000;
const HISTORY_SAMPLE_MS = 5_000;
const HISTORY_LENGTH = 36; // 3 minutes
const ANNOUNCE_MS = 1_500;
/** How far along an alert is; it never moves back. */
const ALERT_STEP: Record<BreachAlert["state"], number> = { open: 0, acked: 1, resolved: 2 };

export class CommandStore {
  readonly interp = new Interpolator();
  readonly load = new Slice<LoadState>({ status: "idle" });
  readonly link = new Slice<LinkState>({ status: "idle", latencyMs: null, lastFrameAt: null, lostAt: null });
  readonly layout = new Slice<VenueLayout | null>(null);
  readonly rooms = new Slice<ReadonlyMap<string, RoomLive>>(new Map());
  readonly gates = new Slice<ReadonlyMap<string, GateLive>>(new Map());
  readonly alerts = new Slice<readonly BreachAlert[]>([]);
  readonly feed = new Slice<readonly FeedItem[]>([]);
  readonly summary = new Slice<LiveSummary | null>(null);
  readonly flash = new Slice<Flash | null>(null);
  /** Screen-reader announcements: polite for most, assertive for critical. */
  readonly announce = new Slice<{ polite: string; assertive: string }>({ polite: "", assertive: "" });
  /** Room occupancy sampled every 5 s, last 3 minutes, for trends. */
  readonly history = new Slice<ReadonlyMap<string, readonly number[]>>(new Map());
  readonly recentScans = new Map<string, { at: number; result: ScanResult }[]>();

  private event: CommandEvent | null = null;
  private generation = 0;
  private cleanups: (() => void)[] = [];
  private pendingFeed: FeedItem[] = [];
  private feedTimer: number | null = null;
  private pendingAnnounce: BreachAlert[] = [];
  private announceTimer: number | null = null;
  private feedSeq = 0;
  private flashSeq = 0;
  private scanListeners = new Set<(scan: LiveScan) => void>();

  constructor(
    private readonly api: CommandApi,
    private readonly connect: (eventId: string) => LiveTransport | null,
  ) {}

  now(): number {
    return this.api.now();
  }

  currentEvent(): CommandEvent | null {
    return this.event;
  }

  /* -------------------------------------------------------------- lifecycle */

  async open(event: CommandEvent): Promise<void> {
    this.close();
    this.event = event;
    const generation = this.generation;
    if (event.state !== "live") {
      this.load.set({ status: "not-live", event });
      this.link.set({ status: "idle", latencyMs: null, lastFrameAt: null, lostAt: null });
      return;
    }
    this.load.set({ status: "loading" });
    this.link.set({ status: "connecting", latencyMs: null, lastFrameAt: null, lostAt: null });
    try {
      const [layout, summary, alerts, gates] = await Promise.all([
        this.api.layout(event.id),
        this.api.summary(event.id),
        this.api.alerts(event.id),
        this.api.gates(event.id),
      ]);
      if (generation !== this.generation) return;
      this.layout.set(layout);
      this.applySummary(summary);
      this.alerts.set(alerts);
      const byId = new Map(layout.checkpoints.map((c) => [c.id, c]));
      this.gates.set(
        new Map(
          gates.map((gate) => {
            const checkpoint = byId.get(gate.checkpoint_id);
            return [gate.checkpoint_id, this.toGateLive(gate, undefined, checkpoint?.perimeter ?? false, checkpoint?.room_id ?? null)];
          }),
        ),
      );
      const transport = this.connect(event.id);
      if (!transport) throw new Error("This event has no live stream.");
      this.attach(transport, generation);
      this.load.set({ status: "ready" });
    } catch (error) {
      if (generation !== this.generation) return;
      this.load.set({ status: "error", message: error instanceof Error ? error.message : "Load failed" });
      this.link.set({ status: "offline", latencyMs: null, lastFrameAt: null, lostAt: null });
    }
  }

  retry(): void {
    if (this.event) void this.open(this.event);
  }

  close(): void {
    this.generation++;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    if (this.feedTimer !== null) window.clearTimeout(this.feedTimer);
    if (this.announceTimer !== null) window.clearTimeout(this.announceTimer);
    this.feedTimer = null;
    this.announceTimer = null;
    this.pendingFeed = [];
    this.pendingAnnounce = [];
    this.recentScans.clear();
    this.interp.reset();
    this.layout.set(null);
    this.rooms.set(new Map());
    this.gates.set(new Map());
    this.alerts.set([]);
    this.feed.set([]);
    this.summary.set(null);
    this.flash.set(null);
    this.history.set(new Map());
  }

  /* ---------------------------------------------------------------- actions */

  /** Acknowledge: optimistic, one click (docs/06 §2.3 D1). */
  async ack(alertId: string): Promise<void> {
    const undo = this.optimistic(alertId, (a) => (a.state === "open" ? { ...a, state: "acked" } : null));
    try {
      const acked = await this.api.ack(alertId);
      this.replaceAlert(acked);
    } catch {
      undo();
      this.say("Could not acknowledge the alert. Try again.", false);
    }
  }

  /**
   * Resolve with a note (D10): optimistic, like `ack`. Resolution is what takes an alert off the
   * open list, so a failure puts it back and rethrows for the form to say so.
   */
  async resolve(alertId: string, note: string): Promise<BreachAlert> {
    const now = new Date(this.now()).toISOString();
    const undo = this.optimistic(alertId, (a) =>
      a.state !== "resolved" ? { ...a, state: "resolved", resolution_note: note.trim(), acked_at: a.acked_at ?? now } : null,
    );
    try {
      const resolved = await this.api.resolveAlert(alertId, { note: note.trim() });
      this.replaceAlert(resolved);
      return resolved;
    } catch (error) {
      undo();
      throw error;
    }
  }

  /**
   * Show one alert changed at once. The returned undo puts back that alert only, and only while
   * the optimistic copy is still the one shown: an alert raised, or a server update that arrived,
   * while the request was out is kept.
   */
  private optimistic(alertId: string, change: (alert: BreachAlert) => BreachAlert | null): () => void {
    const previous = this.alerts.get().find((a) => a.id === alertId);
    const next = previous ? change(previous) : null;
    if (!previous || !next) return () => undefined;
    this.alerts.set(this.alerts.get().map((a) => (a === previous ? next : a)));
    return () => this.alerts.update((list) => list.map((a) => (a === next ? previous : a)));
  }

  /**
   * Every scan as it arrives (the access log's live head). Called at scan rate: a listener
   * buffers and renders at its own pace. Nothing arrives while the link is down.
   */
  subscribeScans(listener: (scan: LiveScan) => void): () => void {
    this.scanListeners.add(listener);
    return () => this.scanListeners.delete(listener);
  }

  /** Set a room's count to a headcount (D-10). Audited server-side. */
  async recount(roomId: string, count: number, note?: string): Promise<{ previous: number; next: number }> {
    const event = this.event;
    if (!event) throw new Error("No event open");
    const result = await this.api.recount(roomId, { event_id: event.id, count, note });
    this.pushFeed({
      kind: "recount",
      id: `recount:${result.adjustment_id}`,
      at: this.now(),
      roomId,
      previous: result.previous,
      next: result.occupancy,
    });
    return { previous: result.previous, next: result.occupancy };
  }

  /* --------------------------------------------------------------- streams */

  private attach(transport: LiveTransport, generation: number): void {
    const alive = () => generation === this.generation;
    const setStatus = (status: LinkStatus) => {
      if (!alive()) return;
      const previous = this.link.get();
      const wasLive = previous.status === "live";
      this.link.set({
        ...previous,
        status,
        lostAt: status === "live" ? null : (previous.lostAt ?? this.now()),
        latencyMs: status === "live" ? previous.latencyMs : null,
      });
      if (wasLive && status !== "live") this.say("Live connection lost. The map shows the last known state.", false);
      if (!wasLive && previous.status !== "connecting" && status === "live") this.say("Live connection restored.", false);
    };
    setStatus(transport.status());
    this.cleanups.push(transport.onStatus(setStatus));
    this.cleanups.push(transport.subscribe("/stream/telemetry", (m) => alive() && this.onTelemetry(m)));
    this.cleanups.push(transport.subscribe("/stream/scans", (m) => alive() && this.onScan(m)));
    this.cleanups.push(transport.subscribe("/stream/alerts", (m) => alive() && this.onAlerts(m)));

    const every = (ms: number, fn: () => void) => {
      const id = window.setInterval(fn, ms);
      this.cleanups.push(() => window.clearInterval(id));
    };
    const ping = () => {
      transport.ping().then(
        (ms) => alive() && this.link.update((l) => ({ ...l, latencyMs: ms })),
        () => alive() && this.link.update((l) => ({ ...l, latencyMs: null })),
      );
    };
    ping();
    every(PING_MS, ping);
    every(SUMMARY_POLL_MS, () => {
      const event = this.event;
      if (!event || this.link.get().status !== "live") return;
      this.api.summary(event.id).then((s) => alive() && this.applySummary(s), () => undefined);
    });
    this.sampleHistory();
    every(HISTORY_SAMPLE_MS, () => this.sampleHistory());
  }

  private onTelemetry(message: ChannelMessage<"/stream/telemetry">): void {
    if (message.type !== "occupancy.snapshot" && message.type !== "occupancy.delta") return;
    const next = new Map(message.type === "occupancy.snapshot" ? undefined : this.rooms.get());
    for (const room of message.data.rooms) {
      const occupancy = room.occupancy ?? 0;
      next.set(room.room_id, { id: room.room_id, occupancy, capacity: room.capacity, level: room.level });
      this.interp.set(`room:${room.room_id}`, occupancy);
    }
    for (const zone of message.data.zones) this.interp.set(`zone:${zone.zone_id}`, zone.occupancy ?? 0);
    this.rooms.set(next);
    this.link.update((l) => ({ ...l, lastFrameAt: this.now() }));
  }

  private onScan(message: ChannelMessage<"/stream/scans">): void {
    if (message.type !== "scan.result") return;
    const scan = message.data;
    const at = Date.parse(scan.corrected_at);
    const recent = this.recentScans.get(scan.checkpoint_id) ?? [];
    recent.unshift({ at, result: scan.result });
    if (recent.length > 5) recent.length = 5;
    this.recentScans.set(scan.checkpoint_id, recent);
    for (const listener of this.scanListeners) listener(scan);
    this.pushFeed({
      kind: "scan",
      id: scan.scan_id,
      at,
      checkpointId: scan.checkpoint_id,
      result: scan.result,
      count: 1,
      offline: scan.offline,
    });
  }

  private onAlerts(message: ChannelMessage<"/stream/alerts">): void {
    if (message.type === "alert.raised") {
      const alert = message.data;
      if (!this.replaceAlert(alert)) return;
      this.pushFeed({ kind: "alert", id: `alert:${message.id}`, at: Date.parse(alert.occurred_at), alert, change: "raised" });
      if (alert.state === "open") this.queueAnnounce(alert);
      if (alert.severity === "critical" && alert.state === "open") {
        const checkpoint = this.layout.get()?.checkpoints.find((c) => c.id === alert.checkpoint_id);
        this.flash.set({
          key: ++this.flashSeq,
          alertId: alert.id,
          roomId: checkpoint?.room_id ?? null,
          checkpointId: alert.checkpoint_id,
        });
      }
    } else if (message.type === "alert.updated") {
      const alert = message.data;
      const previous = this.alerts.get().find((a) => a.id === alert.id);
      if (!this.replaceAlert(alert)) return;
      if (previous?.state !== alert.state && (alert.state === "acked" || alert.state === "resolved")) {
        this.pushFeed({ kind: "alert", id: `alert:${message.id}`, at: this.now(), alert, change: alert.state });
      }
    } else if (message.type === "gate.health") {
      const health = message.data;
      const gates = new Map(this.gates.get());
      const previous = gates.get(health.checkpoint_id);
      gates.set(health.checkpoint_id, this.toGateLive(health, previous, previous?.perimeter ?? false, previous?.roomId ?? null));
      this.gates.set(gates);
      if (previous?.link_state !== health.link_state) {
        this.pushFeed({
          kind: "gate",
          id: `gate:${message.id}`,
          at: Date.parse(message.at),
          checkpointId: health.checkpoint_id,
          link: health.link_state,
          queue: health.queue_depth,
        });
      }
    }
  }

  /* ---------------------------------------------------------------- helpers */

  private toGateLive(health: GateHealth, previous: GateLive | undefined, perimeter: boolean, roomId: string | null): GateLive {
    const down = health.link_state === "offline";
    let offlineSince: number | null = null;
    if (down) {
      // A gate the server has never heard from (heartbeat_age_s null) has no "since": it reads
      // "never heard", not "lost a second ago". The mock sends no age, and keeps its old reading.
      offlineSince =
        previous?.offlineSince ??
        (health.last_heartbeat_at ? Date.parse(health.last_heartbeat_at) : health.heartbeat_age_s === null ? null : this.now());
    }
    return { ...health, offlineSince, perimeter, roomId };
  }

  /**
   * Put the server's copy of an alert in the list. An alert only moves forward (open → acked →
   * resolved; the API never reopens one), so a copy behind the one shown is stale — a late frame,
   * or an answer overtaken by another operator's — and is ignored. Returns whether it was applied.
   */
  private replaceAlert(alert: BreachAlert): boolean {
    const shown = this.alerts.get().find((a) => a.id === alert.id);
    if (shown && ALERT_STEP[shown.state] > ALERT_STEP[alert.state]) return false;
    const rest = this.alerts.get().filter((a) => a.id !== alert.id);
    this.alerts.set([alert, ...rest].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)));
    return true;
  }

  private applySummary(summary: LiveSummary): void {
    this.summary.set(summary);
    this.interp.set("kpi:registered", summary.registered);
    this.interp.set("kpi:checked_in", summary.checked_in);
    this.interp.set("kpi:on_site", summary.on_site);
  }

  private sampleHistory(): void {
    const history = new Map(this.history.get());
    for (const room of this.rooms.get().values()) {
      const samples = [...(history.get(room.id) ?? []), room.occupancy];
      if (samples.length > HISTORY_LENGTH) samples.splice(0, samples.length - HISTORY_LENGTH);
      history.set(room.id, samples);
    }
    this.history.set(history);
  }

  /** Feed rows arrive at scan rate; the list updates at ≤ 4 Hz, admissions grouped per gate. */
  private pushFeed(item: FeedItem): void {
    this.pendingFeed.push(item);
    if (this.feedTimer !== null) return;
    this.feedTimer = window.setTimeout(() => {
      this.feedTimer = null;
      const batch = this.pendingFeed.splice(0);
      const rows: FeedItem[] = [];
      const grouped = new Map<string, FeedItem & { kind: "scan" }>();
      for (const row of batch) {
        if (row.kind === "scan" && row.result === "admitted" && !row.offline) {
          const group = grouped.get(row.checkpointId);
          if (group) {
            group.count += 1;
            group.at = Math.max(group.at, row.at);
            continue;
          }
          const copy = { ...row };
          grouped.set(row.checkpointId, copy);
          rows.push(copy);
          continue;
        }
        rows.push(row);
      }
      for (const row of rows) row.id = `${row.id}#${++this.feedSeq}`;
      rows.sort((a, b) => b.at - a.at);
      this.feed.set([...rows, ...this.feed.get()].slice(0, FEED_LENGTH));
    }, FEED_FLUSH_MS);
  }

  /** New alerts are spoken, coalesced: one sentence per burst, never one per alert. */
  private queueAnnounce(alert: BreachAlert): void {
    this.pendingAnnounce.push(alert);
    if (this.announceTimer !== null) return;
    this.announceTimer = window.setTimeout(() => {
      this.announceTimer = null;
      const batch = this.pendingAnnounce.splice(0);
      if (batch.length === 0) return;
      const top = [...batch].sort((a, b) => severityRank(a.severity) - severityRank(b.severity))[0] as BreachAlert;
      const where = this.layout.get()?.checkpoints.find((c) => c.id === top.checkpoint_id)?.label;
      const what = `${SEVERITY_VIEW[top.severity].label} alert: ${ALERT_KIND_LABEL[top.kind]}${where ? ` at ${where}` : ""}.`;
      const text = batch.length === 1 ? what : `${batch.length} new alerts. Highest: ${what}`;
      this.say(text, top.severity === "critical");
    }, ANNOUNCE_MS);
  }

  private say(text: string, assertive: boolean): void {
    // Toggle a trailing space so a repeat of the same sentence is still announced.
    this.announce.update((a) => {
      if (assertive) return { ...a, assertive: a.assertive === text ? `${text} ` : text };
      return { ...a, polite: a.polite === text ? `${text} ` : text };
    });
  }
}
