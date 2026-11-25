/**
 * D6.1 · Overview `/events/:id/overview` (docs/06 §2.3). The event at a glance: the KPI strip
 * scoped to this event (live figures while it runs, registrations otherwise), the readiness
 * checklist (rooms, pass, sending domain, staff), the next sessions, the event's facts and a
 * way into every other tab. A draft's unmet items open the wizard step that fixes them; a
 * published event's point at the tab that does.
 *
 * Layout: three headline figures, large and calm, with a line of words each. Rooms and sessions
 * are setup facts, not live figures, so they are said in words in the Facts rail. A published
 * event whose every check passes shows readiness as one line, with the checks a click away.
 *
 * States: loading (strip and checklist load on their own), error with retry per part,
 * not live yet ("—" with a note), closed (summary link instead of readiness).
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { buttonClass, cn } from "@synan/ui/components";
import { KpiCell, SignalShape, formatNumber, formatPercent } from "@synan/ui/data";
import type { ReadinessItem, ReadinessKey } from "@synan/mock/command";
import { ReadinessChecklist, readinessSummary } from "../events/parts/readiness-checklist";
import {
  ErrorState,
  KeyValues,
  LoadingState,
  ROW_ACTION,
  SPLIT,
  SectionHead,
  TYPE,
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
import { Meter, RAIL_X } from "./parts/layout";

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

/** Panels in the main column pad 16px, the same as the readiness checklist beside them. */
const PANEL_HEAD = "sm:px-4!";

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
    <div className="pb-10">
      <Kpis live={live} summary={summary} counts={counts} />

      <div className={SPLIT}>
        <div className="flex min-w-0 flex-col gap-6 px-4 py-6 sm:px-6 2xl:px-8">
          {over ? (
            <section aria-labelledby="ov-over" className="">
              <SectionHead id="ov-over" title="The event is over" className={PANEL_HEAD} />
              <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
                <p className="max-w-[60ch] text-13 leading-relaxed text-muted-foreground">
                  Closed {event.closed_at ? <span className="font-mono text-foreground tabular-nums">{formatStamp(event.closed_at, tz)}</span> : null}. The
                  summary shows how it went: attendance, the occupancy curve, the busiest rooms and gates, and the downloads.
                </p>
                <Link to={`/events/${event.id}/summary`} className={buttonClass("secondary", "compact")}>
                  Event summary
                </Link>
              </div>
            </section>
          ) : readiness.status === "loading" ? (
            <LoadingState label="Checking readiness…" className="px-4 sm:px-4" />
          ) : readiness.status === "error" ? (
            <ErrorState title="Could not check readiness" error={readiness.error} onRetry={() => readiness.reload()} className="m-0 sm:m-0" />
          ) : event.state !== "draft" ? (
            <PublishedReadiness items={readiness.data} eventId={event.id} />
          ) : (
            <ReadinessChecklist
              items={readiness.data}
              title="Ready to publish?"
              onFix={(step) => navigate(`/events/new/${step}?draft=${event.id}`)}
            />
          )}

          <section aria-labelledby="ov-next" className="">
            <SectionHead
              id="ov-next"
              title={over ? "Sessions" : "Next sessions"}
              meta={`times in ${zoneLabel(tz)}`}
              className={PANEL_HEAD}
              actions={
                <Link to={`/events/${event.id}/schedule`} className={cn(linkClass, "text-12 whitespace-nowrap")}>
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
                <p className="max-w-[68ch] px-4 py-4 text-13 text-muted-foreground">
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
                      <li
                        key={s.id}
                        className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-4 px-4 py-2.5 sm:grid-cols-[8rem_minmax(0,1fr)_auto]"
                      >
                        <span className="min-w-0">
                          <span className="block font-mono text-13 tabular-nums">
                            {formatTime(s.starts_at, tz)}–{formatTime(s.ends_at, tz)}
                          </span>
                          <span className="block text-12 text-muted-foreground">{formatDate(s.starts_at, tz, { weekday: true, year: false })}</span>
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-13">{s.title}</span>
                          <span className="block truncate text-12 text-muted-foreground">{roomName.get(s.room_id) ?? "—"}</span>
                        </span>
                        {running ? (
                          <span className="inline-flex items-center gap-1.5 text-12 text-success">
                            <SignalShape state="ok" /> Now
                          </span>
                        ) : (
                          <span />
                        )}
                      </li>
                    );
                  })}
                </ol>
              )
            ) : null}
          </section>
        </div>

        <aside className="min-w-0 ">
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
                  "Rooms",
                  venue.status === "ready" && rooms.length > 0 ? (
                    <span key="r">
                      <span className={TYPE.value}>{formatNumber(rooms.length)}</span> {plural(rooms.length, "room")}
                      <span className="text-muted-foreground">
                        , <span className={TYPE.value}>{formatNumber(places)}</span> places
                      </span>
                    </span>
                  ) : venue.status === "ready" ? (
                    <span className="text-muted-foreground">None yet</span>
                  ) : (
                    "…"
                  ),
                ],
                [
                  "Sessions",
                  sessions.status === "ready" ? (
                    sessionList.length > 0 ? (
                      <span key="s">
                        <span className={TYPE.value}>{formatNumber(sessionList.length)}</span> {plural(sessionList.length, "session")}
                        <span className="text-muted-foreground">
                          {" "}
                          over <span className={TYPE.value}>{daysWithSessions}</span> {plural(daysWithSessions, "day")}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">None yet</span>
                    )
                  ) : (
                    "…"
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
                    <span key="v">
                      Version <span className={TYPE.value}>{event.access_rules_version}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Not published</span>
                  ),
                ],
                [
                  "Published",
                  event.published_at ? (
                    <span key="p" className={TYPE.value}>{formatStamp(event.published_at, tz)}</span>
                  ) : (
                    <span className="text-muted-foreground">Not yet</span>
                  ),
                ],
                [
                  "Scan records",
                  <span key="g">
                    Kept <span className={TYPE.value}>{event.grace_buffer_hours}</span> hours
                    <span className="text-muted-foreground"> after closing</span>
                  </span>,
                ],
                [
                  "Last edited",
                  <span key="e">
                    <span className={TYPE.value}>{formatStamp(event.updated_at, tz)}</span>
                    <span className="block text-12 text-muted-foreground">{event.updated_by}</span>
                  </span>,
                ],
              ]}
            />
          </section>
          <nav aria-labelledby="ov-links" className="">
            <SectionHead id="ov-links" title="In this event" />
            <ul>
              {QUICK_LINKS.filter(([to]) => can(WORKSPACE_TAB_NEED[to])).map(([to, label, detail]) => (
                <li key={to} className=" ">
                  <Link
                    to={`/events/${event.id}/${to}`}
                    className={cn(
                      "group flex min-h-12 items-center justify-between gap-3 py-2 transition-colors duration-120 ease-standard hover:bg-surface-2 motion-reduce:transition-none",
                      RAIL_X,
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block text-13">{label}</span>
                      <span className="block truncate text-12 text-muted-foreground">{detail}</span>
                    </span>
                    <ArrowRight size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-muted-foreground group-hover:text-foreground" />
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

/**
 * A published event's readiness. When every check passes there is nothing to read, so it is one
 * line with the checks a click away; otherwise the checklist, with where to fix each unmet item.
 */
function PublishedReadiness({ items, eventId }: { items: ReadinessItem[]; eventId: string }) {
  const [open, setOpen] = useState(false);
  const state = readinessSummary(items, true);
  const allClear = state.ready && state.suggestions === 0;

  if (allClear && !open) {
    return (
      <section aria-labelledby="ov-ready" className="">
        <header className="flex min-h-10 flex-wrap items-center justify-between gap-x-3 px-4">
          <h2 id="ov-ready" className="py-2 text-13 font-medium">
            Readiness
          </h2>
          <p role="status" className="flex items-center gap-1.5 py-2 text-12 text-success">
            <SignalShape state="ok" /> {state.text}
          </p>
        </header>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2 pr-2 pl-4">
          <p className="text-13 text-muted-foreground">
            All {items.length} checks pass. Nothing needs attention.
          </p>
          <button type="button" className={ROW_ACTION} aria-expanded={false} onClick={() => setOpen(true)}>
            Show the checks
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ReadinessChecklist items={items} title="Readiness" published />
      <PublishedFixes items={items} eventId={eventId} />
      {allClear ? (
        <button type="button" className={cn(ROW_ACTION, "-mt-1 self-start")} aria-expanded onClick={() => setOpen(false)}>
          Hide the checks
        </button>
      ) : null}
    </div>
  );
}

function PublishedFixes({ items, eventId }: { items: ReadinessItem[]; eventId: string }) {
  const can = useCan();
  const unmet = items.filter((item) => !item.met);
  if (unmet.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-12 leading-relaxed text-muted-foreground">
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

/** Each cell pads to the page gutter, so the first figure lines up with the title above. */
const CELL = "sm:px-6 2xl:px-8";
/** The strip's last cell sits over the Facts rail, so its divider continues the rail's edge (SPLIT). */
const STRIP_COLUMNS = "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(20rem,24rem)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_26rem]";

function Kpis({
  live,
  summary,
  counts,
}: {
  live: boolean;
  summary: Loaded<Awaited<ReturnType<typeof api.summary>> | null>;
  counts: Loaded<Awaited<ReturnType<typeof configure.eventRows>>[number] | null>;
}) {
  const dash = <span className="text-muted-foreground">—</span>;
  const liveData = summary.status === "ready" ? summary.data : null;
  // A live event whose live figures cannot be read (not running in this mock) falls back to counts.
  const liveMissing = live && summary.status === "error" && errorCode(summary.error) === "NOT_FOUND";
  const row = counts.status === "ready" ? counts.data : null;
  const registered = liveData?.registered ?? row?.registrations ?? null;
  const checkedIn = liveData?.checked_in ?? row?.checked_in ?? null;
  const share = registered && checkedIn !== null ? checkedIn / registered : null;
  const words = (text: string) => <span className="font-sans">{text}</span>;

  return (
    <dl className={cn("grid grid-cols-2 gap-px bg-surface-3 sm:grid-cols-3", STRIP_COLUMNS)} aria-busy={counts.status === "loading"}>
      <KpiCell
        label="Registered"
        className={CELL}
        value={registered !== null ? formatNumber(registered) : dash}
        delta={words(liveData?.by_tier ? `${formatNumber(liveData.by_tier.VIP ?? 0)} of them VIP` : "across all tiers")}
      />
      <KpiCell
        label="Checked in"
        className={CELL}
        value={checkedIn !== null ? formatNumber(checkedIn) : dash}
        delta={words(share !== null ? `${formatPercent(share)} of those registered` : "")}
        spark={share !== null ? <Meter value={share} className="max-w-32" /> : null}
      />
      <KpiCell
        label="On site"
        className={cn(CELL, "max-sm:col-span-2")}
        value={liveData ? formatNumber(liveData.on_site) : dash}
        delta={words(live && !liveMissing ? (liveData ? "In the building right now" : "") : "Counted once the event is live")}
      />
    </dl>
  );
}
