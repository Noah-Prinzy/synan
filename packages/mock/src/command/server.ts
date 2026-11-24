/**
 * The mock backend Admin Command talks to: the REST endpoints D1 reads (GET /dashboard,
 * GET /events/:id/summary, GET /venues/:id, GET /gates/health, GET /breach-alerts,
 * POST /alerts/:id/ack, POST /rooms/:id/recount) and one MockRealtime per live event
 * for the three streams. Everything is in contract shapes; anything that is not is
 * marked NOT IN CONTRACTS and listed as a request to the backend.
 *
 * Swapping to the real API replaces this object and the socket, nothing else: the
 * admin depends on the `CommandApi` and `RealtimeClient` interfaces only.
 */
import type { MockClock } from "../clock";
import { delay } from "../portal";
import { createRng, hashString, idFor, type Rng } from "../random";
import { MockRealtime, type MockGate, type RealtimeClient } from "../realtime";
import type {
  BreachAlert,
  Checkpoint,
  DashboardData,
  EventLiveSummary,
  EventState,
  GateHealth,
  RecountRequest,
  RecountResult,
  Role,
} from "../types";
import { buildVenue, type VenueKey, type VenueLayout } from "./venues";
import { CLOSED_EVENT, ReportJobs, closedSeedDownloads, summaryFor, type ExportFormat, type ReportRow } from "./summary";
import type { PostEventSummary, ReportKind } from "../types";
import { createConfigureMock, MockApiError, type ConfigureApi } from "./configure";
import { SCAN_RESULT_COPY } from "@synan/contracts/copy";
import {
  OpsLog,
  type AlertContext,
  type AlertCredential,
  type GateActivity,
  type GateDetail,
  type ScanLogQuery,
  type ScanPage,
  type TestRead,
} from "./ops";

/* -------------------------------------------------------------------- types */

/** An event as the event selector lists it (a subset of EventSummary, plus its venue). */
export interface CommandEvent {
  id: string;
  slug: string;
  title: string;
  state: EventState;
  starts_at: string;
  ends_at: string;
  venue_name: string;
  timezone: string;
}

/** The roles a signed-in user can hold (docs/01 §3, D-23): the contracts' `Role`. */
export type SessionRole = Role;

/** The mock's sign-in personas, one per role, so every console view can be previewed. */
export const SESSION_ROLES: readonly SessionRole[] = [
  "admin",
  "organiser",
  "supervisor",
  "desk_clerk",
  "security_staff",
  "speaker",
  "crew",
];

/**
 * Who is signed in, their role and their shift: the "who am I" of the console.
 * Close to contracts' `OperatorProfile` (GET /me/operator) plus what the console header shows.
 * NOT IN CONTRACTS: `name`, `event_ids` (the events a desk clerk is assigned to) and
 * `capabilities` (proposed: the server sends what the role may do, so the console never
 * keeps its own copy of the rules).
 */
export interface OperatorContext {
  id: string;
  name: string;
  email: string;
  role: SessionRole;
  shift: { label: string; starts_at: string; ends_at: string };
  /** Events this person may work. `null`: every event in the organisation. */
  event_ids: string[] | null;
  /** Proposed. Absent today: the console derives capabilities from the role. */
  capabilities?: string[];
}

/**
 * NOT IN CONTRACTS — per-minute history behind the KPI sparklines. Proposed as
 * `series` on GET /events/:id/summary (one value per bucket, oldest first).
 */
export interface SummarySeries {
  bucket_ms: number;
  /** Start of the first bucket. */
  from: string;
  registered: number[];
  checked_in: number[];
  on_site: number[];
  capacity_risk: number[];
  open_alerts: number[];
}

/** The contract now carries its own `series` (per-minute scan throughput); the admin KPI strip needs the per-figure series below, so it replaces it here until contracts carries both. */
export type LiveSummary = Omit<EventLiveSummary, "series"> & { series: SummarySeries };

