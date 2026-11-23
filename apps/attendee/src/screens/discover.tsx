import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { pageTitle } from "@synan/ui/brand";
import { AnimatedBar, Badge, buttonClass } from "@synan/ui/components";
import { PageShell } from "../components/page";
import { ErrorState, OfflineState, SkeletonCells, StateBlock } from "../components/states";
import { getEvents, type EventSummary } from "../data/events";
import { dateParts, formatDay, formatTime, relativeDays, zoneLabel } from "../data/format";
import { clock, useResource } from "../data/mock";

type Filter = "all" | "live" | "upcoming";

// "Near me" is left out until the owner decides how proximity works.
const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "upcoming", label: "Upcoming" },
];

function occupancyPct(event: EventSummary): number {
  if (event.state !== "live" || !event.admittedShown || event.capacity === 0) return 0;
  return Math.round((event.admitted / event.capacity) * 100);
}

function barTone(pct: number): "neutral" | "warning" | "destructive" {
  if (pct >= 100) return "destructive";
  if (pct >= 85) return "warning";
  return "neutral";
}

/** Static construction lines (Direction A frame). Decorative, so hidden from assistive tech. */
function ColumnGuides() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden md:block">
      <span className="absolute inset-y-0 left-1/4 w-px bg-border" />
      <span className="absolute inset-y-0 left-3/4 w-px bg-border" />
      <svg className="absolute top-0 left-0 h-full w-1/4 text-border" preserveAspectRatio="none" viewBox="0 0 100 100">
        <path d="M0 100 A100 100 0 0 1 100 0" fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function Cell({ label, children, index }: { label: string; children: React.ReactNode; index: number }) {
  return (
    <div
      className="enter flex min-h-28 flex-col gap-3 border-b border-border px-4 py-5 sm:px-6 md:border-b-0 md:px-8 odd:border-r md:not-last:border-r"
      style={{ ["--i" as string]: index + 3 }}
    >
      <p className="text-13 font-medium text-muted-foreground">{label}</p>
      <div>{children}</div>
    </div>
  );
}

export function Featured({ event }: { event: EventSummary }) {
  const live = event.state === "live";
  const pct = occupancyPct(event);
  return (
    <section aria-labelledby="featured-title" className="border-b border-border">
      <div className="relative overflow-hidden px-4 py-16 text-center sm:px-6 md:py-24">
        <ColumnGuides />
        <div className="relative">
          <div className="enter flex justify-center">
            {live ? (
              <Badge tone="success" dot pulse>
                Live now
              </Badge>
            ) : (
              <Badge tone="neutral">Next up · {relativeDays(event.startsAt, clock.now())}</Badge>
            )}
          </div>
          <h1
            id="featured-title"
            className="enter mx-auto mt-6 max-w-[22ch] font-display text-40 leading-[1.05] text-balance md:text-56"
            style={{ ["--i" as string]: 1 }}
          >
            {event.title}
          </h1>
          <div className="enter mt-8 flex justify-center" style={{ ["--i" as string]: 2 }}>
            <Link to={`/events/${event.slug}`} className={buttonClass("primary", "md")}>
              View event
            </Link>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 border-t border-border md:grid-cols-4">
        <Cell label="When" index={0}>
          <p className="font-mono text-17">{formatDay(event.startsAt, event.timezone)}</p>
          <p className="mt-1 text-13 text-muted-foreground">
            <span className="font-mono">{formatTime(event.startsAt, event.timezone)}</span> · {zoneLabel(event.timezone, event.startsAt)}
          </p>
        </Cell>
        <Cell label="Where" index={1}>
          <p className="text-17">{event.venue}</p>
          <p className="mt-1 text-13 text-muted-foreground">{event.city}</p>
        </Cell>
        <Cell label={live && event.admittedShown ? "Here now" : "Capacity"} index={2}>
          {live && event.admittedShown ? (
            <>
              <p className="text-17">
                <span className="font-mono">{event.admitted.toLocaleString("en-GB")}</span>
                <span className="text-muted-foreground"> of </span>
                <span className="font-mono">{event.capacity.toLocaleString("en-GB")}</span>
              </p>
              <AnimatedBar value={pct} tone={barTone(pct)} label={`${pct}% of capacity`} className="mt-3" />
            </>
          ) : (
            <p className="font-mono text-17">{event.capacity.toLocaleString("en-GB")}</p>
          )}
        </Cell>
        <Cell label="Programme" index={3}>
          <p className="text-17">
            <span className="font-mono">{event.sessionCount}</span> sessions
          </p>
          <Link to={`/events/${event.slug}#schedule`} className="mt-1 inline-flex min-h-11 items-center text-13 underline underline-offset-4">
            See the schedule
          </Link>
        </Cell>
      </div>
    </section>
  );
}

