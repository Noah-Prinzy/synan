/**
 * A6 view model: the attendee's sessions (GET /me/sessions) grouped Now · Next · Later
 * · Earlier against the mock clock, with each room's live count (public telemetry).
 */
import { dayKey } from "./format";
import { clock, portal } from "./mock";

export interface AgendaSession {
  id: string;
  eventSlug: string;
  eventTitle: string;
  timezone: string;
  room: string;
  title: string;
  startsAt: string;
  endsAt: string;
  /** Local calendar day, for day labels. */
  day: string;
  capacity: number;
  admitted: number | null;
}

export type AgendaGroup = "NOW" | "NEXT" | "LATER" | "EARLIER";

export interface AgendaGroupItem {
  group: AgendaGroup;
  sessions: AgendaSession[];
}

function mySessions(): AgendaSession[] {
  const event = portal.passEvent();
  const rooms = new Map(event.detail.rooms.map((room) => [room.room_id, room]));
  const live = new Map(portal.occupancy(event.detail.id).map((room) => [room.room_id, room]));
  return portal.sessions().map((session) => ({
    id: session.id,
    eventSlug: event.detail.slug,
    eventTitle: event.detail.title,
    timezone: event.detail.timezone,
    room: rooms.get(session.room_id)?.name ?? "",
    title: session.title,
    startsAt: session.starts_at,
    endsAt: session.ends_at,
    day: dayKey(session.starts_at, event.detail.timezone),
    capacity: rooms.get(session.room_id)?.capacity ?? 0,
    admitted: live.get(session.room_id)?.occupancy ?? null,
  }));
}

/**
 * Now: running at `now`. Next: the earliest one not yet started. Later: the rest still
 * ahead. Earlier: sessions that have ended, most recent first (owner decision).
 */
export function groupAgenda(now: number = clock.now()): AgendaGroupItem[] {
  const groups: Record<AgendaGroup, AgendaSession[]> = { NOW: [], NEXT: [], LATER: [], EARLIER: [] };
  for (const session of mySessions()) {
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

export function getSpaceLeft(session: AgendaSession): {
  count: number | null;
  label: string;
  tone: "warning" | "destructive" | "muted";
} {
  if (session.admitted === null) return { count: null, label: "Not open yet", tone: "muted" };
  const spaceLeft = Math.max(0, session.capacity - session.admitted);
  if (spaceLeft === 0) return { count: 0, label: "Full", tone: "destructive" };
  if (spaceLeft <= session.capacity * 0.15) return { count: spaceLeft, label: `${spaceLeft} left`, tone: "warning" };
  return { count: spaceLeft, label: `${spaceLeft} left`, tone: "muted" };
}
