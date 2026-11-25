import { useEffect, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { BRAND, pageTitle } from "@synan/ui/brand";
import { Badge, MorphSkeleton, buttonClass } from "@synan/ui/components";
import { COLUMN, PANEL, PageShell } from "../components/page";
import { usePassBarVisible } from "../components/pass-bar";
import { ErrorState, OfflineState, StateBlock } from "../components/states";
import { EventPicture, dateRange, pictureName } from "../components/event-picture";
import { getEventDetail, type EventDetail as EventRecord } from "../data/events";
import { dayKey, formatLongDay, formatTime, zoneLabel } from "../data/format";
import { dataVersion, now } from "../data/live";
import { roomNow, useOccupancy, type OccupancyView } from "../data/occupancy";
import { useResource } from "../data/resource";
import { useSession } from "../data/auth";

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

type Level = "ok" | "warn" | "stop";
const level = (pct: number): Level => (pct >= 100 ? "stop" : pct >= 85 ? "warn" : "ok");
const fill: Record<Level, string> = { ok: "bg-current", warn: "bg-warning", stop: "bg-destructive" };
const words: Record<Level, string> = { ok: "", warn: "text-warning", stop: "text-destructive" };
/** How full, in words first; the figure is secondary. */
const roomWords = (pct: number) => (pct >= 100 ? "Full" : pct >= 85 ? "Nearly full" : pct >= 60 ? "Busy" : "Space");

/** A soft track, no rules: grows with transform, never width. */
function Track({ pct, className = "" }: { pct: number; className?: string }) {
  return (
    <span aria-hidden="true" className={`block h-1 overflow-hidden bg-current/15 ${className}`}>
      <span className={`block h-full origin-left ${fill[level(pct)]}`} style={{ transform: `scaleX(${Math.min(1, pct / 100)})` }} />
    </span>
  );
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

/** What the visitor can do next, from their relation to the event. */
function callToAction(event: EventRecord, signedIn: boolean) {
  // Signed out, we cannot know whether this person registered: offer both doors.
  const membership = signedIn ? event.membership : "none";
  const status = event.closed
    ? "This event has ended"
    : membership === "checked-in"
      ? "You're checked in"
      : membership === "registered"
        ? "You're registered"
        : "Registration is open";
  const line = event.closed
    ? "Registration has closed."
    : membership === "none"
      ? "Register in three short steps and we'll email your pass. You collect a wristband when you arrive."
      : "Your pass is all you need at the entrance.";
  const cta =
    membership !== "none"
      ? { label: "View your pass", path: "/pass" }
      : event.closed
        ? { label: "Browse other events", path: "/" }
        : { label: "Register", path: `/events/${event.slug}/register` };
  return { membership, status, line, cta };
}

/** The rooms of the event with a live count, from its sessions. */
function liveRooms(event: EventRecord, view: OccupancyView | null) {
  const rooms = new Map<string, string>();
  for (const session of event.sessions) rooms.set(session.roomId, session.room);
  return [...rooms].flatMap(([id, name]) => {
    const room = roomNow(view, id);
    if (room.kind === "closed") return [];
    const pct = room.kind === "count" && room.capacity > 0 ? Math.round((room.occupancy / room.capacity) * 100) : null;
    return [{ id, name, pct }];
  });
}

/** The small "rooms now" panel: words, a soft bar, the percentage quiet beside it. */
function RoomsNow({ rooms, onSite, glass }: { rooms: ReturnType<typeof liveRooms>; onSite: number | null; glass: boolean }) {
  return (
    <aside
      aria-label="Rooms now"
      className={glass ? "absolute right-6 bottom-6 hidden w-75 bg-glass p-5 text-glass-ink backdrop-blur-xl lg:block" : `${PANEL} p-5 lg:hidden`}
    >
      <p className="flex items-center justify-between">
        <span className="eyebrow-mono text-inherit">Rooms now</span>
        {onSite !== null ? (
          <span className="flex items-center gap-1.5 font-mono text-13 text-success">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
            {onSite.toLocaleString("en-GB")}
            <span className="sr-only"> people here now</span>
          </span>
        ) : null}
      </p>
      <ul className="mt-3 flex flex-col gap-4">
        {rooms.map((room) => (
          <li key={room.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5">
            <span className="truncate text-17 font-medium">{room.name}</span>
            <span className={`text-15 ${room.pct === null ? (glass ? "text-glass-ink-2" : "text-muted-foreground") : words[level(room.pct)]}`}>
              {room.pct === null ? "Open" : roomWords(room.pct)}
            </span>
            {room.pct !== null ? (
              <>
                <Track pct={room.pct} />
                <span className={`font-mono text-13 ${glass ? "text-glass-ink-2" : "text-muted-foreground"}`}>{room.pct}%</span>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** A section below the picture: a mono capital eyebrow, then the content, apart by space. */
function Part({ id, eyebrow, title, children, className = "" }: { id: string; eyebrow: string; title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`mt-24 scroll-mt-24 outline-none md:mt-32 ${className}`}>
      <p className="eyebrow-mono">{eyebrow}</p>
      <h2 id={`${id}-title`} className="type-title mt-3 mb-8">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** The programme as rhythm: rows held apart by space, the session on now lifted on a tonal step. */
function Programme({ event, occupancy }: { event: EventRecord; occupancy: OccupancyView | null }) {
  const live = event.state === "live";
  const at = now();
  const days = new Map<string, EventRecord["sessions"]>();
  for (const session of event.sessions) {
    const key = dayKey(session.startsIso, event.timezone);
    days.set(key, [...(days.get(key) ?? []), session]);
  }
  return (
    <div className="flex flex-col gap-12">
      {[...days.entries()].map(([key, sessions]) => (
        <div key={key}>
          <h3 className="mb-3 text-15 text-muted-foreground">{formatLongDay(sessions[0]!.startsIso, event.timezone)}</h3>
          <ul className="-mx-4 flex flex-col gap-1">
            {sessions.map((session) => {
              const onNow = live && Date.parse(session.startsIso) <= at && at < Date.parse(session.endsIso);
              const room = roomNow(occupancy, session.roomId);
              const pct = room.kind === "count" && room.capacity > 0 ? Math.round((room.occupancy / room.capacity) * 100) : null;
              return (
                <li
                  key={session.id}
                  id={`session-${session.id}`}
                  className={`grid scroll-mt-24 grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-4 outline-none focus:bg-surface-2 sm:grid-cols-[6rem_minmax(0,1fr)_auto] sm:gap-x-8 ${onNow ? "bg-surface" : ""}`}
                >
                  <span className="font-mono text-15">
                    {session.startsAt}
                    <span className="block text-13 text-muted-foreground">–{session.endsAt}</span>
                  </span>
                  <span className="min-w-0">
                    <span className="block text-17 font-medium">{session.title}</span>
                    <span className="mt-0.5 block text-15 text-muted-foreground">{session.room}</span>
                  </span>
                  {onNow || (live && pct !== null && pct >= 85) ? (
                    <span className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:self-center">
                      {onNow ? (
                        <Badge tone="success" dot>
                          On now
                        </Badge>
                      ) : null}
                      {pct !== null && pct >= 85 ? (
                        <Badge tone={pct >= 100 ? "destructive" : "warning"}>
                          {roomWords(pct)} · <span className="font-mono">{Math.min(pct, 100)}%</span>
                        </Badge>
                      ) : null}
                    </span>
                  ) : null}
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
    <div aria-busy="true" aria-label="Loading" className={`${COLUMN} flex flex-col items-center gap-5 py-24`}>
      <MorphSkeleton width="12rem" />
      <MorphSkeleton width="60%" height="4rem" />
      <MorphSkeleton variant="block" height="16rem" className="mt-8" />
    </div>
  );
}

export default function EventDetail() {
  const { slug } = useParams<{ slug?: string }>();
  const session = useSession();
  // On a phone the My pass bar sits at the foot of the screen: the key facts stand clear of it.
  const passBar = usePassBarVisible();
  const resource = useResource(`event:${slug}:${dataVersion()}`, () => getEventDetail(slug));
  const ready = resource.status === "ready" && resource.data !== null;
  useHashLanding(ready);

  const event = resource.status === "ready" ? resource.data : null;
  // Polled while the page is open and visible, signed in or not.
  const occupancy = useOccupancy(event ? [event.id] : []);
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
            <Link to="/" className={buttonClass("secondary", "md")}>
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
  const view = occupancy(event.id);
  // People on site: the live poll's figure, else the event page's own; null when withheld (too few to show).
  const onSite = view ? view.onSite : event.admittedShown ? event.admitted : null;
  const pct = live && onSite !== null && event.capacity > 0 ? Math.round((onSite / event.capacity) * 100) : null;
  const rooms = live ? liveRooms(event, view) : [];
  const { membership, status, line, cta } = callToAction(event, session !== null);
  const photo = event.image !== null;
  const [lead, ...rest] = event.description.split(/(?<=\.)\s+/);
  const hours = `${formatTime(event.startsAt, event.timezone)}–${formatTime(event.endsAt, event.timezone)}`;
  // The name runs from 64px to 184px with the width of the screen, smaller for a long name.
  const nameSize = `clamp(4rem, ${Math.min(11.5, 170 / event.title.length).toFixed(2)}vw, 11.5rem)`;

  return (
    <PageShell
      bleed
      over
      onPhoto={photo}
      action={
        <Link to={cta.path} className={buttonClass("primary", "sm", "text-15")}>
          {cta.label}
        </Link>
      }
    >
      <section aria-labelledby="event-title" className="relative h-svh min-h-160">
        <div className="absolute inset-0" style={{ viewTransitionName: pictureName(event.slug) }}>
          <EventPicture event={event} big>
            {photo ? <div aria-hidden="true" className="absolute inset-0 bg-linear-to-b from-qr-ink/55 via-transparent to-qr-ink/45" /> : null}
          </EventPicture>
        </div>

        <div className={`absolute inset-x-0 top-[22%] px-5 text-center md:top-[26%] ${photo ? "text-qr-field" : ""}`}>
          <p className={`eyebrow-mono ${photo ? "text-inherit" : ""}`}>
            {dateRange(event)} · {event.venue}
          </p>
          <h1 id="event-title" className="type-event-name mx-auto mt-4 max-w-[12em] wrap-break-word" style={{ fontSize: nameSize }}>
            {event.title}
          </h1>
        </div>

        <Link
          to="/"
          viewTransition
          className="absolute top-20 left-5 inline-flex min-h-11 items-center gap-2 bg-glass px-4 text-15 font-medium text-glass-ink backdrop-blur-xl md:top-22 md:left-8"
        >
          <span aria-hidden="true">←</span> All events
        </Link>

        <article
          aria-label="Key facts"
          className={`absolute inset-x-3 ${passBar ? "bottom-19 md:bottom-6" : "bottom-3 sm:bottom-6"} flex flex-col items-start gap-4 bg-glass p-5 text-glass-ink backdrop-blur-xl sm:inset-x-auto sm:left-6 sm:w-100 sm:p-6`}
        >
          {live ? (
            <Badge tone="success" dot pulse>
              Live now
            </Badge>
          ) : (
            <Badge>{event.closed ? "Ended" : "Upcoming"}</Badge>
          )}
          <dl className="grid w-full grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2.5 text-17">
            <dt className="font-mono text-12 tracking-[0.08em] text-glass-ink-2 uppercase">When</dt>
            <dd>
              {dateRange(event)} <span className="font-mono text-15 text-glass-ink-2">· {hours}</span>
            </dd>
            <dt className="font-mono text-12 tracking-[0.08em] text-glass-ink-2 uppercase">Where</dt>
            <dd>
              {event.venue}
              <span className="text-glass-ink-2">, {event.city}</span>
            </dd>
            {membership !== "none" || event.closed ? (
              <>
                <dt className="font-mono text-12 tracking-[0.08em] text-glass-ink-2 uppercase">You</dt>
                <dd>{status}</dd>
              </>
            ) : null}
          </dl>
          {pct !== null && onSite !== null ? (
            <div className="w-full">
              <p className="mb-2 flex items-baseline justify-between gap-4">
                <span className={`text-17 font-medium ${words[level(pct)]}`}>{pct >= 85 ? roomWords(pct) : pct >= 60 ? "Busy right now" : "Room to move"}</span>
                <span className="text-13 text-glass-ink-2">
                  <span className="font-mono">{onSite.toLocaleString("en-GB")}</span> here now
                </span>
              </p>
              <Track pct={pct} />
            </div>
          ) : null}
          <Link to={cta.path} className={buttonClass("primary", "md", "min-h-13 w-full text-17")}>
            {cta.label} <span aria-hidden="true">→</span>
          </Link>
          <p className="-mt-1 text-13 text-glass-ink-2">
            {line}
            {session === null && !event.closed ? (
              <>
                {" "}
                Already registered?{" "}
                <Link to={`/sign-in?next=${encodeURIComponent("/pass")}`} className="text-glass-ink underline underline-offset-4 hover:text-brand">
                  Sign in to see your pass
                </Link>
              </>
            ) : null}
          </p>
        </article>

        {rooms.length > 0 ? <RoomsNow rooms={rooms} onSite={onSite} glass /> : null}
      </section>

      <div className={COLUMN}>
        {rooms.length > 0 ? (
          <div className="mt-12">
            <RoomsNow rooms={rooms} onSite={onSite} glass={false} />
          </div>
        ) : null}

        <Part id="overview" eyebrow="About" title={lead} className="[&_h2]:max-w-[18em]">
          {rest.length > 0 ? <p className="max-w-[60ch] text-17 leading-relaxed text-muted-foreground">{rest.join(" ")}</p> : null}
        </Part>

        <Part id="schedule" eyebrow="Programme" title={live ? "Today's programme" : "Programme"}>
          <p className="-mt-4 mb-8 text-15 text-muted-foreground">All times are {zoneLabel(event.timezone, event.startsAt)}.</p>
          <Programme event={event} occupancy={view} />
        </Part>

        <Part id="venue" eyebrow="Where" title={event.venue}>
          <dl className="grid max-w-xl grid-cols-[8rem_minmax(0,1fr)] gap-x-6 gap-y-3 text-17">
            <dt className="text-muted-foreground">City</dt>
            <dd>{event.city}</dd>
            <dt className="text-muted-foreground">Local time</dt>
            <dd>{zoneLabel(event.timezone, event.startsAt)}</dd>
            <dt className="text-muted-foreground">Doors</dt>
            <dd>
              <span className="font-mono">{formatTime(event.startsAt, event.timezone)}</span>, {formatLongDay(event.startsAt, event.timezone)}
            </dd>
          </dl>
          <p className="mt-6 max-w-[60ch] text-15 leading-relaxed text-muted-foreground">
            Follow the signs from the main entrance. Show your pass at the entrance; staff will direct you from there.
          </p>
        </Part>

        <Part id="faq" eyebrow="Help" title="Questions">
          <div className="flex max-w-3xl flex-col gap-2">
            {faq.map((item) => (
              <details key={item.q} className={`group ${PANEL}`}>
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 text-17">
                  {item.q}
                  <span aria-hidden="true" className="text-muted-foreground transition-transform duration-180 ease-standard group-open:rotate-45 motion-reduce:transition-none">
                    +
                  </span>
                </summary>
                <p className="fade-in max-w-[62ch] px-5 pb-5 text-15 leading-relaxed text-muted-foreground">{item.a}</p>
              </details>
            ))}
          </div>
        </Part>
      </div>
    </PageShell>
  );
}
