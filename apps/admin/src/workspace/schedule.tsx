/**
 * D6.2 · Schedule `/events/:id/schedule` (docs/06 §2.3). The event's sessions, grouped by day in
 * the event's own zone: time, title, room, length. Sessions drive the attendee agenda and the
 * session-end occupancy reset, so each one names its room. Add and edit in a dialog; delete asks
 * first. Filter by room. At ≥1280 a side column counts sessions per room.
 *
 * States: loading, error with retry, no rooms yet, no sessions yet, no match for the filter,
 * read-only for closed and archived events.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button, Dialog, Select, buttonClass, cn } from "@synan/ui/components";
import { formatNumber } from "@synan/ui/data";
import type { EventSession } from "@synan/contracts/rest";
import {
  EmptyState,
  ErrorState,
  ICON_BUTTON,
  LoadingState,
  Notice,
  SPLIT,
  SectionHead,
  TYPE,
  Table,
  Td,
  Th,
  errorCopy,
  formatDate,
  formatTime,
  linkClass,
  rowClass,
  toLocalInput,
  useDocumentTitle,
  useResource,
  zoneLabel,
} from "../kit";
import { configure } from "../live/backend";
import { ReadOnlyNote, eventRooms, useWorkspaceEvent } from "./parts/context";
import { plural } from "./parts/copy";
import { Duration, HEAD_BLEED, Meter, RAIL_ROW, RAIL_X, RailNote, Toolbar } from "./parts/layout";
import { SessionDialog } from "./parts/session-dialog";

const ALL = "all";

export default function WorkspaceSchedule() {
  const { event, venue, readOnly, tabPrimary } = useWorkspaceEvent();
  useDocumentTitle(`Schedule · ${event.title || "Untitled event"}`);
  const sessions = useResource(() => configure.sessions(event.id), [event.id]);
  const rooms = useMemo(() => eventRooms(event, venue.status === "ready" ? venue.data : null), [event, venue.status, venue.data]);
  const roomName = useMemo(() => new Map(rooms.map((r) => [r.id, r.name])), [rooms]);

  const [filter, setFilter] = useState<string>(ALL);
  const [editing, setEditing] = useState<{ session: EventSession | null } | null>(null);
  const [deleting, setDeleting] = useState<EventSession | null>(null);
  const [said, setSaid] = useState("");

  const tz = event.timezone;
  const list = sessions.status === "ready" ? sessions.data : [];
  const shown = filter === ALL ? list : list.filter((s) => s.room_id === filter);
  const days = useMemo(() => groupByDay(shown, tz), [shown, tz]);
  const canAdd = !readOnly && rooms.length > 0 && !!event.starts_at;

  const addButton = (
    <Button variant={tabPrimary ? "primary" : "secondary"} size="compact" onClick={() => setEditing({ session: null })} disabled={!canAdd}>
      <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
      Add session
    </Button>
  );

  if (sessions.status === "loading" || venue.status === "loading") return <LoadingState label="Loading the schedule…" rows={6} />;
  if (sessions.status === "error") return <ErrorState title="Could not load the sessions" error={sessions.error} onRetry={() => sessions.reload()} />;
  if (venue.status === "error") return <ErrorState title="Could not load the event's rooms" error={venue.error} onRetry={() => venue.reload()} />;

  const body = (() => {
    if (rooms.length === 0) {
      return (
        <EmptyState
          title="No rooms to schedule in yet"
          action={
            event.state === "draft" ? (
              <Link to={`/events/new/venue?draft=${event.id}`} className={buttonClass("secondary", "compact")}>
                Choose the venue and rooms
              </Link>
            ) : undefined
          }
        >
          Every session is held in one of the event's rooms. Pick the venue and the rooms this event uses first.
        </EmptyState>
      );
    }
    if (list.length === 0) {
      return (
        <EmptyState title="No sessions yet" action={readOnly ? undefined : addButton}>
          <p>
            Sessions are the talks, panels and workshops held in each room. They make up the attendee agenda, and when one ends
            the room's count is checked against the gates, so people who left without scanning out are not counted as still inside.
          </p>
          {!event.starts_at ? <p className="mt-2">Set the event's dates first: sessions must fall within them.</p> : null}
        </EmptyState>
      );
    }
    return (
      <>
        {shown.length === 0 ? (
          <p className="px-4 py-8 text-13 text-muted-foreground sm:px-6 2xl:px-8">
            No sessions in {roomName.get(filter) ?? "this room"}.{" "}
            <button type="button" className={linkClass} onClick={() => setFilter(ALL)}>
              Show every room
            </button>
          </p>
        ) : (
          <Table label="Sessions">
            <thead>
              <tr>
                <Th fit>Time</Th>
                <Th>Session</Th>
                <Th fit>Room</Th>
                <Th numeric fit>
                  Length
                </Th>
                {readOnly ? null : (
                  <Th fit>
                    <span className="sr-only">Actions</span>
                  </Th>
                )}
              </tr>
            </thead>
            {days.map((day) => (
              <tbody key={day.key}>
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={readOnly ? 4 : 5}
                    className="h-9 border-b border-border bg-foreground/2 px-4 text-left text-13 font-medium sm:px-6 2xl:px-8"
                  >
                    {dayNumber(event.starts_at, day.key, tz) ? `Day ${dayNumber(event.starts_at, day.key, tz)} · ` : ""}
                    {day.label}
                    <span className="ml-3 text-12 font-normal text-muted-foreground">
                      {formatNumber(day.sessions.length)} {plural(day.sessions.length, "session")}
                    </span>
                  </th>
                </tr>
                {day.sessions.map((session) => (
                  <tr key={session.id} className={rowClass}>
                    <Td fit className={TYPE.value}>
                      {formatTime(session.starts_at, tz)}–{formatTime(session.ends_at, tz)}
                    </Td>
                    <Td className="max-w-96">
                      <span className="block truncate">{session.title}</span>
                    </Td>
                    <Td fit className="pr-8 text-muted-foreground">{roomName.get(session.room_id) ?? "Room no longer used"}</Td>
                    <Td fit className="text-right">
                      <Duration ms={Date.parse(session.ends_at) - Date.parse(session.starts_at)} />
                    </Td>
                    {readOnly ? null : (
                      <Td fit className="py-0">
                        <span className="-mr-2 flex justify-end gap-0.5">
                          <button type="button" className={ICON_BUTTON} aria-label={`Edit ${session.title}`} onClick={() => setEditing({ session })}>
                            <Pencil strokeWidth={1.5} aria-hidden="true" />
                          </button>
                          <button type="button" className={ICON_BUTTON} aria-label={`Delete ${session.title}`} onClick={() => setDeleting(session)}>
                            <Trash2 strokeWidth={1.5} aria-hidden="true" />
                          </button>
                        </span>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            ))}
          </Table>
        )}
      </>
    );
  })();

  return (
    <div className="pb-10">
      {readOnly ? <ReadOnlyNote event={event} what="its schedule" /> : null}
      <div className={SPLIT}>
        <section aria-labelledby="schedule-sessions" className="min-w-0">
          <SectionHead id="schedule-sessions" title="Sessions" meta={`times in ${zoneLabel(tz)}`} className={HEAD_BLEED} />
          {list.length > 0 ? (
            <Toolbar actions={readOnly ? undefined : addButton}>
              <div className="w-full max-w-64">
                <Select
                  aria-label="Show sessions in"
                  options={[
                    { value: ALL, label: "All rooms", meta: formatNumber(list.length) },
                    ...rooms.map((room) => ({
                      value: room.id,
                      label: room.name,
                      meta: formatNumber(list.filter((s) => s.room_id === room.id).length),
                    })),
                  ]}
                  value={filter}
                  onChange={setFilter}
                />
              </div>
              <span>
                <span className={TYPE.value}>{formatNumber(shown.length)}</span> {plural(shown.length, "session")}
                {filter === ALL ? (
                  <>
                    {" "}
                    over <span className={TYPE.value}>{formatNumber(days.length)}</span> {plural(days.length, "day")}
                  </>
                ) : null}
              </span>
            </Toolbar>
          ) : null}
          {body}
          <p role="status" aria-live="polite" className="sr-only">
            {said}
          </p>
        </section>
        <aside aria-labelledby="schedule-rooms" className="min-w-0 border-t border-border lg:border-t-0 lg:border-l">
          <SectionHead id="schedule-rooms" title="By room" meta="sessions and scheduled time" />
          <RoomLoad sessions={list} rooms={rooms} />
          <RailNote>
            When a session ends, its room's count is reset against the gates. Continuous rooms (a café, a foyer) have no
            sessions and are never reset.
          </RailNote>
        </aside>
      </div>

      <SessionDialog
        open={editing !== null}
        event={event}
        rooms={rooms}
        session={editing?.session ?? null}
        onClose={() => setEditing(null)}
        onSaved={(session, created) => {
          setEditing(null);
          setSaid(created ? `Added “${session.title}”.` : `Saved “${session.title}”.`);
          sessions.reload(true);
        }}
      />
      <DeleteSession
        session={deleting}
        eventId={event.id}
        onClose={() => setDeleting(null)}
        onDeleted={(session) => {
          setDeleting(null);
          sessions.set((current) => current.filter((s) => s.id !== session.id));
          setSaid(`Deleted “${session.title}”.`);
        }}
        timeZone={tz}
      />
    </div>
  );
}

interface Day {
  key: string;
  label: string;
  sessions: EventSession[];
}

function groupByDay(sessions: EventSession[], timeZone: string): Day[] {
  const days = new Map<string, Day>();
  for (const session of [...sessions].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    const key = toLocalInput(session.starts_at, timeZone).slice(0, 10);
    let day = days.get(key);
    if (!day) {
      day = { key, label: formatDate(session.starts_at, timeZone, { weekday: true }), sessions: [] };
      days.set(key, day);
    }
    day.sessions.push(session);
  }
  return [...days.values()];
}

/** "Day 2": counted from the event's first local day, so a filter never renumbers the days. */
function dayNumber(eventStart: string | null, key: string, timeZone: string): number | null {
  if (!eventStart) return null;
  const first = toLocalInput(eventStart, timeZone).slice(0, 10);
  const days = Math.round((Date.parse(`${key}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000);
  return Number.isFinite(days) && days >= 0 ? days + 1 : null;
}

/**
 * Sessions per room. Rooms that hold sessions are listed with a bar and their scheduled time;
 * the rest are said in a sentence, so the rail never prints a column of zeros.
 */
function RoomLoad({ sessions, rooms }: { sessions: EventSession[]; rooms: { id: string; name: string; continuous: boolean }[] }) {
  if (rooms.length === 0) return <p className={cn("py-4 text-13 text-muted-foreground", RAIL_X)}>No rooms yet.</p>;
  const load = rooms.map((room) => {
    const own = sessions.filter((s) => s.room_id === room.id);
    return { room, count: own.length, ms: own.reduce((sum, s) => sum + (Date.parse(s.ends_at) - Date.parse(s.starts_at)), 0) };
  });
  const used = load.filter((r) => r.count > 0).sort((a, b) => b.count - a.count || b.ms - a.ms);
  const continuous = load.filter((r) => r.count === 0 && r.room.continuous).map((r) => r.room.name);
  const idle = load.filter((r) => r.count === 0 && !r.room.continuous).length;
  const max = Math.max(1, ...used.map((r) => r.count));
  return (
    <>
      {used.length > 0 ? (
        <ul className="py-1.5">
          {used.map(({ room, count, ms }) => (
            <li key={room.id} className={cn(RAIL_ROW, "grid-cols-[minmax(0,1fr)_3.5rem_2rem_5.5rem]")}>
              <span className="truncate">{room.name}</span>
              <Meter value={count / max} />
              <span className={cn(TYPE.value, "text-right")}>
                {formatNumber(count)}
                <span className="sr-only"> {plural(count, "session")}</span>
              </span>
              <Duration ms={ms} className="text-right text-muted-foreground" />
            </li>
          ))}
        </ul>
      ) : null}
      {continuous.length > 0 || idle > 0 ? (
        <div className={cn("flex flex-col gap-1.5 border-t border-border py-3 text-13 text-muted-foreground", RAIL_X)}>
          {idle > 0 ? (
            <p>
              <span className="font-mono text-foreground tabular-nums">{formatNumber(idle)}</span>
              {used.length > 0 ? " other" : ""} {plural(idle, "room has", "rooms have")} no sessions yet.
            </p>
          ) : null}
          {continuous.length > 0 ? (
            <p>
              <span className="font-mono text-foreground tabular-nums">{formatNumber(continuous.length)}</span>{" "}
              {plural(continuous.length, "room is", "rooms are")} open throughout, with no sessions: {listWords(continuous)}.
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** "A", "A and B", "A, B and C". */
function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function DeleteSession({
  session,
  eventId,
  timeZone,
  onClose,
  onDeleted,
}: {
  session: EventSession | null;
  eventId: string;
  timeZone: string;
  onClose: () => void;
  onDeleted: (session: EventSession) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async () => {
    if (!session) return;
    setBusy(true);
    setProblem(null);
    try {
      await configure.deleteSession(eventId, session.id);
      onDeleted(session);
    } catch (error) {
      const copy = errorCopy(error);
      setProblem(`${copy.title}. ${copy.message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={session !== null}
      onClose={onClose}
      tone="danger"
      width="sm"
      title={session ? `Delete “${session.title}”?` : "Delete session?"}
      description="It leaves the attendee agenda, and the room is no longer reset when it would have ended."
      footer={
        <>
          <Button variant="secondary" size="compact" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="danger" size="compact" onClick={() => void run()} disabled={busy}>
            {busy ? "Deleting…" : "Delete session"}
          </Button>
        </>
      }
    >
      {session ? (
        <p className="px-5 py-4 text-13 text-muted-foreground">
          <span className="font-mono text-foreground tabular-nums">
            {formatDate(session.starts_at, timeZone, { weekday: true })}, {formatTime(session.starts_at, timeZone)}–{formatTime(session.ends_at, timeZone)}
          </span>
        </p>
      ) : null}
      {problem ? <Notice tone="danger" className="mx-5 mb-4">{problem}</Notice> : null}
    </Dialog>
  );
}
