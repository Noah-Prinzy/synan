import { useState } from "react";
import { Link } from "react-router-dom";
import { Wordmark } from "../brand/wordmark";
import { events, type EventSummary } from "../data/events";

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

function Capacity({ event }: { event: EventSummary }) {
  const pct = Math.round((event.admitted / event.capacity) * 100);
  const tone = pct >= 100 ? "bg-destructive" : pct >= 85 ? "bg-warning" : "bg-foreground";
  const label = pct >= 100 ? "text-destructive" : pct >= 85 ? "text-warning" : "text-muted-foreground";

  return (
    <div className="flex flex-col items-end gap-2">
      <span className="flex items-center gap-1.5 font-mono text-[0.625rem] tracking-[0.12em] uppercase">
        <span className="bg-success size-1" aria-hidden />
        Live
      </span>
      <div className="flex items-center gap-2.5">
        <span className={`font-mono text-[0.6875rem] tabular-nums ${label}`}>{pct}%</span>
        <span className="bg-border block h-px w-14">
          <span className={`block h-px ${tone}`} style={{ width: `${Math.min(pct, 100)}%` }} />
        </span>
      </div>
    </div>
  );
}

function EventRow({ event }: { event: EventSummary }) {
  const { weekday, day, month } = dateParts(event);

  return (
    <li>
      <Link
        to={`/events/${event.slug}`}
        className="hover:bg-card/50 grid grid-cols-[3.75rem_1fr] gap-x-5 px-6 py-6 transition-colors sm:grid-cols-[5rem_1fr_10rem] sm:items-center md:px-10"
      >
        <span className="text-muted-foreground pt-1 font-mono text-[0.6875rem] leading-relaxed tracking-[0.08em] uppercase">
          <span className="block">{weekday}</span>
          <span className="text-foreground block">
            {day} {month}
          </span>
        </span>

        <span className="flex min-w-0 flex-col gap-1.5">
          <span className="font-serif text-2xl leading-tight font-normal md:text-[1.75rem]">
            {event.title}
          </span>
          <span className="text-muted-foreground text-sm">
            {event.venue} · {event.city}
          </span>
        </span>

        <span className="hidden justify-self-end sm:block">
          {event.state === "live" ? (
            <Capacity event={event} />
          ) : (
            <span className="text-muted-foreground font-mono text-[0.625rem] tracking-[0.12em] uppercase">
              Upcoming
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

export default function Discover() {
  const [filter, setFilter] = useState<Filter>("all");

  const visible = events.filter((event) => {
    if (filter === "live") return event.state === "live";
    if (filter === "upcoming") return event.state === "upcoming";
    if (filter === "near") return event.nearby;
    return true;
  });

  return (
    <main className="bg-background text-foreground min-h-dvh pb-24">
      <header className="border-border border-b">
        <div className="mx-auto max-w-4xl px-6 pt-10 pb-8 md:px-10">
          <Wordmark className="text-foreground h-9 w-auto md:h-11" />
          <p className="text-muted-foreground mt-5 max-w-sm text-sm leading-relaxed">
            Real-time access, occupancy and gate operations for live events.
          </p>
        </div>
      </header>

      <nav aria-label="Filter events" className="border-border border-b">
        <div className="mx-auto flex max-w-4xl gap-7 px-6 md:px-10">
          {filters.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={`-mb-px border-b py-3 font-mono text-[0.6875rem] tracking-[0.12em] uppercase transition-colors ${
                filter === id
                  ? "border-brand text-brand"
                  : "text-muted-foreground hover:text-foreground border-transparent"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>

      <div className="mx-auto max-w-4xl">
        {visible.length > 0 ? (
          <ul className="divide-border divide-y">
            {visible.map((event) => (
              <EventRow key={event.slug} event={event} />
            ))}
          </ul>
        ) : (
          <div className="border-border flex flex-col items-start gap-3 border-b px-6 py-16 md:px-10">
            <p className="font-serif text-xl">Nothing in this view.</p>
            <p className="text-muted-foreground text-sm">
              There are no events for this filter right now.
            </p>
            <button
              type="button"
              onClick={() => setFilter("all")}
              className="border-border hover:border-brand hover:text-brand mt-2 border px-3 py-1.5 font-mono text-[0.625rem] tracking-[0.12em] uppercase transition-colors"
            >
              Show all events
            </button>
          </div>
        )}
      </div>

      <div className="border-border bg-background/95 fixed inset-x-0 bottom-0 border-t backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-3 md:px-10">
          <span className="text-muted-foreground font-mono text-[0.625rem] tracking-[0.12em] uppercase">
            Sun 22 Nov · Kampala
          </span>
          <Link
            to="/pass"
            className="border-border hover:border-brand hover:text-brand border px-4 py-2 font-mono text-[0.6875rem] tracking-[0.12em] uppercase transition-colors"
          >
            My pass
          </Link>
        </div>
      </div>
    </main>
  );
}
