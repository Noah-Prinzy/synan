/**
 * A6 view model: the attendee's sessions (GET /me/sessions, which names each one's event and room)
 * grouped Now · Next · Later · Earlier against the source's clock. Each room's live count comes
 * from data/occupancy (GET /events/:id/occupancy), read by the screen.
 */
import { backend } from "./backend";
import type { RoomNow } from "./occupancy";

export interface AgendaSession {
  id: string;
  eventId: string;
  eventSlug: string;
  eventTitle: string;
  timezone: string;
  roomId: string;
  room: string;
  title: string;
  startsAt: string;
  endsAt: string;
  /** Local calendar day, for day labels. */
  day: string;
  capacity: number;
}

export type AgendaGroup = "NOW" | "NEXT" | "LATER" | "EARLIER";

export interface AgendaGroupItem {
  group: AgendaGroup;
  sessions: AgendaSession[];
}

/** GET /me/sessions, grouped against the source's clock. */
export function loadAgenda(): AgendaGroupItem[] | Promise<AgendaGroupItem[]> {
  const sessions = backend.mySessions();
  return Array.isArray(sessions) ? groupAgenda(sessions) : sessions.then((items) => groupAgenda(items));
}

/**
 * Now: running at `now`. Next: the earliest one not yet started. Later: the rest still
 * ahead. Earlier: sessions that have ended, most recent first (owner decision).
 */
export function groupAgenda(sessions: AgendaSession[], now: number = backend.now()): AgendaGroupItem[] {
  const groups: Record<AgendaGroup, AgendaSession[]> = { NOW: [], NEXT: [], LATER: [], EARLIER: [] };
  for (const session of sessions) {
    const start = Date.parse(session.startsAt);
    const end = Date.parse(session.endsAt);
    if (end <= now) groups.EARLIER.unshift(session);
    else if (start <= now) groups.NOW.push(session);
    else if (groups.NEXT.length === 0) groups.NEXT.push(session);
    else groups.LATER.push(session);
  }
  return (["NOW", "NEXT", "LATER", "EARLIER"] as const)
    .filter((group) => groups[group].length > 0)
    .map((group) => ({ group, sessions: groups[group] }));
}

/** "Places left" from the room's live count. A withheld count (under the minimum crowd size) means room to spare. */
export function getSpaceLeft(
  session: AgendaSession,
  room: RoomNow,
): {
  count: number | null;
  label: string;
  tone: "warning" | "destructive" | "muted";
} {
  if (room.kind === "closed") return { count: null, label: "Not open yet", tone: "muted" };
  if (room.kind === "hidden") return { count: null, label: "Places available", tone: "muted" };
  const capacity = session.capacity || room.capacity;
  const spaceLeft = Math.max(0, capacity - room.occupancy);
  if (spaceLeft === 0) return { count: 0, label: "Full", tone: "destructive" };
  if (spaceLeft <= capacity * 0.15) return { count: spaceLeft, label: `Nearly full · ${spaceLeft} ${spaceLeft === 1 ? "place" : "places"} left`, tone: "warning" };
  return { count: spaceLeft, label: `${spaceLeft} places left`, tone: "muted" };
}
