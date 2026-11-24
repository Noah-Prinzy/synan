/**
 * Slice 2 — events: drafts, the guarded lifecycle, the readiness checklist, sessions, summary, profile
 * schema, the tier × room access-rule matrix with versioning and explicit republish, and the operator
 * dashboard and event list.
 *
 * Drafts (06 D5): the wizard writes a draft on every step, so a draft may have no venue and no dates
 * yet; `wizard_step` keeps the furthest step reached. Every later state has venue and dates (the
 * database enforces it: events_scheduled_unless_draft).
 * Lifecycle (01 §9): draft → published → live → closed → archived, one step at a time.
 *   publish  is refused while a blocking line of the readiness checklist is unmet (P-13), with the
 *            unmet lines in `issues` (path = the checklist key); GET /events/:id/readiness is the
 *            same checklist;
 *   close    stamps closed_at with server time — the retention clock (03 §6) starts there.
 * Editing: slug and venue only while draft; the set of rooms while draft or published (live: only
 * their capacity overrides); nothing once closed.
 * Access rules: PUT replaces the whole matrix only if `expected_version` is current (409 otherwise);
 * that PUT is the explicit republish 01 §4 asks for, audited with a diff summary; who and when is kept.
 * Sessions: in one of the event's rooms, inside its dates, not overlapping another session in the same
 * room. A change of time or room, or a deletion, is announced to the registered attendees of a
 * published or live event, in generic words that never name a room (03 §5).
 */
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { ContractError } from "@synan/contracts/errors";
import { endpoints, ProfileField, type EventAdmin, type KpiSeries, type OperatorRef, type ReadinessItem } from "@synan/contracts/rest";
import { ATTENDEE_TIER_VALUES, ROLE_VALUES, WIZARD_STEP_VALUES, type WizardStep } from "@synan/contracts/enums";
import type { AppContext } from "../app.js";
import { NOTE } from "../domain/notifications.js";
import { mount } from "../http/route.js";
import { JOB } from "../jobs.js";
import { isScheduled, type AccessRuleRow, type BreachAlertRow, type EventRoomRow, type EventRow, type RegistrationRow, type SessionRow } from "../repo/types.js";
import { canSeeEvent, roomsAndSessions, sessionDto } from "./events.js";

type Json = Record<string, unknown>;
const invalid = (path: string, message: string) => new ContractError("VALIDATION_FAILED", message, [{ path, message }]);
const NEXT: Record<string, "live" | "closed" | "archived" | undefined> = { published: "live", live: "closed", closed: "archived" };
const SLUG_TAKEN = () => new ContractError("CONFLICT", "That slug is already used by another event.", [{ path: "body.slug", message: "Another event already uses this address." }]);
const furthest = (a: WizardStep | undefined, b: WizardStep): WizardStep =>
  WIZARD_STEP_VALUES[Math.max(WIZARD_STEP_VALUES.indexOf(a ?? "basics"), WIZARD_STEP_VALUES.indexOf(b))]!;

/** "Last edited by": the operator's display name, else their email. */
export async function operatorRef(app: AppContext, userId: string | null | undefined): Promise<OperatorRef | null> {
  if (!userId) return null;
  const u = await app.repos.users.byId(userId);
  return u ? { id: u.id, name: u.display_name || u.email } : null;
}

export async function adminDto(app: AppContext, e: EventRow): Promise<EventAdmin> {
  const venue = e.venue_id ? await app.repos.venues.venue(e.venue_id) : null;
  const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    starts_at: iso(e.starts_at),
    ends_at: iso(e.ends_at),
    timezone: e.timezone,
    state: e.state,
    venue: venue ? { id: venue.id, name: venue.name, city: venue.city ?? null } : null,
    on_site: null,
    ...(await roomsAndSessions(app, e, true)),
    org_id: e.org_id,
    listed: e.listed_bool,
    grace_buffer_hours: e.grace_buffer,
    pass_template: e.pass_template_jsonb,
    access_rules_version: e.access_rules_version,
    closed_at: iso(e.closed_at),
    wizard_step: e.wizard_step ?? "basics",
    published_at: iso(e.published_at),
    created_at: iso(e.created_at) ?? undefined,
    updated_at: iso(e.updated_at) ?? undefined,
    updated_by: await operatorRef(app, e.updated_by),
    contact: e.contact_name || e.contact_email ? { name: e.contact_name ?? null, email: e.contact_email ?? null } : null,
  };
}

