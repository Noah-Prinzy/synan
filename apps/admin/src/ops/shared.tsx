/**
 * What the response screens (D9 access log, D10 alerts, D12 gate health, D12b gate detail)
 * share: the live-event states every one of them designs for, gate signal words, scan copy and
 * the "last known" notice. These screens read the same CommandStore as the Command Center, so
 * what they show matches the strip and the rail to the second.
 */
import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { CarrierKind, GateLinkState } from "@synan/contracts/enums";
import { Button, buttonClass, cn } from "@synan/ui/components";
import { SignalShape, formatAge, formatClock, formatNumber, type SignalState } from "@synan/ui/data";
import { EmptyState, ErrorState, GUTTER_X, LoadingState, PROSE } from "../kit";
import { useCommand } from "../live/context";
import { useNow } from "../live/hooks";
import { useSlice } from "../live/slice";
import type { GateLive } from "../live/store";
import type { CommandEvent } from "../live/transport";
import { useSession } from "../access/session";

/* ------------------------------------------------------------------- words */

export const CARRIER_LABEL: Record<CarrierKind, string> = {
  qr_portal: "Portal QR",
  qr_email: "Emailed QR",
  nfc: "Wristband",
};

export const DIRECTION_LABEL = { in: "Entry", out: "Exit", both: "Both ways" } as const;

export const LINK_VIEW: Record<GateLinkState, { state: SignalState; label: string }> = {
  online: { state: "ok", label: "Online" },
  degraded: { state: "warn", label: "Degraded" },
  offline: { state: "stop", label: "Offline" },
};

/** D-14: a scanner clock more than two minutes out is a fault. */
export const CLOCK_LIMIT_MS = 120_000;

export function clockWrong(gate: Pick<GateLive, "clock_fault" | "clock_offset_ms">): boolean {
  return gate.clock_fault || Math.abs(gate.clock_offset_ms ?? 0) > CLOCK_LIMIT_MS;
}

/** The gate's state in one word, as the Command Center rail says it (copied from command/rail.tsx). */
export function gateSignal(gate: GateLive): { state: SignalState; words: string } {
  if (gate.link_state === "offline") return { state: "stop", words: "Offline" };
  if (gate.link_state === "degraded") return { state: "warn", words: "Degraded" };
  if (clockWrong(gate)) return { state: "warn", words: "Clock wrong" };
  if (gate.queue_depth > 0) return { state: "warn", words: "Draining queue" };
  return { state: "ok", words: "Online" };
}

/**
 * The gate's pass list (its signed offline allowlist) is more than 15 minutes old (O-05): offline,
 * it would still admit known passes, each with an alert. Sent by the real API; the mock sends none.
 */
export function allowlistStale(gate: Pick<GateLive, "allowlist_stale">): boolean {
  return gate.allowlist_stale === true;
}

export function isFault(gate: GateLive): boolean {
  return gate.link_state !== "online" || clockWrong(gate) || gate.queue_depth > 0 || allowlistStale(gate);
}

/** Faults first: offline, then degraded, then clock or queue; then by label. */
export function faultRank(gate: GateLive): number {
  if (gate.link_state === "offline") return 0;
  if (gate.link_state === "degraded") return 1;
  if (isFault(gate)) return 2;
  return 3;
}

/* -------------------------------------------------------------------- time */

/** 14:03:22.481 in the venue's zone: an access-log time, to the millisecond. */
export function formatScanTime(iso: string, timeZone: string): string {
  const at = Date.parse(iso);
  return `${formatClock(at, timeZone)}.${String(((at % 1000) + 1000) % 1000).padStart(3, "0")}`;
}

/** "4m 05s ago" from an ISO time. */
export function Ago({ iso, now }: { iso: string | null; now: number }) {
  if (!iso) return <span className="text-muted-foreground">—</span>;
  return <>{formatAge(now - Date.parse(iso))} ago</>;
}

/**
 * An age in words for an overview row — "just now", "6 min ago", "2 h ago" — so a list does not
 * tick every second. The exact time stays on the detail page.
 */
