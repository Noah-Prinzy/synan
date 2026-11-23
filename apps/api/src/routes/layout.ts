/**
 * Slice 1 — organisation, venues, zones, rooms, checkpoints (02 §5, 02 §4.1).
 *
 * - First-run: the single organisation (O-01) is created once; venues need it.
 * - Venue consistency is checked here with the same rules the database enforces (a room's and a
 *   checkpoint's zone belong to the same venue; warn ≤ block thresholds; unique hardware id), so
 *   both repositories answer 4xx rather than one of them failing with a constraint error.
 * - Layout edits apply immediately. "Drafts until Publish layout" (06 D3) is client state: the
 *   server has no layout-draft model (proposed doc change). Edits invalidate cached projections.
 * - Every mutation is audited. Non-operators see only checkpoints they are assigned to.
 */
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { ContractError } from "@synan/contracts/errors";
import { endpoints } from "@synan/contracts/rest";
import type { AppContext } from "../app.js";
import { mount } from "../http/route.js";
import type { CheckpointRow, RoomRow, ScanRow, VenueRow, ZoneRow } from "../repo/types.js";

type Json = Record<string, unknown>;

export const venueDto = (v: VenueRow) => ({ id: v.id, org_id: v.org_id, name: v.name, address: v.address, timezone: v.timezone, city: v.city });
export const zoneDto = (z: ZoneRow) => ({ id: z.id, venue_id: z.venue_id, name: z.name, floor: z.floor, geometry: z.geometry_jsonb });
export const roomDto = (r: RoomRow) => ({
  id: r.id, venue_id: r.venue_id, zone_id: r.zone_id, name: r.name, capacity: r.capacity, warn_at_pct: r.warn_at_pct,
  block_at_pct: r.block_at_pct, continuous: r.continuous_bool, capacity_policy: r.capacity_policy, geometry: r.geometry_jsonb,
});
export const checkpointDto = (c: CheckpointRow) => ({
  id: c.id, venue_id: c.venue_id, zone_id: c.zone_id, room_id: c.room_id, direction: c.direction,
  perimeter: c.perimeter_bool, hardware_id: c.hardware_id, label: c.label,
});
const scanDto = (s: ScanRow) => ({
  id: s.id, event_id: s.event_id, checkpoint_id: s.checkpoint_id, ephemeral_id: null, carrier_kind: s.carrier_kind, result: s.result,
  occurred_at: s.occurred_at.toISOString(), received_at: s.received_at.toISOString(), clock_offset_ms: s.clock_offset_ms, offline: s.offline_bool,
});

const invalid = (path: string, message: string) => new ContractError("VALIDATION_FAILED", message, [{ path, message }]);

