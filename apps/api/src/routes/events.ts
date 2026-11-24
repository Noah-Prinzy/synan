import type { Express } from "express";
import { ContractError } from "@synan/contracts/errors";
import { endpoints, type EventDetail, type EventSummary } from "@synan/contracts/rest";
import type { AppContext } from "../app.js";
import type { AuthContext } from "../domain/principal.js";
import { deskEventIds } from "../domain/scope.js";
import { mount } from "../http/route.js";
import { isScheduled, type EventRow, type ScheduledEvent, type SessionRow } from "../repo/types.js";

const encodeCursor = (e: ScheduledEvent) => Buffer.from(JSON.stringify({ s: e.starts_at.toISOString(), i: e.id })).toString("base64url");
function decodeCursor(c: string | undefined): { starts_at: Date; id: string } | undefined {
  if (!c) return undefined;
  try {
    const v = JSON.parse(Buffer.from(c, "base64url").toString()) as { s: string; i: string };
    const d = new Date(v.s);
    if (Number.isNaN(d.getTime()) || typeof v.i !== "string") throw new Error();
    return { starts_at: d, id: v.i };
  } catch {
    throw new ContractError("VALIDATION_FAILED", "Invalid cursor", [{ path: "query.cursor", message: "invalid" }]);
  }
}

/** The public card. Only for an event with its venue and dates (drafts without them are operator-only, GET /admin/events). */
export async function summary(app: AppContext, e: ScheduledEvent): Promise<EventSummary> {
  const venue = await app.repos.venues.venue(e.venue_id);
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    starts_at: e.starts_at.toISOString(),
    ends_at: e.ends_at.toISOString(),
    timezone: e.timezone,
    state: e.state,
    venue: { id: e.venue_id, name: venue?.name ?? "", city: venue?.city ?? null },
    on_site: await publicOnSite(app, e),
    ...(await cardFigures(app, e)),
  };
}

/** Capacity (sum of the capacities in force of the event's rooms; null without rooms), session count, image (none yet). */
async function cardFigures(app: AppContext, e: EventRow): Promise<{ capacity: number | null; session_count: number; image_url: string | null }> {
  const eventRooms = await app.repos.events.rooms(e.id);
  const rooms = await app.repos.venues.roomsByIds(eventRooms.map((r) => r.room_id));
  const override = new Map(eventRooms.map((r) => [r.room_id, r.capacity_override]));
  const capacity = rooms.length ? rooms.reduce((sum, r) => sum + (override.get(r.id) ?? r.capacity), 0) : null;
  return { capacity, session_count: (await app.repos.events.sessions(e.id)).length, image_url: null };
}

/**
 * People on site now, for public discovery. Same rule as public telemetry: null unless the event
 * is live and the count reaches the minimum crowd size (O-08).
 */
export async function publicOnSite(app: AppContext, e: EventRow): Promise<number | null> {
  if (e.state !== "live") return null;
  const k = app.config.kAnon;
  // Sum only zones that are themselves shown publicly, so this total reveals nothing the public zone
  // view hides: total − visible zones can never recover a suppressed zone's count.
  const n = (await app.scans.projection(e.id)).allZones().reduce((sum, z) => sum + ((z.occupancy ?? 0) >= k ? z.occupancy! : 0), 0);
  return n >= k ? n : null;
}

/**
 * Who may see an event's detail page.
 * - draft: operators only.
 * - unlisted (Private Invitation): operators, or an attendee registered for it. Everyone else gets 404,
 *   indistinguishable from a slug that does not exist.
 */
export async function canSeeEvent(app: AppContext, e: EventRow, ctx: AuthContext | null): Promise<boolean> {
  const operator = ctx?.kind === "operator";
  if (operator) return true;
  if (e.state === "draft") return false;
  if (e.listed_bool) return true;
  if (ctx?.kind !== "attendee") return false;
  const regs = await app.repos.registrations.forAttendee(ctx.sub);
  return regs.some((r) => r.event_id === e.id && r.state !== "cancelled");
}

