/**
 * WebSocket server (02 §6, 03 §3, P-16).
 *
 * Upgrade: `Sec-WebSocket-Protocol: <WS_SUBPROTOCOL>, <WS_TICKET_PREFIX><ticket>`. The ticket is single-use,
 * 30 s, bound to the principal, channel and event it was minted for. Tickets in the URL are
 * ignored. The Origin header, when present, must be an allowed origin.
 *
 * Channels and their scoping, matching the REST rules:
 *   /stream/telemetry  operators: full; attendees and staff: the public (k-anonymous) scope.
 *   /stream/scans      operators: the event (optionally one checkpoint); staff: only checkpoints they
 *                      are staffing now, closed when the shift ends. Heartbeat frames feed gate health.
 *   /stream/alerts     operators: everything (optionally one event); staff: alerts at their current
 *                      checkpoints, without the credential link. Attendees: refused.
 *   /stream/me         attendees: their own pass status and entitlements, so a revoked pass flips live.
 */
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { ContractError } from "@synan/contracts/errors";
import type { WsChannel } from "@synan/contracts/enums";
import { WS_SUBPROTOCOL, WS_TICKET_PREFIX, type BreachAlert } from "@synan/contracts/rest";
import { ClientMessage, WS_CLOSE } from "@synan/contracts/ws";
import type { AppContext } from "../app.js";
import type { AuthContext } from "../domain/principal.js";
import { currentAssignments } from "../domain/scope.js";
import { canSeeEvent } from "../routes/events.js";
import { ChannelHub, type Envelope, type View } from "./channel-hub.js";
import type { TelemetryScope } from "./telemetry-hub.js";

const CHANNELS: ReadonlySet<string> = new Set(["/stream/scans", "/stream/telemetry", "/stream/alerts", "/stream/me"]);
const HELLO_TIMEOUT_MS = 5_000;
const HEARTBEAT_MS = 30_000;
const MAX_BUFFERED = 1 << 20;
const SERVER_HEARTBEAT_MS = 15_000;

export interface ChannelGrant {
  scope: TelemetryScope | "own";
  /** Staff: the checkpoints they may follow (null = not restricted, operators). */
  checkpoints: string[] | null;
  /** Staff: when the earliest relevant shift ends; the socket closes then. */
  until: number | null;
}

/** Per-channel authorisation. Throws a ContractError when refused. */
export async function authoriseChannel(
  app: AppContext,
  ctx: AuthContext,
  channel: WsChannel,
  eventId: string | null,
  checkpointId: string | null,
): Promise<ChannelGrant> {
  const required = () => new ContractError("VALIDATION_FAILED", "event_id is required", [{ path: "body.event_id", message: "required" }]);
  const operator = ctx.kind === "operator";
  const staffScope = async (venueId: string | null) => {
    const now = app.clock.now();
    const shifts = [];
    for (const a of await currentAssignments(app, ctx.sub)) {
      const cp = await app.repos.venues.checkpoint(a.checkpoint_id);
      if (cp && (!venueId || cp.venue_id === venueId) && (!checkpointId || cp.id === checkpointId)) shifts.push(a);
    }
    if (!shifts.length) throw new ContractError("CHECKPOINT_NOT_ASSIGNED");
    return { checkpoints: [...new Set(shifts.map((a) => a.checkpoint_id))], until: Math.min(...shifts.map((a) => a.shift_end.getTime()), now + 24 * 3600_000) };
  };

  if (channel === "/stream/telemetry") {
    if (!eventId) throw required();
    const event = await app.repos.events.byId(eventId);
    if (!event) throw new ContractError("NOT_FOUND");
    if (operator) return { scope: "full", checkpoints: null, until: null };
    // Reduced public scope for event pages: attendees and staff, published/live events they may see.
    if ((event.state !== "published" && event.state !== "live") || !(await canSeeEvent(app, event, ctx))) throw new ContractError("NOT_FOUND");
    return { scope: "public", checkpoints: null, until: null };
  }
  if (channel === "/stream/scans") {
    if (ctx.kind === "attendee") throw new ContractError("FORBIDDEN");
    if (!eventId) throw required();
    const event = await app.repos.events.byId(eventId);
    if (!event) throw new ContractError("NOT_FOUND");
    if (operator) {
      if (checkpointId && (await app.repos.venues.checkpoint(checkpointId))?.venue_id !== event.venue_id) throw new ContractError("NOT_FOUND");
      return { scope: "full", checkpoints: checkpointId ? [checkpointId] : null, until: null };
    }
    if (ctx.role !== "security_staff") throw new ContractError("FORBIDDEN");
    return { scope: "own", ...(await staffScope(event.venue_id)) };
  }
  if (channel === "/stream/alerts") {
    if (ctx.kind === "attendee") throw new ContractError("FORBIDDEN");
    if (eventId && !(await app.repos.events.byId(eventId))) throw new ContractError("NOT_FOUND");
    if (operator) return { scope: "full", checkpoints: null, until: null };
    if (ctx.role !== "security_staff") throw new ContractError("FORBIDDEN");
    const event = eventId ? await app.repos.events.byId(eventId) : null;
    return { scope: "own", ...(await staffScope(event?.venue_id ?? null)) };
  }
  // /stream/me
  if (ctx.kind !== "attendee") throw new ContractError("FORBIDDEN");
  if (eventId && !(await app.repos.registrations.forAttendee(ctx.sub)).some((r) => r.event_id === eventId && r.state !== "cancelled")) {
    throw new ContractError("NOT_FOUND");
  }
  return { scope: "own", checkpoints: null, until: null };
}

