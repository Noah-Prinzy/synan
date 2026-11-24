/**
 * D13c · Event summary `/admin/events/:id/summary` (docs/06, D-21): the landing page of
 * a closed event. One page, no tabs: headline figures, attendance by tier, the occupancy
 * curve, busiest rooms and gates, how fast alerts were handled, downloads, and a plain
 * line saying what was deleted and when. A live event shows its figures so far, labelled
 * provisional. Built against GET /events/:id/post-event-summary (contracts).
 *
 * Layout: three headline figures large (registered, checked in, peak on site); no-shows,
 * rooms at capacity and alerts sit beside them as a short list of facts, over the same rail
 * that carries attendance by tier and the alerts below, so every row shares one right edge.
 * Exact values stay wherever this page is the record (tier table, rooms, gates, alerts).
 *
 * States: loading, error, no data yet (an event that has not opened), provisional, final.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { ERROR_COPY } from "@synan/contracts/copy";
import type { AttendeeTier, Severity } from "@synan/contracts/enums";
import type { PostEventSummary } from "@synan/contracts/rest";
import { cn } from "@synan/ui/components";
import { KpiCell, SignalShape, formatAge, formatClock, formatNumber, formatPercent } from "@synan/ui/data";
import { GUTTER_X, PROSE, PageHeader, SPLIT, SectionHead, TYPE } from "../kit";
import { SEVERITY_VIEW } from "../live/alert-copy";
import { api } from "../live/backend";
import { useCommand } from "../live/context";
import { HEAD_BLEED, Meter, RAIL_ROW, RAIL_X } from "../workspace/parts/layout";
import { Downloads } from "./downloads";
import { OccupancyCurve } from "./occupancy-curve";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: PostEventSummary };

const TIER_LABEL: Record<AttendeeTier, string> = {
  VIP: "VIP",
  ORDINARY: "Ordinary",
  PRIVATE_INVITE: "Invitation",
  PUBLIC: "Public",
};

/** The headline strip and every row below share the split's columns, so dividers line up. */
const STRIP = "grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-3 lg:grid-cols-[repeat(3,minmax(0,1fr))_minmax(20rem,24rem)] 2xl:grid-cols-[repeat(3,minmax(0,1fr))_26rem]";
/** A KPI cell padded to the page gutter. */
const CELL = "sm:px-6 2xl:px-8";

function longDate(at: string, timeZone: string): string {
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone });
}

function shortWhen(at: string, timeZone: string): string {
  const day = new Date(at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone });
  return `${formatClock(at, timeZone, { seconds: false })} · ${day}`;
}

/** "15:15 on Wed 18 Nov": the time in mono, the day in words. */
function When({ at, timeZone }: { at: string; timeZone: string }) {
  const day = new Date(at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone });
  return (
    <span className="font-sans">
      <span className="font-mono tabular-nums">{formatClock(at, timeZone, { seconds: false })}</span> on {day}
    </span>
  );
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
        <PageHeader code="D13c" title="Event summary" />
        <p className={cn("py-6 text-13 text-muted-foreground", GUTTER_X)}>{ERROR_COPY.NOT_FOUND.message}</p>
      </div>
    );
  }

  const data = load.status === "ready" ? load.data : null;
  const noData = data !== null && (data.state === "draft" || data.state === "published");

  return (
    <div className="min-h-full pb-10">
      <PageHeader
        code="D13c"
        title={event ? event.title : "Event summary"}
        meta={
          event ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{event.venue_name}</span>
              <span aria-hidden="true">·</span>
              <span>
                {longDate(event.starts_at, timeZone)} – {longDate(event.ends_at, timeZone)}
              </span>
            </span>
          ) : undefined
        }
        actions={data && !noData ? <StateLine data={data} timeZone={timeZone} /> : undefined}
      />

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
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-13">
        <SignalShape state="idle" className="text-muted-foreground" />
        <span className="font-medium">Provisional</span>
        <span className="text-muted-foreground">
          figures so far, as of <span className="font-mono tabular-nums">{formatClock(data.as_of, timeZone)}</span>
        </span>
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-13">
      <span className="font-medium">Final</span>
      <span className="text-muted-foreground">
        closed <When at={data.as_of} timeZone={timeZone} />
      </span>
    </p>
  );
}