export function eventRoutes(x: Express, app: AppContext) {
  mount(x, app, endpoints.listEvents, async ({ query, ctx }) => {
    let rows: EventRow[];
    if (query.scope === "all") {
      // Every state, listed or not: operators only. Refused (not silently narrowed) for anyone else.
      if (ctx?.kind !== "operator") throw new ContractError("FORBIDDEN");
      rows = await app.repos.events.listAll({ state: query.state, q: query.q, after: decodeCursor(query.cursor), limit: query.limit + 1 });
    } else if (query.scope === "work") {
      // The events the caller may work, unlisted ones included: operators (admin, organiser,
      // supervisor) every published or live event; a desk clerk only their desk events. Never public.
      const working = ["published", "live"] as const;
      if (ctx?.kind === "operator") {
        rows = await app.repos.events.listAll({ state: query.state, states: working, q: query.q, after: decodeCursor(query.cursor), limit: query.limit + 1 });
      } else if (ctx?.role === "desk_clerk") {
        const after = decodeCursor(query.cursor);
        const needle = query.q?.toLowerCase();
        const mine = [];
        for (const id of await deskEventIds(app, ctx.sub)) {
          const e = await app.repos.events.byId(id);
          if (e && (working as readonly string[]).includes(e.state) && (!query.state || e.state === query.state) && (!needle || e.title.toLowerCase().includes(needle))) mine.push(e);
        }
        rows = mine
          .filter(isScheduled)
          .sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime() || a.id.localeCompare(b.id))
          .filter((e) => !after || e.starts_at > after.starts_at || (e.starts_at.getTime() === after.starts_at.getTime() && e.id > after.id))
          .slice(0, query.limit + 1);
      } else {
        throw new ContractError("FORBIDDEN");
      }
    } else {
      // Discovery: published or live, listed only. Any other requested state matches nothing.
      if (query.state && query.state !== "published" && query.state !== "live") return { items: [], next_cursor: null };
      rows = await app.repos.events.listPublic({
        state: query.state as "published" | "live" | undefined,
        q: query.q,
        after: decodeCursor(query.cursor),
        limit: query.limit + 1,
      });
    }
    // Drafts without dates sort last and have no public card: they are listed by GET /admin/events.
    const scheduled = rows.filter(isScheduled);
    const page = scheduled.slice(0, query.limit);
    return {
      items: await Promise.all(page.map((e) => summary(app, e))),
      next_cursor: scheduled.length > query.limit ? encodeCursor(page[page.length - 1]!) : null,
    };
  });

  mount(x, app, endpoints.getEvent, async ({ params, ctx }) => {
    const e = await app.repos.events.bySlug(params.slug);
    if (!e || !isScheduled(e) || !(await canSeeEvent(app, e, ctx))) throw new ContractError("NOT_FOUND");
    return detailOf(app, e);
  });

  mount(x, app, endpoints.eventSessions, async ({ params, ctx }) => {
    const e = await app.repos.events.byId(params.id);
    if (!e || !(await canSeeEvent(app, e, ctx))) throw new ContractError("NOT_FOUND");
    return { items: (await app.repos.events.sessions(e.id)).map(sessionDto) };
  });
}

/** Public detail of an event (the caller has already checked visibility). */
export async function detailOf(app: AppContext, e: ScheduledEvent): Promise<EventDetail> {
  return { ...(await summary(app, e)), ...(await roomsAndSessions(app, e)) };
}

export const sessionDto = (s: SessionRow) => ({
  id: s.id, event_id: s.event_id, room_id: s.room_id, title: s.title, starts_at: s.starts_at.toISOString(), ends_at: s.ends_at.toISOString(),
});

/** Description, rooms (with the capacity in force) and sessions; `overrides` adds each room's own override (operator views). */
export async function roomsAndSessions(app: AppContext, e: EventRow, overrides = false) {
  const eventRooms = await app.repos.events.rooms(e.id);
  const rooms = await app.repos.venues.roomsByIds(eventRooms.map((r) => r.room_id));
  const sessions = await app.repos.events.sessions(e.id);
  return {
    description: e.description,
    rooms: rooms
      .map((r) => {
        const override = eventRooms.find((er) => er.room_id === r.id)?.capacity_override ?? null;
        return { room_id: r.id, name: r.name, zone_id: r.zone_id, capacity: override ?? r.capacity, ...(overrides ? { capacity_override: override } : {}) };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
    sessions: sessions.map(sessionDto),
  };
}