/** Routing facts carried with every channel event (never sent to clients). */
export interface Meta {
  event_id: string;
  checkpoint_id?: string | null;
  attendee_id?: string;
}

/** Wires the domain's emitters into the three event hubs. */
export function createHubs(app: AppContext) {
  const scans = new ChannelHub<Meta>(app.clock);
  const alerts = new ChannelHub<Meta>(app.clock);
  const me = new ChannelHub<Meta>(app.clock);
  app.scans.events.on("scan", (d: { event_id: string; checkpoint_id: string }) => scans.publish("scan.result", d, { event_id: d.event_id, checkpoint_id: d.checkpoint_id }));
  const alert = (type: string) => (a: BreachAlert) => alerts.publish(type, a, { event_id: a.event_id, checkpoint_id: a.checkpoint_id });
  app.alerts.events.on("raised", alert("alert.raised"));
  app.alerts.events.on("updated", alert("alert.updated"));
  app.credentials.events.on("state", (s: { event_id: string; attendee_id: string; state: string }) =>
    me.publish("pass.status", { event_id: s.event_id, state: s.state }, { event_id: s.event_id, attendee_id: s.attendee_id }));
  app.credentials.events.on("entitlements", (s: { event_id: string; attendee_id: string }) => {
    void app.credentials.myCredential(s.attendee_id, s.event_id).then(
      (c) => me.publish("entitlements.updated", { event_id: s.event_id, permitted_room_ids: c.permitted_room_ids }, { event_id: s.event_id, attendee_id: s.attendee_id }),
      () => undefined,
    );
  });
  return { scans, alerts, me };
}

