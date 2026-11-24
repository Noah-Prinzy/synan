/**
 * Event view models for A1 and A2. Screens consume these; where they come from (the mock or the
 * real API) is decided in data/backend.ts.
 */
import { backend } from "./backend";

export type EventState = "live" | "upcoming" | "closed";

export type EventSummary = {
  slug: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  venue: string;
  city: string;
  state: EventState;
  /** Public on-site count; 0 when not shown (not live, or under the k-anonymity minimum). */
  admitted: number;
  /** False when the server withholds the count (EventSummary.on_site is null). */
  admittedShown: boolean;
  capacity: number;
  nearby: boolean;
  /** Event photograph, when the organiser supplied one. */
  image: string | null;
  sessionCount: number;
};

export type EventDetail = EventSummary & {
  description: string;
  membership: "none" | "registered" | "checked-in";
  closed: boolean;
  sessions: {
    id: string;
    day: string;
    room: string;
    title: string;
    startsIso: string;
    endsIso: string;
    /** HH:MM in the event's time zone */
    startsAt: string;
    endsAt: string;
    /** The session's room, live. 0 when the room has no public count. */
    occupancy: number;
    capacity: number;
  }[];
};

/** A1: listed, published or live events, soonest first. */
export function getEvents(): EventSummary[] | Promise<EventSummary[]> {
  return backend.getEvents();
}

/** A2: any event by slug, including unlisted ones reached by link; null when there is none. */
export function getEventDetail(slug: string | undefined): EventDetail | null | Promise<EventDetail | null> {
  return backend.getEventDetail(slug);
}