export interface CommandApi {
  /** Server time, epoch ms. */
  now(): number;
  dashboard(): Promise<DashboardData>;
  events(): Promise<CommandEvent[]>;
  /** GET /me/operator. Rejects with UNAUTHENTICATED when no one is signed in. */
  operator(): Promise<OperatorContext>;
  /** POST /auth/logout. */
  signOut(): Promise<void>;
  /**
   * Mock only: sign back in as the last persona (the real sign-in is password plus second
   * factor, POST /auth/login + /auth/mfa/verify).
   */
  signIn(): Promise<OperatorContext>;
  /** GET /venues/:id for the event's venue, with layout extras. */
  layout(eventId: string): Promise<VenueLayout>;
  summary(eventId: string): Promise<LiveSummary>;
  alerts(eventId: string): Promise<BreachAlert[]>;
  gates(eventId: string): Promise<GateHealth[]>;
  ack(alertId: string): Promise<BreachAlert>;
  recount(roomId: string, body: RecountRequest): Promise<RecountResult>;
  /** GET /events/:id/post-event-summary (D-21). */
  postEventSummary(eventId: string): Promise<PostEventSummary>;
  /** POST /reports/:id/export — `:id` is the event. */
  exportReport(eventId: string, body: { format: ExportFormat; kind?: ReportKind }): Promise<ReportRow>;
  /** GET /reports/:eventId — export jobs and their state. */
  reports(eventId: string): Promise<ReportRow[]>;

  /* response (docs/06 D9, D10, D12, D12b) */
  /** POST /alerts/:id/resolve (contracts `ResolveAlert`: note 3–1000 characters). Rejects with VALIDATION_FAILED. */
  resolveAlert(alertId: string, body: { note: string }): Promise<BreachAlert>;
  /** NOT IN CONTRACTS — the scans, credential and rule behind one alert (D10's detail sheet). */
  alertContext(alertId: string): Promise<AlertContext>;
  /** GET /scans, newest first, with NOT IN CONTRACTS extras (see `ScanLogQuery`, `OpsScan`). */
  scans(eventId: string, query?: ScanLogQuery): Promise<ScanPage>;
  /** NOT IN CONTRACTS — heartbeat, last scan and the 15-minute series per gate (D12). */
  gateActivity(eventId: string): Promise<GateActivity[]>;
  /** NOT IN CONTRACTS — one gate's link history, throughput, results and last 50 scans (D12b). NOT_FOUND for a bad id. */
  gateDetail(eventId: string, checkpointId: string): Promise<GateDetail>;
  /** NOT IN CONTRACTS — a synthetic read, never logged as attendance (D12b `Test read`). */
  testRead(eventId: string, checkpointId: string): Promise<TestRead>;
}

export interface CommandMockOptions {
  clock: MockClock;
  /** `large` swaps Nexus Hall for its 60-room build (the performance test). */
  venueSize?: "standard" | "large";
  /** Every event is out of its live window (the D1 empty state). */
  noLiveEvent?: boolean;
  /** REST latency, ms. */
  latencyMs?: number;
  /** The first layout load fails (the D1 error state). */
  failFirstLoad?: boolean;
  /** First-run world for the configure screens: no organisation, no venues (D0). */
  freshOrganization?: boolean;
  /** Who is signed in at start (default `admin`). */
  role?: SessionRole;
}

export interface CommandMock {
  api: CommandApi;
  /** Development only: sign in as another persona at once (the role preview). */
  setPersona(role: SessionRole): void;
  /** The configure side: first run, venues, events, the wizard and the event workspace. */
  configure: ConfigureApi;
  /** The live socket for one event, or null when the event is not live. */
  realtimeFor(eventId: string): (RealtimeClient & { readonly mock: MockRealtime }) | null;
  /** Server-side handle for dev tools: scenarios, link control, ambient traffic. */
  serverFor(eventId: string): EventServer | null;
}

/* ------------------------------------------------------------------- events */

const BUCKET_MS = 60_000;
const SERIES_LENGTH = 60;

interface EventSpec {
  slug: string;
  title: string;
  state: EventState;
  starts_at: string;
  ends_at: string;
  venue: VenueKey | null;
  venue_name: string;
}

