/**
 * D6.1 · Overview `/events/:id/overview` (docs/06 §2.3). The event at a glance: the KPI strip
 * scoped to this event (live figures while it runs, registrations otherwise), the readiness
 * checklist (rooms, pass, sending domain, staff), the next sessions, the event's facts and a
 * way into every other tab. A draft's unmet items open the wizard step that fixes them; a
 * published event's point at the tab that does.
 *
 * States: loading (strip and checklist load on their own), error with retry per part,
 * not live yet ("—" with a note), closed (summary link instead of readiness).
 */
import { useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { buttonClass } from "@synan/ui/components";
import { KpiCell, formatNumber, formatPercent } from "@synan/ui/data";
import type { ReadinessItem, ReadinessKey } from "@synan/mock/command";
import { ReadinessChecklist } from "../events/parts/readiness-checklist";
import {
  ErrorState,
  KeyValues,
  LoadingState,
  SectionHead,
  errorCode,
  formatDate,
  formatStamp,
  formatTime,
  linkClass,
  useDocumentTitle,
  useResource,
  zoneLabel,
} from "../kit";
import { api, clock, configure } from "../live/backend";
import { useCan } from "../access/session";
import { WORKSPACE_TAB_NEED, type WorkspaceTab } from "../routes";
import { eventRooms, useWorkspaceEvent } from "./parts/context";
import { plural } from "./parts/copy";

/** Where a published event fixes an unmet readiness item (the wizard is for drafts). */
const FIX_TAB: Partial<Record<ReadinessKey, { to: WorkspaceTab; label: string }>> = {
  basics: { to: "settings", label: "Settings" },
  capacity: { to: "settings", label: "Settings" },
  rules: { to: "rooms", label: "Rooms & rules" },
  staff: { to: "staff", label: "Staff" },
};

const QUICK_LINKS = [
  ["schedule", "Schedule", "Sessions by day and room"],
  ["rooms", "Rooms & rules", "Who may enter each room"],
  ["attendees", "Attendees", "Registrations, passes and bands"],
  ["credentials", "Credentials", "Band inventory and binding"],
  ["staff", "Staff", "Gate shifts and handovers"],
  ["reports", "Reports", "Exports and the event summary"],
  ["settings", "Settings", "Name, capacity, retention, close"],
] as const;

export default function WorkspaceOverview() {
  const { event, venue } = useWorkspaceEvent();
  useDocumentTitle(`Overview · ${event.title || "Untitled event"}`);
  const navigate = useNavigate();
  const can = useCan();
  const tz = event.timezone;
  const over = event.state === "closed" || event.state === "archived";

  const live = event.state === "live";
  const summary = useResource(() => (live ? api.summary(event.id) : Promise.resolve(null)), [event.id, live]);
  const counts = useResource(() => configure.eventRows().then((rows) => rows.find((r) => r.id === event.id) ?? null), [event.id]);
  const readiness = useResource(() => configure.readiness(event.id), [event.id, event.updated_at]);
  const sessions = useResource(() => configure.sessions(event.id), [event.id]);

  // Live figures refresh quietly while the tab is open.
  const { reload: reloadSummary } = summary;
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => reloadSummary(true), 15_000);
    return () => window.clearInterval(timer);
  }, [live, reloadSummary]);

  const rooms = useMemo(() => eventRooms(event, venue.status === "ready" ? venue.data : null), [event, venue.status, venue.data]);
  const roomName = useMemo(() => new Map(rooms.map((r) => [r.id, r.name])), [rooms]);
  const places = rooms.reduce((sum, room) => sum + room.capacity, 0);

  const now = clock.now();
  const sessionList = sessions.status === "ready" ? sessions.data : [];
  const upcoming = sessionList.filter((s) => Date.parse(s.ends_at) > now).slice(0, 6);
  const daysWithSessions = new Set(sessionList.map((s) => formatDate(s.starts_at, tz))).size;

  return (
    <div className="pb-8">
      <Kpis
        live={live}
        summary={summary}
        counts={counts}
        rooms={venue.status === "ready" ? rooms.length : null}
        places={places}
        sessions={sessions.status === "ready" ? sessionList.length : null}
        days={daysWithSessions}
      />

      <div className="grid grid-cols-12">
        <div className="col-span-12 flex min-w-0 flex-col gap-6 px-4 py-5 sm:px-6 xl:col-span-8">
          {over ? (
            <section aria-labelledby="ov-over" className="border border-border">
              <SectionHead id="ov-over" title="The event is over" />
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <p className="max-w-120 text-13 text-muted-foreground">
                  Closed {event.closed_at ? <span className="font-mono text-foreground tabular-nums">{formatStamp(event.closed_at, tz)}</span> : null}. The
                  summary shows how it went: attendance, the occupancy curve, the busiest rooms and gates, and the downloads.
                </p>
                <Link to={`/events/${event.id}/summary`} className={buttonClass("secondary", "compact")}>
                  Event summary
                </Link>
              </div>
            </section>
          ) : readiness.status === "loading" ? (
            <LoadingState label="Checking readiness…" className="border border-border px-4 sm:px-4" />
          ) : readiness.status === "error" ? (
            <ErrorState title="Could not check readiness" error={readiness.error} onRetry={() => readiness.reload()} className="m-0 sm:m-0" />
          ) : (
            <div className="flex flex-col gap-2">
              <ReadinessChecklist
                items={readiness.data}
                title={event.state === "draft" ? "Ready to publish?" : "Readiness"}
                published={event.state !== "draft"}
                onFix={event.state === "draft" ? (step) => navigate(`/events/new/${step}?draft=${event.id}`) : undefined}
              />
              {event.state !== "draft" ? <PublishedFixes items={readiness.data} eventId={event.id} /> : null}
            </div>
          )}

          <section aria-labelledby="ov-next" className="border border-border">
            <SectionHead
              id="ov-next"
              title={over ? "Sessions" : "Next sessions"}
              meta={`times in ${zoneLabel(tz)}`}
              actions={
                <Link to={`/events/${event.id}/schedule`} className={`${linkClass} text-11`}>
                  Full schedule
                </Link>
              }
            />
            {sessions.status === "loading" ? <LoadingState label="Loading sessions…" className="px-4 py-4 sm:px-4" /> : null}
            {sessions.status === "error" ? (
              <ErrorState title="Could not load the sessions" error={sessions.error} onRetry={() => sessions.reload()} className="m-4 sm:m-4" />
            ) : null}
            {sessions.status === "ready" ? (
              upcoming.length === 0 ? (
                <p className="px-4 py-3 text-13 text-muted-foreground">
                  {sessionList.length === 0
                    ? "No sessions yet. Add them in the schedule: they make up the attendee agenda."
                    : over
                      ? `${sessionList.length} ${plural(sessionList.length, "session")} were held.`
                      : "No more sessions: every session has ended."}
                </p>
              ) : (
                <ol>
                  {upcoming.map((s) => {
                    const running = Date.parse(s.starts_at) <= now;
                    return (
                      <li key={s.id} className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-2 text-13 last:border-b-0 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
                        <span className="font-mono text-12 tabular-nums">
                          <span className="hidden text-muted-foreground sm:inline">{formatDate(s.starts_at, tz, { weekday: true, year: false })} </span>
                          {formatTime(s.starts_at, tz)}–{formatTime(s.ends_at, tz)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate">{s.title}</span>
                          <span className="block truncate text-12 text-muted-foreground">{roomName.get(s.room_id) ?? "—"}</span>
                        </span>
                        <span className={running ? "text-12 text-success" : "text-12 text-muted-foreground"}>{running ? "Now" : ""}</span>
                      </li>
                    );
                  })}
                </ol>
              )
            ) : null}
          </section>
        </div>

        <aside className="col-span-12 min-w-0 border-t border-border xl:col-span-4 xl:border-t-0 xl:border-l">
          <section aria-labelledby="ov-facts">
            <SectionHead id="ov-facts" title="Facts" />
            <KeyValues
              rows={[
                [
                  "Venue",
                  event.venue_id && venue.status === "ready" && venue.data ? (
                    can("venues.edit") ? (
                      <Link to={`/venues/${event.venue_id}`} className={linkClass}>
                        {venue.data.venue.name}
                      </Link>
                    ) : (
                      venue.data.venue.name
                    )
                  ) : event.venue_id ? (
                    "…"
                  ) : (
                    <span className="text-muted-foreground">Not chosen</span>
                  ),
                ],
                [
                  "Time zone",
                  <span key="tz">
                    {tz.replace(/_/g, " ")} <span className="text-muted-foreground">· {zoneLabel(tz).split(" · ")[1]}</span>
                  </span>,
                ],
                ["Visibility", event.listed ? "Listed in discovery" : "Invitation only"],
                [
                  "Access rules",
                  event.access_rules_version > 0 ? (
                    <span key="v" className="font-mono text-12 tabular-nums">v{event.access_rules_version}</span>
                  ) : (
                    <span className="text-muted-foreground">Not published</span>
                  ),
                ],
                [
                  "Published",
                  event.published_at ? (
                    <span key="p" className="font-mono text-12 tabular-nums">{formatStamp(event.published_at, tz)}</span>
                  ) : (
                    <span className="text-muted-foreground">Not yet</span>
                  ),
                ],
                [
                  "Grace period",
                  <span key="g">
                    <span className="font-mono text-12 tabular-nums">{event.grace_buffer_hours} h</span>
                    <span className="text-muted-foreground"> before scan records are deleted</span>
                  </span>,
                ],
                [
                  "Last edited",
                  <span key="e">
                    <span className="font-mono text-12 tabular-nums">{formatStamp(event.updated_at, tz)}</span>
                    <span className="text-muted-foreground"> · {event.updated_by}</span>
                  </span>,
                ],
              ]}
            />
          </section>
          <nav aria-labelledby="ov-links" className="border-t border-border">
            <SectionHead id="ov-links" title="In this event" />
            <ul>
              {QUICK_LINKS.filter(([to]) => can(WORKSPACE_TAB_NEED[to])).map(([to, label, detail]) => (
                <li key={to} className="border-b border-border last:border-b-0">
                  <Link
                    to={`/events/${event.id}/${to}`}
                    className="group flex items-center justify-between gap-3 px-4 py-2 transition-colors duration-120 ease-standard hover:bg-foreground/[0.03] motion-reduce:transition-none"
                  >
                    <span className="min-w-0">
                      <span className="block text-13">{label}</span>
                      <span className="block truncate text-12 text-muted-foreground">{detail}</span>
                    </span>
                    <ArrowRight size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-muted-foreground group-hover:text-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
      </div>
    </div>
  );
}

function PublishedFixes({ items, eventId }: { items: ReadinessItem[]; eventId: string }) {
  const can = useCan();
  const unmet = items.filter((item) => !item.met);
  if (unmet.length === 0) return null;
  return (
    <ul className="text-12 text-muted-foreground">
      {unmet.map((item) => {
        const tab = FIX_TAB[item.key];
        // A fix in a tab the role cannot open is someone else's job: say whose, without a dead link.
        const fix = tab && can(WORKSPACE_TAB_NEED[tab.to]) ? tab : undefined;
        if (tab && !fix) {
          return (
            <li key={item.key}>
              {item.label}: an admin sets this in {tab.label}.
            </li>
          );
        }
        return (
          <li key={item.key}>
            {item.label}:{" "}
            {fix ? (
              <>
                fix it in{" "}
                <Link to={`/events/${eventId}/${fix.to}`} className={linkClass}>
                  {fix.label}
                </Link>
                .
              </>
            ) : item.key === "email" ? (
              "verify the sending domain in the organisation's settings."
            ) : (
              "this is set before publishing and cannot be changed on a published event yet."
            )}
          </li>
        );
      })}
    </ul>
  );
}

type Loaded<T> = { status: "loading" | "error" | "ready"; data: T | null; error: unknown };

function Kpis({
  live,
  summary,
  counts,
  rooms,
  places,
  sessions,
  days,
}: {
  live: boolean;
  summary: Loaded<Awaited<ReturnType<typeof api.summary>> | null>;
  counts: Loaded<Awaited<ReturnType<typeof configure.eventRows>>[number] | null>;
  rooms: number | null;
  places: number;
  sessions: number | null;
  days: number;
}) {
  const dash = <span className="text-muted-foreground">—</span>;
  const liveData = summary.status === "ready" ? summary.data : null;
  // A live event whose live figures cannot be read (not running in this mock) falls back to counts.
  const liveMissing = live && summary.status === "error" && errorCode(summary.error) === "NOT_FOUND";
  const row = counts.status === "ready" ? counts.data : null;
  const registered = liveData?.registered ?? row?.registrations ?? null;
  const checkedIn = liveData?.checked_in ?? row?.checked_in ?? null;
  const share = registered && checkedIn !== null ? `${formatPercent(checkedIn / registered)} of registered` : "";

  return (
    <dl className="grid grid-cols-2 gap-px border-b border-border bg-border lg:grid-cols-5" aria-busy={counts.status === "loading"}>
      <KpiCell label="Registered" value={registered !== null ? formatNumber(registered) : dash} delta={liveData?.by_tier ? `${formatNumber(liveData.by_tier.VIP ?? 0)} VIP` : "all tiers"} />
      <KpiCell label="Checked in" value={checkedIn !== null ? formatNumber(checkedIn) : dash} delta={share} />
      <KpiCell
        label="On site"
        value={liveData ? formatNumber(liveData.on_site) : dash}
        delta={<span className="font-sans">{live && !liveMissing ? (liveData ? "now" : "") : "opens when live"}</span>}
      />
      <KpiCell label="Rooms" value={rooms !== null ? formatNumber(rooms) : dash} delta={rooms ? `${formatNumber(places)} places` : ""} />
      <KpiCell
        label="Sessions"
        value={sessions !== null ? formatNumber(sessions) : dash}
        delta={sessions ? `over ${days} ${plural(days, "day")}` : ""}
        className="max-lg:col-span-2"
      />
    </dl>
  );
}
