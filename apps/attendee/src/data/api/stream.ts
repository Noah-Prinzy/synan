/**
 * `/stream/me` (docs/02 §6, 03 §3, P-16): the attendee's own pass status, live.
 *
 * Connecting: a single-use ticket from POST /auth/ws-ticket travels in the Sec-WebSocket-Protocol
 * header (`ticket.protocols`), never in the URL; the client then says `hello`, with the cursor
 * of the last event it saw so missed events are replayed. `ready` with resumed=false means the
 * server could not replay: the caller re-fetches the pass instead (`onResync`).
 *
 * Reconnection: exponential backoff with jitter, capped at 30 s; at once when the browser comes
 * back online. A connection with no frame for three server heartbeats is treated as dead.
 * Loaded lazily (it carries the WebSocket contracts), after the pass is on screen.
 */
import { MeServerMessage, WS_CLOSE } from "@synan/contracts/ws";
import type { WsTicket } from "@synan/contracts/rest";
import { ApiFailure } from "../failure";

type MeEvent = Extract<MeServerMessage, { type: "pass.status" | "entitlements.updated" }>;

export interface MeStreamOptions {
  /** The API origin as a WebSocket URL base, e.g. `ws://127.0.0.1:5180`. */
  wsBase: string;
  ticket: () => Promise<WsTicket>;
  onEvent: (event: MeEvent) => void;
  onResync: () => void;
  /** The session is over (the ticket was refused as unauthenticated): stop for good. */
  onSignedOut?: () => void;
  WebSocketImpl?: typeof WebSocket;
  random?: () => number;
  online?: () => boolean;
}

export interface MeStream {
  close(): void;
}

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
/** Server heartbeats arrive every 15 s; three missed is a dead connection. */
const SILENCE_MS = 45_000;

/** Delay before reconnect attempt `attempt` (0-based): exponential, capped, with full jitter in its upper half. */
export function backoff(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

export function openMeStream(options: MeStreamOptions): MeStream {
  const Socket = options.WebSocketImpl ?? WebSocket;
  const random = options.random ?? Math.random;
  const online = options.online ?? (() => navigator.onLine);
  let socket: WebSocket | null = null;
  let attempt = 0;
  let lastEventId: string | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const clearTimers = () => {
    if (retryTimer) clearTimeout(retryTimer);
    if (silenceTimer) clearTimeout(silenceTimer);
    retryTimer = silenceTimer = null;
  };

  const heard = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => socket?.close(), SILENCE_MS);
  };

  function schedule() {
    if (stopped || retryTimer) return;
    // Offline: wait for the `online` event rather than spinning.
    if (!online()) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, backoff(attempt++, random));
  }

  async function connect() {
    if (stopped || socket) return;
    let ticket: WsTicket;
    try {
      ticket = await options.ticket();
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) {
        stopped = true;
        options.onSignedOut?.();
        return;
      }
      schedule();
      return;
    }
    if (stopped) return;
    const ws = new Socket(`${options.wsBase}/stream/me`, ticket.protocols);
    socket = ws;
    ws.onopen = () => {
      heard();
      ws.send(JSON.stringify(lastEventId ? { type: "hello", last_event_id: lastEventId } : { type: "hello" }));
    };
    ws.onmessage = (frame) => {
      heard();
      let parsed;
      try {
        parsed = MeServerMessage.safeParse(JSON.parse(String(frame.data)));
      } catch {
        return;
      }
      if (!parsed.success) {
        if (import.meta.env.DEV) console.error("[stream/me] message does not match its contract", parsed.error.issues);
        return;
      }
      const message = parsed.data;
      switch (message.type) {
        case "ready":
          attempt = 0;
          if (!message.resumed) options.onResync();
          return;
        case "pass.status":
        case "entitlements.updated":
          lastEventId = message.id;
          options.onEvent(message);
          return;
        default:
          // heartbeat, pong, error: nothing to do beyond staying alive.
          return;
      }
    };
    ws.onclose = (event) => {
      if (socket === ws) socket = null;
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = null;
      // Refused for good: not this person's stream.
      if (event.code === WS_CLOSE.FORBIDDEN) stopped = true;
      schedule();
    };
    ws.onerror = () => {
      // A close event always follows; reconnection is decided there.
    };
  }

  const onOnline = () => {
    if (stopped) return;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    attempt = 0;
    void connect();
  };
  const onOffline = () => socket?.close();
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  void connect();

  return {
    close() {
      stopped = true;
      clearTimers();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      socket?.close(WS_CLOSE.NORMAL);
      socket = null;
    },
  };
}
