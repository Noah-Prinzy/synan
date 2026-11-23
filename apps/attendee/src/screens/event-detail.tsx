import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { BRAND, pageTitle } from "@synan/ui/brand";
import { AnimatedBar, Badge, buttonClass } from "@synan/ui/components";
import { PageShell } from "../components/page";
import { ErrorState, OfflineState, StateBlock } from "../components/states";
import { getEventDetail, type EventDetail as EventRecord } from "../data/events";
import { dayKey, formatLongDay, formatTime, zoneLabel } from "../data/format";
import { portal, useResource } from "../data/mock";
import { MorphSkeleton } from "@synan/ui/components";

const sections = [
  { id: "overview", label: "Overview" },
  { id: "schedule", label: "Schedule" },
  { id: "venue", label: "Venue" },
  { id: "faq", label: "Questions" },
] as const;

type SectionId = (typeof sections)[number]["id"];

const faq = [
  {
    q: "Do I need to print my pass?",
    a: "No. Your pass lives on your phone. Show it at the entrance to collect your wristband; from then on the wristband opens every door.",
  },
  {
    q: "What if I don't have a wristband yet?",
    a: "Go to any registration desk with your pass open. Staff bind a wristband to you and your pass updates straight away.",
  },
  {
    q: "Can I use my pass offline?",
    a: "Yes. Once it has loaded, the pass keeps working without a connection.",
  },
  {
    q: "Where do I get help at the venue?",
    a: `Ask anyone wearing a ${BRAND.name} lanyard, or go to the nearest registration desk.`,
  },
];

function barTone(pct: number): "neutral" | "warning" | "destructive" {
  if (pct >= 100) return "destructive";
  if (pct >= 85) return "warning";
  return "neutral";
}

/** Which section is in view: the last one whose top has passed under the sticky header (scroll-spy). */
function useActiveSection(ready: boolean): SectionId {
  const [active, setActive] = useState<SectionId>("overview");
  useEffect(() => {
    if (!ready) return;
    const measure = () => {
      const line = 140;
      let current: SectionId = sections[0].id;
      for (const section of sections) {
        const node = document.getElementById(section.id);
        if (node && node.getBoundingClientRect().top <= line) current = section.id;
      }
      // At the very bottom, the last section is current even if it is short.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) current = sections[sections.length - 1]!.id;
      setActive(current);
    };
    // Scroll events already arrive once per frame; four rect reads per event are cheap.
    const onScroll = () => measure();
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [ready]);
  return active;
}

/** Land on `#session-…` and `#schedule` links (React Router does not scroll to hashes). */
function useHashLanding(ready: boolean) {
  const { hash } = useLocation();
  useEffect(() => {
    if (!ready || !hash) return;
    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!target) return;
    target.scrollIntoView({ block: "start" });
    if (target.tabIndex < 0) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }, [ready, hash]);
}

function StatusCell({ event }: { event: EventRecord }) {
  const statusText =
    event.membership === "checked-in" ? "You're checked in" : event.membership === "registered" ? "You're registered" : "Not registered yet";
  const cta =
    event.closed || event.membership !== "none"
      ? { label: "View your pass", path: "/pass" }
      : { label: "Register", path: `/events/${event.slug}/register` };
  return (
    <div className="flex flex-col justify-between gap-6 px-4 py-8 sm:px-6 md:px-8">
      <div>
        <p className="text-13 font-medium text-muted-foreground">Your status</p>
        <p className="mt-2 font-display text-28 leading-tight">{statusText}</p>
        <p className="mt-2 text-15 text-muted-foreground">
          {event.membership === "none"
            ? "Register to receive your pass. You'll collect a wristband when you arrive."
            : "Your pass is all you need at the entrance."}
        </p>
      </div>
      <Link to={cta.path} className={buttonClass("primary", "md", "w-full")}>
        {cta.label}
      </Link>
    </div>
  );
}

