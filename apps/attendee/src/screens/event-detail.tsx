import { useParams, Link, NavLink } from "react-router-dom";
import { useEffect } from "react";
import { type EventDetail, eventDetails } from "../data/events";
import SiteHeader from "../components/site-header";

function formatDate(event: EventDetail) {
  const date = new Date(event.startsAt);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: event.timezone,
  }).format(date);
}

function timeRange(startsAt: string, endsAt: string) {
  return `${startsAt}–${endsAt}`;
}

function OccupancyChip({ occupancy, capacity }: { occupancy: number; capacity: number }) {
  const pct = Math.round((occupancy / capacity) * 100);
  const tone =
    pct >= 100
      ? "text-destructive"
      : pct >= 85
        ? "text-warning"
        : "text-muted-foreground";

  return (
    <span className={`font-mono text-[0.6875rem] tabular-nums ${tone}`}>
      {pct}%
    </span>
  );
}

function SessionRow({ session, event }: { session: EventDetail["sessions"][number]; event: EventDetail }) {
  return (
    <li className="px-6 py-4 md:px-10">
      <div className="flex flex-col gap-1 sm:grid sm:grid-cols-[8rem_minmax(8rem,1fr)_minmax(0,1fr)_8rem] sm:gap-x-5">
        <span className="text-muted-foreground font-mono text-[0.6875rem] tabular-nums">
          {timeRange(session.startsAt, session.endsAt)}
        </span>
        <span className="text-muted-foreground font-mono text-[0.6875rem] tabular-nums sm:justify-self-end">
          {session.room}
        </span>
        <span className="min-w-0 truncate font-serif text-lg leading-tight font-normal sm:col-start-3">
          {session.title}
        </span>
        {event.state === "live" && session.occupancy > 0 ? (
          <span className="sm:justify-self-end">
            <OccupancyChip occupancy={session.occupancy} capacity={session.capacity} />
          </span>
        ) : null}
      </div>
    </li>
  );
}

function StatusSection({ event }: { event: EventDetail }) {
  const statusText =
    event.membership === "checked-in"
      ? "Checked in"
      : event.membership === "registered"
        ? "Registered"
        : "Not registered";

  let ctaText = "";
  let ctaPath = "";

  if (event.closed) {
    ctaText = "View your pass";
    ctaPath = "/pass";
  } else if (event.membership === "none") {
    ctaText = "Register";
    ctaPath = `/events/${event.slug}/register`;
  } else {
    ctaText = "View your pass";
    ctaPath = "/pass";
  }

  return (
    <section className="flex flex-col gap-2" aria-labelledby="your-status-heading">
      <p className="text-muted-foreground font-mono text-[0.625rem] tracking-[0.12em] uppercase" id="your-status-heading">
        Your status
      </p>
      <p className="font-serif text-xl leading-tight font-normal">{statusText}</p>
      <Link
        to={ctaPath}
        className="border-border hover:border-brand hover:text-brand focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand w-fit border px-4 py-3 font-mono text-[0.6875rem] tracking-[0.12em] uppercase transition-colors motion-reduce:transition-none"
      >
        {ctaText}
      </Link>
    </section>
  );
}

function DayGroup({ day, sessions, event }: { day: string; sessions: EventDetail["sessions"]; event: EventDetail }) {
  return (
    <div className="mt-4">
      <h3 className="text-muted-foreground mb-2 font-mono text-[0.625rem] tracking-[0.12em] uppercase px-6 md:px-10">
        {day}
      </h3>
      <ul className="divide-border divide-y">
        {sessions.map((session) => (
          <SessionRow key={session.id} session={session} event={event} />
        ))}
      </ul>
    </div>
  );
}

function GroupSessionsByDay(sessions: EventDetail["sessions"]) {
  const groups: Record<string, typeof sessions> = {};
  for (const session of sessions) {
    const day = session.day;
    if (!groups[day]) groups[day] = [];
    groups[day].push(session);
  }
  return Object.entries(groups).map(([day, s]) => ({ day, sessions: s }));
}

function SkipLink() {
  return (
    <a
      href="#content"
      className="focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:block focus:bg-background focus:p-2 focus:text-brand focus:underline focus:underline-offset-2"
      style={{ position: "absolute", left: "-9999px", top: 0 }}
    >
      Skip to content
    </a>
  );
}

export default function EventDetail() {
  const { slug } = useParams<{ slug?: string }>();
  const event = eventDetails.find((e) => e.slug === slug);

  useEffect(() => {
    if (event) {
      document.title = `${event.title} · Connexia`;
    }
  }, [event]);

  if (!event) {
    return (
      <main className="bg-background text-foreground flex min-h-dvh flex-col">
        <SkipLink />
        <SiteHeader />
        <div className="flex flex-1 flex-col items-start justify-center gap-4 px-6 md:px-10 xl:px-16">
          <p className="font-serif text-3xl font-normal">Event not found.</p>
          <Link to="/" className="text-sm underline underline-offset-4">
            Back to events
          </Link>
        </div>
      </main>
    );
  }

  const dayGroups = GroupSessionsByDay(event.sessions);

  return (
    <main className="bg-background text-foreground min-h-dvh">
      <SkipLink />
      <SiteHeader />

      <div id="content" className="mx-auto w-full max-w-[1600px] px-6 pt-10 md:px-10 xl:px-16">
        <span className="text-muted-foreground font-mono text-[0.6875rem] tabular-nums tracking-[0.08em] uppercase">
          {formatDate(event)}
          <span className="ml-2">· {event.timezone}</span>
        </span>
        <h1 className="font-serif text-[2.25rem] leading-tight font-normal mt-2 sm:text-3xl md:text-[2.75rem] lg:text-[3rem]">
          {event.title}
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {event.venue} · {event.city}
        </p>
        <p className="mt-4 max-w-[68ch] text-sm leading-relaxed">{event.description}</p>

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-12 mt-8">
          <div className="min-w-0">
            <StatusSection event={event} />
            {dayGroups.map((group) => (
              <DayGroup key={group.day} day={group.day} sessions={group.sessions} event={event} />
            ))}
          </div>
          <aside className="hidden lg:block pt-12 sticky top-16">
            <StatusSection event={event} />
          </aside>
        </div>
      </div>
    </main>
  );
}