const EVENT_SPECS: EventSpec[] = [
  {
    slug: "nexus-summit-2026",
    title: "Nexus Summit 2026",
    state: "live",
    starts_at: "2026-11-22T06:00:00.000Z",
    ends_at: "2026-11-23T14:00:00.000Z",
    venue: "nexus-hall",
    venue_name: "Nexus Hall",
  },
  {
    slug: "security-operations-forum",
    title: "Security Operations Forum",
    state: "live",
    starts_at: "2026-11-22T07:00:00.000Z",
    ends_at: "2026-11-22T11:00:00.000Z",
    venue: "serena",
    venue_name: "Serena Conference Centre",
  },
  {
    slug: CLOSED_EVENT.slug,
    title: CLOSED_EVENT.title,
    state: "closed",
    starts_at: CLOSED_EVENT.starts_at,
    ends_at: CLOSED_EVENT.ends_at,
    venue: null,
    venue_name: CLOSED_EVENT.venue_name,
  },
  {
    slug: "design-week-kampala",
    title: "Design Week Kampala",
    state: "published",
    starts_at: "2026-11-25T07:00:00.000Z",
    ends_at: "2026-11-27T15:00:00.000Z",
    venue: null,
    venue_name: "Innovation Village",
  },
];

/* ------------------------------------------------------------- event server */

export class EventServer {
  readonly layout: VenueLayout;
  readonly rt: MockRealtime;
  readonly alerts = new Map<string, BreachAlert>();
  readonly health = new Map<string, GateHealth>();
  /** The scan log, gate activity and link history behind D9, D12 and D12b. */
  readonly ops: OpsLog;
  private readonly clock: MockClock;
  private readonly base: { registered: number; checkedIn: number; onSite: number };
  private readonly history: Omit<SummarySeries, "bucket_ms" | "from">;
  private readonly startBucket: number;
  private readonly recorded = new Map<number, Record<keyof Omit<SummarySeries, "bucket_ms" | "from">, number>>();
  private ambientTimer: number | null = null;
  private ambientRng: Rng;

  constructor(
    readonly event: CommandEvent,
    venue: VenueKey,
    clock: MockClock,
    readonly operatorId: string,
  ) {
    this.clock = clock;
    const built = buildVenue(venue, idFor("org:synan-demo"));
    this.layout = built.layout;
    const rooms = this.layout.rooms;
    this.rt = new MockRealtime({
      clock,
      dropWhileDown: true,
      venue: {
        eventId: event.id,
        rooms: rooms.map((room) => ({
          room_id: room.id,
          zone_id: room.zone_id,
          capacity: room.capacity,
          warn_at_pct: room.warn_at_pct,
          block_at_pct: room.block_at_pct,
          occupancy: built.initial[room.id] ?? 0,
        })),
        gates: this.layout.checkpoints.map(toMockGate),
      },
    });
    this.ambientRng = createRng(rooms.length * 7919);

    // People inside the perimeter: everyone in a room, plus a corridor crowd.
    const inRooms = Object.values(built.initial).reduce((sum, n) => sum + n, 0);
    const onSite = inRooms + Math.round(inRooms * 0.09);
    const checkedIn = onSite + Math.round(onSite * 0.11);
    this.base = { registered: Math.round(checkedIn * 1.24), checkedIn, onSite };

    const now = clock.now();
    this.startBucket = Math.floor(now / BUCKET_MS);
    this.history = backfill(this.base, rooms.length, createRng(rooms.length));

    for (const checkpoint of this.layout.checkpoints) {
      this.health.set(checkpoint.id, {
        checkpoint_id: checkpoint.id,
        label: checkpoint.label,
        link_state: "online",
        last_heartbeat_at: new Date(now - 2_000).toISOString(),
        queue_depth: 0,
        clock_offset_ms: 0,
        clock_fault: false,
        scans_last_minute: checkpoint.perimeter ? 14 + (checkpoint.label.length % 9) : checkpoint.label.length % 4,
      });
    }

    // One alert open at the demo instant: the workshop that is nearly full.
    const workshop = rooms[1];
    const workshopDoor = this.layout.checkpoints[3];
    if (workshop && workshopDoor) {
      const raised = alertRecord(event.id, {
        kind: "capacity_warn",
        severity: "medium",
        detail: `${workshop.name} passed its warning threshold (85%)`,
        checkpoint_id: workshopDoor.id,
        occurred_at: new Date(now - 6 * 60_000).toISOString(),
      });
      this.alerts.set(raised.id, raised);
    }
    // And one from earlier in the shift, already resolved.
    const earlier = alertRecord(event.id, {
      kind: "gate_offline",
      severity: "high",
      detail: "No heartbeat for more than 60 seconds",
      checkpoint_id: this.layout.checkpoints[1]?.id ?? null,
      occurred_at: new Date(now - 48 * 60_000).toISOString(),
    });
    earlier.state = "resolved";
    earlier.acked_by = operatorId;
    earlier.acked_at = new Date(now - 46 * 60_000).toISOString();
    earlier.resolution_note = "Power cable reseated.";
    this.alerts.set(earlier.id, earlier);

    this.ops = new OpsLog(this.layout, this.rt, clock, this.health, event.id, Date.parse(event.starts_at));

    // The server's own bookkeeping: every alert and gate change lands in its tables.
    this.rt.tap("/stream/alerts", (message) => {
      if (message.type === "alert.raised" || message.type === "alert.updated") {
        this.alerts.set(message.data.id, message.data);
      } else if (message.type === "gate.health") {
        this.health.set(message.data.checkpoint_id, message.data);
      }
    });
  }

