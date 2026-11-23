import type { Express } from "express";
import { ContractError } from "@synan/contracts/errors";
import { endpoints, type EventDetail, type EventSummary } from "@synan/contracts/rest";
import type { AppContext } from "../app.js";
import type { AuthContext } from "../domain/principal.js";
import { mount } from "../http/route.js";
import type { EventRow } from "../repo/types.js";

const encodeCursor = (e: EventRow) => Buffer.from(JSON.stringify({ s: e.starts_at.toISOString(), i: e.id })).toString("base64url");
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

export async function summary(app: AppContext, e: EventRow): Promise<EventSummary> {
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
  };
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
    const page = rows.slice(0, query.limit);
    return {
      items: await Promise.all(page.map((e) => summary(app, e))),
      next_cursor: rows.length > query.limit ? encodeCursor(page[page.length - 1]!) : null,
    };
  });

  mount(x, app, endpoints.getEvent, async ({ params, ctx }) => {
    const e = await app.repos.events.bySlug(params.slug);
    if (!e || !(await canSeeEvent(app, e, ctx))) throw new ContractError("NOT_FOUND");
    return detailOf(app, e);
  });

  mount(x, app, endpoints.eventSessions, async ({ params, ctx }) => {
    const e = await app.repos.events.byId(params.id);
    if (!e || !(await canSeeEvent(app, e, ctx))) throw new ContractError("NOT_FOUND");
    const sessions = await app.repos.events.sessions(e.id);
    return {
      items: sessions.map((s) => ({
        id: s.id,
        event_id: s.event_id,
        room_id: s.room_id,
        title: s.title,
        starts_at: s.starts_at.toISOString(),
        ends_at: s.ends_at.toISOString(),
      })),
    };
  });
}

/** Public detail of an event (the caller has already checked visibility). */
export async function detailOf(app: AppContext, e: EventRow): Promise<EventDetail> {
  {
    const eventRooms = await app.repos.events.rooms(e.id);
    const rooms = await app.repos.venues.roomsByIds(eventRooms.map((r) => r.room_id));
    const sessions = await app.repos.events.sessions(e.id);
    const detail: EventDetail = {
      ...(await summary(app, e)),
      description: e.description,
      rooms: rooms.map((r) => ({
        room_id: r.id,
        name: r.name,
        zone_id: r.zone_id,
        capacity: eventRooms.find((er) => er.room_id === r.id)?.capacity_override ?? r.capacity,
      })),
      sessions: sessions.map((s) => ({
        id: s.id,
        event_id: s.event_id,
        room_id: s.room_id,
        title: s.title,
        starts_at: s.starts_at.toISOString(),
        ends_at: s.ends_at.toISOString(),
      })),
    };
    return detail;
  }
}
