import { useEffect } from "react";
import { Link } from "react-router-dom";
import { pageTitle } from "@synan/ui/brand";
import { groupAgenda, getSpaceLeft, type AgendaGroupItem, type AgendaSession } from "../data/agenda";
import { formatLongDay, formatTime } from "../data/format";
import { clock } from "../data/mock";
import { dayKey } from "../data/format";
import { PageShell } from "../components/page";

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

  const groups = groupAgenda();

  return (
    <PageShell>
      <div className="max-w-[56rem]">
        <p className="text-13 font-medium text-muted-foreground">My schedule</p>
        <h1 className="mt-2 font-display text-40">My agenda</h1>

        {groups.length === 0 ? (
          <p className="mt-12 text-17 text-muted-foreground">Nothing on your agenda yet. Sessions you register for appear here.</p>
        ) : (
          <div className="mt-8">
            {groups.map((group, index) => (
              <AgendaSection key={group.group} group={group} index={index} />
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}

function AgendaSection({ group, index }: { group: AgendaGroupItem; index: number }) {
  const isNow = group.group === "NOW";
  const earlier = group.group === "EARLIER";
  const today = group.sessions[0] ? dayKey(new Date(clock.now()).toISOString(), group.sessions[0].timezone) : "";
  let lastDay = "";

  return (
    <section aria-labelledby={`agenda-${group.group}`} className="enter border-t border-border py-8" style={{ ["--i" as string]: index }}>
      <h2 id={`agenda-${group.group}`} className="mb-4 font-display text-28">
        {groupLabel[group.group]}
      </h2>
      <ul>
        {group.sessions.map((session) => {
          const dayChanged = session.day !== lastDay;
          lastDay = session.day;
          return (
            <li key={session.id}>
              {dayChanged && (session.day !== today || group.group === "LATER") ? (
                <p className="mt-4 mb-2 text-15 font-medium text-muted-foreground">
                  {session.day === today ? "Today" : formatLongDay(session.startsAt, session.timezone)}
                </p>
              ) : null}
              <AgendaRow session={session} isNow={isNow} muted={earlier} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AgendaRow({ session, isNow, muted }: { session: AgendaSession; isNow: boolean; muted: boolean }) {
  const spaceLeft = getSpaceLeft(session);
  return (
    <Link
      to={`/events/${session.eventSlug}#session-${session.id}`}
      className={`-mt-px flex items-center justify-between gap-4 border border-border p-4 transition-colors duration-[120ms] ease-[cubic-bezier(.2,0,0,1)] hover:bg-card/40 motion-reduce:transition-none ${
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
