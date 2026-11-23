import { useEffect } from "react";
import { Link } from "react-router-dom";
import { groupAgenda, getSpaceLeft, type AgendaGroupItem } from "../data/agenda";
import { useSession } from "../data/auth";
import { PageShell, Eyebrow } from "../components/page";

function formatTime(start: string, end: string): string {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Kampala",
  });
  return `${formatter.format(new Date(start))}–${formatter.format(new Date(end))}`;
}

function formatDay(dateStr: string): string {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

export default function Agenda() {
  useEffect(() => {
    document.title = "Agenda · Connexia";
  }, []);

  const session = useSession();
  const groups = groupAgenda();

  // If no sessions, show empty state
  const hasSessions = groups.length > 0;

  return (
    <PageShell>
      <div className="max-w-[68rem]">
        <Eyebrow>My schedule</Eyebrow>
        <h1 className="mt-2 font-serif text-[1.75rem] leading-tight">My agenda</h1>

        {!hasSessions && (
          <div className="mt-12 text-center">
            <p className="text-muted-foreground">
              No sessions in your agenda
            </p>
          </div>
        )}

        {hasSessions && (
          <div className="mt-8">
            {groups.map((group) => (
              <AgendaSection key={group.group} group={group} />
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}

function AgendaSection({ group }: { group: AgendaGroupItem }) {
  const sessions = group.sessions;

  return (
    <section className="border-border border-t py-8 first:border-t-0">
      <h2 className="font-mono text-[0.625rem] tracking-[0.18em] uppercase text-muted-foreground mb-6">
        {group.group}
      </h2>
      <div className="space-y-1">
        {sessions.map((session) => {
          const spaceLeft = getSpaceLeft(session);
          const isNow = group.group === "NOW";

          return (
            <Link
              key={session.id}
              to={`/events/${session.eventSlug}#session-${session.id}`}
              className={`border-border flex items-center justify-between gap-4 border-y p-4 hover:bg-card/50 transition-colors motion-reduce:transition-none ${
                isNow ? "border-l-2 border-l-foreground" : ""
              }`}
            >
              <div className="min-w-0">
                <p className="font-mono text-[0.6875rem] tracking-[0.12em] uppercase text-muted-foreground">
                  {formatTime(session.startsAt, session.endsAt)} · {session.room}
                </p>
                <p className="font-serif text-[1.125rem] leading-tight mt-1 truncate">
                  {session.title}
                </p>
                <p className="font-mono text-[0.625rem] tracking-[0.08em] uppercase text-muted-foreground mt-1">
                  {session.eventTitle}
                </p>
              </div>
              <div className="shrink-0">
                <p 
                  className={`font-mono text-[0.6875rem] uppercase tracking-wider ${
                    spaceLeft.tone === "destructive" ? "text-destructive" :
                    spaceLeft.tone === "warning" ? "text-warning" :
                    "text-muted-foreground"
                  }`}
                >
                  {spaceLeft.label}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
