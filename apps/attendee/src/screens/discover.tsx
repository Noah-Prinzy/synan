import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { PageShell, Eyebrow } from "../components/page";
import { events, type EventSummary } from "../data/events";
import {
  AnimatedBar,
  AnimatedUnderline,
  Badge,
  Button,
  Card,
  buttonClass,
} from "@connexia/ui/components";

type Filter = "all" | "live" | "upcoming" | "near";

const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "upcoming", label: "Upcoming" },
  { id: "near", label: "Near me" },
];

function dateParts(event: EventSummary) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: event.timezone,
  }).formatToParts(new Date(event.startsAt));
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return { weekday: pick("weekday"), day: pick("day"), month: pick("month") };
}

function occupancy(event: EventSummary): number {
  if (event.state !== "live" || event.capacity === 0) return 0;
  return Math.round((event.admitted / event.capacity) * 100);
}

function occupancyTone(pct: number): "success" | "warning" | "destructive" {
  if (pct >= 100) return "destructive";
  if (pct >= 85) return "warning";
  return "success";
}

function barTone(pct: number): "neutral" | "warning" | "destructive" {
  if (pct >= 100) return "destructive";
  if (pct >= 85) return "warning";
  return "neutral";
}

function FeaturedEvent({ event }: { event: EventSummary }) {
  const pct = occupancy(event);
  const { weekday, day, month } = dateParts(event);

  return (
    <section aria-labelledby="featured-heading" className="border-b border-border pb-10 md:pb-14">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-end lg:gap-16">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="success" dot pulse>
              Live now
            </Badge>
            <Eyebrow>
              {weekday} {day} {month} · {event.city}
            </Eyebrow>
          </div>

          <h2 id="featured-heading" className="mt-5 max-w-[18ch] font-serif text-4xl leading-[1.05] font-normal md:text-6xl xl:text-7xl">
            <Link
              to={`/events/${event.slug}`}
              className="transition-colors duration-[120ms] ease-[cubic-bezier(.2,0,0,1)] hover:text-brand focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand motion-reduce:transition-none"
            >
              {event.title}
            </Link>
          </h2>

          <p className="mt-4 text-sm text-muted-foreground">
            {event.venue} · {event.city}
          </p>

          <div className="mt-8">
            <Link to={`/events/${event.slug}`} className={buttonClass("primary", "md")}>
              View event
            </Link>
          </div>
        </div>

        <Card className="bg-transparent">
          <div className="px-5 pt-4 pb-5">
            <Eyebrow>Admitted</Eyebrow>
            <p className="mt-2 font-serif text-5xl leading-none tabular-nums">
              {event.admitted.toLocaleString("en-GB")}
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                / {event.capacity.toLocaleString("en-GB")}
              </span>
            </p>
            <div className="mt-6">
              <AnimatedBar value={pct} tone={barTone(pct)} label={`${pct}% of capacity admitted`} />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
                {pct}% of capacity
              </span>
              <Badge tone={occupancyTone(pct)} dot>
                {pct >= 85 ? "Near capacity" : "Within capacity"}
              </Badge>
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}

function EventCard({ event }: { event: EventSummary }) {
  const { weekday, day, month } = dateParts(event);
  const pct = occupancy(event);

  return (
    <Card className="group h-full transition-colors duration-[180ms] ease-[cubic-bezier(.2,0,0,1)] hover:border-brand/60 motion-reduce:transition-none">
      <Link to={`/events/${event.slug}`} className="flex h-full flex-col focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <p className="font-mono text-[0.6875rem] uppercase tracking-[0.08em] text-muted-foreground">
            <span className="block">{weekday}</span>
            <span className="block text-foreground">
              {day} {month}
            </span>
          </p>
          {event.state === "live" ? (
            <Badge tone="success" dot pulse={pct >= 85}>
              Live
            </Badge>
          ) : (
            <Badge tone="neutral">Upcoming</Badge>
          )}
        </div>

        <div className="flex flex-1 flex-col justify-between gap-6 px-5 py-5">
          <div>
            <h2 className="font-serif text-2xl leading-tight font-normal">{event.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {event.venue} · {event.city}
            </p>
          </div>

          {event.state === "live" ? (
            <div>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-muted-foreground">
                  Occupancy
                </span>
                <span
                  className={`font-mono text-[0.6875rem] tabular-nums ${
                    pct >= 100 ? "text-destructive" : pct >= 85 ? "text-warning" : "text-foreground"
                  }`}
                >
                  {pct}%
                </span>
              </div>
              <AnimatedBar value={pct} tone={barTone(pct)} label={`${event.title} occupancy`} />
            </div>
          ) : (
            <p className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-muted-foreground">
              Capacity {event.capacity.toLocaleString("en-GB")}
            </p>
          )}
        </div>
      </Link>
    </Card>
  );
}

export default function Discover() {
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    document.title = "Connexia";
  }, []);

  const visible = events.filter((event) => {
    if (filter === "live") return event.state === "live";
    if (filter === "upcoming") return event.state === "upcoming";
    if (filter === "near") return event.nearby;
    return true;
  });

  const featured = events.find((event) => event.state === "live");

  return (
    <PageShell>
      <h1 className="sr-only">Events</h1>

      {featured && (filter === "all" || filter === "live" || filter === "near") ? (
        <FeaturedEvent event={featured} />
      ) : null}

      <nav aria-label="Filter events" className="border-b border-border">
        <div className="flex flex-wrap gap-7">
          {filters.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={`relative pt-3 pb-3 font-mono text-[0.6875rem] uppercase tracking-[0.12em] transition-colors duration-[120ms] ease-[cubic-bezier(.2,0,0,1)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand motion-reduce:transition-none ${
                filter === id ? "text-brand" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
              <AnimatedUnderline active={filter === id} />
            </button>
          ))}
        </div>
      </nav>

      <section aria-labelledby="all-events-heading" className="pt-8 pb-24">
        <div className="mb-5 flex items-baseline justify-between gap-4">
          <h2 id="all-events-heading" className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-muted-foreground">
            {filter === "all" ? "All events" : filters.find((f) => f.id === filter)?.label}
          </h2>
          <span className="font-mono text-[0.625rem] tabular-nums text-muted-foreground">
            {visible.length.toString().padStart(2, "0")}
          </span>
        </div>

        {visible.length > 0 ? (
          <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((event) => (
              <li key={event.slug}>
                <EventCard event={event} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-start gap-3 border border-border px-6 py-14">
            <p className="font-serif text-xl">Nothing in this view.</p>
            <p className="text-sm text-muted-foreground">
              There are no events for this filter right now.
            </p>
            <Button variant="secondary" size="sm" onClick={() => setFilter("all")} className="mt-2">
              Show all events
            </Button>
          </div>
        )}
      </section>
    </PageShell>
  );
}