export function layoutRoutes(x: Express, app: AppContext) {
  const audit = (actor: string, action: string, target: string, meta: Json = {}) => app.audit.append({ actorId: actor, action, target, meta });
  const venueOr404 = async (id: string) => {
    const v = await app.repos.venues.venue(id);
    if (!v) throw new ContractError("NOT_FOUND");
    return v;
  };
  const zoneInVenue = async (zoneId: string, venueId: string) => {
    const z = await app.repos.venues.zone(zoneId);
    if (!z || z.venue_id !== venueId) throw invalid("body.zone_id", "zone is not in this venue");
    return z;
  };
  const thresholds = (warn: number, block: number) => {
    if (block < warn) throw invalid("body.block_at_pct", "block_at_pct must be at least warn_at_pct");
  };
  const hardwareFree = async (venueId: string, hardwareId: string | null, exceptId?: string) => {
    if (!hardwareId) return;
    // Unique across all venues (checkpoints_hardware_id_uq).
    const venues = await app.repos.venues.listVenues({ limit: 10_000 });
    for (const v of venues) {
      for (const c of await app.repos.venues.checkpointsOfVenue(v.id)) {
        if (c.hardware_id === hardwareId && c.id !== exceptId) throw new ContractError("CONFLICT", "hardware_id is already paired with another checkpoint");
      }
    }
    void venueId;
  };

  /* ---- organisation (first-run) ---- */
  mount(x, app, endpoints.createOrganization, async ({ body, ctx }) => {
    if ((await app.repos.venues.organizations()).length > 0) {
      throw new ContractError("CONFLICT", "The organisation is already set up (single organisation in v1, O-01).");
    }
    const row = { id: randomUUID(), ...body };
    await app.repos.fixtures.organization(row);
    await audit(ctx!.sub, "organization.create", `organization:${row.id}`, { name: row.name });
    return row;
  });

  /* ---- venues ---- */
  mount(x, app, endpoints.listVenues, async ({ query }) => {
    const rows = await app.repos.venues.listVenues({ after: query.cursor, limit: query.limit + 1 });
    const page = rows.slice(0, query.limit);
    return { items: page.map(venueDto), next_cursor: rows.length > query.limit ? page.at(-1)!.id : null };
  });

  mount(x, app, endpoints.createVenue, async ({ body, ctx }) => {
    const [org] = await app.repos.venues.organizations();
    if (!org) throw new ContractError("CONFLICT", "Create the organisation first (first-run setup).");
    const row: VenueRow = { id: randomUUID(), org_id: org.id, name: body.name, address: body.address, timezone: body.timezone, city: body.city ?? null };
    await app.repos.fixtures.venue(row);
    await audit(ctx!.sub, "venue.create", `venue:${row.id}`, { name: row.name });
    return venueDto(row);
  });

  mount(x, app, endpoints.updateVenue, async ({ params, body, ctx }) => {
    await venueOr404(params.id);
    const updated = await app.repos.venues.updateVenue(params.id, body);
    await audit(ctx!.sub, "venue.update", `venue:${params.id}`, { fields: Object.keys(body) });
    return venueDto(updated);
  });

  mount(x, app, endpoints.getVenue, async ({ params }) => {
    const v = await venueOr404(params.id);
    const [zones, rooms, cps] = await Promise.all([
      app.repos.venues.zonesOfVenue(v.id), app.repos.venues.roomsOfVenue(v.id), app.repos.venues.checkpointsOfVenue(v.id),
    ]);
    return { ...venueDto(v), zones: zones.map(zoneDto), rooms: rooms.map(roomDto), checkpoints: cps.map(checkpointDto) };
  });

  /* ---- zones ---- */
  mount(x, app, endpoints.listZones, async ({ params }) => {
    await venueOr404(params.id);
    return { items: (await app.repos.venues.zonesOfVenue(params.id)).map(zoneDto) };
  });

  mount(x, app, endpoints.createZone, async ({ params, body, ctx }) => {
    await venueOr404(params.id);
    const row: ZoneRow = { id: randomUUID(), venue_id: params.id, name: body.name, floor: body.floor, geometry_jsonb: (body.geometry ?? null) as Json | null };
    await app.repos.fixtures.zone(row);
    await audit(ctx!.sub, "zone.create", `zone:${row.id}`, { venue_id: params.id });
    return zoneDto(row);
  });

  mount(x, app, endpoints.updateZone, async ({ params, body, ctx }) => {
    if (!(await app.repos.venues.zone(params.id))) throw new ContractError("NOT_FOUND");
    const { geometry, ...rest } = body;
    const updated = await app.repos.venues.updateZone(params.id, { ...rest, ...(geometry !== undefined ? { geometry_jsonb: geometry as Json | null } : {}) });
    await audit(ctx!.sub, "zone.update", `zone:${params.id}`, { fields: Object.keys(body) });
    app.scans.forgetProjections();
    return zoneDto(updated);
  });

  /* ---- rooms ---- */
  mount(x, app, endpoints.createRoom, async ({ body, ctx }) => {
    await venueOr404(body.venue_id);
    await zoneInVenue(body.zone_id, body.venue_id);
    thresholds(body.warn_at_pct, body.block_at_pct);
    const row: RoomRow = {
      id: randomUUID(), venue_id: body.venue_id, zone_id: body.zone_id, name: body.name, capacity: body.capacity,
      warn_at_pct: body.warn_at_pct, block_at_pct: body.block_at_pct, continuous_bool: body.continuous,
      capacity_policy: body.capacity_policy, geometry_jsonb: (body.geometry ?? null) as Json | null,
    };
    await app.repos.fixtures.room(row);
    await audit(ctx!.sub, "room.create", `room:${row.id}`, { venue_id: row.venue_id, capacity: row.capacity });
    return roomDto(row);
  });

  mount(x, app, endpoints.updateRoom, async ({ params, body, ctx }) => {
    const cur = await app.repos.venues.room(params.id);
    if (!cur) throw new ContractError("NOT_FOUND");
    if (body.venue_id !== undefined && body.venue_id !== cur.venue_id) throw invalid("body.venue_id", "a room cannot move to another venue");
    if (body.zone_id !== undefined) await zoneInVenue(body.zone_id, cur.venue_id);
    thresholds(body.warn_at_pct ?? cur.warn_at_pct, body.block_at_pct ?? cur.block_at_pct);
    const { continuous, geometry, venue_id: _v, ...rest } = body;
    const updated = await app.repos.venues.updateRoom(params.id, {
      ...rest,
      ...(continuous !== undefined ? { continuous_bool: continuous } : {}),
      ...(geometry !== undefined ? { geometry_jsonb: geometry as Json | null } : {}),
    });
    await audit(ctx!.sub, "room.update", `room:${params.id}`, { fields: Object.keys(body), capacity: updated.capacity });
    app.scans.forgetProjections(); // capacity and thresholds feed live decisions
    return roomDto(updated);
  });

  /* ---- checkpoints ---- */
  const checkCheckpoint = async (venueId: string, zoneId: string, roomId: string | null) => {
    await zoneInVenue(zoneId, venueId);
    if (roomId) {
      const r = await app.repos.venues.room(roomId);
      if (!r || r.venue_id !== venueId) throw invalid("body.room_id", "room is not in this venue");
      // Decision: a room door belongs to the room's zone (zone presence follows the door).
      if (r.zone_id !== zoneId) throw invalid("body.zone_id", "a room door must be in the room's zone");
    }
  };

  mount(x, app, endpoints.createCheckpoint, async ({ body, ctx }) => {
    await venueOr404(body.venue_id);
    await checkCheckpoint(body.venue_id, body.zone_id, body.room_id);
    await hardwareFree(body.venue_id, body.hardware_id);
    const row: CheckpointRow = {
      id: randomUUID(), venue_id: body.venue_id, zone_id: body.zone_id, room_id: body.room_id, direction: body.direction,
      perimeter_bool: body.perimeter, hardware_id: body.hardware_id, label: body.label,
    };
    await app.repos.fixtures.checkpoint(row);
    await audit(ctx!.sub, "checkpoint.create", `checkpoint:${row.id}`, { venue_id: row.venue_id, perimeter: row.perimeter_bool });
    return checkpointDto(row);
  });

  mount(x, app, endpoints.updateCheckpoint, async ({ params, body, ctx }) => {
    const cur = await app.repos.venues.checkpoint(params.id);
    if (!cur) throw new ContractError("NOT_FOUND");
    await checkCheckpoint(cur.venue_id, body.zone_id ?? cur.zone_id, body.room_id !== undefined ? body.room_id : cur.room_id);
    if (body.hardware_id !== undefined) await hardwareFree(cur.venue_id, body.hardware_id, cur.id);
    const { perimeter, ...rest } = body;
    const updated = await app.repos.venues.updateCheckpoint(params.id, { ...rest, ...(perimeter !== undefined ? { perimeter_bool: perimeter } : {}) });
    await audit(ctx!.sub, "checkpoint.update", `checkpoint:${params.id}`, { fields: Object.keys(body) });
    app.scans.forgetProjections();
    return checkpointDto(updated);
  });

  mount(x, app, endpoints.listCheckpoints, async ({ query, ctx }) => {
    let venueIds: string[];
    if (query.event_id) {
      const e = await app.repos.events.byId(query.event_id);
      if (!e) throw new ContractError("NOT_FOUND");
      venueIds = [e.venue_id];
    } else if (query.venue_id) venueIds = [query.venue_id];
    else venueIds = (await app.repos.venues.listVenues({ limit: 10_000 })).map((v) => v.id);
    let rows = (await Promise.all(venueIds.map((v) => app.repos.venues.checkpointsOfVenue(v)))).flat();
    if (ctx!.kind !== "operator") {
      // Staff: only checkpoints they hold a current or upcoming assignment for.
      const now = app.clock.now();
      const mine = new Set((await app.repos.staff.assignmentsFor(ctx!.sub)).filter((a) => a.shift_end.getTime() > now).map((a) => a.checkpoint_id));
      rows = rows.filter((c) => mine.has(c.id));
    }
    rows.sort((a, b) => a.id.localeCompare(b.id));
    const after = query.cursor;
    const filtered = after ? rows.filter((c) => c.id > after) : rows;
    const page = filtered.slice(0, query.limit);
    return { items: page.map(checkpointDto), next_cursor: filtered.length > query.limit ? page.at(-1)!.id : null };
  });

  mount(x, app, endpoints.checkpointScans, async ({ params, query }) => {
    const cp = await app.repos.venues.checkpoint(params.id);
    if (!cp) throw new ContractError("NOT_FOUND");
    let eventId = query.event_id ?? null;
    if (eventId) {
      const e = await app.repos.events.byId(eventId);
      if (!e || e.venue_id !== cp.venue_id) throw new ContractError("NOT_FOUND");
    } else {
      eventId = (await app.repos.events.listAll({ state: "live", limit: 100 })).find((e) => e.venue_id === cp.venue_id)?.id ?? null;
      if (!eventId) return { items: [], next_cursor: null };
    }
    const rows = await app.repos.scans.page(eventId, { checkpointId: cp.id, limit: query.limit + 1, before: query.cursor });
    const page = rows.slice(0, query.limit);
    return { items: page.map(scanDto), next_cursor: rows.length > query.limit ? page.at(-1)!.id : null };
  });
}