function SummaryBody({ data, timeZone }: { data: PostEventSummary; timeZone: string }) {
  const h = data.headline;
  const share = (part: number) => (h.registered > 0 ? part / h.registered : null);
  const pct = (part: number) => {
    const s = share(part);
    return s === null ? "—" : formatPercent(s);
  };
  const words = (text: ReactNode) => <span className="font-sans">{text}</span>;
  const checkedShare = share(h.checked_in);

  return (
    <>
      <div className={STRIP}>
        <dl className="contents">
          <KpiCell label="Registered" className={CELL} value={formatNumber(h.registered)} delta={words("across all tiers")} />
          <KpiCell
            label="Checked in"
            className={CELL}
            value={formatNumber(h.checked_in)}
            delta={words(`${pct(h.checked_in)} of those registered`)}
            spark={checkedShare !== null ? <Meter value={checkedShare} className="max-w-32" /> : null}
          />
          <KpiCell
            label="Peak on site"
            className={cn(CELL, "max-sm:col-span-2")}
            value={formatNumber(h.peak_on_site)}
            delta={h.peak_on_site_at ? <When at={h.peak_on_site_at} timeZone={timeZone} /> : "—"}
          />
        </dl>
        <div className="col-span-2 flex flex-col justify-center bg-background py-3 sm:col-span-3 lg:col-span-1">
          <dl className="text-13">
            <Fact label="No-shows">
              <span className={TYPE.value}>{formatNumber(h.no_shows)}</span>
              <span className="text-muted-foreground"> · {pct(h.no_shows)}</span>
            </Fact>
            <Fact label="Rooms at capacity">
              <span className={cn(TYPE.value, h.rooms_at_capacity > 0 && "text-destructive")}>{formatNumber(h.rooms_at_capacity)}</span>
              <span className="text-muted-foreground"> reached their stop point</span>
            </Fact>
            <Fact label="Alerts raised">
              <span className={TYPE.value}>{formatNumber(h.alerts_raised)}</span>
              <span className="text-muted-foreground">
                {" "}
                · <span className="font-mono tabular-nums">{seconds(data.alerts.ack_p50_s)}</span> to acknowledge
              </span>
            </Fact>
          </dl>
        </div>
      </div>

      <div className={cn(SPLIT, "border-b border-border")}>
        <section aria-labelledby="sum-curve" className="min-w-0">
          <SectionHead id="sum-curve" title="On site across the event" meta="5-minute buckets · peak marked" className={HEAD_BLEED} />
          <div className={cn("pt-5 pb-3", GUTTER_X)}>
            {data.occupancy_curve.length > 1 ? (
              <OccupancyCurve points={data.occupancy_curve} peakAt={h.peak_on_site_at} timeZone={timeZone} />
            ) : (
              <p className="py-8 text-13 text-muted-foreground">Not enough data for a curve yet.</p>
            )}
          </div>
        </section>
        <section aria-labelledby="sum-tier" className="min-w-0 border-t border-border lg:border-t-0 lg:border-l">
          <SectionHead id="sum-tier" title="Attendance by tier" meta="checked in of registered" />
          <TierTable rows={data.attendance_by_tier} />
        </section>
      </div>

      <div className={cn(SPLIT, "border-b border-border")}>
        <div className="grid min-w-0 grid-cols-1 md:grid-cols-2">
          <section aria-labelledby="sum-rooms" className="min-w-0">
            <SectionHead id="sum-rooms" title="Busiest rooms" meta="peak against capacity" className={HEAD_BLEED} />
            <ol className="py-1.5">
              {data.busiest_rooms.map((room) => {
                const ratio = room.capacity > 0 ? room.peak / room.capacity : 0;
                const full = ratio >= 1;
                return (
                  <li
                    key={room.room_id}
                    className={cn("grid min-h-10 grid-cols-[minmax(0,1fr)_2.5rem_auto_2.75rem] items-center gap-3 py-1.5 text-13", GUTTER_X, "md:pr-5!")}
                  >
                    <span className="truncate" title={room.name}>
                      {room.name}
                    </span>
                    <Meter value={ratio} tone={full ? "bg-destructive" : "bg-foreground/60"} />
                    <span className="text-right font-mono tabular-nums whitespace-nowrap">
                      <span className={full ? "text-destructive" : undefined}>{formatNumber(room.peak)}</span>
                      <span className="text-muted-foreground">/{formatNumber(room.capacity)}</span>
                    </span>
                    <span className="text-right font-mono text-12 text-muted-foreground tabular-nums">
                      {room.peak_at ? formatClock(room.peak_at, timeZone, { seconds: false }) : ""}
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
          <section aria-labelledby="sum-gates" className="min-w-0 border-t border-border md:border-t-0 md:border-l">
            <SectionHead id="sum-gates" title="Busiest gates" meta="scans and refusals" />
            <ol className="py-1.5">
              {data.busiest_gates.map((gate) => (
                <li key={gate.checkpoint_id} className={cn(RAIL_ROW, "grid-cols-[minmax(0,1fr)_auto_5.5rem]")}>
                  <span className="truncate">{gate.label}</span>
                  <span className={cn(TYPE.value, "text-right")}>{formatNumber(gate.scans)}</span>
                  <span className="text-right text-12 whitespace-nowrap text-muted-foreground">
                    <span className="font-mono tabular-nums">{formatNumber(gate.denied)}</span> refused
                    <span className="sr-only"> ({gate.scans > 0 ? formatPercent(gate.denied / gate.scans) : "—"})</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <section aria-labelledby="sum-alerts" className="min-w-0 border-t border-border lg:border-t-0 lg:border-l">
          <SectionHead id="sum-alerts" title="Alerts" meta="by severity · how fast handled" />
          <AlertHandling data={data} />
        </section>
      </div>

      <Downloads eventId={data.event_id} initial={data.downloads} provisional={data.provisional} timeZone={timeZone} />

      <PurgeLine data={data} timeZone={timeZone} />
    </>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={cn("grid grid-cols-[9rem_minmax(0,1fr)] items-baseline gap-3 py-1.5", RAIL_X)}>
      <dt className="text-12 text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function TierTable({ rows }: { rows: PostEventSummary["attendance_by_tier"] }) {
  const head = "h-9 border-b border-border text-12 font-normal whitespace-nowrap text-muted-foreground";
  return (
    <table className="w-full border-collapse text-13">
      <thead>
        <tr>
          <th scope="col" className={cn(head, "pr-2 pl-4 text-left sm:pl-5")}>Tier</th>
          <th scope="col" className={cn(head, "px-2 text-right")}>Registered</th>
          <th scope="col" className={cn(head, "px-2 text-right")}>Checked in</th>
          <th scope="col" className={cn(head, "w-14 px-2")}><span className="sr-only">Share checked in</span></th>
          <th scope="col" className={cn(head, "pr-4 pl-2 text-right sm:pr-5")}>No-shows</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const ratio = row.registered > 0 ? row.checked_in / row.registered : 0;
          return (
            <tr key={row.tier} className="h-10 border-b border-border last:border-b-0">
              <th scope="row" className="pr-2 pl-4 text-left font-normal sm:pl-5">{TIER_LABEL[row.tier]}</th>
              <td className={cn(TYPE.value, "px-2 text-right")}>{formatNumber(row.registered)}</td>
              <td className={cn(TYPE.value, "px-2 text-right")}>{formatNumber(row.checked_in)}</td>
              <td className="px-2" title={formatPercent(ratio)}>
                <Meter value={ratio} tone="bg-foreground/70" />
              </td>
              <td className={cn(TYPE.value, "pr-4 pl-2 text-right text-muted-foreground sm:pr-5")}>{formatNumber(row.no_shows)}</td>
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
      <ul className="py-1.5">
        {order.map((severity) => {
          const n = data.alerts.by_severity[severity] ?? 0;
          const view = SEVERITY_VIEW[severity];
          return (
            <li key={severity} className={cn(RAIL_ROW, "min-h-9 grid-cols-[auto_minmax(0,1fr)_auto]")}>
              <SignalShape state={n > 0 ? view.state : "idle"} className={n > 0 ? view.text : "text-muted-foreground"} />
              <span className={n > 0 ? undefined : "text-muted-foreground"}>{view.label}</span>
              <span className={cn(TYPE.value, n === 0 && "text-muted-foreground")}>{formatNumber(n)}</span>
            </li>
          );
        })}
      </ul>
      <dl className="grid grid-cols-2 border-t border-border">
        <div className={cn("border-r border-border py-3", RAIL_X)}>
          <dt className="text-12 text-muted-foreground">Median to acknowledge</dt>
          <dd className="mt-1 font-mono text-17 tabular-nums">{seconds(data.alerts.ack_p50_s)}</dd>
        </div>
        <div className={cn("py-3", RAIL_X)}>
          <dt className="text-12 text-muted-foreground">Median to resolve</dt>
          <dd className="mt-1 font-mono text-17 tabular-nums">{seconds(data.alerts.resolve_p50_s)}</dd>
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
  return <p className={cn("pt-6 text-13 leading-relaxed text-muted-foreground", GUTTER_X, PROSE)}>{text}</p>;
}

/* ----------------------------------------------------------------- states */

function SummaryLoading() {
  return (
    <div role="status" aria-label="Loading the summary">
      <div aria-hidden="true" className={STRIP}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={cn("bg-background px-4 py-4", CELL, i === 3 && "col-span-2 sm:col-span-3 lg:col-span-1")}>
            <span className="block h-2 w-20 bg-muted/60" />
            <span className="mt-3 block h-8 w-24 bg-muted/40" />
            <span className="mt-3 block h-2 w-28 bg-muted/40" />
          </div>
        ))}
      </div>
      <div className={cn("py-8", GUTTER_X)}>
        <p className="text-13 text-muted-foreground">Loading the summary…</p>
        <div className="relative mt-3 h-px w-64 max-w-full overflow-hidden bg-border">
          <span aria-hidden="true" className="animate-skeleton-sweep absolute inset-y-0 w-1/3 bg-foreground/40" />
        </div>
      </div>
    </div>
  );
}

function SummaryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const copy = message in ERROR_COPY ? ERROR_COPY[message as keyof typeof ERROR_COPY] : ERROR_COPY.INTERNAL;
  return (
    <div role="alert" className="m-4 max-w-120 border border-border sm:m-6 2xl:m-8">
      <p className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-13 font-medium text-destructive">
        <SignalShape state="stop" /> Could not load the summary
      </p>
      <p className="px-4 py-3 text-13 text-muted-foreground">{copy.message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="pressable w-full border-t border-border px-4 py-2.5 text-left text-13 font-medium transition-colors duration-120 ease-standard hover:bg-foreground/5 motion-reduce:transition-none"
      >
        Try again
      </button>
    </div>
  );
}

function NoData({ data, timeZone, startsAt }: { data: PostEventSummary; timeZone: string; startsAt: string | null }) {
  return (
    <div className={cn("max-w-160 py-10", GUTTER_X)}>
      <p className="flex items-center gap-2 text-12 text-muted-foreground">
        <SignalShape state="idle" /> No data yet
      </p>
      <h2 className="mt-2 font-display text-21 leading-tight">This event has not opened</h2>
      <p className="mt-2 text-13 leading-relaxed text-muted-foreground">
        {startsAt ? (
          <>
            Doors open <span className="font-mono text-foreground tabular-nums">{shortWhen(startsAt, timeZone)}</span>.{" "}
          </>
        ) : null}
        The summary fills in once the first person checks in: figures are provisional while the event is live and final
        when it closes.
      </p>
      <p className="mt-4 text-12 text-muted-foreground">
        State: <span className="font-mono">{data.state}</span> ·{" "}
        <Link to="/" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-brand">
          Command Center
        </Link>
      </p>
    </div>
  );
}
