/**
 * The Command Center's live link to the real API (02 §6, 03 §3, P-16): one `LiveTransport` per
 * event, implementing the interface the store is written against (live/transport.ts).
 *
 * - One WebSocket per channel (`/stream/telemetry`, `/stream/scans`, `/stream/alerts`), opened when
 *   the channel gets its first subscriber and closed when it loses its last.
 * - Each connection mints a single-use ticket (POST /auth/ws-ticket, scoped to the channel and the
 *   event) and passes it in the Sec-WebSocket-Protocol list (`ticket.protocols`), never in the URL.
 * - After open, `hello` carries the last event id seen on that channel, so the server replays what
 *   was missed; `ready.resumed=false` means it could not, and a snapshot follows (telemetry), or
 *   this side re-reads the alerts (see below).
 * - Reconnect with exponential backoff and jitter (cap 30 s), at once when the browser comes back
 *   online; no frame for three server heartbeats (45 s) counts as a dead connection.
 * - Every frame is validated against the channel's contract union; a frame that does not match is
 *   dropped and reported to `debug`.
 *
 * - `gate.health` frames arrive on /stream/alerts. GET /gates/health is read when the channel is
 *   first followed (and again after a reconnect without replay), each gate emitted as a
 *   `gate.health` frame, so the store has every gate before the first change arrives; and again
 *   every 30 s while the channel is live. The server publishes a gate only when its state differs
 *   from what it last published, so a reading taken between two of its polls (a queue that emptied
 *   seconds after the snapshot) would otherwise stay on screen until that gate changed again.
 *   These synthetic frames carry ids starting `poll:` and never become `last_event_id`.
 * - When /stream/alerts reconnects without replay, GET /breach-alerts is read and each alert is
 *   emitted as `alert.updated` (ids `resync:`), so the store's list is right again.
 */
import { serverMessageByChannel, WS_CLOSE } from "@synan/contracts/ws";
import type { WsChannel } from "@synan/contracts/enums";
import type { BreachAlert, GateHealth } from "@synan/contracts/rest";
import type { ChannelMessage, LinkStatus, LiveTransport } from "../live/transport";
import { ApiFailure } from "./failure";
import type { ApiClient } from "./client";

type AdminChannel = "/stream/telemetry" | "/stream/scans" | "/stream/alerts";

export interface StreamOptions {
  eventId: string;
  client: ApiClient;
  /** Base for the socket URLs, e.g. `ws://127.0.0.1:5180`. Default: the client's. */
  wsBase?: string;
  WebSocketImpl?: typeof WebSocket;
  random?: () => number;
  online?: () => boolean;
  debug?: (message: string, detail?: unknown) => void;
  /** Called once when the stream closes (explicitly, or when its last subscriber leaves). */
  onClose?: () => void;
}

export interface LiveStream extends LiveTransport {
  /** Close every socket for good (sign-out, event change). */
  close(): void;
}

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
/** Server heartbeats arrive every 15 s; three missed is a dead connection. */
const SILENCE_MS = 45_000;
const PING_TIMEOUT_MS = 5_000;
/** Gate health is re-read this often while /stream/alerts is live (see the header). */
export const GATES_RESYNC_MS = 30_000;

/** Delay before reconnect attempt `attempt` (0-based): exponential, capped, with jitter in its upper half. */
export function backoff(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.min(attempt, 10));
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

type LinkState = "idle" | "connecting" | "live" | "reconnecting" | "stopped";

interface Link {
  channel: AdminChannel;
  handlers: Set<(message: never) => void>;
  socket: WebSocket | null;
  state: LinkState;
  everLive: boolean;
  attempt: number;
  lastEventId: string | undefined;
  retryTimer: ReturnType<typeof setTimeout> | null;
  silenceTimer: ReturnType<typeof setTimeout> | null;
  /** Bumped on close so a late callback of an old socket does nothing. */
  generation: number;
}

