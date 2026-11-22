import { useParams, Link } from "react-router-dom";
import { type EventDetail, eventDetails } from "../data/events";

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
    <li className="grid grid-cols-[6rem_4rem_1fr_8rem] gap-x-5 px-6 py-4 md:px-10">
      <span className="text-muted-foreground font-mono text-[0.6875rem] tabular-nums">
        {timeRange(session.startsAt, session.endsAt)}
      </span>
      <span className="text-muted-foreground font-mono text-[0.6875rem] tabular-nums">
        {session.room}
      </span>
      <span className="min-w-0 truncate font-serif text-lg leading-tight font-normal">
        {session.title}
      </span>
      {event.state === "live" && session.occupancy > 0 ? (
        <span className="justify-self-end">
          <OccupancyChip occupancy={session.occupancy} capacity={session.capacity} />
        </span>
      ) : null}
    </li>
  );
}

function MobileStatus({ event }: { event: EventDetail }) {
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
    <div className="flex flex-col gap-2 border-border border-t pt-4 sm:hidden">
      <p className="text-muted-foreground font-mono text-[0.625rem] tracking-[0.12em] uppercase">
        Your status
      </p>
      <p className="font-serif text-xl leading-tight font-normal">{statusText}</p>
      <Link
        to={ctaPath}
        className="border-border hover:border-foreground w-fit border px-4 py-2 font-mono text-[0.6875rem] tracking-[0.12em] uppercase transition-colors"
      >
        {ctaText}
      </Link>
    </div>
  );
}

function RailStatus({ event }: { event: EventDetail }) {
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
    <div className="w-64 flex-shrink-0 border-border border-l pl-8 py-8">
      <p className="text-muted-foreground mb-1 font-mono text-[0.625rem] tracking-[0.12em] uppercase">
        Your status
      </p>
      <p className="font-serif text-xl leading-tight font-normal">{statusText}</p>
      <Link
        to={ctaPath}
        className="border-border hover:border-foreground mt-4 inline-block border px-4 py-2 font-mono text-[0.6875rem] tracking-[0.12em] uppercase transition-colors"
      >
        {ctaText}
      </Link>
    </div>
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

export default function EventDetail() {
  const { slug } = useParams<{ slug?: string }>();
  const event = eventDetails.find((e) => e.slug === slug);

  if (!event) {
    return (
      <main className="bg-background text-foreground flex min-h-dvh flex-col">
        <header className="border-border border-b px-6 py-4 md:px-10">
          <Link to="/" aria-label="Connexia home">
            <span className="font-serif text-lg leading-tight font-normal">Events</span>
          </Link>
        </header>
        <div className="flex flex-1 flex-col items-start justify-center gap-4 px-6 md:px-10">
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
    <main className="bg-background text-foreground min-h-dvh pb-24">
      <header className="border-border border-b">
        <div className="mx-auto max-w-4xl px-6 pt-10 pb-8 md:px-10">
          <Link to="/" className="text-muted-foreground mb-4 block font-mono text-[0.625rem] tracking-[0.12em] uppercase hover:text-foreground">
            All events
          </Link>
          <span className="text-muted-foreground font-mono text-[0.6875rem] tabular-nums tracking-[0.08em] uppercase">
            {formatDate(event)}
            <span className="ml-2">· {event.timezone}</span>
          </span>
          <h1 className="font-serif text-[2.25rem] leading-tight font-normal mt-2 sm:text-3xl md:text-[2.75rem]">
            {event.title}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {event.venue} · {event.city}
          </p>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed">{event.description}</p>
        </div>
      </header>

      <div className="border-border border-b" />

      <div className="mx-auto max-w-4xl flex gap-8">
        <div className="flex-1 min-w-0">
          <MobileStatus event={event} />

          <div className="mt-4">
            {dayGroups.map((group) => (
              <DayGroup key={group.day} day={group.day} sessions={group.sessions} event={event} />
            ))}
          </div>
        </div>
        <div className="hidden lg:block">
          <RailStatus event={event} />
        </div>
      </div>

      <div className="border-border bg-background/95 fixed inset-x-0 bottom-0 border-t backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-3 md:px-10">
          <span className="text-muted-foreground font-mono text-[0.625rem] tracking-[0.12em] uppercase">
            {formatDate(event)}
          </span>
          <Link
            to="/pass"
            className="border-border hover:border-foreground border px-4 py-2 font-mono text-[0.6875rem] tracking-[0.12em] uppercase transition-colors"
          >
            My pass
          </Link>
        </div>
      </div>
    </main>
  );
}
