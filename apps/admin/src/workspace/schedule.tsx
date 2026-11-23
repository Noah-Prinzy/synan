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
import { Button, Dialog, Select, buttonClass } from "@synan/ui/components";
import { formatNumber } from "@synan/ui/data";
import type { EventSession } from "@synan/contracts/rest";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Notice,
  SectionHead,
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
import { formatDuration, plural } from "./parts/copy";
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
      <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
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
          <p className="px-4 py-6 text-13 text-muted-foreground sm:px-6">
            No sessions in {roomName.get(filter) ?? "this room"}.{" "}
            <button type="button" className={linkClass} onClick={() => setFilter(ALL)}>
              Show every room
            </button>
          </p>
        ) : (
          <Table label="Sessions">
            <thead>
              <tr>
                <Th className="w-36">Time</Th>
                <Th>Session</Th>
                <Th>Room</Th>
                <Th numeric>Length</Th>
                {readOnly ? null : (
                  <Th className="w-24">
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
                    className="h-8 border-b border-border bg-foreground/2 px-4 text-left text-12 font-medium sm:px-6"
                  >
                    {dayNumber(event.starts_at, day.key, tz) ? `Day ${dayNumber(event.starts_at, day.key, tz)} · ` : ""}
                    {day.label}
                    <span className="ml-2 font-normal text-muted-foreground">
                      {formatNumber(day.sessions.length)} {plural(day.sessions.length, "session")}
                    </span>
                  </th>
                </tr>
                {day.sessions.map((session) => (
                  <tr key={session.id} className={rowClass}>
                    <Td className="font-mono text-12 whitespace-nowrap tabular-nums">
                      {formatTime(session.starts_at, tz)}–{formatTime(session.ends_at, tz)}
                    </Td>
                    <Td className="max-w-96">
                      <span className="block truncate">{session.title}</span>
                    </Td>
                    <Td className="whitespace-nowrap text-muted-foreground">{roomName.get(session.room_id) ?? "Room no longer used"}</Td>
                    <Td numeric className="whitespace-nowrap">
                      {formatDuration(Date.parse(session.ends_at) - Date.parse(session.starts_at))}
                    </Td>
                    {readOnly ? null : (
                      <Td className="whitespace-nowrap">
                        <span className="flex justify-end gap-1">
                          <Button variant="quiet" size="compact" aria-label={`Edit ${session.title}`} onClick={() => setEditing({ session })}>
                            <Pencil size={14} strokeWidth={1.5} aria-hidden="true" />
                          </Button>
                          <Button variant="quiet" size="compact" aria-label={`Delete ${session.title}`} onClick={() => setDeleting(session)}>
                            <Trash2 size={14} strokeWidth={1.5} aria-hidden="true" />
                          </Button>
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
    <div className="pb-8">
      {readOnly ? <ReadOnlyNote event={event} what="its schedule" /> : null}
      <div className="xl:grid xl:grid-cols-12">
        <section aria-labelledby="schedule-sessions" className="min-w-0 xl:col-span-8">
          <SectionHead
            id="schedule-sessions"
            title="Sessions"
            meta={
              list.length > 0 ? (
                <>
                  <span className="font-mono tabular-nums">{formatNumber(list.length)}</span> in total · times in {zoneLabel(tz)}
                </>
              ) : (
                `Times in ${zoneLabel(tz)}`
              )
            }
          />
          {list.length > 0 ? (
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
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
              {readOnly ? null : addButton}
            </div>
          ) : null}
          {body}
          <p role="status" aria-live="polite" className="sr-only">
            {said}
          </p>
        </section>
        <aside aria-labelledby="schedule-rooms" className="min-w-0 border-t border-border xl:col-span-4 xl:border-t-0 xl:border-l">
          <SectionHead id="schedule-rooms" title="By room" meta="sessions · scheduled time" />
          <RoomLoad sessions={list} rooms={rooms} />
          <p className="border-t border-border px-4 py-3 text-12 text-muted-foreground">
            When a session ends, its room's count is reset against the gates. Continuous rooms (a café, a foyer) have no
            sessions and are never reset.
          </p>
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

function RoomLoad({ sessions, rooms }: { sessions: EventSession[]; rooms: { id: string; name: string; continuous: boolean }[] }) {
  if (rooms.length === 0) return <p className="px-4 py-3 text-13 text-muted-foreground">No rooms yet.</p>;
  const max = Math.max(1, ...rooms.map((room) => sessions.filter((s) => s.room_id === room.id).length));
  return (
    <ul className="py-1">
      {rooms.map((room) => {
        const own = sessions.filter((s) => s.room_id === room.id);
        const ms = own.reduce((sum, s) => sum + (Date.parse(s.ends_at) - Date.parse(s.starts_at)), 0);
        return (
          <li key={room.id} className="grid h-8 grid-cols-[minmax(0,1fr)_3.5rem_auto] items-center gap-3 px-4 text-13">
            <span className="truncate">{room.name}</span>
            <span aria-hidden="true" className="relative h-1 bg-border">
              <span className="absolute inset-0 origin-left bg-foreground/60" style={{ transform: `scaleX(${own.length / max})` }} />
            </span>
            <span className="text-right font-mono text-12 tabular-nums">
              {room.continuous && own.length === 0 ? (
                <span className="text-muted-foreground">continuous</span>
              ) : (
                <>
                  {formatNumber(own.length)}
                  <span className="text-muted-foreground"> · {ms > 0 ? formatDuration(ms) : "—"}</span>
                </>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
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
