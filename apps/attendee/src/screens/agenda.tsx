import { useEffect } from "react";
import { Link } from "react-router-dom";
import { groupAgenda, getSpaceLeft, type AgendaGroupItem } from "../data/agenda";
import { useSession } from "../data/auth";
import { PageShell, Eyebrow, Panel } from "../components/page";

function SkipLink() {
  return (
    <a
      href="#content"
      className="absolute left-0 top-0 -translate-y-full bg-background px-4 py-3 text-sm text-foreground focus:translate-y-0 focus:outline-none"
    >
      Skip to content
    </a>
  );
}

function formatTime(start: string, end: string): string {
  const startTime = new Date(start);
  const endTime = new Date(end);
  
  const startHours = startTime.getHours().toString().padStart(2, "0");
  const startMins = startTime.getMinutes().toString().padStart(2, "0");
  const endHours = endTime.getHours().toString().padStart(2, "0");
  const endMins = endTime.getMinutes().toString().padStart(2, "0");
  
  return `${startHours}:${startMins}–${endHours}:${endMins}`;
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
      <SkipLink />
      <div className="pt-10 md:pt-14 xl:pt-16">
        <Eyebrow>My schedule</Eyebrow>
        <h1 className="mt-2 font-serif text-2xl leading-tight">My agenda</h1>

        {!hasSessions && (
          <div className="mt-12 text-center">
            <p className="font-mono text-[0.6875rem] tracking-[0.12em] uppercase text-muted-foreground">
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
      <h2 className="font-mono text-[0.6875rem] tracking-[0.18em] uppercase text-muted-foreground mb-6">
        {group.group}
      </h2>
      <div className="space-y-3">
        {sessions.map((session) => {
          const spaceLeft = getSpaceLeft(session);
          const isNow = group.group === "NOW";

          return (
            <Link
              key={session.id}
              to={`/events/${session.eventSlug}#session-${session.id}`}
              className={`border-border flex items-center justify-between gap-4 rounded-none border p-4 hover:bg-card/50 transition-colors motion-reduce:transition-none ${
                isNow ? "border-l-2 border-foreground" : "border-l-0"
              }`}
            >
              <div className="min-w-0">
                <p className="font-mono text-[0.6875rem] tracking-[0.12em] uppercase text-muted-foreground">
                  {formatTime(session.startsAt, session.endsAt)} · {session.room}
                </p>
                <p className="font-serif text-[1.125rem] leading-tight mt-1 truncate">
                  {session.title}
                </p>
                <p className="font-mono text-[0.6875rem] tracking-[0.08em] uppercase text-muted-foreground mt-1">
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
