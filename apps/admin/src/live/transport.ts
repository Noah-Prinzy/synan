/**
 * What the Command Center needs from the outside world, as interfaces. The store is
 * written against these and nothing else, so replacing the mock with the real API is
 * a transport change (docs/02 §8): a WebSocket client that implements `LiveTransport`
 * (ticket in `Sec-WebSocket-Protocol`, `hello` with `last_event_id`, backoff with
 * jitter — docs/02 §6, 03 §3) and a fetch client that implements `CommandApi`.
 */
import type { WsChannel } from "@synan/contracts/enums";
import type {
  AlertsServerMessage,
  MeServerMessage,
  ScansServerMessage,
  TelemetryServerMessage,
} from "@synan/contracts/ws";

export type LinkStatus = "connecting" | "live" | "reconnecting" | "offline";

export type ChannelMessage<C extends WsChannel> = C extends "/stream/telemetry"
  ? TelemetryServerMessage
  : C extends "/stream/scans"
    ? ScansServerMessage
    : C extends "/stream/alerts"
      ? AlertsServerMessage
      : MeServerMessage;

export interface LiveTransport {
  subscribe<C extends WsChannel>(channel: C, handler: (message: ChannelMessage<C>) => void): () => void;
  status(): LinkStatus;
  onStatus(listener: (status: LinkStatus) => void): () => void;
  /** Ping/pong round trip in ms; rejects while the link is down. */
  ping(): Promise<number>;
}

/*
 * The REST side. The interface is declared with the mock because several of its
 * shapes are proposals not yet in contracts (series, operator, layout extras); it
 * moves to contracts when they do.
 */
export type {
  CommandApi,
  CommandEvent,
  LiveSummary,
  OperatorContext,
  SummarySeries,
  GridPoint,
  GridRect,
  GridPolygon,
  VenueLayout,
} from "@synan/mock/command";
