import { useEffect } from "react";
import { Link } from "react-router-dom";
import { pageTitle } from "@synan/ui/brand";
import { buttonClass } from "@synan/ui/components";
import { loadAgenda, getSpaceLeft, type AgendaGroupItem, type AgendaSession } from "../data/agenda";
import { dayKey, formatLongDay, formatTime } from "../data/format";
import { now } from "../data/live";
import { roomNow, useOccupancy, type OccupancyView } from "../data/occupancy";
import { useResource } from "../data/resource";
import { PageHeader, PageShell, RuledRow } from "../components/page";
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
    <PageShell bleed>
      <PageHeader label="My schedule" title="My agenda">
        The sessions on your pass, in the event's local time. Select one to see it in the programme.
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
            <Link to="/" className={buttonClass("secondary", "sm")}>
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
    <div className="enter" style={{ ["--i" as string]: index }}>
      <RuledRow label={groupLabel[group.group]}>
        <ul className="max-w-3xl">
          {group.sessions.map((session) => {
            const dayChanged = session.day !== lastDay;
            lastDay = session.day;
            return (
              <li key={session.id}>
                {dayChanged && session.day !== today ? (
                  <p className="pt-6 pb-2 text-15 font-medium text-muted-foreground">
                    {formatLongDay(session.startsAt, session.timezone)}
                  </p>
                ) : null}
                <AgendaRow session={session} isNow={isNow} muted={earlier} occupancy={occupancy(session.eventId)} />
              </li>
            );
          })}
        </ul>
      </RuledRow>
    </div>
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
      className={`relative -mt-px flex min-h-16 flex-col gap-1 border sm:flex-row sm:items-center sm:justify-between sm:gap-4 border-border px-4 py-3 transition-colors duration-120 ease-standard hover:bg-card/40 motion-reduce:transition-none ${
        isNow ? "before:absolute before:-inset-y-px before:-left-px before:w-0.5 before:bg-foreground" : ""
      } ${muted ? "text-muted-foreground" : ""}`}
    >
      <div className="min-w-0">
        <p className="text-15 text-muted-foreground">
          <span className="font-mono">
            {formatTime(session.startsAt, session.timezone)}–{formatTime(session.endsAt, session.timezone)}
          </span>
          {session.room ? <> · {session.room}</> : null}
        </p>
        <p className="mt-1 text-17 sm:truncate">{session.title}</p>
      </div>
      {muted ? (
        <p className="shrink-0 text-13">Ended</p>
      ) : (
        <p
          className={`shrink-0 text-13 ${
            spaceLeft.tone === "destructive" ? "text-destructive" : spaceLeft.tone === "warning" ? "text-warning" : "text-muted-foreground"
          }`}
        >
          {spaceLeft.label}
        </p>
      )}
    </Link>
  );
}