  summary(): LiveSummary {
    const now = this.clock.now();
    const current = this.current();
    const bucket = Math.floor(now / BUCKET_MS);
    this.recorded.set(bucket, current);

    const first = bucket - SERIES_LENGTH + 1;
    const series: SummarySeries = {
      bucket_ms: BUCKET_MS,
      from: new Date(first * BUCKET_MS).toISOString(),
      registered: [],
      checked_in: [],
      on_site: [],
      capacity_risk: [],
      open_alerts: [],
    };
    for (let b = first; b <= bucket; b++) {
      const live = this.recorded.get(b);
      const back = this.startBucket - b; // 0 = the bucket the mock started in
      for (const key of ["registered", "checked_in", "on_site", "capacity_risk", "open_alerts"] as const) {
        if (live) series[key].push(live[key]);
        else if (back >= 0) series[key].push(this.history[key][SERIES_LENGTH - 1 - Math.min(back, SERIES_LENGTH - 1)] as number);
        else series[key].push(series[key][series[key].length - 1] ?? current[key]);
      }
    }

    const registered = current.registered;
    return {
      event_id: this.event.id,
      registered,
      checked_in: current.checked_in,
      on_site: current.on_site,
      by_tier: {
        VIP: Math.round(registered * 0.06),
        PRIVATE_INVITE: Math.round(registered * 0.04),
        PUBLIC: Math.round(registered * 0.15),
        ORDINARY: registered - Math.round(registered * 0.06) - Math.round(registered * 0.04) - Math.round(registered * 0.15),
      },
      open_alerts: current.open_alerts,
      as_of: new Date(now).toISOString(),
      series,
    };
  }

  /** A trickle of everyday traffic, so a quiet floor still looks like a live one. */
  startAmbient(): void {
    if (this.ambientTimer !== null) return;
    const rng = this.ambientRng;
    const gates = this.rt.gates;
    const entries = gates.filter((gate) => gate.perimeter).slice(0, 3);
    const exit = this.layout.checkpoints.find((c) => c.perimeter && c.direction === "out");
    const exitGate = gates.find((gate) => gate.id === exit?.id);
    const roomIds = [...this.rt.rooms.keys()];
    const tick = () => {
      this.ambientTimer = this.clock.setTimeout(tick, 600);
      // An offline gate's scans queue on the device; they arrive at sync, not now.
      const reachable = entries.filter((g) => this.health.get(g.id)?.link_state !== "offline");
      const gate = reachable[Math.floor(rng() * reachable.length)];
      if (gate) {
        const roll = rng();
        if (roll < 0.9) this.rt.scan({ gate, result: "admitted" });
        else if (roll < 0.96) this.rt.scan({ gate, result: "already_inside" });
        else this.rt.scan({ gate, result: "duplicate_read" });
      }
      if (exitGate && rng() < 0.35) this.rt.exit(exitGate);
      // Rooms drift toward a comfortable middle, one person at a time.
      for (let i = 0; i < 2; i++) {
        const roomId = roomIds[Math.floor(rng() * roomIds.length)] as string;
        const room = this.rt.rooms.get(roomId);
        if (!room || room.capacity === 0) continue;
        const pct = (room.occupancy ?? 0) / room.capacity;
        const up = pct < 0.55 ? 0.7 : pct > 0.92 ? 0.25 : 0.5;
        this.rt.adjustRoom(roomId, rng() < up ? 1 : -1);
      }
    };
    tick();
  }

