/**
 * Slice 2 — events: create, patch, the guarded lifecycle, summary, profile schema, the tier × room
 * access-rule matrix with versioning and explicit republish, and the operator dashboard.
 *
 * Lifecycle (01 §9): draft → published → live → closed → archived, one step at a time.
 *   publish  needs a pass template and at least one room with capacity > 0 (refused with the list
 *            of unmet requirements in `issues`);
 *   close    stamps closed_at with server time — the retention clock (03 §6) starts there.
 * Editing: slug only while draft; rooms only while draft or published; nothing once closed.
 * Access rules: PUT replaces the whole matrix only if `expected_version` is current (409 otherwise);
 * that PUT is the explicit republish 01 §4 asks for, and it is audited with a diff summary.
 */
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { ContractError } from "@synan/contracts/errors";
import { endpoints, ProfileField, type EventAdmin } from "@synan/contracts/rest";
import { ATTENDEE_TIER_VALUES, ROLE_VALUES } from "@synan/contracts/enums";
import type { AppContext } from "../app.js";
import { mount } from "../http/route.js";
import type { AccessRuleRow, EventRoomRow, EventRow } from "../repo/types.js";
import { canSeeEvent, detailOf } from "./events.js";

type Json = Record<string, unknown>;
const invalid = (path: string, message: string) => new ContractError("VALIDATION_FAILED", message, [{ path, message }]);
const NEXT: Record<string, "live" | "closed" | "archived" | undefined> = { published: "live", live: "closed", closed: "archived" };

export async function adminDto(app: AppContext, e: EventRow): Promise<EventAdmin> {
  return {
    ...(await detailOf(app, e)),
    org_id: e.org_id,
    listed: e.listed_bool,
    grace_buffer_hours: e.grace_buffer,
    pass_template: e.pass_template_jsonb,
    access_rules_version: e.access_rules_version,
    closed_at: e.closed_at?.toISOString() ?? null,
  };
}

const ruleDto = (r: AccessRuleRow) => ({
  id: r.id, event_id: r.event_id, subject_kind: r.subject_kind, subject: r.subject, room_id: r.room_id,
  window_start: r.window_start?.toISOString() ?? null, window_end: r.window_end?.toISOString() ?? null, effect: r.effect,
});

