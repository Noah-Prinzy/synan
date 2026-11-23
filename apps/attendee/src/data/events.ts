/**
 * Event view models for A1 and A2, adapted from contract shapes served by
 * @synan/mock (EventDetail + public RoomOccupancy). Screens consume these, so
 * when the transport becomes real only this file changes.
 */
import type { EventState as ContractEventState, PortalEvent, RoomOccupancy } from "@synan/mock";
import { portal } from "./mock";

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
    /** The session's room, live. Null when the room has no public count. */
    occupancy: number;
    capacity: number;
  }[];
};

function viewState(state: ContractEventState): EventState {
  if (state === "live") return "live";
  if (state === "closed" || state === "archived") return "closed";
  return "upcoming";
}

function totals(rooms: RoomOccupancy[], event: PortalEvent) {
  const capacity = event.detail.rooms.reduce((sum, room) => sum + room.capacity, 0);
  const admitted = rooms.reduce((sum, room) => sum + (room.occupancy ?? 0), 0);
  return { capacity, admitted };
}

function summary(event: PortalEvent): EventSummary {
  const { detail, extras } = event;
  const { capacity } = totals(portal.occupancy(detail.id), event);
  const admitted = detail.on_site ?? 0;
  return {
    slug: detail.slug,
    title: detail.title,
    startsAt: detail.starts_at,
    endsAt: detail.ends_at,
    timezone: detail.timezone,
    venue: detail.venue.name,
    city: detail.venue.city ?? extras.city,
    state: viewState(detail.state),
    admitted,
    admittedShown: detail.on_site !== null,
    capacity,
    nearby: extras.nearby,
    image: extras.image ?? null,
    sessionCount: detail.sessions.length,
  };
}

/** A1: listed, published or live events, soonest first. */
export function getEvents(): EventSummary[] {
  return portal
    .listEvents()
    .filter((event) => event.detail.state === "published" || event.detail.state === "live")
    .sort((a, b) => a.detail.starts_at.localeCompare(b.detail.starts_at))
    .map(summary);
}

/** A2: any event by slug, including unlisted ones reached by link. */
export function getEventDetail(slug: string | undefined): EventDetail | undefined {
  const event = slug ? portal.getEvent(slug) : undefined;
  if (!event) return undefined;
  const { detail } = event;
  const rooms = new Map(detail.rooms.map((room) => [room.room_id, room]));
  const live = new Map(portal.occupancy(detail.id).map((room) => [room.room_id, room]));
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: detail.timezone });
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: detail.timezone });
  const registration = portal.registration(detail.id);
  const membership = !registration ? "none" : registration.checked_in ? "checked_in" : "registered";

  return {
    ...summary(event),
    description: detail.description ?? "",
    membership: membership === "checked_in" ? "checked-in" : membership,
    closed: detail.state === "closed" || detail.state === "archived",
    sessions: [...detail.sessions]
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .map((session) => {
        const room = rooms.get(session.room_id);
        return {
          id: session.id,
          day: day.format(new Date(session.starts_at)),
          room: room?.name ?? "",
          title: session.title,
          startsIso: session.starts_at,
          endsIso: session.ends_at,
          startsAt: time.format(new Date(session.starts_at)),
          endsAt: time.format(new Date(session.ends_at)),
          occupancy: live.get(session.room_id)?.occupancy ?? 0,
          capacity: room?.capacity ?? 0,
        };
      }),
  };
}
