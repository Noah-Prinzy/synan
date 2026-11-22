import { eventDetails, type EventDetail } from "./events";

export interface AgendaSession {
  id: string;
  eventSlug: string;
  eventTitle: string;
  day: string;
  room: string;
  title: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  admitted: number;
}

// Create agenda sessions from eventDetails
function buildAgendaSessions(): AgendaSession[] {
  const sessions: AgendaSession[] = [];
  
  for (const event of eventDetails) {
    for (const session of event.sessions) {
      sessions.push({
        id: session.id,
        eventSlug: event.slug,
        eventTitle: event.title,
        day: session.day,
        room: session.room,
        title: session.title,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        capacity: session.capacity,
        admitted: Math.floor(session.occupancy * session.capacity / 100),
      });
    }
  }
  
  return sessions;
}

const agendaSessions = buildAgendaSessions();

// Group sessions by time relative to now
export type AgendaGroup = "NOW" | "NEXT" | "LATER";

export interface AgendaGroupItem {
  group: AgendaGroup;
  sessions: AgendaSession[];
}

function getNowIso(): string {
  return new Date().toISOString();
}

function isSessionActive(session: AgendaSession, nowIso: string): boolean {
  // Sessions are in Africa/Kampala timezone (+03:00)
  // Convert to UTC for comparison
  const startUtc = new Date(session.startsAt).toISOString();
  const endUtc = new Date(session.endsAt).toISOString();
  return nowIso >= startUtc && nowIso <= endUtc;
}

function isSessionUpcoming(session: AgendaSession, nowIso: string): boolean {
  const startUtc = new Date(session.startsAt).toISOString();
  return nowIso < startUtc;
}

export function groupAgenda(now?: Date): AgendaGroupItem[] {
  const nowIso = now ? now.toISOString() : getNowIso();
  
  const nowSessions: AgendaSession[] = [];
  const nextSessions: AgendaSession[] = [];
  const laterSessions: AgendaSession[] = [];
  
  // Sort by startsAt
  const sortedSessions = [...agendaSessions].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
  );
  
  for (const session of sortedSessions) {
    if (isSessionActive(session, nowIso)) {
      nowSessions.push(session);
    } else if (isSessionUpcoming(session, nowIso)) {
      // Next session is the earliest upcoming
      if (nextSessions.length === 0) {
        nextSessions.push(session);
      } else {
        laterSessions.push(session);
      }
    } else {
      laterSessions.push(session);
    }
  }
  
  const groups: AgendaGroupItem[] = [];
  
  if (nowSessions.length > 0) {
    groups.push({ group: "NOW", sessions: nowSessions });
  }
  if (nextSessions.length > 0) {
    groups.push({ group: "NEXT", sessions: nextSessions });
  }
  if (laterSessions.length > 0) {
    groups.push({ group: "LATER", sessions: laterSessions });
  }
  
  return groups;
}

// Get all sessions for display (chronological)
export function getAllSessions(): AgendaSession[] {
  return [...agendaSessions].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
  );
}

// Get space left info
export function getSpaceLeft(session: AgendaSession): { count: number; label: string; tone: "warning" | "destructive" | "muted" } {
  const spaceLeft = session.capacity - session.admitted;
  
  if (spaceLeft === 0) {
    return { count: 0, label: "Full", tone: "destructive" };
  } else if (spaceLeft <= session.capacity * 0.15) {
    return { count: spaceLeft, label: "Near full", tone: "warning" };
  } else {
    return { count: spaceLeft, label: "Space left", tone: "muted" };
  }
}