  stopAmbient(): void {
    if (this.ambientTimer !== null) this.clock.clearTimeout(this.ambientTimer);
    this.ambientTimer = null;
  }

  ambientRunning(): boolean {
    return this.ambientTimer !== null;
  }

  private current() {
    const rooms = [...this.rt.rooms.values()];
    const inRooms = rooms.reduce((sum, room) => sum + (room.occupancy ?? 0), 0);
    const minutes = Math.max(0, Math.floor((this.clock.now() - this.startBucket * BUCKET_MS) / BUCKET_MS));
    const checkedIn = this.base.checkedIn + this.rt.counters.checkedIn;
    const onSite = Math.max(inRooms, this.base.onSite + this.rt.counters.checkedIn - this.rt.counters.exited);
    return {
      registered: Math.max(this.base.registered + Math.floor(minutes / 3), checkedIn),
      checked_in: checkedIn,
      on_site: onSite,
      capacity_risk: rooms.filter((room) => room.level !== "ok").length,
      open_alerts: [...this.alerts.values()].filter((alert) => alert.state === "open").length,
    };
  }
}

function toMockGate(checkpoint: Checkpoint): MockGate {
  return { id: checkpoint.id, label: checkpoint.label, perimeter: checkpoint.perimeter, roomId: checkpoint.room_id };
}

function alertRecord(
  eventId: string,
  input: Pick<BreachAlert, "kind" | "severity" | "detail" | "checkpoint_id" | "occurred_at">,
): BreachAlert {
  return {
    id: idFor(`alert:seed:${eventId}:${input.occurred_at}`),
    event_id: eventId,
    credential_id: null,
    state: "open",
    acked_by: null,
    acked_at: null,
    resolution_note: null,
    scan_ids: [],
    ...input,
  };
}

/** The hour before the mock started: a plausible doors-open curve, oldest first. */
function backfill(
  base: { registered: number; checkedIn: number; onSite: number },
  roomCount: number,
  rng: Rng,
): Omit<SummarySeries, "bucket_ms" | "from"> {
  const out: Omit<SummarySeries, "bucket_ms" | "from"> = {
    registered: [],
    checked_in: [],
    on_site: [],
    capacity_risk: [],
    open_alerts: [],
  };
  for (let i = 0; i < SERIES_LENGTH; i++) {
    const t = i / (SERIES_LENGTH - 1); // 0 = an hour ago, 1 = now
    const ease = 1 - Math.pow(1 - t, 2);
    const checkedIn = Math.round(base.checkedIn * (0.82 + 0.18 * ease));
    out.checked_in.push(checkedIn);
    out.registered.push(Math.round(base.registered - (1 - t) * 20));
    const wobble = Math.sin(i / 4.5) * 0.015 + (rng() - 0.5) * 0.008;
    out.on_site.push(Math.min(checkedIn, Math.round(base.onSite * (0.84 + 0.16 * ease + wobble))));
    const risk = Math.max(0, Math.round(Math.max(1, roomCount / 8) * (0.3 + 0.7 * ease)));
    out.capacity_risk.push(risk);
    out.open_alerts.push(i > 50 ? 1 : i > 10 && i < 14 ? 1 : 0);
  }
  return out;
}

/* ---------------------------------------------------------------- the mock */