function SessionList({ event }: { event: EventRecord }) {
  const live = event.state === "live";
  const days = new Map<string, EventRecord["sessions"]>();
  for (const session of event.sessions) {
    const key = dayKey(session.startsIso, event.timezone);
    days.set(key, [...(days.get(key) ?? []), session]);
  }
  return (
    <div className="flex flex-col gap-10">
      {[...days.entries()].map(([key, sessions]) => (
        <div key={key}>
          <h3 className="border-b border-border pb-3 font-display text-21">
            {formatLongDay(sessions[0]!.startsIso, event.timezone)}
          </h3>
          <ul>
            {sessions.map((session) => {
              const pct = session.capacity > 0 ? Math.round((session.occupancy / session.capacity) * 100) : 0;
              return (
                <li
                  key={session.id}
                  id={`session-${session.id}`}
                  className="grid scroll-mt-24 gap-1 border-b border-border py-4 outline-none focus:bg-card/40 sm:grid-cols-[7.5rem_minmax(0,1fr)_9rem] sm:gap-6"
                >
                  <span className="font-mono text-15 text-muted-foreground">
                    {session.startsAt}–{session.endsAt}
                  </span>
                  <div className="min-w-0">
                    <p className="text-17">{session.title}</p>
                    <p className="mt-1 text-15 text-muted-foreground">{session.room}</p>
                  </div>
                  {live && session.occupancy > 0 ? (
                    <div className="self-center">
                      <div className="mb-1.5 flex justify-between text-13 text-muted-foreground">
                        <span>Room</span>
                        <span className={`font-mono ${pct >= 100 ? "text-destructive" : pct >= 85 ? "text-warning" : ""}`}>{pct}%</span>
                      </div>
                      <AnimatedBar value={pct} tone={barTone(pct)} label={`${session.room}: ${pct}% full`} />
                    </div>
                  ) : (
                    <span />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-5 px-4 py-16 sm:px-6 md:px-8">
      <MorphSkeleton width="8rem" />
      <MorphSkeleton width="60%" height="3rem" />
      <MorphSkeleton width="40%" />
      <MorphSkeleton variant="block" height="12rem" className="mt-8" />
    </div>
  );
}

export default function EventDetail() {
  const { slug } = useParams<{ slug?: string }>();
  const resource = useResource(`event:${slug}:${portal.version()}`, () => getEventDetail(slug) ?? null);
  const ready = resource.status === "ready" && resource.data !== null;
  const active = useActiveSection(ready);
  useHashLanding(ready);

  const event = resource.status === "ready" ? resource.data : null;
  useEffect(() => {
    document.title = pageTitle(event?.title ?? "Event");
  }, [event]);

  if (resource.status !== "ready") {
    return (
      <PageShell bleed>
        {resource.status === "loading" ? (
          <DetailSkeleton />
        ) : resource.status === "offline" ? (
          <OfflineState what="This event" onRetry={resource.retry} />
        ) : (
          <ErrorState what="this event" onRetry={resource.retry} />
        )}
      </PageShell>
    );
  }

  if (!event) {
    return (
      <PageShell bleed>
        <StateBlock
          glyph="·"
          title="We can't find that event."
          action={
            <Link to="/" className={buttonClass("secondary", "sm")}>
              Browse events
            </Link>
          }
        >
          It may have ended, or the link may be mistyped.
        </StateBlock>
      </PageShell>
    );
  }

  const live = event.state === "live";
  const pct = live && event.capacity > 0 ? Math.round((event.admitted / event.capacity) * 100) : 0;

  return (
    <PageShell bleed>
      <section className="grid border-b border-border lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="px-4 py-10 sm:px-6 md:px-8 md:py-16">
          <Link to="/" className="inline-flex min-h-11 items-center text-15 text-muted-foreground hover:text-foreground">
            ← All events
          </Link>
          <div className="enter mt-6 flex flex-wrap items-center gap-3">
            {live ? (
              <Badge tone="success" dot pulse>
                Live now
              </Badge>
            ) : event.closed ? (
              <Badge tone="neutral">Ended</Badge>
            ) : (
              <Badge tone="neutral">Upcoming</Badge>
            )}
          </div>
          <h1 className="enter mt-4 max-w-[18ch] font-display text-40 leading-[1.05] md:text-56" style={{ ["--i" as string]: 1 }}>
            {event.title}
          </h1>
          <p className="enter mt-5 text-17 text-muted-foreground" style={{ ["--i" as string]: 2 }}>
            {formatLongDay(event.startsAt, event.timezone)} · <span className="font-mono">{formatTime(event.startsAt, event.timezone)}</span>{" "}
            {zoneLabel(event.timezone, event.startsAt)}
          </p>
          <p className="enter text-17 text-muted-foreground" style={{ ["--i" as string]: 3 }}>
            {event.venue}, {event.city}
          </p>
        </div>
        <div className="border-t border-border lg:border-t-0 lg:border-l">
          <StatusCell event={event} />
        </div>
      </section>

      <div className="grid md:grid-cols-[14rem_minmax(0,1fr)]">
        {/* The rail: sticky, scroll-spied. On phones it becomes a sticky row of cells. */}
        <nav
          aria-label="On this page"
          className="sticky top-14 z-20 border-b border-border bg-background md:top-16 md:self-start md:border-r md:border-b-0"
        >
          <ul className="flex overflow-x-auto md:flex-col scrollbar-none">
            {sections.map((section) => (
              <li key={section.id} className="shrink-0 border-r border-border md:border-r-0 md:border-b">
                <a
                  href={`#${section.id}`}
                  aria-current={active === section.id ? "location" : undefined}
                  onClick={(clickEvent) => {
                    clickEvent.preventDefault();
                    document.getElementById(section.id)?.scrollIntoView({ block: "start" });
                    history.replaceState(null, "", `#${section.id}`);
                  }}
                  className={`relative flex min-h-12 items-center justify-between gap-3 px-4 text-15 transition-colors duration-120 ease-standard motion-reduce:transition-none md:px-6 ${
                    active === section.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {section.label}
                  <span
                    aria-hidden="true"
                    className={`absolute bottom-0 left-0 h-px w-full origin-left bg-brand transition-transform duration-180 ease-standard motion-reduce:transition-none md:top-0 md:h-full md:w-px md:origin-top ${
                      active === section.id ? "scale-100" : "scale-x-0 md:scale-x-100 md:scale-y-0"
                    }`}
                  />
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0">
          <section id="overview" aria-labelledby="overview-title" className="scroll-mt-28 border-b border-border px-4 py-10 outline-none sm:px-6 md:px-10">
            <h2 id="overview-title" className="font-display text-28">Overview</h2>
            <p className="mt-4 max-w-[62ch] text-17 leading-relaxed">{event.description}</p>
            <dl className="mt-8 grid grid-cols-2 border-t border-l border-border md:grid-cols-3">
              <div className="border-r border-b border-border p-4">
                <dt className="text-13 text-muted-foreground">Sessions</dt>
                <dd className="mt-1 font-mono text-21">{event.sessions.length}</dd>
              </div>
              <div className="border-r border-b border-border p-4">
                <dt className="text-13 text-muted-foreground">Capacity</dt>
                <dd className="mt-1 font-mono text-21">{event.capacity.toLocaleString("en-GB")}</dd>
              </div>
              <div className="col-span-2 border-r border-b border-border p-4 md:col-span-1">
                <dt className="text-13 text-muted-foreground">{live ? "Here now" : "Doors"}</dt>
                <dd className="mt-1">
                  {live ? (
                    <>
                      <span className="font-mono text-21">{event.admitted.toLocaleString("en-GB")}</span>
                      <AnimatedBar value={pct} tone={barTone(pct)} label={`${pct}% of capacity`} className="mt-2" />
                    </>
                  ) : (
                    <span className="font-mono text-21">{formatTime(event.startsAt, event.timezone)}</span>
                  )}
                </dd>
              </div>
            </dl>
          </section>

          <section id="schedule" aria-labelledby="schedule-title" className="scroll-mt-28 border-b border-border px-4 py-10 outline-none sm:px-6 md:px-10">
            <h2 id="schedule-title" className="font-display text-28">Schedule</h2>
            <p className="mt-2 text-15 text-muted-foreground">All times are {zoneLabel(event.timezone, event.startsAt)}.</p>
            <div className="mt-8">
              <SessionList event={event} />
            </div>
          </section>

          <section id="venue" aria-labelledby="venue-title" className="scroll-mt-28 border-b border-border px-4 py-10 outline-none sm:px-6 md:px-10">
            <h2 id="venue-title" className="font-display text-28">Venue</h2>
            <dl className="mt-6 border-t border-border">
              {[
                { term: "Venue", value: event.venue },
                { term: "City", value: event.city },
                { term: "Local time", value: zoneLabel(event.timezone, event.startsAt) },
                { term: "Doors", value: `${formatTime(event.startsAt, event.timezone)}, ${formatLongDay(event.startsAt, event.timezone)}` },
              ].map((row) => (
                <div key={row.term} className="grid grid-cols-[8rem_minmax(0,1fr)] gap-4 border-b border-border py-3.5">
                  <dt className="text-15 text-muted-foreground">{row.term}</dt>
                  <dd className="text-17">{row.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 max-w-[62ch] text-15 leading-relaxed text-muted-foreground">
              Follow the signs from the main entrance. Show your pass at the entrance; staff will direct you from there.
            </p>
          </section>

          <section id="faq" aria-labelledby="faq-title" className="scroll-mt-28 px-4 py-10 outline-none sm:px-6 md:px-10">
            <h2 id="faq-title" className="font-display text-28">Questions</h2>
            <div className="mt-6 border-t border-border">
              {faq.map((item) => (
                <details key={item.q} className="group border-b border-border">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 text-17">
                    {item.q}
                    <span
                      aria-hidden="true"
                      className="text-muted-foreground transition-transform duration-180 ease-standard group-open:rotate-45 motion-reduce:transition-none"
                    >
                      +
                    </span>
                  </summary>
                  <p className="fade-in pb-5 max-w-[62ch] text-15 leading-relaxed text-muted-foreground">{item.a}</p>
                </details>
              ))}
            </div>
          </section>
        </div>
      </div>
    </PageShell>
  );
}
