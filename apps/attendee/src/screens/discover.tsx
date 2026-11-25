import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { pageTitle } from "@synan/ui/brand";
import { Badge, buttonClass } from "@synan/ui/components";
import { PageHeader, PageShell } from "../components/page";
import { ErrorState, OfflineState, SkeletonCells, StateBlock } from "../components/states";
import { EventPicture, dateRange, pictureName } from "../components/event-picture";
import { chipClass } from "../components/form-styles";
import { getEvents, type EventSummary } from "../data/events";
import { relativeDays } from "../data/format";
import { now } from "../data/live";
import { useResource } from "../data/resource";

type Filter = "all" | "live" | "upcoming";

// "Near me" is left out until the owner decides how proximity works.
const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "upcoming", label: "Upcoming" },
];

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const word = (count: number) => WORDS[count] ?? String(count);

/** The showcase statement (D-37): what is on now, then what is coming, in words. */
function statement(live: number, upcoming: number): { title: string; more: string } {
  const coming = upcoming === 1 ? "One more event is coming up." : `${word(upcoming)} more events are coming up.`;
  if (live > 0) {
    return { title: live === 1 ? "One event is on right now." : `${word(live)} events are on right now.`, more: upcoming > 0 ? coming : "Nothing else is scheduled yet." };
  }
  if (upcoming > 0) return { title: "Nothing is on right now.", more: upcoming === 1 ? "One event is coming up." : `${word(upcoming)} events are coming up.` };
  return { title: "No events yet.", more: "New events appear here as soon as organisers publish them." };
}

function greeting(at: number): string {
  const hour = new Date(at).getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return `${part} · ${new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date(at))}`;
}

/** An event as its picture, with its name, place and date set under it on the ground: no card frame. */
export function EventCard({ event, index }: { event: EventSummary; index: number }) {
  const live = event.state === "live";
  return (
    <li className="enter" style={{ ["--i" as string]: index }}>
      <Link to={`/events/${event.slug}`} viewTransition className="group flex flex-col gap-4">
        <div className="aspect-16/10 overflow-hidden" style={{ viewTransitionName: pictureName(event.slug) }}>
          <div className="size-full transition-transform duration-600 ease-standard group-hover:scale-[1.02] motion-reduce:transition-none">
            <EventPicture event={event} />
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 px-1">
          {live ? (
            <Badge tone="success" dot>
              Live now
            </Badge>
          ) : (
            <Badge>{event.state === "closed" ? "Ended" : `Opens ${relativeDays(event.startsAt, now())}`}</Badge>
          )}
          <h3 className="font-display text-21 leading-tight font-medium underline-offset-4 group-hover:underline">{event.title}</h3>
          <p className="text-15 text-muted-foreground">
            {event.venue} · {dateRange(event)}
            {live && event.admittedShown ? (
              <>
                {" · "}
                <span className="font-mono">{event.admitted.toLocaleString("en-GB")}</span> here now
              </>
            ) : null}
          </p>
        </div>
      </Link>
    </li>
  );
}

function Shelf({ id, title, events, wide = false }: { id: string; title: string; events: EventSummary[]; wide?: boolean }) {
  if (events.length === 0) return null;
  return (
    <section aria-labelledby={id} className="mt-20 md:mt-28">
      <h2 id={id} className="mb-8 font-display text-21 font-medium">
        {title}
      </h2>
      <ul className={`grid gap-x-6 gap-y-12 sm:grid-cols-2 ${wide ? "" : "lg:grid-cols-3"}`}>
        {events.map((event, index) => (
          <EventCard key={event.slug} event={event} index={index} />
        ))}
      </ul>
    </section>
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
  const live = all.filter((event) => event.state === "live");
  const upcoming = all.filter((event) => event.state === "upcoming");
  const counts: Record<Filter, number> = { all: all.length, live: live.length, upcoming: upcoming.length };
  const words = statement(live.length, upcoming.length);
  const shown = filter === "all" ? all.length : counts[filter];

  return (
    <PageShell>
      <PageHeader
        hero
        label={
          <>
            {live.length > 0 ? <span aria-hidden="true" className="mr-2 inline-block size-2 rounded-full bg-success" /> : null}
            {greeting(now())}
          </>
        }
        title={words.title}
        more={words.more}
      />

      {all.length > 0 ? (
        <div role="group" aria-label="Filter events" className="mt-10 flex flex-wrap justify-center gap-2">
          {filters.map(({ id, label }) => (
            <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} className={chipClass}>
              {label}
              <span className="font-mono text-13 opacity-70">{counts[id]}</span>
            </button>
          ))}
        </div>
      ) : null}

      {shown > 0 ? (
        <div key={filter}>
          {filter !== "upcoming" ? <Shelf id="on-now" title="On now" events={live} wide /> : null}
          {filter !== "live" ? <Shelf id="coming-up" title="Coming up" events={upcoming} /> : null}
          {filter === "all" ? <Shelf id="other" title="Other events" events={all.filter((event) => event.state === "closed")} /> : null}
        </div>
      ) : all.length > 0 ? (
        <StateBlock
          glyph="·"
          title={filter === "live" ? "Nothing is live right now." : "No upcoming events yet."}
          action={
            <button type="button" onClick={() => setFilter("all")} className={buttonClass("secondary", "md")}>
              Show all events
            </button>
          }
        >
          New events appear here as soon as organisers publish them.
        </StateBlock>
      ) : null}
    </PageShell>
  );
}