const ruleDto = (r: AccessRuleRow) => ({
  id: r.id, event_id: r.event_id, subject_kind: r.subject_kind, subject: r.subject, room_id: r.room_id,
  window_start: r.window_start?.toISOString() ?? null, window_end: r.window_end?.toISOString() ?? null, effect: r.effect,
});

/**
 * The readiness checklist (06 D5 review, D6.1; P-13). Blocking lines guard publish; the others are
 * advice. Composed from repository reads, so both storage backends answer alike.
 */
export async function readinessOf(app: AppContext, e: EventRow): Promise<ReadinessItem[]> {
  const eventRooms = await app.repos.events.rooms(e.id);
  const roomRows = await app.repos.venues.roomsByIds(eventRooms.map((r) => r.room_id));
  const rooms = roomRows.map((r) => ({ ...r, capacity: eventRooms.find((er) => er.room_id === r.id)?.capacity_override ?? r.capacity }));
  const venue = e.venue_id ? await app.repos.venues.venue(e.venue_id) : null;
  const checkpoints = venue ? await app.repos.venues.checkpointsOfVenue(venue.id) : [];
  const rules = await app.repos.events.accessRules(e.id);
  const shifts = await app.repos.staff.list({ eventId: e.id, offset: 0, limit: 10_000 });
  const sessions = await app.repos.events.sessions(e.id);
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

  const datesOk = !!e.starts_at && !!e.ends_at && e.ends_at > e.starts_at;
  const basics = e.title.trim().length > 0 && datesOk;
  const zeroCap = rooms.filter((r) => r.capacity <= 0);
  const tiers = ATTENDEE_TIER_VALUES.filter((t) => rules.some((r) => r.subject_kind === "tier" && r.subject === t && r.effect === "permit"));
  const doorless = rooms.filter((r) => !checkpoints.some((c) => c.room_id === r.id));
  const outside = e.starts_at && e.ends_at ? sessions.filter((s) => s.starts_at < e.starts_at! || s.ends_at > e.ends_at!) : [];
  return [
    { key: "basics", label: "Name and dates", met: basics, blocking: true, step: "basics",
      detail: basics ? "Named, with start and end dates." : "Add the event's name and its start and end dates." },
    { key: "venue", label: "Venue", met: !!venue, blocking: true, step: "venue", detail: venue ? venue.name : "Choose where the event is held." },
    { key: "rooms", label: "At least one room", met: rooms.length > 0, blocking: true, step: "venue",
      detail: rooms.length > 0 ? `${n(rooms.length, "room")} in use.` : "Pick the rooms this event uses." },
    { key: "capacity", label: "Capacity on every room", met: rooms.length > 0 && zeroCap.length === 0, blocking: true, step: "venue",
      detail: rooms.length === 0 ? "Set once rooms are picked."
        : zeroCap.length === 0 ? `${rooms.reduce((s, r) => s + r.capacity, 0)} places in total.`
        : `${zeroCap.map((r) => r.name).join(", ")} ${zeroCap.length === 1 ? "has" : "have"} no capacity.` },
    { key: "rules", label: "Access rules", met: tiers.length > 0, blocking: false, step: "access",
      detail: tiers.length === 0 ? "No tier can enter any room yet. Attendees would be refused at every door." : `${tiers.length} of 4 tiers can enter at least one room.` },
    { key: "pass", label: "Pass template", met: e.pass_template_jsonb !== null, blocking: true, step: "pass",
      detail: e.pass_template_jsonb ? "Set." : "Set up the pass attendees will carry." },
    { key: "email", label: "Sending domain verified", met: false, blocking: false, step: null,
      detail: "No email provider is connected to this server yet, so passes are not sent from a verified domain." },
    { key: "staff", label: "Gate staff assigned", met: shifts.length > 0, blocking: false, step: null,
      detail: shifts.length > 0 ? `${n(shifts.length, "shift")} assigned.` : "Assign staff to gates before doors open." },
    { key: "doors", label: "A door gate on every room", met: rooms.length > 0 && doorless.length === 0, blocking: false, step: null,
      detail: rooms.length === 0 ? "Set once rooms are picked." : doorless.length === 0 ? "Every room has a door gate."
        : `${doorless.map((r) => r.name).join(", ")} ${doorless.length === 1 ? "has" : "have"} no door gate, so ${doorless.length === 1 ? "its" : "their"} occupancy is not counted.` },
    { key: "gate", label: "A perimeter gate", met: checkpoints.some((c) => c.perimeter_bool), blocking: false, step: null,
      detail: checkpoints.some((c) => c.perimeter_bool) ? "The venue has an entrance that accepts QR codes." : "Add an entrance gate in the venue editor: QR codes are accepted only at the perimeter." },
    { key: "sessions", label: "Sessions inside the event's dates", met: outside.length === 0, blocking: false, step: null,
      detail: outside.length === 0 ? `${n(sessions.length, "session")} scheduled.` : `${n(outside.length, "session")} fall${outside.length === 1 ? "s" : ""} outside the event's dates.` },
  ];
}

