import { useParams, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { type EventDetail as EventRecord, eventDetails } from "../data/events";
import { PageShell, Eyebrow, Panel } from "../components/page";
import {
  AnimatedBar,
  AnimatedCounter,
  AnimatedUnderline,
  Badge,
  buttonClass,
} from "@connexia/ui/components";

type Tab = "overview" | "schedule" | "venue" | "faq";

const tabs: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "schedule", label: "Schedule" },
  { id: "venue", label: "Venue" },
  { id: "faq", label: "FAQ" },
];

const faq = [
  {
    q: "Do I need to print my pass?",
    a: "No. Your pass lives on this device and is scanned at the gate. Keep the screen awake when you reach the door.",
  },
  {
    q: "What if my credential is not yet bound?",
    a: "Visit any registration desk with your pass open. Staff bind the credential to a wristband and the state updates here.",
  },
  {
    q: "Can I use my pass offline?",
    a: "Yes. Once loaded, the pass stays valid without a connection. Gates reconcile scans when the network returns.",
  },
  {
    q: "Where do I get help at the venue?",
    a: "Approach any staff member in a Connexia-marked vest, or use the nearest registration desk.",
  },
];

function formatDate(event: EventRecord) {
  const date = new Date(event.startsAt);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: event.timezone,
  }).format(date);
}

function formatTime(event: EventRecord) {
  const date = new Date(event.startsAt);
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: event.timezone,
  }).format(date);
}