export function eventAdminRoutes(x: Express, app: AppContext) {
  const audit = (actor: string, action: string, target: string, meta: Json = {}) => app.audit.append({ actorId: actor, action, target, meta });
  const eventOr404 = async (id: string) => {
    const e = await app.repos.events.byId(id);
    if (!e) throw new ContractError("NOT_FOUND");
    return e;
  };
  /** Rooms must belong to the event's venue (event_rooms_same_venue trigger). */
  const roomsInVenue = async (venueId: string, rooms: { room_id: string; capacity_override?: number | null }[]): Promise<EventRoomRow[]> => {
    const ids = rooms.map((r) => r.room_id);
    if (new Set(ids).size !== ids.length) throw invalid("body.rooms", "a room is listed twice");
    const found = await app.repos.venues.roomsByIds(ids);
    for (const r of rooms) {
      if (!found.some((f) => f.id === r.room_id && f.venue_id === venueId)) throw invalid("body.rooms", `room ${r.room_id} is not in this venue`);
    }
    return rooms.map((r) => ({ event_id: "", room_id: r.room_id, capacity_override: r.capacity_override ?? null }));
  };
  const timesInOrder = (starts: Date, ends: Date) => {
    if (ends.getTime() <= starts.getTime()) throw invalid("body.ends_at", "ends_at must be after starts_at");
  };
  const profileFields = (v: unknown[]) => v.filter((f) => ProfileField.safeParse(f).success);

  mount(x, app, endpoints.getEventAdmin, async ({ params }) => adminDto(app, await eventOr404(params.id)));

  mount(x, app, endpoints.createEvent, async ({ body, ctx }) => {
    const venue = await app.repos.venues.venue(body.venue_id);
    if (!venue) throw invalid("body.venue_id", "venue not found");
    if (await app.repos.events.bySlug(body.slug)) throw new ContractError("CONFLICT", "That slug is already used by another event.");
    const starts = new Date(body.starts_at);
    const ends = new Date(body.ends_at);
    timesInOrder(starts, ends);
    const rooms = await roomsInVenue(venue.id, body.rooms);
    const id = randomUUID();
    const row: EventRow = {
      id, org_id: venue.org_id, venue_id: venue.id, slug: body.slug, title: body.title, description: body.description ?? null,
      starts_at: starts, ends_at: ends, timezone: body.timezone, state: "draft", listed_bool: body.listed, grace_buffer: body.grace_buffer_hours,
      pass_template_jsonb: (body.pass_template ?? null) as Json | null, profile_schema_jsonb: body.profile_schema ?? [],
      access_rules_version: 0, revocation_epoch: 0, closed_at: null,
    };
    await app.repos.fixtures.event(row);
    for (const r of rooms) await app.repos.fixtures.eventRoom({ ...r, event_id: id });
    await audit(ctx!.sub, "event.create", `event:${id}`, { slug: row.slug, listed: row.listed_bool });
    return adminDto(app, row);
  });

  mount(x, app, endpoints.updateEvent, async ({ params, body, ctx }) => {
    const e = await eventOr404(params.id);
    if (e.state === "closed" || e.state === "archived") throw new ContractError("CONFLICT", "A closed or archived event cannot be edited.");
    if (body.slug !== undefined && body.slug !== e.slug) {
      if (e.state !== "draft") throw new ContractError("CONFLICT", "The slug is fixed once the event is published (links are out).");
      if (await app.repos.events.bySlug(body.slug)) throw new ContractError("CONFLICT", "That slug is already used by another event.");
    }
    const starts = body.starts_at ? new Date(body.starts_at) : e.starts_at;
    const ends = body.ends_at ? new Date(body.ends_at) : e.ends_at;
    timesInOrder(starts, ends);
    if (body.rooms !== undefined) {
      if (e.state !== "draft" && e.state !== "published") throw new ContractError("CONFLICT", "Rooms are fixed once the event is live.");
      const rooms = await roomsInVenue(e.venue_id, body.rooms);
      await app.repos.events.setRooms(e.id, rooms.map((r) => ({ ...r, event_id: e.id })));
      app.scans.forgetProjections();
    }
    const updated = await app.repos.events.update(e.id, {
      ...(body.slug !== undefined ? { slug: body.slug } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.starts_at !== undefined ? { starts_at: starts } : {}),
      ...(body.ends_at !== undefined ? { ends_at: ends } : {}),
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      ...(body.listed !== undefined ? { listed_bool: body.listed } : {}),
      ...(body.grace_buffer_hours !== undefined ? { grace_buffer: body.grace_buffer_hours } : {}),
      ...(body.pass_template !== undefined ? { pass_template_jsonb: body.pass_template as Json | null } : {}),
      ...(body.profile_schema !== undefined ? { profile_schema_jsonb: body.profile_schema } : {}),
    });
    await audit(ctx!.sub, "event.update", `event:${e.id}`, { fields: Object.keys(body) });
    return adminDto(app, updated);
  });

  mount(x, app, endpoints.publishEvent, async ({ params, ctx }) => {
    const e = await eventOr404(params.id);
    if (e.state !== "draft") throw new ContractError("CONFLICT", `Only a draft can be published (this event is ${e.state}).`);
    const issues: { path: string; message: string }[] = [];
    if (!e.pass_template_jsonb) issues.push({ path: "pass_template", message: "a pass template is required" });
    const eventRooms = await app.repos.events.rooms(e.id);
    const rooms = await app.repos.venues.roomsByIds(eventRooms.map((r) => r.room_id));
    const withCapacity = eventRooms.some((er) => (er.capacity_override ?? rooms.find((r) => r.id === er.room_id)?.capacity ?? 0) > 0);
    if (!withCapacity) issues.push({ path: "rooms", message: "at least one room with capacity is required" });
    if (issues.length) throw new ContractError("CONFLICT", "The event is not ready to publish.", issues);
    const updated = await app.repos.events.update(e.id, { state: "published" });
    await audit(ctx!.sub, "event.publish", `event:${e.id}`, {});
    return adminDto(app, updated);
  });

  mount(x, app, endpoints.transitionEvent, async ({ params, body, ctx }) => {
    const e = await eventOr404(params.id);
    if (NEXT[e.state] !== body.state) throw new ContractError("CONFLICT", `An event that is ${e.state} cannot move to ${body.state}.`);
    const patch: Partial<EventRow> = { state: body.state };
    if (body.state === "closed") patch.closed_at = new Date(app.clock.now()); // the retention clock starts (03 §6)
    const updated = await app.repos.events.update(e.id, patch);
    await audit(ctx!.sub, `event.${body.state === "live" ? "go_live" : body.state === "closed" ? "close" : "archive"}`, `event:${e.id}`, {
      from: e.state, to: body.state,
    });
    app.scans.forgetProjections();
    return adminDto(app, updated);
  });

  mount(x, app, endpoints.eventSummary, async ({ params }) => {
    const e = await eventOr404(params.id);
    const regs = (await app.repos.registrations.forEvent(e.id)).filter((r) => r.state !== "cancelled");
    const byTier = Object.fromEntries(ATTENDEE_TIER_VALUES.map((t) => [t, regs.filter((r) => r.tier === t).length])) as Record<(typeof ATTENDEE_TIER_VALUES)[number], number>;
    const onSite = e.state === "live" ? (await app.scans.projection(e.id)).zoneOf.size : 0;
    const open = await app.repos.alerts.list({ eventId: e.id, state: "open", limit: 100_000 });
    return {
      event_id: e.id,
      registered: regs.length,
      checked_in: regs.filter((r) => r.checked_in_at !== null).length,
      on_site: onSite,
      by_tier: byTier,
      open_alerts: open.length,
      as_of: new Date(app.clock.now()).toISOString(),
    };
  });

  mount(x, app, endpoints.profileSchema, async ({ params, ctx }) => {
    const e = await app.repos.events.bySlug(params.slug);
    if (!e || !(await canSeeEvent(app, e, ctx))) throw new ContractError("NOT_FOUND");
    return { event_slug: e.slug, fields: profileFields(e.profile_schema_jsonb) as never };
  });

  mount(x, app, endpoints.getAccessRules, async ({ params }) => {
    const e = await eventOr404(params.id);
    return { version: e.access_rules_version, rules: (await app.repos.events.accessRules(e.id)).map(ruleDto) };
  });

  mount(x, app, endpoints.putAccessRules, async ({ params, body, ctx }) => {
    const e = await eventOr404(params.id);
    if (e.state === "closed" || e.state === "archived") throw new ContractError("CONFLICT", "Access rules of a closed event are frozen.");
    // Changing who may enter while doors are open is privileged: a fresh second factor is required.
    if (e.state === "live" && !app.auth.isMfaFresh(ctx!)) throw new ContractError("MFA_REQUIRED");
    const eventRoomIds = new Set((await app.repos.events.rooms(e.id)).map((r) => r.room_id));
    const rules: AccessRuleRow[] = body.rules.map((r, i) => {
      const at = `body.rules.${i}`;
      if (r.subject_kind === "tier" && !(ATTENDEE_TIER_VALUES as readonly string[]).includes(r.subject)) throw invalid(`${at}.subject`, "not a tier");
      if (r.subject_kind === "role" && !(ROLE_VALUES as readonly string[]).includes(r.subject)) throw invalid(`${at}.subject`, "not a role");
      if (!eventRoomIds.has(r.room_id)) throw invalid(`${at}.room_id`, "room is not part of this event");
      const ws = r.window_start ? new Date(r.window_start) : null;
      const we = r.window_end ? new Date(r.window_end) : null;
      if (ws && we && we.getTime() <= ws.getTime()) throw invalid(`${at}.window_end`, "window_end must be after window_start");
      return { id: randomUUID(), event_id: e.id, subject_kind: r.subject_kind, subject: r.subject, room_id: r.room_id, window_start: ws, window_end: we, effect: r.effect };
    });
    const before = await app.repos.events.accessRules(e.id);
    const key = (r: { subject_kind: string; subject: string; room_id: string; effect: string; window_start: Date | null; window_end: Date | null }) =>
      `${r.subject_kind}|${r.subject}|${r.room_id}|${r.effect}|${r.window_start?.getTime() ?? ""}|${r.window_end?.getTime() ?? ""}`;
    const was = new Set(before.map(key));
    const now = new Set(rules.map(key));
    const version = await app.repos.events.replaceAccessRules(e.id, body.expected_version, rules);
    if (version === null) throw new ContractError("CONFLICT", "The access rules were republished by someone else. Reload and review the change.");
    await audit(ctx!.sub, "access_rules.republish", `event:${e.id}`, {
      version, live: e.state === "live",
      added: [...now].filter((k) => !was.has(k)).length, removed: [...was].filter((k) => !now.has(k)).length,
    });
    return { version, rules: (await app.repos.events.accessRules(e.id)).map(ruleDto) };
  });

  mount(x, app, endpoints.dashboard, async () => {
    const live = await app.repos.events.listAll({ state: "live", limit: 1000 });
    const now = app.clock.now();
    let onSite = 0;
    let gatesOffline = 0;
    for (const e of live) {
      onSite += (await app.scans.projection(e.id)).zoneOf.size;
      for (const cp of await app.repos.venues.checkpointsOfVenue(e.venue_id)) {
        const g = app.scans.gates.get(cp.id);
        if (!g || now - g.lastSeenAt > 60_000) gatesOffline++;
      }
    }
    const open = await app.repos.alerts.list({ state: "open", limit: 100_000 });
    return { live_events: live.length, on_site: onSite, open_alerts: open.length, gates_offline: gatesOffline, as_of: new Date(now).toISOString() };
  });
}