/**
 * The image slot. With a photograph: the photo, cropped to the slot. Without one: a
 * typographic plate — the date as the picture, on the frame's construction lines — so
 * an event without a photo looks intended, not missing.
 */
function EventPlate({ event }: { event: EventSummary }) {
  const { weekday, day, month } = dateParts(event.startsAt, event.timezone);
  if (event.image) {
    return <img src={event.image} alt="" className="aspect-[2/1] w-full border-b border-border object-cover sm:aspect-16/10" loading="lazy" />;
  }
  const live = event.state === "live";
  return (
    <div aria-hidden="true" className="relative aspect-[2/1] overflow-hidden border-b border-border sm:aspect-16/10">
      <svg className="absolute inset-0 h-full w-full text-border" preserveAspectRatio="none" viewBox="0 0 160 100">
        <path d="M0 100 A100 100 0 0 1 100 0" fill="none" stroke="currentColor" vectorEffect="non-scaling-stroke" />
        <line x1="100" y1="0" x2="100" y2="100" stroke="currentColor" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute right-0 bottom-0 left-0 flex items-end justify-between p-5">
        <p className="font-mono leading-none">
          <span className="block text-56 text-foreground">{day}</span>
          <span className="mt-2 block text-13 tracking-[0.08em] text-muted-foreground uppercase">
            {weekday} {month}
          </span>
        </p>
        {live && event.admittedShown ? (
          <p className="text-right text-13 text-muted-foreground">
            <span className="block font-mono text-28 text-foreground">{event.admitted.toLocaleString("en-GB")}</span>
            here now
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function EventCard({ event, index }: { event: EventSummary; index: number }) {
  const live = event.state === "live";
  const pct = occupancyPct(event);
  return (
    <li className="enter" style={{ ["--i" as string]: index }}>
      <Link
        to={`/events/${event.slug}`}
        className="group flex h-full flex-col transition-colors duration-120 ease-standard hover:bg-card/40 motion-reduce:transition-none"
      >
        <EventPlate event={event} />
        <div className="flex flex-1 flex-col gap-4 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            {live ? (
              <Badge tone="success" dot>
                Live
              </Badge>
            ) : (
              <span className="text-13 text-muted-foreground">Opens {relativeDays(event.startsAt, clock.now())}</span>
            )}
            <span className="font-mono text-13 text-muted-foreground">{formatTime(event.startsAt, event.timezone)}</span>
          </div>
          <div className="flex-1">
            <h3 className="font-display text-28 leading-tight underline-offset-4 group-hover:underline">{event.title}</h3>
            <p className="mt-2 text-15 text-muted-foreground">
              {event.venue} · {event.city}
            </p>
          </div>
          {live && event.admittedShown ? (
            <div>
              <div className="mb-2 flex items-baseline justify-between text-13 text-muted-foreground">
                <span>Here now</span>
                <span className={`font-mono ${pct >= 100 ? "text-destructive" : pct >= 85 ? "text-warning" : "text-foreground"}`}>
                  {pct}%
                </span>
              </div>
              <AnimatedBar value={pct} tone={barTone(pct)} label={`${event.title}: ${pct}% of capacity`} />
            </div>
          ) : (
            <p className="text-13 text-muted-foreground">
              <span className="font-mono">{event.sessionCount}</span> sessions · capacity{" "}
              <span className="font-mono">{event.capacity.toLocaleString("en-GB")}</span>
            </p>
          )}
        </div>
      </Link>
    </li>
  );
}

/**
 * Completes the last row of the card grid, so a short row ends in a quiet ruled cell
 * instead of an empty hole. Absent on phones (one column) and when the row is full.
 */
function RowEnd({ count }: { count: number }) {
  const sm = count % 2 === 0 ? "sm:hidden" : "sm:flex sm:col-span-1";
  const lg = count % 3 === 0 ? "lg:hidden" : count % 3 === 1 ? "lg:flex lg:col-span-2" : "lg:flex lg:col-span-1";
  return (
    <li aria-hidden="true" className={`hidden flex-col justify-end gap-2 p-5 sm:p-6 ${sm} ${lg} sm:!border-r-0`}>
      <p className="text-15 text-muted-foreground">That's every event for now.</p>
      <p className="max-w-[34ch] text-13 text-muted-foreground">New events appear here as soon as organisers publish them.</p>
    </li>
  );
}

export default function Discover() {
  const [filter, setFilter] = useState<Filter>("all");
  const events = useResource("events", getEvents);

  useEffect(() => {
    document.title = pageTitle();
  }, []);

  if (events.status !== "ready") {
    return (
      <PageShell bleed>
        <h1 className="sr-only">Events</h1>
        {events.status === "loading" ? (
          <SkeletonCells count={3} />
        ) : events.status === "offline" ? (
          <OfflineState what="Events" onRetry={events.retry} />
        ) : (
          <ErrorState what="events" onRetry={events.retry} />
        )}
      </PageShell>
    );
  }

  const all = events.data;
  const featured = all.find((event) => event.state === "live") ?? all[0];
  const rest = all.filter((event) => event !== featured);
  const visible = rest.filter((event) => filter === "all" || event.state === filter);
  const counts: Record<Filter, number> = {
    all: rest.length,
    live: rest.filter((event) => event.state === "live").length,
    upcoming: rest.filter((event) => event.state === "upcoming").length,
  };

  return (
    <PageShell bleed>
      {featured ? <Featured event={featured} /> : <h1 className="sr-only">Events</h1>}

      <section aria-labelledby="more-title">
        <div className="flex flex-col border-b border-border sm:flex-row sm:items-stretch sm:justify-between">
          <h2 id="more-title" className="flex min-h-14 items-center px-4 font-display text-21 sm:px-6 md:px-8">
            {featured ? "More events" : "Events"}
          </h2>
          <div role="group" aria-label="Filter events" className="grid grid-cols-3 border-t border-border sm:flex sm:items-stretch sm:border-t-0">
            {filters.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
                className={`relative flex min-h-14 items-center justify-center gap-2 border-border px-4 text-15 not-first:border-l sm:justify-start sm:border-l transition-colors duration-120 ease-standard motion-reduce:transition-none sm:px-5 ${
                  filter === id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
                <span className="font-mono text-13 text-muted-foreground">{counts[id]}</span>
                <span
                  aria-hidden="true"
                  className={`absolute inset-x-0 -bottom-px h-px origin-left bg-brand transition-transform duration-180 ease-standard motion-reduce:transition-none ${
                    filter === id ? "scale-x-100" : "scale-x-0"
                  }`}
                />
              </button>
            ))}
          </div>
        </div>

        {visible.length > 0 ? (
          <ul key={filter} className="grid sm:grid-cols-2 lg:grid-cols-3 [&>li]:border-b [&>li]:border-border sm:[&>li:nth-child(odd)]:border-r lg:[&>li]:border-r lg:[&>li:nth-child(3n)]:border-r-0">
            {visible.map((event, index) => (
              <EventCard key={event.slug} event={event} index={index} />
            ))}
            <RowEnd count={visible.length} />
          </ul>
        ) : (
          <StateBlock
            glyph="·"
            title={filter === "live" ? "Nothing else is live right now." : "No upcoming events yet."}
            action={
              <button type="button" onClick={() => setFilter("all")} className={buttonClass("secondary", "sm")}>
                Show all events
              </button>
            }
          >
            New events appear here as soon as organisers publish them.
          </StateBlock>
        )}
      </section>
    </PageShell>
  );
}
