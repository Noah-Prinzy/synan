/**
 * D13c · Event summary `/admin/events/:id/summary` (docs/06, D-21): the landing page of
 * a closed event. One page, no tabs: headline figures, attendance by tier, the occupancy
 * curve, busiest rooms and gates, how fast alerts were handled, downloads, and a plain
 * line saying what was deleted and when. A live event shows its figures so far, labelled
 * provisional. Built against GET /events/:id/post-event-summary (contracts).
 *
 * States: loading, error, no data yet (an event that has not opened), provisional, final.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ERROR_COPY } from "@synan/contracts/copy";
import type { AttendeeTier, Severity } from "@synan/contracts/enums";
import type { PostEventSummary } from "@synan/contracts/rest";
import { KpiCell, SignalShape, formatAge, formatClock, formatNumber, formatPercent } from "@synan/ui/data";
import { SEVERITY_VIEW } from "../live/alert-copy";
import { api } from "../live/backend";
import { useCommand } from "../live/context";
import { ScreenHeader } from "../screens/placeholder";
import { Downloads } from "./downloads";
import { OccupancyCurve } from "./occupancy-curve";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: PostEventSummary };

const TIER_LABEL: Record<AttendeeTier, string> = {
  VIP: "VIP",
  ORDINARY: "Ordinary",
  PRIVATE_INVITE: "Invitation",
  PUBLIC: "Public",
};

function longDate(at: string, timeZone: string): string {
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone });
}

function shortWhen(at: string, timeZone: string): string {
  const day = new Date(at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone });
  return `${formatClock(at, timeZone, { seconds: false })} · ${day}`;
}

function seconds(s: number | null): string {
  return s === null ? "—" : formatAge(s * 1000);
}

export default function EventSummary() {
  const { id = "" } = useParams();
  const { events } = useCommand();
  const event = events?.find((e) => e.id === id) ?? null;
  const timeZone = event?.timezone ?? "Africa/Kampala";
  const [load, setLoad] = useState<Load>({ status: "loading" });

  const fetchSummary = useCallback(
    (quiet = false) => {
      if (!quiet) setLoad({ status: "loading" });
      api.postEventSummary(id).then(
        (data) => setLoad({ status: "ready", data }),
        (error: unknown) => {
          if (!quiet) setLoad({ status: "error", message: error instanceof Error ? error.message : "INTERNAL" });
        },
      );
    },
    [id],
  );

  useEffect(() => fetchSummary(), [fetchSummary]);

  // Provisional figures refresh every 30 s; final ones never change.
  const provisional = load.status === "ready" && load.data.provisional && load.data.state === "live";
  useEffect(() => {
    if (!provisional) return;
    const timer = window.setInterval(() => fetchSummary(true), 30_000);
    return () => window.clearInterval(timer);
  }, [provisional, fetchSummary]);

  useEffect(() => {
    document.title = event ? `Summary · ${event.title}` : "Event summary";
  }, [event]);

  if (events && !event) {
    return (
      <div>
        <ScreenHeader code="D13c" title="Event summary" />
        <p className="px-6 py-4 text-13 text-muted-foreground">{ERROR_COPY.NOT_FOUND.message}</p>
      </div>
    );
  }

  const data = load.status === "ready" ? load.data : null;
  const noData = data !== null && (data.state === "draft" || data.state === "published");

  return (
    <div className="min-h-full pb-8">
      <ScreenHeader code="D13c" title={event ? event.title : "Event summary"}>
        <div className="text-right">
          {data && !noData ? <StateLine data={data} timeZone={timeZone} /> : null}
          {event ? (
            <p className="mt-1 text-12 text-muted-foreground">
              {event.venue_name} · {longDate(event.starts_at, timeZone)} – {longDate(event.ends_at, timeZone)}
            </p>
          ) : null}
        </div>
      </ScreenHeader>

      {load.status === "loading" ? <SummaryLoading /> : null}
      {load.status === "error" ? <SummaryError message={load.message} onRetry={() => fetchSummary()} /> : null}
      {noData && data ? <NoData data={data} timeZone={timeZone} startsAt={event?.starts_at ?? null} /> : null}
      {data && !noData ? <SummaryBody data={data} timeZone={timeZone} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ parts */