export function roughAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} h ago`;
}

/* ------------------------------------------------------------------ states */

/**
 * The live-event gate for a response screen: loading, error, not live, no event. Returns null
 * once the store is ready, and the screen renders.
 */
export function LiveStates({ what, notLive }: { what: string; notLive: (event: CommandEvent) => ReactNode }) {
  const { store, event, events } = useCommand();
  const load = useSlice(store.load);
  if (load.status === "ready") return null;
  if (load.status === "not-live") return <NotLiveOps event={load.event}>{notLive(load.event)}</NotLiveOps>;
  if (load.status === "error") {
    return <ErrorState title={`Could not load ${what}`} error={new Error(load.message)} onRetry={() => store.retry()} />;
  }
  if (load.status === "idle" && events && !event) {
    return (
      <EmptyState title="No event to show" className={GUTTER_X}>
        There are no events in this organisation yet. {what[0]?.toUpperCase()}
        {what.slice(1)} appear once an event is live.
      </EmptyState>
    );
  }
  return <LoadingState label={`Loading ${what}…`} rows={8} />;
}

/** True once the live store is ready for the selected event. */
export function useLiveReady(): boolean {
  const { store } = useCommand();
  return useSlice(store.load).status === "ready";
}

/**
 * The not-live state, in the Command Center's words: what this screen needs, when the event
 * opens, and the events that are live now.
 */
export function NotLiveOps({ event, children }: { event: CommandEvent; children: ReactNode }) {
  const { events, selectEvent } = useCommand();
  const live = (events ?? []).filter((e) => e.state === "live");
  const { can } = useSession();
  const when = new Date(event.starts_at).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: event.timezone,
  });
  const ended = event.state === "closed" || event.state === "archived";
  return (
    <div className={cn("max-w-176 py-8", GUTTER_X)}>
      <p className="flex items-center gap-2 text-12 text-muted-foreground">
        <SignalShape state="idle" /> No live event
      </p>
      <h2 className="mt-2 font-display text-28 leading-tight tracking-tight text-balance">{event.title} is not live</h2>
      <p className={cn("mt-2 text-13 leading-relaxed text-muted-foreground", PROSE)}>
        {ended ? (
          <>This event has {event.state === "closed" ? "closed" : "been archived"}. </>
        ) : (
          <>
            Doors open <span className="font-mono text-foreground">{when}</span> at {event.venue_name}.{" "}
          </>
        )}
        {children}
      </p>
      {ended && can("reports.view") ? (
        <p className="mt-5">
          <Link to={`/events/${event.id}/summary`} className={buttonClass("secondary", "compact")}>
            Open the event summary
          </Link>
        </p>
      ) : null}
      <div className="mt-8 border-t border-border">
        <p className="flex h-10 items-center text-13 font-medium">Live now</p>
        {live.length === 0 ? (
          <p className="border-t border-border py-3 text-13 text-muted-foreground">No event in this organisation is live.</p>
        ) : (
          <ul>
            {live.map((e) => (
              <li key={e.id} className="flex min-h-14 items-center justify-between gap-4 border-t border-border py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-13">{e.title}</span>
                  <span className="block truncate text-12 text-muted-foreground">{e.venue_name}</span>
                </span>
                <Button variant="secondary" size="compact" onClick={() => selectEvent(e.id)}>
                  Watch this event
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** While the live link is down: everything on screen is the last known state, with its age. */
export function LastKnown({ className = "" }: { className?: string }) {
  const { store } = useCommand();
  const link = useSlice(store.link);
  const now = useNow(1000);
  if (link.status === "live" || link.status === "idle" || link.status === "connecting") return null;
  const since = link.lostAt ?? link.lastFrameAt;
  return (
    <p role="status" className={cn("flex min-h-10 items-center gap-2 border-b border-border py-2 text-12 text-warning", GUTTER_X, className)}>
      <SignalShape state="warn" className="shrink-0" />
      <span>
        Last known state{since ? <> · link lost <span className="font-mono tabular-nums">{formatAge(now - since)}</span> ago</> : null}.{" "}
        <span className="text-muted-foreground">
          {link.status === "reconnecting" ? "Reconnecting; this updates when it is back." : "Offline; this updates when the link returns."}
        </span>
      </span>
    </p>
  );
}

/** Escape closes a side panel (a Dialog handles its own). */
export function useEscape(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // A select list or a nested dialog owns its own Escape.
      if (document.querySelector("dialog[open]")) return;
      onEscape();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onEscape]);
}

/** 1,184 in mono. */
export function Num({ value, className = "" }: { value: number; className?: string }) {
  return <span className={`font-mono tabular-nums ${className}`}>{formatNumber(value)}</span>;
}
