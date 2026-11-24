/**
 * `/stream/scans` (02 §6, 03 §3, P-16). Each connection mints a single-use ticket with
 * POST /auth/ws-ticket and passes it in the Sec-WebSocket-Protocol list (`ticket.protocols`), never
 * in the URL. After `open` the client sends `hello` with the last event id it saw; the server
 * answers `ready`, replays or snapshots, and sends a heartbeat every 15 s. The scanner sends its own
 * heartbeat frame with the same device id it sends over REST, so gate health is one device row.
 * Reconnects with exponential backoff and full jitter; stops when the server ends the shift or
 * retires the scanner (close 1008).
 */
import { call } from "./client";
import { STREAM_HEARTBEAT_MS, WS_BASE } from "./config";

export type StreamState = "idle" | "connecting" | "open" | "closed";

export interface StreamDeps {
  eventId: string;
  checkpointId: string;
  /** The heartbeat frame's body: the same stable device id as on REST, and the held allowlist's `issued_at`. */
  heartbeat: () => { queue_depth: number; clock_offset_ms: number; online: boolean; device_id: string; allowlist_issued_at: string | null };
  onState: (s: StreamState, detail?: string) => void;
  /** Any frame from the server: the link is alive. */
  onAlive: () => void;
  onScanResult?: (data: unknown) => void;
}

const POLICY_CLOSE = 1008;

/** The `heartbeat` client frame (contracts ws ClientHeartbeat). */
export function heartbeatFrame(h: ReturnType<StreamDeps["heartbeat"]>) {
  return { type: "heartbeat" as const, ...h };
}

export class ScanStream {
  private ws: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private beat: ReturnType<typeof setInterval> | null = null;
  private lastEventId: string | undefined;
  state: StreamState = "idle";

  constructor(private readonly d: StreamDeps) {}

  start() {
    this.stopped = false;
    if (!this.ws && !this.retry) void this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.clearBeat();
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000, "scanner closed");
    this.set("idle");
  }

  /** The link came back: try now instead of waiting out the backoff. */
  kick() {
    if (this.stopped || this.ws) return;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.attempt = 0;
    void this.connect();
  }

  /** Send a heartbeat frame now (queue depth changed). */
  heartbeatNow() {
    if (this.ws?.readyState === WebSocket.OPEN && this.state === "open") this.ws.send(JSON.stringify(heartbeatFrame(this.d.heartbeat())));
  }

  private set(s: StreamState, detail?: string) {
    this.state = s;
    this.d.onState(s, detail);
  }

  private clearBeat() {
    if (this.beat) clearInterval(this.beat);
    this.beat = null;
  }

  private schedule() {
    if (this.stopped) return;
    // Full jitter: 0..min(30 s, 1 s × 2^n).
    const cap = Math.min(30_000, 1000 * 2 ** Math.min(this.attempt, 5));
    const wait = Math.round(Math.random() * cap) + 250;
    this.attempt++;
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.connect();
    }, wait);
  }

  private async connect() {
    if (this.stopped) return;
    this.set("connecting");
    let protocols: [string, string];
    try {
      const t = await call("wsTicket", { body: { channel: "/stream/scans", event_id: this.d.eventId, checkpoint_id: this.d.checkpointId } });
      protocols = t.protocols;
    } catch {
      this.set("closed", "ticket");
      this.schedule();
      return;
    }
    if (this.stopped) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${WS_BASE}/stream/scans`, protocols);
    } catch {
      this.set("closed", "socket");
      this.schedule();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify(this.lastEventId ? { type: "hello", last_event_id: this.lastEventId } : { type: "hello" }));
      this.clearBeat();
      this.beat = setInterval(() => this.heartbeatNow(), STREAM_HEARTBEAT_MS);
    };
    ws.onmessage = (e) => {
      let m: { type?: string; id?: unknown; data?: unknown };
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      this.d.onAlive();
      if (typeof m.id === "string") this.lastEventId = m.id;
      if (m.type === "ready") {
        this.attempt = 0;
        this.set("open");
        this.heartbeatNow();
      } else if (m.type === "scan.result") {
        this.d.onScanResult?.(m.data);
      }
    };
    ws.onclose = (e) => {
      if (this.ws === ws) this.ws = null;
      this.clearBeat();
      if (this.stopped) return;
      // The server ended the shift or retired this scanner: do not hammer it.
      if (e.code === POLICY_CLOSE && /shift ended|retired/.test(e.reason)) {
        this.set("closed", e.reason);
        return;
      }
      this.set("closed", String(e.code));
      this.schedule();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }
}