function reject(socket: Duplex, status: number, text: string) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function attachWebSockets(server: Server, app: AppContext) {
  const hubs = createHubs(app);
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 16 * 1024,
    handleProtocols: (protocols) => (protocols.has(WS_SUBPROTOCOL) ? WS_SUBPROTOCOL : false),
  });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    void (async () => {
      const path = (req.url ?? "").split("?")[0] ?? "";
      if (!CHANNELS.has(path)) return reject(socket, 404, "Not Found");
      const origin = req.headers.origin;
      if (origin && !app.config.allowedOrigins.includes(origin)) return reject(socket, 403, "Forbidden");

      const offered = String(req.headers["sec-websocket-protocol"] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const ticketProto = offered.find((p) => p.startsWith(WS_TICKET_PREFIX));
      if (!offered.includes(WS_SUBPROTOCOL) || !ticketProto) return reject(socket, 401, "Unauthorized");
      const grant = await app.auth.consumeWsTicket(ticketProto.slice(WS_TICKET_PREFIX.length));
      // Rogue scanner connection (03 §8.2): a scanner stream with a ticket that is not valid. The ticket is never recorded.
      const ip = req.socket.remoteAddress ?? "unknown";
      if (!grant || grant.channel !== path) {
        if (path === "/stream/scans") await app.scannerTrust.refused({ reason: "invalid_ws_ticket", channel: "ws /stream/scans", ip, userId: grant?.ctx.sub ?? null });
        return reject(socket, 401, "Unauthorized");
      }

      let g: ChannelGrant;
      try {
        g = await authoriseChannel(app, grant.ctx, grant.channel, grant.eventId, grant.checkpointId);
      } catch (e) {
        // The assignment ended between minting and connecting, or never existed.
        if (path === "/stream/scans" && e instanceof ContractError && e.code === "CHECKPOINT_NOT_ASSIGNED") {
          await app.scannerTrust.refused({ reason: "not_assigned", channel: "ws /stream/scans", ip, userId: grant.ctx.sub, checkpointId: grant.checkpointId, eventId: grant.eventId });
        }
        return reject(socket, 403, "Forbidden");
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        if (grant.channel === "/stream/telemetry") return onTelemetry(app, ws, grant.eventId!, g.scope as TelemetryScope);
        const ctx = grant.ctx;
        const inScope = (cp: string | null | undefined) => g.checkpoints === null || (cp != null && g.checkpoints.includes(cp));
        const byEvent = (e: { meta: Meta }) => !grant.eventId || e.meta.event_id === grant.eventId;
        const env = (e: { id: string; type: string; at: string; data: unknown }): Envelope => ({ id: e.id, type: e.type, at: e.at, data: e.data });
        let hub: ChannelHub<Meta>;
        let view: View<Meta>;
        if (grant.channel === "/stream/scans") {
          hub = hubs.scans;
          view = (e) => (byEvent(e) && inScope(e.meta.checkpoint_id) ? env(e) : null);
        } else if (grant.channel === "/stream/alerts") {
          hub = hubs.alerts;
          view = (e) => {
            if (!byEvent(e) || !inScope(e.meta.checkpoint_id)) return null;
            // Staff never receive the credential link (as GET /breach-alerts).
            return ctx.kind === "operator" ? env(e) : { ...env(e), data: { ...(e.data as BreachAlert), credential_id: null } };
          };
        } else {
          hub = hubs.me;
          view = (e) => (e.meta.attendee_id === ctx.sub && byEvent(e) ? env(e) : null);
        }
        onChannel(app, ws, grant.channel, g, hub, view, grant.channel === "/stream/scans" && g.checkpoints?.length === 1 ? g.checkpoints[0]! : grant.checkpointId, ctx.sub, ip);
      });
    })().catch(() => reject(socket, 500, "Internal Server Error"));
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const w = ws as WebSocket & { alive?: boolean };
      if (w.alive === false) {
        w.terminate();
        continue;
      }
      w.alive = false;
      w.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    wss,
    hubs,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat);
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => resolve());
      }),
  };
}

/** Shared framing: hello within 5 s, ping/pong, slow-consumer cut-off. */
function frame(app: AppContext, ws: WebSocket, onHello: (lastEventId: string | undefined) => void, onHeartbeat?: (m: { queue_depth: number; clock_offset_ms: number; online: boolean; device_id?: string }) => void) {
  const w = ws as WebSocket & { alive?: boolean };
  w.alive = true;
  ws.on("pong", () => (w.alive = true));
  let helloSeen = false;
  let beat: NodeJS.Timeout | null = null;
  const helloTimer = setTimeout(() => ws.close(WS_CLOSE.BAD_MESSAGE, "hello expected"), HELLO_TIMEOUT_MS);
  const send = (msg: unknown) => {
    if (ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > MAX_BUFFERED) return void ws.close(WS_CLOSE.POLICY, "slow consumer");
    ws.send(JSON.stringify(msg));
  };
  ws.on("message", (raw) => {
    let parsed: ReturnType<typeof ClientMessage.safeParse>;
    try {
      parsed = ClientMessage.safeParse(JSON.parse(String(raw)));
    } catch {
      return ws.close(WS_CLOSE.BAD_MESSAGE, "invalid json");
    }
    if (!parsed.success) return ws.close(WS_CLOSE.BAD_MESSAGE, "invalid message");
    const msg = parsed.data;
    if (msg.type === "hello") {
      if (helloSeen) return; // only the first hello counts
      helloSeen = true;
      clearTimeout(helloTimer);
      onHello(msg.last_event_id);
      // Application-level heartbeat: lets a client tell a quiet stream from a dead one.
      beat = setInterval(() => send({ type: "heartbeat", server_time: new Date(app.clock.now()).toISOString() }), SERVER_HEARTBEAT_MS);
      beat.unref();
    } else if (msg.type === "ping") {
      send({ type: "pong", t: msg.t, server_time: new Date(app.clock.now()).toISOString() });
    } else if (msg.type === "heartbeat") {
      onHeartbeat?.(msg);
    }
  });
  ws.on("close", () => {
    clearTimeout(helloTimer);
    if (beat) clearInterval(beat);
  });
  ws.on("error", () => ws.terminate());
  return send;
}