export function openLiveStream(options: StreamOptions): LiveStream {
  const { client, eventId } = options;
  const SocketImpl = options.WebSocketImpl ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  if (!SocketImpl) throw new Error("No WebSocket implementation available");
  const Socket: typeof WebSocket = SocketImpl;
  const wsBase = options.wsBase ?? client.wsBase;
  const random = options.random ?? Math.random;
  const online = options.online ?? (() => (globalThis as { navigator?: { onLine?: boolean } }).navigator?.onLine ?? true);
  const debug = options.debug ?? (() => undefined);

  const links = new Map<AdminChannel, Link>();
  const statusListeners = new Set<(status: LinkStatus) => void>();
  const pending = new Map<number, (ms: number) => void>();
  let closed = false;
  let lastStatus: LinkStatus = "connecting";
  let gatesRead = false;
  let gatesTimer: ReturnType<typeof setInterval> | null = null;
  let syntheticSeq = 0;

  /* ---------------------------------------------------------------- status */

  const computeStatus = (): LinkStatus => {
    if (closed || !online()) return "offline";
    const active = [...links.values()].filter((l) => l.handlers.size > 0);
    if (active.length === 0) return "connecting";
    if (active.some((l) => l.state === "stopped")) return "offline";
    if (active.every((l) => l.state === "live")) return "live";
    // "reconnecting" only once a channel that was live has dropped; the first connect is "connecting".
    return active.some((l) => l.state !== "live" && l.everLive) ? "reconnecting" : "connecting";
  };

  const publishStatus = () => {
    const next = computeStatus();
    if (next === lastStatus) return;
    lastStatus = next;
    for (const listener of statusListeners) listener(next);
  };

  /* ------------------------------------------------------------- delivery */

  const deliver = <C extends AdminChannel>(channel: C, message: ChannelMessage<C>) => {
    const link = links.get(channel);
    if (!link) return;
    for (const handler of [...link.handlers]) {
      try {
        (handler as (m: ChannelMessage<C>) => void)(message);
      } catch (error) {
        debug(`[stream] ${channel} handler threw`, error);
      }
    }
  };

  const synthetic = (prefix: "poll" | "resync") => `${prefix}:${Date.now().toString(36)}:${++syntheticSeq}`;
  const serverNow = () => new Date(Date.now() + client.offsetMs()).toISOString();

  /** GET /gates/health once → a `gate.health` frame per gate (the stream carries every change after). */
  const readGates = async () => {
    try {
      const { items } = await client.call("gateHealth", { query: { event_id: eventId } });
      for (const gate of items) deliver("/stream/alerts", { id: synthetic("poll"), type: "gate.health", at: serverNow(), data: gate satisfies GateHealth });
    } catch (error) {
      debug("[stream] gate health read failed", error);
    }
  };

  /** The alerts stream could not replay: re-read the list and hand each alert over as an update. */
  const resyncAlerts = async () => {
    try {
      const { items } = await client.call("listAlerts", { query: { event_id: eventId, limit: 500 } });
      for (const alert of items) deliver("/stream/alerts", { id: synthetic("resync"), type: "alert.updated", at: serverNow(), data: alert satisfies BreachAlert });
      await readGates();
    } catch (error) {
      debug("[stream] alert resync failed", error);
    }
  };

  /* ---------------------------------------------------------- connections */

  const clearTimers = (link: Link) => {
    if (link.retryTimer) clearTimeout(link.retryTimer);
    if (link.silenceTimer) clearTimeout(link.silenceTimer);
    link.retryTimer = link.silenceTimer = null;
  };

  const heard = (link: Link, ws: WebSocket) => {
    if (link.silenceTimer) clearTimeout(link.silenceTimer);
    link.silenceTimer = setTimeout(() => ws.close(), SILENCE_MS);
  };

  const schedule = (link: Link) => {
    if (closed || link.handlers.size === 0 || link.state === "stopped" || link.retryTimer) return;
    link.state = link.everLive ? "reconnecting" : "connecting";
    publishStatus();
    // Offline: wait for the `online` event rather than spinning.
    if (!online()) return;
    link.retryTimer = setTimeout(() => {
      link.retryTimer = null;
      void connect(link);
    }, backoff(link.attempt++, random));
  };

  const stop = (link: Link, why: string) => {
    debug(`[stream] ${link.channel} stopped: ${why}`);
    link.state = "stopped";
    clearTimers(link);
    publishStatus();
  };

  async function connect(link: Link): Promise<void> {
    if (closed || link.socket || link.handlers.size === 0 || link.state === "stopped") return;
    const generation = link.generation;
    if (link.state !== "reconnecting") link.state = link.everLive ? "reconnecting" : "connecting";
    publishStatus();
    let protocols: string[];
    try {
      const ticket = await client.call("wsTicket", { body: { channel: link.channel, event_id: eventId } });
      protocols = [...ticket.protocols];
    } catch (error) {
      if (generation !== link.generation) return;
      if (error instanceof ApiFailure && error.kind === "http") {
        // Signed out, or this role may not follow this channel or event: retrying will not help.
        if (error.status === 401 || error.code === "FORBIDDEN" || error.code === "NOT_FOUND" || error.code === "VALIDATION_FAILED") {
          stop(link, `ticket refused (${error.code})`);
          return;
        }
      }
      schedule(link);
      return;
    }
    if (closed || generation !== link.generation || link.handlers.size === 0) return;

    let ws: WebSocket;
    try {
      ws = new Socket(`${wsBase}${link.channel}`, protocols);
    } catch (error) {
      debug(`[stream] ${link.channel}: socket could not be created`, error);
      schedule(link);
      return;
    }
    link.socket = ws;
    const schema = serverMessageByChannel[link.channel];

    ws.onopen = () => {
      heard(link, ws);
      ws.send(JSON.stringify(link.lastEventId ? { type: "hello", last_event_id: link.lastEventId } : { type: "hello" }));
    };
    ws.onmessage = (frame: MessageEvent) => {
      heard(link, ws);
      let parsed;
      try {
        parsed = schema.safeParse(JSON.parse(String(frame.data)));
      } catch {
        debug(`[stream] ${link.channel}: unreadable frame`);
        return;
      }
      if (!parsed.success) {
        debug(`[stream] ${link.channel}: frame does not match its contract`, parsed.error.issues);
        return;
      }
      const message = parsed.data;
      switch (message.type) {
        case "ready":
          link.attempt = 0;
          link.state = "live";
          link.everLive = true;
          publishStatus();
          if (link.channel === "/stream/alerts" && !message.resumed) void resyncAlerts();
          break;
        case "pong":
          if (typeof message.t === "number") pending.get(message.t)?.(Date.now() - message.t);
          break;
        case "error":
          debug(`[stream] ${link.channel}: server error ${message.code}`, message.message);
          break;
        case "heartbeat":
          break;
        default:
          // Replayable events carry the cursor for the next `hello`.
          if ("id" in message && typeof message.id === "string") link.lastEventId = message.id;
      }
      deliver(link.channel, message as ChannelMessage<typeof link.channel>);
    };
    ws.onclose = (event: CloseEvent) => {
      if (link.socket === ws) link.socket = null;
      if (link.silenceTimer) clearTimeout(link.silenceTimer);
      link.silenceTimer = null;
      if (closed || generation !== link.generation || link.handlers.size === 0) return;
      // Refused for good: not this person's channel.
      if (event.code === WS_CLOSE.FORBIDDEN) {
        stop(link, `closed ${event.code} ${event.reason}`);
        return;
      }
      schedule(link);
    };
    ws.onerror = () => {
      // A close event always follows; reconnection is decided there.
    };
  }

  const linkFor = (channel: AdminChannel): Link => {
    let link = links.get(channel);
    if (!link) {
      link = {
        channel,
        handlers: new Set(),
        socket: null,
        state: "idle",
        everLive: false,
        attempt: 0,
        lastEventId: undefined,
        retryTimer: null,
        silenceTimer: null,
        generation: 0,
      };
      links.set(channel, link);
    }
    return link;
  };

  const release = (link: Link) => {
    link.generation++;
    clearTimers(link);
    const ws = link.socket;
    link.socket = null;
    if (ws && ws.readyState <= 1) ws.close(WS_CLOSE.NORMAL);
    link.state = "idle";
    link.attempt = 0;
  };

  /* -------------------------------------------------------- browser state */

  const win = (globalThis as { window?: Window }).window;
  const onOnline = () => {
    if (closed) return;
    for (const link of links.values()) {
      if (link.handlers.size === 0 || link.state === "stopped" || link.socket) continue;
      if (link.retryTimer) clearTimeout(link.retryTimer);
      link.retryTimer = null;
      link.attempt = 0;
      void connect(link);
    }
    publishStatus();
  };
  const onOffline = () => {
    for (const link of links.values()) link.socket?.close();
    publishStatus();
  };
  win?.addEventListener?.("online", onOnline);
  win?.addEventListener?.("offline", onOffline);

  /* -------------------------------------------------------------- the api */

  const stream: LiveStream = {
    subscribe<C extends WsChannel>(channel: C, handler: (message: ChannelMessage<C>) => void): () => void {
      if (channel === "/stream/me") {
        // Operators cannot join /stream/me (an attendee channel): nothing will ever arrive.
        return () => undefined;
      }
      const link = linkFor(channel as AdminChannel);
      const h = handler as unknown as (message: never) => void;
      link.handlers.add(h);
      if (link.channel === "/stream/alerts" && !gatesRead) {
        gatesRead = true;
        void readGates();
        gatesTimer = setInterval(() => {
          if (!closed && online() && link.state === "live") void readGates();
        }, GATES_RESYNC_MS);
      }
      if (!closed && link.handlers.size === 1 && !link.socket && !link.retryTimer && link.state !== "stopped") void connect(link);
      publishStatus();
      return () => {
        link.handlers.delete(h);
        if (link.handlers.size > 0) return;
        release(link);
        publishStatus();
        // The store opens a new transport per event: one nobody follows any more is done.
        if ([...links.values()].every((l) => l.handlers.size === 0)) stream.close();
      };
    },
    status: () => computeStatus(),
    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    ping() {
      const live = [...links.values()].find((l) => l.state === "live" && l.socket && l.socket.readyState === 1);
      if (!live?.socket) return Promise.reject(new Error("The live link is down."));
      const socket = live.socket;
      return new Promise<number>((resolve, reject) => {
        let t = Date.now();
        while (pending.has(t)) t++;
        const timer = setTimeout(() => {
          pending.delete(t);
          reject(new Error("No pong in time."));
        }, PING_TIMEOUT_MS);
        pending.set(t, (ms) => {
          clearTimeout(timer);
          pending.delete(t);
          resolve(ms);
        });
        socket.send(JSON.stringify({ type: "ping", t }));
      });
    },
    close() {
      if (closed) return;
      closed = true;
      if (gatesTimer) clearInterval(gatesTimer);
      gatesTimer = null;
      for (const link of links.values()) release(link);
      win?.removeEventListener?.("online", onOnline);
      win?.removeEventListener?.("offline", onOffline);
      publishStatus();
      options.onClose?.();
    },
  };
  return stream;
}