function StateLine({ data, timeZone }: { data: PostEventSummary; timeZone: string }) {
  if (data.provisional) {
    return (
      <p className="flex items-center justify-end gap-2 text-13">
        <SignalShape state="idle" className="text-muted-foreground" />
        <span className="font-medium">Provisional</span>
        <span className="text-muted-foreground">
          figures so far, as of <span className="font-mono tabular-nums">{formatClock(data.as_of, timeZone)}</span>
        </span>
      </p>
    );
  }
  return (
    <p className="flex items-center justify-end gap-2 text-13">
      <span className="font-medium">Final</span>
      <span className="text-muted-foreground">
        closed <span className="font-mono tabular-nums">{shortWhen(data.as_of, timeZone)}</span>
      </span>
    </p>
  );
}

function SummaryBody({ data, timeZone }: { data: PostEventSummary; timeZone: string }) {
  const h = data.headline;
  const pct = (part: number) => (h.registered > 0 ? formatPercent(part / h.registered) : "—");
  return (
    <>
      <dl className="grid grid-cols-3 gap-px border-b border-border bg-border xl:grid-cols-6">
        <KpiCell label="Registered" value={formatNumber(h.registered)} delta="all tiers" />
        <KpiCell label="Checked in" value={formatNumber(h.checked_in)} delta={`${pct(h.checked_in)} of registered`} />
        <KpiCell label="No-shows" value={formatNumber(h.no_shows)} delta={`${pct(h.no_shows)} of registered`} />
        <KpiCell
          label="Peak on site"
          value={formatNumber(h.peak_on_site)}
          delta={h.peak_on_site_at ? shortWhen(h.peak_on_site_at, timeZone) : "—"}
        />
        <KpiCell
          label="Rooms at capacity"
          value={formatNumber(h.rooms_at_capacity)}
          valueClassName={h.rooms_at_capacity > 0 ? "text-destructive" : undefined}
          delta="reached their stop threshold"
        />
        <KpiCell label="Alerts raised" value={formatNumber(h.alerts_raised)} delta={`median ack ${seconds(data.alerts.ack_p50_s)}`} />
      </dl>

      <div className="grid grid-cols-12 border-b border-border">
        <section aria-labelledby="sum-curve" className="col-span-12 xl:col-span-8">
          <SectionHead id="sum-curve" title="On site across the event" meta="5-minute buckets · peak marked" />
          <div className="px-4 pt-3 pb-2">
            {data.occupancy_curve.length > 1 ? (
              <OccupancyCurve points={data.occupancy_curve} peakAt={h.peak_on_site_at} timeZone={timeZone} />
            ) : (
              <p className="py-8 text-13 text-muted-foreground">Not enough data for a curve yet.</p>
            )}
          </div>
        </section>
        <section aria-labelledby="sum-tier" className="col-span-12 border-t border-border xl:col-span-4 xl:border-t-0 xl:border-l">
          <SectionHead id="sum-tier" title="Attendance by tier" meta="checked in of registered" />
          <TierTable rows={data.attendance_by_tier} />
        </section>
      </div>

      <div className="grid grid-cols-12 border-b border-border">
        <section aria-labelledby="sum-rooms" className="col-span-12 lg:col-span-4">
          <SectionHead id="sum-rooms" title="Busiest rooms" meta="peak against capacity" />
          <ol className="py-1">
            {data.busiest_rooms.map((room) => {
              const ratio = room.capacity > 0 ? room.peak / room.capacity : 0;
              const full = ratio >= 1;
              return (
                <li key={room.room_id} className="grid h-8 grid-cols-[minmax(0,1fr)_4rem_auto] items-center gap-3 px-4 text-13">
                  <span className="truncate">{room.name}</span>
                  <span aria-hidden="true" className="relative h-1 bg-border">
                    <span className={`absolute inset-0 origin-left ${full ? "bg-destructive" : "bg-muted-foreground"}`} style={{ transform: `scaleX(${Math.min(1, ratio)})` }} />
                  </span>
                  <span className="text-right font-mono text-12 tabular-nums">
                    <span className={full ? "text-destructive" : undefined}>{formatNumber(room.peak)}</span>
                    <span className="text-muted-foreground">/{formatNumber(room.capacity)}</span>
                    {room.peak_at ? <span className="text-muted-foreground"> · {formatClock(room.peak_at, timeZone, { seconds: false })}</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
        <section aria-labelledby="sum-gates" className="col-span-12 border-t border-border lg:col-span-4 lg:border-t-0 lg:border-l">
          <SectionHead id="sum-gates" title="Busiest gates" meta="scans · refused" />
          <ol className="py-1">
            {data.busiest_gates.map((gate) => (
              <li key={gate.checkpoint_id} className="grid h-8 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-4 text-13">
                <span className="truncate">{gate.label}</span>
                <span className="font-mono text-12 tabular-nums">{formatNumber(gate.scans)}</span>
                <span className="w-16 text-right font-mono text-12 text-muted-foreground tabular-nums">
                  {formatNumber(gate.denied)} <span className="text-11">({gate.scans > 0 ? formatPercent(gate.denied / gate.scans) : "—"})</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
        <section aria-labelledby="sum-alerts" className="col-span-12 border-t border-border lg:col-span-4 lg:border-t-0 lg:border-l">
          <SectionHead id="sum-alerts" title="Alerts" meta="by severity · how fast handled" />
          <AlertHandling data={data} />
        </section>
      </div>

      <Downloads eventId={data.event_id} initial={data.downloads} provisional={data.provisional} timeZone={timeZone} />

      <PurgeLine data={data} timeZone={timeZone} />
    </>
  );
}

function SectionHead({ id, title, meta }: { id: string; title: string; meta?: string }) {
  return (
    <header className="flex h-8 items-center justify-between gap-3 border-b border-border px-4">
      <h2 id={id} className="text-12 font-medium">
        {title}
      </h2>
      {meta ? <span className="text-11 text-muted-foreground">{meta}</span> : null}
    </header>
  );
}

function TierTable({ rows }: { rows: PostEventSummary["attendance_by_tier"] }) {
  return (
    <table className="w-full text-13">
      <thead>
        <tr className="h-8 text-left text-11 whitespace-nowrap text-muted-foreground">
          <th scope="col" className="px-4 font-normal">Tier</th>
          <th scope="col" className="px-2 text-right font-normal">Registered</th>
          <th scope="col" className="px-2 text-right font-normal">Checked in</th>
          <th scope="col" className="w-14 px-2 font-normal"><span className="sr-only">Share checked in</span></th>
          <th scope="col" className="px-4 text-right font-normal">No-shows</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const ratio = row.registered > 0 ? row.checked_in / row.registered : 0;
          return (
            <tr key={row.tier} className="h-8 border-t border-border">
              <th scope="row" className="px-4 text-left font-normal">{TIER_LABEL[row.tier]}</th>
              <td className="px-2 text-right font-mono text-12 tabular-nums">{formatNumber(row.registered)}</td>
              <td className="px-2 text-right font-mono text-12 tabular-nums">{formatNumber(row.checked_in)}</td>
              <td className="px-2">
                <span className="relative block h-1 bg-border" title={formatPercent(ratio)}>
                  <span className="absolute inset-0 origin-left bg-foreground/70" style={{ transform: `scaleX(${ratio})` }} />
                </span>
              </td>
              <td className="px-4 text-right font-mono text-12 text-muted-foreground tabular-nums">{formatNumber(row.no_shows)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function AlertHandling({ data }: { data: PostEventSummary }) {
  const order: Severity[] = ["critical", "high", "medium", "low"];
  return (
    <div>
      <ul className="py-1">
        {order.map((severity) => {
          const n = data.alerts.by_severity[severity] ?? 0;
          const view = SEVERITY_VIEW[severity];
          return (
            <li key={severity} className="grid h-7 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 text-13">
              <SignalShape state={n > 0 ? view.state : "idle"} className={n > 0 ? view.text : "text-muted-foreground"} />
              <span>{view.label}</span>
              <span className="font-mono text-12 tabular-nums">{formatNumber(n)}</span>
            </li>
          );
        })}
      </ul>
      <dl className="grid grid-cols-2 border-t border-border">
        <div className="border-r border-border px-4 py-2.5">
          <dt className="text-11 text-muted-foreground">Median to acknowledge</dt>
          <dd className="font-mono text-17 tabular-nums">{seconds(data.alerts.ack_p50_s)}</dd>
        </div>
        <div className="px-4 py-2.5">
          <dt className="text-11 text-muted-foreground">Median to resolve</dt>
          <dd className="font-mono text-17 tabular-nums">{seconds(data.alerts.resolve_p50_s)}</dd>
        </div>
      </dl>
    </div>
  );
}

function PurgeLine({ data, timeZone }: { data: PostEventSummary; timeZone: string }) {
  let text: string;
  if (data.purge.purged_at) {
    text = `Individual scan records for this event were deleted on ${longDate(data.purge.purged_at, timeZone)}. Totals, peaks and flows above are kept; who went where is not.`;
  } else if (data.purge.due_at) {
    text = `Individual scan records for this event will be deleted on ${longDate(data.purge.due_at, timeZone)}. Totals, peaks and flows are kept after that.`;
  } else {
    text = "Individual scan records are kept while the event is open and deleted after the grace period that follows closing.";
  }
  return <p className="px-6 pt-4 text-13 text-muted-foreground">{text}</p>;
}

/* ----------------------------------------------------------------- states */

function SummaryLoading() {
  return (
    <div role="status" aria-label="Loading the summary">
      <div aria-hidden="true" className="grid grid-cols-3 gap-px border-b border-border bg-border xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="bg-background px-4 pt-3 pb-3">
            <span className="block h-2 w-20 bg-muted/60" />
            <span className="mt-3 block h-8 w-24 bg-muted/40" />
            <span className="mt-3 block h-2 w-28 bg-muted/40" />
          </div>
        ))}
      </div>
      <div className="px-6 py-8">
        <p className="text-13 text-muted-foreground">Loading the summary…</p>
        <div className="relative mt-3 h-px w-64 overflow-hidden bg-border">
          <span aria-hidden="true" className="animate-skeleton-sweep absolute inset-y-0 w-1/3 bg-foreground/40" />
        </div>
      </div>
    </div>
  );
}

function SummaryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const copy = message in ERROR_COPY ? ERROR_COPY[message as keyof typeof ERROR_COPY] : ERROR_COPY.INTERNAL;
  return (
    <div role="alert" className="m-6 max-w-120 border border-border">
      <p className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-13 font-medium text-destructive">
        <SignalShape state="stop" /> Could not load the summary
      </p>
      <p className="px-4 py-3 text-13 text-muted-foreground">{copy.message}</p>
      <button type="button" onClick={onRetry} className="w-full border-t border-border px-4 py-2.5 text-left text-13 font-medium hover:bg-foreground/5">
        Try again
      </button>
    </div>
  );
}

function NoData({ data, timeZone, startsAt }: { data: PostEventSummary; timeZone: string; startsAt: string | null }) {
  return (
    <div className="max-w-160 px-6 py-8">
      <p className="flex items-center gap-2 text-12 text-muted-foreground">
        <SignalShape state="idle" /> No data yet
      </p>
      <h2 className="mt-2 font-display text-21 leading-tight">This event has not opened</h2>
      <p className="mt-2 text-13 text-muted-foreground">
        {startsAt ? (
          <>
            Doors open <span className="font-mono text-foreground">{shortWhen(startsAt, timeZone)}</span>.{" "}
          </>
        ) : null}
        The summary fills in once the first person checks in: figures are provisional while the event is live and final
        when it closes.
      </p>
      <p className="mt-4 text-12 text-muted-foreground">
        State: <span className="font-mono">{data.state}</span> ·{" "}
        <Link to="/" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
          Command Center
        </Link>
      </p>
    </div>
  );
}