/** Open at `t`: raised by then and not yet acknowledged (or resolved, for one never acknowledged). */
function openAt(a: BreachAlertRow, t: number): boolean {
  if (a.occurred_at.getTime() > t) return false;
  const ended = a.acked_at ?? a.resolved_at ?? (a.state === "open" ? null : a.occurred_at);
  return ended === null || ended.getTime() > t;
}

export function eventAdminRoutes(x: Express, app: AppContext) {
  const audit = (actor: string, action: string, target: string, meta: Json = {}) => app.audit.append({ actorId: actor, action, target, meta });
  const eventOr404 = async (id: string) => {
    const e = await app.repos.events.byId(id);
    if (!e) throw new ContractError("NOT_FOUND");
    return e;
  };
  const touch = (e: EventRow, actor: string) => app.repos.events.update(e.id, { updated_by: actor });
  /** Rooms must belong to the event's venue (event_rooms_same_venue trigger). */
  const roomsInVenue = async (venueId: string | null, rooms: { room_id: string; capacity_override?: number | null }[]): Promise<EventRoomRow[]> => {
    if (rooms.length && !venueId) throw invalid("body.rooms", "choose the venue first");
    const ids = rooms.map((r) => r.room_id);
    if (new Set(ids).size !== ids.length) throw invalid("body.rooms", "a room is listed twice");
    const found = await app.repos.venues.roomsByIds(ids);
    for (const r of rooms) {
      if (!found.some((f) => f.id === r.room_id && f.venue_id === venueId)) throw invalid("body.rooms", `room ${r.room_id} is not in this venue`);
    }
    return rooms.map((r) => ({ event_id: "", room_id: r.room_id, capacity_override: r.capacity_override ?? null }));
  };
  const timesInOrder = (starts: Date | null, ends: Date | null) => {
    if (starts && ends && ends.getTime() <= starts.getTime()) throw invalid("body.ends_at", "ends_at must be after starts_at");
  };
  const profileFields = (v: unknown[]) => v.filter((f) => ProfileField.safeParse(f).success);

  mount(x, app, endpoints.getEventAdmin, async ({ params }) => adminDto(app, await eventOr404(params.id)));

  /* ---- the operators' event list (06 D4) ---- */
  mount(x, app, endpoints.listEventsAdmin, async ({ query }) => {
    let after: { updated_at: Date; id: string } | undefined;
    if (query.cursor) {
      try {
        const c = JSON.parse(Buffer.from(query.cursor, "base64url").toString()) as { u: string; i: string };
        const d = new Date(c.u);
        if (Number.isNaN(d.getTime()) || typeof c.i !== "string") throw new Error();
        after = { updated_at: d, id: c.i };
      } catch {
        throw invalid("query.cursor", "invalid cursor");
      }
    }
    const rows = await app.repos.events.listAdmin({ state: query.state, q: query.q, venueId: query.venue_id, after, limit: query.limit + 1 });
    const page = rows.slice(0, query.limit);
    const counts = await app.repos.registrations.countByEvent(page.map((e) => e.id));
    const venues = new Map<string, { id: string; name: string; city: string | null } | null>();
    const people = new Map<string, OperatorRef | null>();
    const items = [];
    for (const e of page) {
      if (e.venue_id && !venues.has(e.venue_id)) {
        const v = await app.repos.venues.venue(e.venue_id);
        venues.set(e.venue_id, v ? { id: v.id, name: v.name, city: v.city ?? null } : null);
      }
      if (e.updated_by && !people.has(e.updated_by)) people.set(e.updated_by, await operatorRef(app, e.updated_by));
      const c = counts.get(e.id) ?? { registered: 0, checked_in: 0 };
      items.push({
        id: e.id, slug: e.slug, title: e.title, state: e.state, starts_at: e.starts_at?.toISOString() ?? null, ends_at: e.ends_at?.toISOString() ?? null,
        timezone: e.timezone, listed: e.listed_bool, venue: e.venue_id ? (venues.get(e.venue_id) ?? null) : null,
        registrations: c.registered, checked_in: c.checked_in, wizard_step: e.wizard_step ?? "basics", published_at: e.published_at?.toISOString() ?? null,
        created_at: (e.created_at ?? new Date(0)).toISOString(), updated_at: (e.updated_at ?? new Date(0)).toISOString(),
        updated_by: e.updated_by ? (people.get(e.updated_by) ?? null) : null,
      });
    }
    const last = page.at(-1);
    return {
      items,
      next_cursor: rows.length > query.limit && last ? Buffer.from(JSON.stringify({ u: last.updated_at!.toISOString(), i: last.id })).toString("base64url") : null,
    };
  });

  /* ---- drafts ---- */
  mount(x, app, endpoints.createEvent, async ({ body, ctx }) => {
    const venue = body.venue_id ? await app.repos.venues.venue(body.venue_id) : null;
    if (body.venue_id && !venue) throw invalid("body.venue_id", "venue not found");
    const [org] = await app.repos.venues.organizations();
    if (!venue && !org) throw new ContractError("CONFLICT", "Create the organisation first (first-run setup).");
    if (await app.repos.events.bySlug(body.slug)) throw SLUG_TAKEN();
    const starts = body.starts_at ? new Date(body.starts_at) : null;
    const ends = body.ends_at ? new Date(body.ends_at) : null;
    timesInOrder(starts, ends);
    const rooms = await roomsInVenue(venue?.id ?? null, body.rooms);
    const id = randomUUID();
    const row: EventRow = {
      id, org_id: venue?.org_id ?? org!.id, venue_id: venue?.id ?? null, slug: body.slug, title: body.title, description: body.description ?? null,
      starts_at: starts, ends_at: ends, timezone: body.timezone, state: "draft", listed_bool: body.listed, grace_buffer: body.grace_buffer_hours,
      pass_template_jsonb: (body.pass_template ?? null) as Json | null, profile_schema_jsonb: body.profile_schema ?? [],
      access_rules_version: 0, revocation_epoch: 0, closed_at: null, wizard_step: body.wizard_step ?? "basics", published_at: null, updated_by: ctx!.sub,
      ...(body.contact ? { contact_name: body.contact.name ?? null, contact_email: body.contact.email ?? null } : {}),
    };
    await app.repos.fixtures.event(row);
    for (const r of rooms) await app.repos.fixtures.eventRoom({ ...r, event_id: id });
    await audit(ctx!.sub, "event.create", `event:${id}`, { slug: row.slug, listed: row.listed_bool });
    return adminDto(app, (await app.repos.events.byId(id))!);
  });

  mount(x, app, endpoints.updateEvent, async ({ params, body, ctx }) => {
    let e = await eventOr404(params.id);
    if (e.state === "closed" || e.state === "archived") throw new ContractError("CONFLICT", "A closed or archived event cannot be edited.");
    const draft = e.state === "draft";
    if (body.slug !== undefined && body.slug !== e.slug) {
      if (!draft) throw new ContractError("CONFLICT", "The slug is fixed once the event is published (links are out).");
      if (await app.repos.events.bySlug(body.slug)) throw SLUG_TAKEN();
    }
    if ((body.starts_at === null || body.ends_at === null) && !draft) throw invalid(body.starts_at === null ? "body.starts_at" : "body.ends_at", "a published event keeps its dates");
    const starts = body.starts_at === undefined ? e.starts_at : body.starts_at === null ? null : new Date(body.starts_at);
    const ends = body.ends_at === undefined ? e.ends_at : body.ends_at === null ? null : new Date(body.ends_at);
    timesInOrder(starts, ends);
    if (body.venue_id !== undefined && body.venue_id !== e.venue_id) {
      if (!draft) throw new ContractError("CONFLICT", "The venue is fixed once the event is published.");
      if (body.venue_id !== null && !(await app.repos.venues.venue(body.venue_id))) throw invalid("body.venue_id", "venue not found");
      // A new venue means new rooms: the draft's rooms go, with their sessions and access rules.
      e = await app.repos.events.setVenue(e.id, body.venue_id);
      app.scans.forgetProjections();
    }
    if (body.rooms !== undefined) {
      const rooms = await roomsInVenue(e.venue_id, body.rooms);
      if (e.state === "live") {
        // Doors are open: the set of rooms is fixed, but a room's capacity may be adjusted (06 D6.8).
        const current = new Set((await app.repos.events.rooms(e.id)).map((r) => r.room_id));
        if (rooms.length !== current.size || rooms.some((r) => !current.has(r.room_id))) {
          throw new ContractError("CONFLICT", "Rooms are fixed once the event is live; only their capacity can change.");
        }
      } else if (e.state !== "draft" && e.state !== "published") {
        throw new ContractError("CONFLICT", "Rooms are fixed once the event is live.");
      }
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
      ...(body.wizard_step !== undefined ? { wizard_step: furthest(e.wizard_step, body.wizard_step) } : {}),
      ...(body.contact === null ? { contact_name: null, contact_email: null } : {}),
      ...(body.contact?.name !== undefined ? { contact_name: body.contact.name } : {}),
      ...(body.contact?.email !== undefined ? { contact_email: body.contact.email } : {}),
      updated_by: ctx!.sub,
    });
    await audit(ctx!.sub, "event.update", `event:${e.id}`, { fields: Object.keys(body) });
    return adminDto(app, updated);
  });

  mount(x, app, endpoints.duplicateEvent, async ({ params, body, ctx }) => {
    const src = await eventOr404(params.id);
    let slug = body.slug;
    if (slug) {
      if (await app.repos.events.bySlug(slug)) throw SLUG_TAKEN();
    } else {
      const base = `${src.slug}-copy`.slice(0, 74).replace(/-+$/, "");
      slug = base;
      for (let i = 2; await app.repos.events.bySlug(slug); i++) slug = `${base}-${i}`;
    }
    const title = body.title ?? `${src.title} (copy)`.slice(0, 200);
    const id = await app.repos.events.duplicate({
      eventId: src.id, slug, title, startsAt: body.starts_at ? new Date(body.starts_at) : null, actorId: ctx!.sub, now: new Date(app.clock.now()),
    });
    return adminDto(app, (await app.repos.events.byId(id))!);
  });

  mount(x, app, endpoints.deleteEvent, async ({ params, ctx }) => {
    const e = await eventOr404(params.id);
    const r = await app.repos.events.deleteDraft(e.id);
    if (r === "not_found") throw new ContractError("NOT_FOUND");
    if (r === "not_draft") throw new ContractError("CONFLICT", "Only a draft can be deleted; close or archive a published event instead.");
    if (r === "has_registrations") throw new ContractError("CONFLICT", "People are registered for this draft: it cannot be deleted.");
    if (r === "has_history") throw new ContractError("CONFLICT", "Reports or alerts were recorded for this draft: it cannot be deleted.");
    await audit(ctx!.sub, "event.delete", `event:${e.id}`, { slug: e.slug });
    app.scans.forgetProjections();
    return { ok: true as const };
  });

  /* ---- readiness and the guarded lifecycle ---- */
  mount(x, app, endpoints.eventReadiness, async ({ params }) => {
    const e = await eventOr404(params.id);
    const items = await readinessOf(app, e);
    return { event_id: e.id, ready: items.every((i) => i.met || !i.blocking), items };
  });

  mount(x, app, endpoints.publishEvent, async ({ params, ctx }) => {
    const e = await eventOr404(params.id);
    if (e.state !== "draft") throw new ContractError("CONFLICT", `Only a draft can be published (this event is ${e.state}).`);
    const unmet = (await readinessOf(app, e)).filter((i) => i.blocking && !i.met);
    if (unmet.length) throw new ContractError("CONFLICT", "The event is not ready to publish.", unmet.map((i) => ({ path: i.key, message: i.detail })));
    const updated = await app.repos.events.update(e.id, { state: "published", published_at: new Date(app.clock.now()), wizard_step: "review", updated_by: ctx!.sub });
    await audit(ctx!.sub, "event.publish", `event:${e.id}`, {});
    return adminDto(app, updated);
  });

  mount(x, app, endpoints.transitionEvent, async ({ params, body, ctx }) => {
    const e = await eventOr404(params.id);
    if (NEXT[e.state] !== body.state) throw new ContractError("CONFLICT", `An event that is ${e.state} cannot move to ${body.state}.`);
    const patch: Partial<EventRow> = { state: body.state, updated_by: ctx!.sub };
    if (body.state === "closed") patch.closed_at = new Date(app.clock.now()); // the retention clock starts (03 §6)
    const updated = await app.repos.events.update(e.id, patch);
    await audit(ctx!.sub, `event.${body.state === "live" ? "go_live" : body.state === "closed" ? "close" : "archive"}`, `event:${e.id}`, {
      from: e.state, to: body.state,
    });
    app.scans.forgetProjections();
    if (body.state === "closed") app.jobs.kick(JOB.scheduledReport); // "on close" report schedules fire now
    return adminDto(app, updated);
  });

  /* ---- sessions (06 D6.2) ---- */
  const sessionOr404 = async (eventId: string, sessionId: string) => {
    const s = (await app.repos.events.sessions(eventId)).find((x) => x.id === sessionId);
    if (!s) throw new ContractError("NOT_FOUND");
    return s;
  };
  const editable = (e: EventRow) => {
    if (e.state === "closed" || e.state === "archived") throw new ContractError("CONFLICT", "The schedule of a closed event is frozen.");
  };
  /** The checks the mock's validateSession makes, field by field, then the same-room overlap. */
  const checkSession = async (e: EventRow, s: Omit<SessionRow, "id" | "event_id">, exceptId: string | null) => {
    const rooms = new Set((await app.repos.events.rooms(e.id)).map((r) => r.room_id));
    if (!rooms.has(s.room_id)) throw invalid("body.room_id", "Choose one of this event's rooms.");
    if (s.ends_at.getTime() <= s.starts_at.getTime()) throw invalid("body.ends_at", "The session must end after it starts.");
    if (e.starts_at && e.ends_at && (s.starts_at < e.starts_at || s.ends_at > e.ends_at)) throw invalid("body.starts_at", "Sessions must fall within the event's dates.");
    const clash = (await app.repos.events.sessions(e.id)).find(
      (o) => o.id !== exceptId && o.room_id === s.room_id && o.starts_at < s.ends_at && s.starts_at < o.ends_at,
    );
    if (clash) throw new ContractError("CONFLICT", "Another session uses this room at that time.", [{ path: "body.starts_at", message: `Overlaps “${clash.title}” in the same room.` }]);
  };
  /** Registered attendees hear about a change to a session that has not ended, once the event is published. */
  const announces = (e: EventRow, s: SessionRow) => (e.state === "published" || e.state === "live") && s.ends_at.getTime() > app.clock.now();

  mount(x, app, endpoints.createSession, async ({ params, body, ctx }) => {
    const e = await eventOr404(params.id);
    editable(e);
    const row: SessionRow = { id: randomUUID(), event_id: e.id, room_id: body.room_id, title: body.title, starts_at: new Date(body.starts_at), ends_at: new Date(body.ends_at) };
    await checkSession(e, row, null);
    await app.repos.events.insertSession(row);
    await touch(e, ctx!.sub);
    await audit(ctx!.sub, "session.create", `session:${row.id}`, { event_id: e.id, room_id: row.room_id });
    return sessionDto(row);
  });

  mount(x, app, endpoints.updateSession, async ({ params, body, ctx }) => {
    const e = await eventOr404(params.id);
    editable(e);
    const cur = await sessionOr404(e.id, params.sessionId);
    const next: SessionRow = {
      ...cur,
      ...(body.room_id !== undefined ? { room_id: body.room_id } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.starts_at !== undefined ? { starts_at: new Date(body.starts_at) } : {}),
      ...(body.ends_at !== undefined ? { ends_at: new Date(body.ends_at) } : {}),
    };
    await checkSession(e, next, cur.id);
    const updated = await app.repos.events.updateSession(cur.id, { room_id: next.room_id, title: next.title, starts_at: next.starts_at, ends_at: next.ends_at });
    await touch(e, ctx!.sub);
    const retimed = next.starts_at.getTime() !== cur.starts_at.getTime() || next.ends_at.getTime() !== cur.ends_at.getTime();
    const moved = next.room_id !== cur.room_id;
    const notify = (retimed || moved) && announces(e, cur);
    if (notify) {
      // Generic words (03 §5): the session's public title and, for a new time, the time — never the room.
      await app.notifications.sessionChanged(e.id, retimed ? NOTE.sessionChanged(next.title, next.starts_at, e.timezone) : NOTE.sessionMoved(next.title));
    }
    await audit(ctx!.sub, "session.update", `session:${cur.id}`, { event_id: e.id, fields: Object.keys(body), retimed, moved, notified: notify });
    return sessionDto(updated);
  });

  mount(x, app, endpoints.deleteSession, async ({ params, ctx }) => {
    const e = await eventOr404(params.id);
    editable(e);
    const cur = await sessionOr404(e.id, params.sessionId);
    await app.repos.events.deleteSession(cur.id);
    await touch(e, ctx!.sub);
    const notify = announces(e, cur);
    if (notify) await app.notifications.sessionChanged(e.id, NOTE.sessionCancelled(cur.title));
    await audit(ctx!.sub, "session.delete", `session:${cur.id}`, { event_id: e.id, notified: notify });
    return { ok: true as const };
  });

  /* ---- live summary ---- */
  mount(x, app, endpoints.eventSummary, async ({ params, query }) => {
    const e = await eventOr404(params.id);
    const now = app.clock.now();
    const n = query.series_minutes;
    // Per-minute series from the per-gate rollups (both backends keep them as scans arrive), zero-filled.
    const last = Math.floor(now / 60_000) * 60_000 - 60_000;
    const first = last - (n - 1) * 60_000;
    const byMinute = new Map<number, { scans: number; admitted: number; denied: number }>();
    if (n > 0) {
      for (const r of await app.repos.rollups.gateRates(e.id)) {
        const t = r.minute_start.getTime();
        if (t < first || t > last) continue;
        const m = byMinute.get(t) ?? { scans: 0, admitted: 0, denied: 0 };
        m.scans += r.scans;
        m.admitted += r.admitted;
        m.denied += r.denied;
        byMinute.set(t, m);
      }
    }
    const series = Array.from({ length: n }, (_, i) => {
      const t = first + i * 60_000;
      return { at: new Date(t).toISOString(), ...(byMinute.get(t) ?? { scans: 0, admitted: 0, denied: 0 }) };
    });
    const regs = (await app.repos.registrations.forEvent(e.id)).filter((r) => r.state !== "cancelled");
    const byTier = Object.fromEntries(ATTENDEE_TIER_VALUES.map((t) => [t, regs.filter((r) => r.tier === t).length])) as Record<(typeof ATTENDEE_TIER_VALUES)[number], number>;
    const live = e.state === "live";
    const proj = live ? await app.scans.projection(e.id) : null;
    const onSite = proj ? proj.zoneOf.size : 0;
    const risk = proj ? [...proj.rooms.keys()].filter((id) => proj.level(id) !== "ok").length : 0;
    const alerts = await app.repos.alerts.list({ eventId: e.id, limit: 100_000 });
    const open = alerts.filter((a) => a.state === "open").length;

    let kpi: KpiSeries | undefined;
    if (n > 0) {
      // Buckets: the n minutes up to and including the current one. Earlier values are the figures at
      // the end of their minute; the current minute's are the headline figures now.
      const current = Math.floor(now / 60_000) * 60_000;
      const from = current - (n - 1) * 60_000;
      const ends = Array.from({ length: n - 1 }, (_, i) => from + (i + 1) * 60_000 - 1);
      const count = (rows: RegistrationRow[], at: (r: RegistrationRow) => Date | null, t: number) => rows.filter((r) => { const d = at(r); return d !== null && d.getTime() <= t; }).length;
      const past = live && ends.length ? await app.scans.figuresAt(e.id, ends) : { onSite: ends.map(() => 0), risk: ends.map(() => 0) };
      kpi = {
        bucket_ms: 60_000,
        from: new Date(from).toISOString(),
        registered: [...ends.map((t) => count(regs, (r) => r.created_at, t)), regs.length],
        checked_in: [...ends.map((t) => count(regs, (r) => r.checked_in_at, t)), regs.filter((r) => r.checked_in_at !== null).length],
        on_site: [...past.onSite, onSite],
        capacity_risk: [...past.risk, risk],
        open_alerts: [...ends.map((t) => alerts.filter((a) => openAt(a, t)).length), open],
      };
    }
    return {
      event_id: e.id,
      registered: regs.length,
      checked_in: regs.filter((r) => r.checked_in_at !== null).length,
      on_site: onSite,
      by_tier: byTier,
      open_alerts: open,
      as_of: new Date(now).toISOString(),
      series,
      capacity_risk: risk,
      ...(kpi ? { kpi_series: kpi } : {}),
    };
  });

  mount(x, app, endpoints.profileSchema, async ({ params, ctx }) => {
    const e = await app.repos.events.bySlug(params.slug);
    if (!e || !(await canSeeEvent(app, e, ctx))) throw new ContractError("NOT_FOUND");
    return { event_slug: e.slug, fields: profileFields(e.profile_schema_jsonb) as never };
  });

  /* ---- access rules ---- */
  const ruleSet = async (e: EventRow, version: number) => {
    const v = version > 0 ? await app.repos.events.accessRuleVersion(e.id, version) : null;
    return {
      version,
      rules: (await app.repos.events.accessRules(e.id)).map(ruleDto),
      published_at: v?.published_at.toISOString() ?? null,
      published_by: await operatorRef(app, v?.published_by),
    };
  };

  mount(x, app, endpoints.getAccessRules, async ({ params }) => {
    const e = await eventOr404(params.id);
    return ruleSet(e, e.access_rules_version);
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
    const version = await app.repos.events.replaceAccessRules(e.id, body.expected_version, rules, { actorId: ctx!.sub, now: new Date(app.clock.now()) });
    if (version === null) throw new ContractError("CONFLICT", "The access rules were republished by someone else. Reload and review the change.");
    await touch(e, ctx!.sub);
    await audit(ctx!.sub, "access_rules.republish", `event:${e.id}`, {
      version, live: e.state === "live",
      added: [...now].filter((k) => !was.has(k)).length, removed: [...was].filter((k) => !now.has(k)).length,
    });
    return ruleSet(e, version);
  });

  mount(x, app, endpoints.dashboard, async () => {
    const live = await app.repos.events.listAll({ state: "live", limit: 1000 });
    const now = app.clock.now();
    let onSite = 0;
    let gatesOffline = 0;
    for (const e of live.filter(isScheduled)) {
      onSite += (await app.scans.projection(e.id)).zoneOf.size;
      // From the devices table (every instance agrees): never heard from or silent for 60 s.
      for (const g of await app.repos.devices.gateHealth(e.venue_id, { eventId: e.id, now: new Date(now) })) {
        if (g.link_state !== "online") gatesOffline++;
      }
    }
    const open = await app.repos.alerts.list({ state: "open", limit: 100_000 });
    return { live_events: live.length, on_site: onSite, open_alerts: open.length, gates_offline: gatesOffline, as_of: new Date(now).toISOString() };
  });
}