function onChannel(app: AppContext, ws: WebSocket, channel: WsChannel, g: ChannelGrant, hub: ChannelHub<Meta>, view: View<Meta>, heartbeatCheckpoint: string | null, userId: string, remoteIp: string) {
  let unsubscribe: (() => void) | null = null;
  // A staff stream ends with the shift (server time).
  const shiftTimer = g.until !== null ? setTimeout(() => ws.close(WS_CLOSE.POLICY, "shift ended"), Math.max(0, g.until - app.clock.now())) : null;
  shiftTimer?.unref();
  const send = frame(
    app,
    ws,
    (last) => {
      const sub = hub.subscribe(view, (m) => send(m), last);
      unsubscribe = sub.unsubscribe;
      send({ type: "ready", channel, scope: g.scope === "own" ? "own" : "full", resumed: sub.resumed, heartbeat_interval_ms: HEARTBEAT_MS });
      for (const m of sub.catchUp) send(m);
    },
    channel === "/stream/scans" && g.scope === "own" && heartbeatCheckpoint
      ? (m) => {
          // The phone is a device: the frame lands on its device row and the checkpoint (never logged with detail).
          void (async () => {
            const cp = await app.repos.venues.checkpoint(heartbeatCheckpoint);
            if (!cp) return;
            const r = await app.gates.phoneHeartbeat({
              userId, venueId: cp.venue_id, checkpointId: cp.id, clientDeviceId: m.device_id ?? "stream",
              clockOffsetMs: m.clock_offset_ms, queueDepth: m.queue_depth, online: m.online,
            });
            if (r !== "ok") {
              // An operator retired this phone's scanner: drop the stream and alert (03 §8.2).
              await app.scannerTrust.refused({ reason: "scanner_retired", channel: "ws /stream/scans", ip: remoteIp, userId, checkpointId: cp.id });
              ws.close(WS_CLOSE.POLICY, "scanner retired");
            }
          })().catch((e: unknown) => console.error(`[ws] heartbeat failed: ${e instanceof Error ? e.message.slice(0, 120) : "error"}`));
        }
      : undefined,
  );
  ws.on("close", () => {
    if (shiftTimer) clearTimeout(shiftTimer);
    unsubscribe?.();
  });
}

function onTelemetry(app: AppContext, ws: WebSocket, eventId: string, scope: TelemetryScope) {
  let unsubscribe: (() => void) | null = null;
  const send = frame(app, ws, (last) => {
    // Make sure the projection is loaded so the snapshot is real.
    void app.scans.projection(eventId).then(
      () => {
        if (ws.readyState !== ws.OPEN) return;
        const sub = app.telemetry.subscribe(eventId, scope, send, last);
        unsubscribe = sub.unsubscribe;
        send({ type: "ready", channel: "/stream/telemetry", scope, resumed: sub.resumed, heartbeat_interval_ms: HEARTBEAT_MS });
        for (const m of sub.catchUp) send(m);
      },
      () => ws.close(WS_CLOSE.POLICY, "event unavailable"),
    );
  });
  ws.on("close", () => unsubscribe?.());
}