export function createCommandMock(options: CommandMockOptions): CommandMock {
  const { clock } = options;
  const latency = options.latencyMs ?? 300;
  let failLayout = options.failFirstLoad ?? false;
  const dayShift = { label: "Day shift", starts_at: "2026-11-22T05:00:00.000Z", ends_at: "2026-11-22T17:00:00.000Z" };
  const persona = (role: SessionRole, slug: string, name: string, shift: OperatorContext["shift"] = dayShift): OperatorContext => ({
    id: idFor(`user:${slug}`),
    name,
    email: `${name.split(" ")[0]?.toLowerCase()}@synan-demo.org`,
    role,
    shift,
    event_ids: null,
  });
  // The admin keeps the id every seeded record (exports, alert acks) was written with.
  const operator: OperatorContext = persona("admin", "operator-amara", "Amara Okello");
  const personas: Record<SessionRole, OperatorContext> = {
    admin: operator,
    organiser: persona("organiser", "operator-daniel", "Daniel Mugisha"),
    supervisor: persona("supervisor", "operator-grace", "Grace Achieng"),
    desk_clerk: persona("desk_clerk", "staff-kemi", "Kemi Nakamya", {
      label: "Registration desk",
      starts_at: "2026-11-22T05:30:00.000Z",
      ends_at: "2026-11-22T14:00:00.000Z",
    }),
    security_staff: persona("security_staff", "staff-moses", "Moses Opio"),
    speaker: persona("speaker", "staff-ruth", "Ruth Namutebi"),
    crew: persona("crew", "staff-owen", "Owen Kizza"),
  };
  let current: SessionRole = options.role ?? "admin";
  let signedIn = true;

  const events: (CommandEvent & { venue: VenueKey | null })[] = EVENT_SPECS.map((spec) => {
    const venue: VenueKey | null =
      spec.venue === "nexus-hall" && options.venueSize === "large" ? "nexus-hall-full" : spec.venue;
    return {
      id: idFor(`event:${spec.slug}`),
      slug: spec.slug,
      title: spec.title,
      state: options.noLiveEvent && spec.state === "live" ? "published" : spec.state,
      // With nothing live, the would-be live events open in two days rather than in the past.
      starts_at:
        options.noLiveEvent && spec.state === "live"
          ? new Date(Date.parse(spec.starts_at) + 2 * 86_400_000).toISOString()
          : spec.starts_at,
      ends_at: spec.ends_at,
      venue_name: spec.venue_name,
      timezone: "Africa/Kampala",
      venue,
    };
  });

  // The desk clerk works the Nexus Summit desk and sees nothing else.
  personas.desk_clerk.event_ids = [idFor("event:nexus-summit-2026")];

  const closedId = idFor(`event:${CLOSED_EVENT.slug}`);
  const jobs = new ReportJobs(clock, operator.id);
  jobs.seed(closedSeedDownloads(closedId, operator.id));
  let failSummary = options.failFirstLoad ?? false;

  const servers = new Map<string, EventServer>();
  const serverFor = (eventId: string): EventServer | null => {
    const existing = servers.get(eventId);
    if (existing) return existing;
    const event = events.find((e) => e.id === eventId);
    if (!event || event.state !== "live" || !event.venue) return null;
    const { venue, ...rest } = event;
    const server = new EventServer(rest, venue, clock, operator.id);
    servers.set(eventId, server);
    return server;
  };
  const need = (eventId: string): EventServer => {
    const server = serverFor(eventId);
    if (!server) throw new Error("NOT_FOUND");
    return server;
  };

  const api: CommandApi = {
    now: () => clock.now(),
    async dashboard() {
      await delay(latency);
      // An event made live from the configure screens has no simulated floor; it counts as quiet.
      const live = events
        .filter((event) => event.state === "live")
        .map((event) => serverFor(event.id))
        .filter((server): server is EventServer => server !== null);
      return {
        live_events: live.length,
        on_site: live.reduce((sum, server) => sum + server.summary().on_site, 0),
        open_alerts: live.reduce((sum, server) => sum + server.summary().open_alerts, 0),
        gates_offline: live.reduce(
          (sum, server) => sum + [...server.health.values()].filter((gate) => gate.link_state === "offline").length,
          0,
        ),
        as_of: new Date(clock.now()).toISOString(),
      };
    },
    async events() {
      await delay(latency);
      return events.map(({ venue: _venue, ...event }) => event);
    },
    async operator() {
      await delay(latency);
      if (!signedIn) throw new MockApiError("UNAUTHENTICATED");
      return structuredClone(personas[current]);
    },
    async signOut() {
      await delay(Math.min(latency, 160));
      signedIn = false;
    },
    async signIn() {
      await delay(latency);
      signedIn = true;
      return structuredClone(personas[current]);
    },
    async layout(eventId) {
      await delay(latency);
      if (failLayout) {
        failLayout = false;
        throw new Error("INTERNAL");
      }
      return need(eventId).layout;
    },
    async summary(eventId) {
      await delay(Math.min(latency, 120));
      return need(eventId).summary();
    },
    async alerts(eventId) {
      await delay(latency);
      return [...need(eventId).alerts.values()].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
    },
    async gates(eventId) {
      await delay(latency);
      return [...need(eventId).health.values()];
    },
    async ack(alertId) {
      await delay(Math.min(latency, 160));
      for (const server of servers.values()) {
        const alert = server.alerts.get(alertId);
        if (!alert) continue;
        if (alert.state !== "open") return alert;
        const acked: BreachAlert = {
          ...alert,
          state: "acked",
          acked_by: personas[current].id,
          acked_at: new Date(clock.now()).toISOString(),
        };
        server.rt.alertUpdated(acked);
        return acked;
      }
      throw new Error("NOT_FOUND");
    },
    async recount(roomId, body) {
      await delay(Math.min(latency, 200));
      const server = need(body.event_id);
      const room = server.rt.rooms.get(roomId);
      if (!room) throw new Error("NOT_FOUND");
      const previous = room.occupancy ?? 0;
      server.rt.setRoom(roomId, body.count);
      return {
        room_id: roomId,
        previous,
        occupancy: body.count,
        adjustment_id: idFor(`adjustment:${roomId}:${clock.now()}`),
      };
    },
    async postEventSummary(eventId) {
      await delay(latency);
      if (failSummary) {
        failSummary = false;
        throw new Error("INTERNAL");
      }
      const event = events.find((e) => e.id === eventId);
      if (!event) throw new Error("NOT_FOUND");
      return summaryFor({
        eventId,
        state: event.state,
        server: event.state === "live" ? serverFor(eventId) : null,
        closed: eventId === closedId,
        now: clock.now(),
        operatorId: operator.id,
        jobs,
      });
    },
    async exportReport(eventId, body) {
      await delay(Math.min(latency, 200));
      return jobs.start(eventId, body.format, body.kind);
    },
    async reports(eventId) {
      await delay(Math.min(latency, 120));
      return jobs.list(eventId);
    },

    async resolveAlert(alertId, body) {
      await delay(Math.min(latency, 200));
      const note = body.note.trim();
      if (note.length < 3) throw new MockApiError("VALIDATION_FAILED", { note: "Write at least three characters on what was done." });
      if (note.length > 1000) throw new MockApiError("VALIDATION_FAILED", { note: "Keep the note under 1,000 characters." });
      const found = alertById(alertId);
      if (!found) throw new MockApiError("NOT_FOUND");
      const { alert, server } = found;
      if (alert.state === "resolved") return alert;
      const resolved: BreachAlert = {
        ...alert,
        state: "resolved",
        // Resolving an open alert acknowledges it too.
        acked_by: alert.acked_by ?? personas[current].id,
        acked_at: alert.acked_at ?? new Date(clock.now()).toISOString(),
        resolution_note: note,
      };
      server.rt.alertUpdated(resolved);
      return resolved;
    },
    async alertContext(alertId) {
      await delay(Math.min(latency, 200));
      const found = alertById(alertId);
      if (!found) throw new MockApiError("NOT_FOUND");
      const { alert, server } = found;
      return {
        alert_id: alert.id,
        ...server.ops.context(alert),
        credential: await credentialFor(alert),
        acked_by_name: alert.acked_by ? nameOf(alert.acked_by) : null,
      };
    },
    async scans(eventId, query = {}) {
      await delay(Math.min(latency, 200));
      return need(eventId).ops.page(query, (result) => SCAN_RESULT_COPY[result].label);
    },
    async gateActivity(eventId) {
      await delay(Math.min(latency, 120));
      return need(eventId).ops.activity();
    },
    async gateDetail(eventId, checkpointId) {
      await delay(Math.min(latency, 200));
      const detail = need(eventId).ops.detail(checkpointId);
      if (!detail) throw new MockApiError("NOT_FOUND");
      return detail;
    },
    async testRead(eventId, checkpointId) {
      // A real round trip to the device: a little slower than a REST read.
      await delay(Math.min(latency, 200) + 250);
      return need(eventId).ops.testRead(checkpointId);
    },
  };

  const alertById = (alertId: string): { alert: BreachAlert; server: EventServer } | null => {
    for (const server of servers.values()) {
      const alert = server.alerts.get(alertId);
      if (alert) return { alert, server };
    }
    return null;
  };

  const nameOf = (userId: string): string => {
    const persona = Object.values(personas).find((p) => p.id === userId);
    return persona?.name ?? "Another operator";
  };

  /**
   * The registration an alert is about. The scenarios raise alerts without one, so the mock links
   * each alert to a fitting registration of the event once, and keeps that link: an impossible
   * travel alert to a pass under review, so `Clear credential` and `Revoke` act on a real row.
   */
  const alertCredential = new Map<string, string | null>();
  const credentialFor = async (alert: BreachAlert): Promise<AlertCredential | null> => {
    const wants =
      alert.kind === "impossible_travel"
        ? ({ credential: "suspended_review" } as const)
        : alert.kind === "unauthorised_tier"
          ? ({ tier: "PUBLIC" } as const)
          : alert.kind === "pass_replayed" || alert.kind === "offline_conflict_pass_reuse" || alert.kind === "offline_conflict_passback"
            ? ({ credential: "active" } as const)
            : null;
    if (!wants) return null;
    if (!alertCredential.has(alert.id)) {
      const { items } = await configure.attendees(alert.event_id, wants);
      const used = new Set(alertCredential.values());
      const free = items.filter((row) => !used.has(row.registration_id));
      const pool = free.length > 0 ? free : items;
      const row = pool[hashString(alert.id) % Math.max(1, pool.length)];
      alertCredential.set(alert.id, row?.registration_id ?? null);
    }
    const registrationId = alertCredential.get(alert.id);
    if (!registrationId) return null;
    const row = await configure.deskAttendee(alert.event_id, registrationId);
    return {
      registration_id: row.registration_id,
      credential_id: row.credential_id,
      state: row.credential_state,
      tier: row.tier,
      full_name: row.full_name,
      band_hint: row.band_hint,
    };
  };

  const configure = createConfigureMock({
    clock,
    latencyMs: latency,
    events,
    orgId: idFor("org:synan-demo"),
    operator: { id: operator.id, name: operator.name },
    venueSize: options.venueSize ?? "standard",
    liveCounts: (eventId) => {
      const event = events.find((e) => e.id === eventId);
      if (!event || event.state !== "live") return null;
      const server = serverFor(eventId);
      if (!server) return null;
      const summary = server.summary();
      return { registered: summary.registered, checked_in: summary.checked_in };
    },
    fresh: options.freshOrganization ?? false,
    failOnce: options.failFirstLoad ?? false,
  });

  return {
    api,
    configure,
    setPersona(role) {
      current = role;
      signedIn = true;
    },
    serverFor,
    realtimeFor(eventId) {
      const server = serverFor(eventId);
      if (!server) return null;
      const rt = server.rt;
      return {
        mock: rt,
        subscribe: (channel, handler) => rt.subscribe(channel, handler),
        status: () => rt.status(),
        onStatus: (listener) => rt.onStatus(listener),
        ping: () => rt.ping(),
      };
    },
  };
}
