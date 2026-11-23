/**
 * WebSocket server (02 §6, 03 §3, P-16).
 *
 * Upgrade: `Sec-WebSocket-Protocol: <WS_SUBPROTOCOL>, <WS_TICKET_PREFIX><ticket>`. The ticket is single-use,
 * 30 s, bound to the principal, channel and event it was minted for. Tickets in the URL are
 * ignored. The Origin header, when present, must be an allowed origin.
 *
 * Implemented channel: `/stream/telemetry`. The others answer 501 at ticket mint.
 */
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { ContractError } from "@synan/contracts/errors";
import type { WsChannel } from "@synan/contracts/enums";
import { WS_SUBPROTOCOL, WS_TICKET_PREFIX } from "@synan/contracts/rest";
import { ClientMessage, WS_CLOSE, type TelemetryServerMessage } from "@synan/contracts/ws";
import type { AppContext } from "../app.js";
import type { AuthContext } from "../domain/principal.js";
import { canSeeEvent } from "../routes/events.js";
import type { TelemetryScope } from "./telemetry-hub.js";

const CHANNELS: ReadonlySet<string> = new Set(["/stream/scans", "/stream/telemetry", "/stream/alerts", "/stream/me"]);
const HELLO_TIMEOUT_MS = 5_000;
const HEARTBEAT_MS = 30_000;
const MAX_BUFFERED = 1 << 20;

/** Per-channel authorisation. Throws a ContractError when refused. */
export async function authoriseChannel(
  app: AppContext,
  ctx: AuthContext,
  channel: WsChannel,
  eventId: string | null,
  _checkpointId: string | null,
): Promise<{ scope: TelemetryScope }> {
  if (channel !== "/stream/telemetry") {
    throw new ContractError("NOT_IMPLEMENTED", `${channel} is not available on this server yet.`);
  }
  if (!eventId) throw new ContractError("VALIDATION_FAILED", "event_id is required", [{ path: "body.event_id", message: "required" }]);
  const event = await app.repos.events.byId(eventId);
  if (!event) throw new ContractError("NOT_FOUND");
  if (ctx.kind === "operator") return { scope: "full" };
  // Reduced public scope for event pages: attendees and staff, published/live events they may see.
  if ((event.state !== "published" && event.state !== "live") || !(await canSeeEvent(app, event, ctx))) {
    throw new ContractError("NOT_FOUND");
  }
  return { scope: "public" };
}

function reject(socket: Duplex, status: number, text: string) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function attachWebSockets(server: Server, app: AppContext) {
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
      const grant = app.auth.consumeWsTicket(ticketProto.slice(WS_TICKET_PREFIX.length));
      if (!grant || grant.channel !== path) return reject(socket, 401, "Unauthorized");

      let scope: TelemetryScope;
      try {
        ({ scope } = await authoriseChannel(app, grant.ctx, grant.channel, grant.eventId, grant.checkpointId));
      } catch {
        return reject(socket, 403, "Forbidden");
      }
      wss.handleUpgrade(req, socket, head, (ws) => onTelemetry(app, ws, grant.eventId!, scope));
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
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat);
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => resolve());
      }),
  };
}

function onTelemetry(app: AppContext, ws: WebSocket, eventId: string, scope: TelemetryScope) {
  const w = ws as WebSocket & { alive?: boolean };
  w.alive = true;
  ws.on("pong", () => (w.alive = true));
  let unsubscribe: (() => void) | null = null;

  const send = (msg: TelemetryServerMessage) => {
    if (ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > MAX_BUFFERED) {
      ws.close(WS_CLOSE.POLICY, "slow consumer");
      return;
    }
    ws.send(JSON.stringify(msg));
  };

  const helloTimer = setTimeout(() => ws.close(WS_CLOSE.BAD_MESSAGE, "hello expected"), HELLO_TIMEOUT_MS);

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
      if (unsubscribe) return; // only the first hello counts
      clearTimeout(helloTimer);
      // Make sure the projection is loaded so the snapshot is real.
      void app.scans.projection(eventId).then(
        () => {
          if (ws.readyState !== ws.OPEN) return;
          const sub = app.telemetry.subscribe(eventId, scope, send, msg.last_event_id);
          unsubscribe = sub.unsubscribe;
          send({ type: "ready", channel: "/stream/telemetry", scope, resumed: sub.resumed, heartbeat_interval_ms: HEARTBEAT_MS });
          for (const m of sub.catchUp) send(m);
        },
        () => ws.close(WS_CLOSE.POLICY, "event unavailable"),
      );
    } else if (msg.type === "ping") {
      send({ type: "pong", t: msg.t, server_time: new Date(app.clock.now()).toISOString() });
    }
    // heartbeat frames belong to /stream/scans; ignored here.
  });

  ws.on("close", () => {
    clearTimeout(helloTimer);
    unsubscribe?.();
  });
  ws.on("error", () => ws.terminate());
}
