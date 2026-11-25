import { useEffect } from "react";
import { Link } from "react-router-dom";
import { pageTitle } from "@synan/ui/brand";
import { buttonClass } from "@synan/ui/components";
import { loadAgenda, getSpaceLeft, type AgendaGroupItem, type AgendaSession } from "../data/agenda";
import { dayKey, formatLongDay, formatTime } from "../data/format";
import { now } from "../data/live";
import { roomNow, useOccupancy, type OccupancyView } from "../data/occupancy";
import { useResource } from "../data/resource";
import { PANEL, PageHeader, PageShell } from "../components/page";
import { ErrorState, OfflineState, SkeletonCells, StateBlock } from "../components/states";

const groupLabel: Record<AgendaGroupItem["group"], string> = {
  NOW: "Now",
  NEXT: "Next",
  LATER: "Later",
  EARLIER: "Earlier",
};

export default function Agenda() {
  useEffect(() => {
    document.title = pageTitle("Agenda");
  }, []);

  const agenda = useResource("agenda", loadAgenda);
  // Live room counts for the events still ahead (an ended session shows none).
  const eventIds =
    agenda.status === "ready"
      ? agenda.data.filter((group) => group.group !== "EARLIER").flatMap((group) => group.sessions.map((session) => session.eventId))
      : [];
  const occupancy = useOccupancy(eventIds);

  return (
    <PageShell>
      <PageHeader label="My schedule" title="My agenda." more="The sessions on your pass, in the event's local time.">
        Select one to see it in the programme.
      </PageHeader>

      {agenda.status === "loading" ? (
        <SkeletonCells count={3} />
      ) : agenda.status === "offline" ? (
        <OfflineState what="Your agenda" onRetry={agenda.retry} />
      ) : agenda.status === "error" ? (
        <ErrorState what="your agenda" onRetry={agenda.retry} />
      ) : agenda.data.length === 0 ? (
        <StateBlock
          glyph="·"
          title="Nothing on your agenda yet."
          action={
            <Link to="/" className={buttonClass("secondary", "md")}>
              Browse events
            </Link>
          }
        >
          Sessions appear here once you're registered for an event.
        </StateBlock>
      ) : (
        agenda.data.map((group, index) => <AgendaGroup key={group.group} group={group} index={index} occupancy={occupancy} />)
      )}
    </PageShell>
  );
}

function AgendaGroup({
  group,
  index,
  occupancy,
}: {
  group: AgendaGroupItem;
  index: number;
  occupancy: (eventId: string) => OccupancyView | null;
}) {
  const isNow = group.group === "NOW";
  const earlier = group.group === "EARLIER";
  const today = group.sessions[0] ? dayKey(new Date(now()).toISOString(), group.sessions[0].timezone) : "";
  let lastDay = "";
  return (
    <section aria-labelledby={`agenda-${group.group}`} className="enter mx-auto mt-16 max-w-3xl md:mt-20" style={{ ["--i" as string]: index }}>
      <h2 id={`agenda-${group.group}`} className="mb-4 font-display text-21 font-medium">
        {groupLabel[group.group]}
      </h2>
        <ul className="-mx-4 flex flex-col gap-1">
          {group.sessions.map((session) => {
            const dayChanged = session.day !== lastDay;
            lastDay = session.day;
            return (
              <li key={session.id}>
                {dayChanged && session.day !== today ? (
                  <p className="px-4 pt-6 pb-2 text-15 text-muted-foreground">
                    {formatLongDay(session.startsAt, session.timezone)}
                  </p>
                ) : null}
                <AgendaRow session={session} isNow={isNow} muted={earlier} occupancy={occupancy(session.eventId)} />
              </li>
            );
          })}
        </ul>
    </section>
  );
}

function AgendaRow({
  session,
  isNow,
  muted,
  occupancy,
}: {
  session: AgendaSession;
  isNow: boolean;
  muted: boolean;
  occupancy: OccupancyView | null;
}) {
  const spaceLeft = getSpaceLeft(session, roomNow(occupancy, session.roomId));
  return (
    <Link
      to={`/events/${session.eventSlug}#session-${session.id}`}
      className={`grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4 gap-y-1 px-4 py-4 transition-colors duration-120 ease-standard hover:bg-surface-2 sm:grid-cols-[6rem_minmax(0,1fr)_auto] sm:items-center sm:gap-x-6 motion-reduce:transition-none ${
        isNow ? PANEL : ""
      } ${muted ? "text-muted-foreground" : ""}`}
    >
      <p className="row-span-2 font-mono text-15 sm:row-span-1">
        {formatTime(session.startsAt, session.timezone)}
        <span className="block text-13 text-muted-foreground">–{formatTime(session.endsAt, session.timezone)}</span>
      </p>
      <div className="min-w-0">
        <p className="text-17 font-medium sm:truncate">{session.title}</p>
        {session.room ? <p className="mt-0.5 text-15 text-muted-foreground">{session.room}</p> : null}
      </div>
      {muted ? (
        <p className="text-13">Ended</p>
      ) : (
        <p
          className={`text-13 ${
            spaceLeft.tone === "destructive" ? "text-destructive" : spaceLeft.tone === "warning" ? "text-warning" : "text-muted-foreground"
          }`}
        >
          {spaceLeft.label}
        </p>
      )}
    </Link>
  );
}
