import { useEffect } from "react";
import { Link } from "react-router-dom";
import { pageTitle } from "@synan/ui/brand";
import { buttonClass } from "@synan/ui/components";
import { groupAgenda, getSpaceLeft, type AgendaGroupItem, type AgendaSession } from "../data/agenda";
import { dayKey, formatLongDay, formatTime } from "../data/format";
import { clock, useResource } from "../data/mock";
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

  const agenda = useResource("agenda", () => groupAgenda());

  return (
    <PageShell bleed>
      <PageHeader label="My schedule" title="My agenda">
        The sessions on your pass, in the event's local time. Tap one to see it in the programme.
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
        agenda.data.map((group, index) => <AgendaGroup key={group.group} group={group} index={index} />)
      )}
    </PageShell>
  );
}

function AgendaGroup({ group, index }: { group: AgendaGroupItem; index: number }) {
  const isNow = group.group === "NOW";
  const earlier = group.group === "EARLIER";
  const today = group.sessions[0] ? dayKey(new Date(clock.now()).toISOString(), group.sessions[0].timezone) : "";
  let lastDay = "";
  return (
    <div className="enter" style={{ ["--i" as string]: index }}>
      <RuledRow label={groupLabel[group.group]}>
        <ul>
          {group.sessions.map((session) => {
            const dayChanged = session.day !== lastDay;
            lastDay = session.day;
            return (
              <li key={session.id}>
                {dayChanged && session.day !== today ? (
                  <p className="mt-4 mb-2 text-15 font-medium text-muted-foreground first:mt-0">
                    {formatLongDay(session.startsAt, session.timezone)}
                  </p>
                ) : null}
                <AgendaRow session={session} isNow={isNow} muted={earlier} />
              </li>
            );
          })}
        </ul>
      </RuledRow>
    </div>
  );
}

function AgendaRow({ session, isNow, muted }: { session: AgendaSession; isNow: boolean; muted: boolean }) {
  const spaceLeft = getSpaceLeft(session);
  return (
    <Link
      to={`/events/${session.eventSlug}#session-${session.id}`}
      className={`-mt-px flex min-h-16 items-center justify-between gap-4 border border-border px-4 py-3 transition-colors duration-120 ease-standard hover:bg-card/40 motion-reduce:transition-none ${
        isNow ? "border-l-2 border-l-foreground" : ""
      } ${muted ? "text-muted-foreground" : ""}`}
    >
      <div className="min-w-0">
        <p className="text-15 text-muted-foreground">
          <span className="font-mono">
            {formatTime(session.startsAt, session.timezone)}–{formatTime(session.endsAt, session.timezone)}
          </span>{" "}
          · {session.room}
        </p>
        <p className="mt-1 truncate text-17">{session.title}</p>
      </div>
      {muted ? (
        <p className="shrink-0 text-13">Ended</p>
      ) : (
        <p
          className={`shrink-0 text-13 ${
            spaceLeft.tone === "destructive" ? "text-destructive" : spaceLeft.tone === "warning" ? "text-warning" : "text-muted-foreground"
          }`}
        >
          {spaceLeft.count !== null ? <span className="font-mono">{spaceLeft.label}</span> : spaceLeft.label}
        </p>
      )}
    </Link>
  );
}