function timeRange(startsAt: string, endsAt: string) {
  return `${startsAt}–${endsAt}`;
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

function SessionRow({ session, live }: { session: EventRecord["sessions"][number]; live: boolean }) {
  const pct = session.capacity > 0 ? Math.round((session.occupancy / session.capacity) * 100) : 0;

  return (
    <li className="grid gap-2 py-4 sm:grid-cols-[5.5rem_8rem_minmax(0,1fr)] sm:gap-x-5">
      <span className="font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
        {timeRange(session.startsAt, session.endsAt)}
      </span>
      <span className="font-mono text-[0.6875rem] text-muted-foreground sm:justify-self-start">
        {session.room}
      </span>
      <div className="min-w-0">
        <p className="font-serif text-lg leading-snug font-normal">{session.title}</p>
        {live && session.occupancy > 0 ? (
          <div className="mt-2.5 flex items-center gap-3">
            <AnimatedBar
              value={pct}
              tone={barTone(pct)}
              label={`${session.title} occupancy`}
              className="max-w-[12rem]"
            />
            <span
              className={`font-mono text-[0.625rem] tabular-nums ${
                pct >= 100 ? "text-destructive" : pct >= 85 ? "text-warning" : "text-muted-foreground"
              }`}
            >
              {pct}%
            </span>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function DayGroup({ day, sessions, live }: { day: string; sessions: EventRecord["sessions"]; live: boolean }) {
  return (
    <div className="mt-6 first:mt-0">
      <h3 className="mb-2 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-muted-foreground">
        {day}
      </h3>
      <ul className="divide-y divide-border">
        {sessions.map((session) => (
          <SessionRow key={session.id} session={session} live={live} />
        ))}
      </ul>
    </div>
  );
}

function groupByDay(sessions: EventRecord["sessions"]) {
  const groups: Record<string, EventRecord["sessions"]> = {};
  for (const session of sessions) {
    (groups[session.day] ??= []).push(session);
  }
  return Object.entries(groups).map(([day, list]) => ({ day, sessions: list }));
}

function StatusPanel({ event }: { event: EventRecord }) {
  const statusText =
    event.membership === "checked-in"
      ? "Checked in"
      : event.membership === "registered"
        ? "Registered"
        : "Not registered";

  const cta =
    event.closed || event.membership !== "none"
      ? { label: "View your pass", path: "/pass" }
      : { label: "Register", path: `/events/${event.slug}/register` };

  return (
    <Panel className="flex h-full flex-col justify-between gap-6">
      <div>
        <Eyebrow>Your status</Eyebrow>
        <p className="mt-2 font-serif text-2xl leading-tight font-normal">{statusText}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {event.membership === "none"
            ? "Register to receive your pass and wristband."
            : "Your pass is the only credential you need at the door."}
        </p>
      </div>
      <Link to={cta.path} className={buttonClass("primary", "md", "w-full")}>
        {cta.label}
      </Link>
    </Panel>
  );
}

function StatsPanel({ event }: { event: EventRecord }) {
  const live = event.state === "live";
  const pct = live && event.capacity > 0 ? Math.round((event.admitted / event.capacity) * 100) : 0;
  const peak = event.sessions.reduce((max, session) => {
    const value = session.capacity > 0 ? Math.round((session.occupancy / session.capacity) * 100) : 0;
    return Math.max(max, value);
  }, 0);

  const stats = [
    { label: "Admitted", value: live ? event.admitted : null, suffix: "" },
    { label: "Peak session", value: live ? peak : null, suffix: "%" },
    { label: "Sessions", value: event.sessions.length, suffix: "" },
  ];

  return (
    <aside aria-label="Event statistics" className="border border-border">
      <div className="grid grid-cols-3 divide-x divide-border">
        {stats.map((stat) => (
          <div key={stat.label} className="px-4 py-4">
            <p className="font-mono text-[0.5625rem] uppercase tracking-[0.14em] text-muted-foreground">
              {stat.label}
            </p>
            <p className="mt-2 font-mono text-xl tabular-nums text-foreground">
              {stat.value === null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <>
                  <AnimatedCounter value={stat.value} />
                  {stat.suffix}
                </>
              )}
            </p>
          </div>
        ))}
      </div>
      <div className="border-t border-border px-4 py-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <Eyebrow>Occupancy</Eyebrow>
          <Badge tone={live ? occupancyTone(pct) : "neutral"} dot={live}>
            {live ? (pct >= 85 ? "Near capacity" : "Within capacity") : "Not open"}
          </Badge>
        </div>
        <AnimatedBar value={pct} tone={barTone(pct)} label="Event occupancy" />
        <p className="mt-2 font-mono text-[0.625rem] tabular-nums text-muted-foreground">
          {live ? `${pct}% of ${event.capacity.toLocaleString("en-GB")} seats` : `Capacity ${event.capacity.toLocaleString("en-GB")}`}
        </p>
      </div>
    </aside>
  );
}

function TabPanel({ event, tab }: { event: EventRecord; tab: Tab }) {
  if (tab === "schedule") {
    const days = groupByDay(event.sessions);
    return (
      <div>
        {days.map((group) => (
          <DayGroup key={group.day} day={group.day} sessions={group.sessions} live={event.state === "live"} />
        ))}
      </div>
    );
  }

  if (tab === "venue") {
    return (
      <div>
        <dl className="divide-y divide-border border-y border-border">
          {[
            { term: "Venue", value: event.venue },
            { term: "City", value: event.city },
            { term: "Time zone", value: event.timezone },
            { term: "Doors", value: `${formatTime(event)} · ${formatDate(event)}` },
          ].map((row) => (
            <div key={row.term} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4 py-3.5">
              <dt className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-muted-foreground">
                {row.term}
              </dt>
              <dd className="text-sm">{row.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Follow venue signage from the main entrance. Your pass is scanned once at the gate; staff direct
          you from there.
        </p>
      </div>
    );
  }

  if (tab === "faq") {
    return (
      <div className="divide-y divide-border border-y border-border">
        {faq.map((item) => (
          <details key={item.q} className="group py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-serif text-lg leading-snug">
              {item.q}
              <span
                aria-hidden="true"
                className="font-mono text-xs text-muted-foreground transition-transform duration-[180ms] ease-[cubic-bezier(.2,0,0,1)] group-open:rotate-45 motion-reduce:transition-none"
              >
                +
              </span>
            </summary>
            <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">{item.a}</p>
          </details>
        ))}
      </div>
    );
  }

  return (
    <div>
      <p className="max-w-[68ch] text-[0.9375rem] leading-relaxed">{event.description}</p>
      <div className="mt-8 grid gap-px border border-border bg-border sm:grid-cols-2">
        {[
          { term: "Date", value: formatDate(event) },
          { term: "Start", value: `${formatTime(event)} ${event.timezone}` },
          { term: "Venue", value: event.venue },
          { term: "City", value: event.city },
        ].map((fact) => (
          <div key={fact.term} className="bg-background px-5 py-4">
            <Eyebrow>{fact.term}</Eyebrow>
            <p className="mt-1.5 text-sm">{fact.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function EventDetail() {
  const { slug } = useParams<{ slug?: string }>();
  const event = eventDetails.find((entry) => entry.slug === slug);
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    if (event) {
      document.title = `${event.title} · Connexia`;
    }
  }, [event]);

  if (!event) {
    return (
      <PageShell>
        <div className="flex flex-col items-start gap-4 py-24">
          <p className="font-serif text-3xl font-normal">Event not found.</p>
          <Link to="/" className="text-sm underline underline-offset-4">
            Back to events
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <section className="border-b border-border pb-8 md:pb-10">
        <Link
          to="/"
          className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-muted-foreground transition-colors duration-[120ms] ease-[cubic-bezier(.2,0,0,1)] hover:text-foreground motion-reduce:transition-none"
        >
          ← All events
        </Link>

        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-16">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <Eyebrow>
                {formatDate(event)} · {formatTime(event)}
              </Eyebrow>
              {event.state === "live" ? (
                <Badge tone="success" dot pulse>
                  Live
                </Badge>
              ) : (
                <Badge tone="neutral">Upcoming</Badge>
              )}
            </div>
            <h1 className="mt-3 max-w-[20ch] font-serif text-4xl leading-[1.05] font-normal md:text-6xl">
              {event.title}
            </h1>
            <p className="mt-4 text-sm text-muted-foreground">
              {event.venue} · {event.city} · {event.timezone}
            </p>
          </div>

          <StatusPanel event={event} />        </div>
      </section>

      <div className="grid gap-10 py-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-16">
        <div className="min-w-0">
          <div aria-label="Event sections" role="tablist" className="flex flex-wrap gap-7 border-b border-border">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`tab-${item.id}`}
                aria-selected={tab === item.id}
                aria-controls="event-tabpanel"
                onClick={() => setTab(item.id)}
                className={`relative pt-1 pb-3 font-mono text-[0.6875rem] uppercase tracking-[0.12em] transition-colors duration-[120ms] ease-[cubic-bezier(.2,0,0,1)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand motion-reduce:transition-none ${
                  tab === item.id ? "text-brand" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
                <AnimatedUnderline active={tab === item.id} />
              </button>
            ))}
          </div>

          <div
            role="tabpanel"
            id="event-tabpanel"
            aria-labelledby={`tab-${tab}`}
            className="pt-6"
          >
            <TabPanel event={event} tab={tab} />
          </div>
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <StatsPanel event={event} />
        </div>
      </div>
    </PageShell>
  );
}
