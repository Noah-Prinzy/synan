import type { Express } from "express";
import { ContractError } from "@synan/contracts/errors";
import { endpoints, type BreachAlert } from "@synan/contracts/rest";
import type { AppContext } from "../app.js";
import { toAlertDto } from "../domain/alerts.js";
import { credentialsNamed, hint } from "../domain/credential-service.js";
import type { AuthContext } from "../domain/principal.js";
import { mount } from "../http/route.js";
import type { BreachAlertRow, ScanRow } from "../repo/types.js";

/**
 * A scan row for operators. `withPerson` is true only in the audited access-history lookup; general
 * lists never carry the stable per-person id, so they cannot be regrouped into movement trails (03 §5).
 */
const scanDto = (s: ScanRow, withPerson = false) => ({
  id: s.id,
  event_id: s.event_id,
  checkpoint_id: s.checkpoint_id,
  ephemeral_id: withPerson ? s.ephemeral_id : null,
  carrier_kind: s.carrier_kind,
  result: s.result,
  occurred_at: s.occurred_at.toISOString(),
  received_at: s.received_at.toISOString(),
  clock_offset_ms: s.clock_offset_ms,
  offline: s.offline_bool,
  corrected_at: new Date(s.occurred_at.getTime() + s.clock_offset_ms).toISOString(),
});

/** GET /scans counts matching scans up to this many; beyond it `total` is a lower bound. */
const LOG_COUNT_CAP = 10_000;

/** The event's credentials a log search names (GET /scans `q`); see credentialsNamed. Never a name. */
const credentialsMatching = (app: AppContext, eventId: string, raw: string) => credentialsNamed(app.repos, eventId, raw);

/**
 * Checkpoints a non-operator may see alerts for: the ones they are assigned to right now (03 §4, §8.2
 * "the nearest gate's security tablet"). Operators are unscoped (returns null).
 */
async function alertScope(app: AppContext, ctx: AuthContext): Promise<string[] | null> {
  if (ctx.kind === "operator") return null;
  const now = app.clock.now();
  const mine = await app.repos.staff.assignmentsFor(ctx.sub);
  return mine.filter((a) => a.shift_start.getTime() <= now && now < a.shift_end.getTime()).map((a) => a.checkpoint_id);
}

/** Gate staff see what to act on, not who: no credential link, no scan ids, no operator notes. */
function forStaff(a: BreachAlert): BreachAlert {
  return { ...a, credential_id: null, scan_ids: [], resolution_note: null };
}

export function scanRoutes(x: Express, app: AppContext) {
  mount(x, app, endpoints.postScans, async ({ body, ctx }) => app.scans.ingest(ctx!, body));

  // 06 S3 `Undo`: the scanner's own admission, within the window; a correction record, never a delete.
  mount(x, app, endpoints.undoScan, async ({ params, body, ctx }) => app.scans.undo(ctx!, body.event_id, params.id, body.reason));

  mount(x, app, endpoints.listScans, async ({ query, ctx }) => {
    const checkpointIds = query.checkpoint_ids ? [...new Set([...query.checkpoint_ids, ...(query.checkpoint_id ? [query.checkpoint_id] : [])])] : undefined;
    let ephemeralIds: string[] | undefined;
    if (query.q) {
      // One pass's scans is a per-person movement view: the audited access-history lookup's rules
      // (03 §5, §7) — operators only, written to the audit log, and still no per-person id per record.
      if (ctx!.role !== "admin" && ctx!.role !== "organiser") throw new ContractError("FORBIDDEN", "Searching the log for one pass is for admins and organisers.");
      const event = await app.repos.events.byId(query.event_id);
      if (!event) throw new ContractError("NOT_FOUND");
      const found = await credentialsMatching(app, event.id, query.q);
      ephemeralIds = [];
      for (const c of found) {
        const eph = await app.repos.ephemeralIds.find(event.id, c);
        if (eph) ephemeralIds.push(eph);
      }
      if (found.length) {
        await app.audit.append({
          actorId: ctx!.sub, action: "credential.access_history", target: `event:${event.id}`,
          meta: { event_id: event.id, via: "scan_log_search", credential_ids: found, cursor: query.cursor ?? null },
        });
      }
    }
    const filter = { checkpointIds, result: query.result, ephemeralIds };
    const rows = await app.repos.scans.page(query.event_id, {
      checkpointId: checkpointIds ? undefined : query.checkpoint_id,
      ...filter,
      limit: query.limit + 1,
      before: query.cursor,
    });
    const page = rows.slice(0, query.limit);
    const stats = await app.repos.scans.logStats(query.event_id, { ...filter, checkpointIds: checkpointIds ?? (query.checkpoint_id ? [query.checkpoint_id] : undefined), cap: LOG_COUNT_CAP });
    return {
      items: page.map((s) => scanDto(s)),
      next_cursor: rows.length > query.limit ? page[page.length - 1]!.id : null,
      total: stats.total,
      total_exact: stats.exact,
      oldest_at: stats.oldest_at?.toISOString() ?? null,
    };
  });

  // The alert detail sheet (06 D10): the alert with its gate, room, scans, credential and history.
  mount(x, app, endpoints.getAlert, async ({ params }) => {
    const a = await app.repos.alerts.byId(params.id);
    if (!a) throw new ContractError("NOT_FOUND");
    const cp = a.checkpoint_id ? await app.repos.venues.checkpoint(a.checkpoint_id) : null;
    const roomId = a.room_id ?? cp?.room_id ?? null;
    const room = roomId ? await app.repos.venues.room(roomId) : null;
    const capacity = room ? ((await app.repos.events.rooms(a.event_id)).find((r) => r.room_id === room.id)?.capacity_override ?? room.capacity) : 0;
    const labels = new Map<string, string>();
    const scans = [];
    for (const id of a.scan_ids) {
      const s = await app.repos.scans.byId(a.event_id, id);
      if (!s) continue; // purged with the event's scans (03 §6)
      if (!labels.has(s.checkpoint_id)) labels.set(s.checkpoint_id, (await app.repos.venues.checkpoint(s.checkpoint_id))?.label ?? "");
      scans.push({ ...scanDto(s), checkpoint_label: labels.get(s.checkpoint_id)! });
    }
    scans.sort((p, q) => p.corrected_at.localeCompare(q.corrected_at));
    let credential = null;
    if (a.credential_id) {
      const c = await app.repos.credentials.byId(a.credential_id);
      if (c) {
        const reg = c.registration_id ? await app.repos.registrations.byId(c.registration_id) : null;
        const band = (await app.repos.carriers.forCredential(c.id)).find((k) => k.kind === "nfc" && (k.state === "assigned" || k.state === "bound" || k.state === "active"));
        credential = { id: c.id, registration_id: c.registration_id, state: c.state, tier: reg?.tier ?? null, band_hint: band ? hint(band) : null };
      }
    }
    const entries = (await app.repos.audit.find({ actions: ["alert.ack", "alert.resolve"], targets: [`alert:${a.id}`], limit: 20 })).reverse();
    const names = new Map<string, string | null>();
    const history = [];
    for (const h of entries) {
      if (h.actor_id && !names.has(h.actor_id)) {
        const u = await app.repos.users.byId(h.actor_id);
        names.set(h.actor_id, u ? u.display_name || u.email : null);
      }
      history.push({
        action: h.action === "alert.ack" ? ("acked" as const) : ("resolved" as const), at: h.at.toISOString(), actor_id: h.actor_id,
        actor_name: h.actor_id ? (names.get(h.actor_id) ?? null) : null, note: typeof h.meta_jsonb.note === "string" ? h.meta_jsonb.note : null,
      });
    }
    return {
      alert: toAlertDto(a),
      room: room ? { id: room.id, name: room.name, capacity } : null,
      checkpoint: cp ? { id: cp.id, label: cp.label, perimeter: cp.perimeter_bool, room_id: cp.room_id } : null,
      scans,
      credential,
      history,
    };
  });

  // The audited access-history lookup of one credential (03 §5, §7): the only per-person movement view.
  mount(x, app, endpoints.credentialScans, async ({ params, query, ctx }) => {
    const cred = await app.repos.credentials.byId(params.id);
    if (!cred) throw new ContractError("NOT_FOUND");
    let eventId = query.event_id ?? null;
    if (!eventId && cred.registration_id) eventId = (await app.repos.registrations.byId(cred.registration_id))?.event_id ?? null;
    if (!eventId) {
      throw new ContractError("VALIDATION_FAILED", "event_id is required for this credential", [{ path: "query.event_id", message: "required" }]);
    }
    const event = await app.repos.events.byId(eventId);
    if (!event) throw new ContractError("NOT_FOUND");
    // Written before anything is returned, whether or not there is history to show.
    await app.audit.append({
      actorId: ctx!.sub,
      action: "credential.access_history",
      target: `credential:${cred.id}`,
      meta: { event_id: event.id, cursor: query.cursor ?? null },
    });
    const eph = await app.repos.ephemeralIds.find(event.id, cred.id);
    if (!eph) return { items: [], next_cursor: null };
    const rows = await app.repos.scans.page(event.id, { ephemeralId: eph, limit: query.limit + 1, before: query.cursor });
    const page = rows.slice(0, query.limit);
    return { items: page.map((s) => scanDto(s, true)), next_cursor: rows.length > query.limit ? page[page.length - 1]!.id : null };
  });

  mount(x, app, endpoints.listAlerts, async ({ query, ctx }) => {
    const scope = await alertScope(app, ctx!);
    const rows = await app.repos.alerts.list({
      eventId: query.event_id,
      state: query.state,
      severity: query.severity,
      checkpointIds: scope ?? undefined,
      limit: query.limit,
    });
    const items = rows.map(toAlertDto);
    return { items: scope ? items.map(forStaff) : items, next_cursor: null };
  });

  mount(x, app, endpoints.ackAlert, async ({ params, ctx }) => {
    const a = await app.repos.alerts.byId(params.id);
    const scope = await alertScope(app, ctx!);
    if (!a || (scope && !inScope(a, scope))) throw new ContractError("NOT_FOUND");
    if (a.state !== "open") throw new ContractError("CONFLICT", "Alert is not open.");
    const updated = await app.alerts.update(a.id, { state: "acked", acked_by: ctx!.sub, acked_at: new Date(app.clock.now()) });
    await app.audit.append({ actorId: ctx!.sub, action: "alert.ack", target: `alert:${a.id}`, meta: { kind: a.kind } });
    const dto = toAlertDto(updated);
    return scope ? forStaff(dto) : dto;
  });

  mount(x, app, endpoints.resolveAlert, async ({ params, body, ctx }) => {
    const a = await app.repos.alerts.byId(params.id);
    if (!a) throw new ContractError("NOT_FOUND");
    if (a.state === "resolved") throw new ContractError("CONFLICT", "Alert is already resolved.");
    const now = new Date(app.clock.now());
    const updated = await app.alerts.update(a.id, {
      state: "resolved",
      resolution_note: body.note,
      resolved_by: ctx!.sub,
      resolved_at: now,
      acked_by: a.acked_by ?? ctx!.sub,
      acked_at: a.acked_at ?? now,
    });
    await app.audit.append({ actorId: ctx!.sub, action: "alert.resolve", target: `alert:${a.id}`, meta: { kind: a.kind, note: body.note } });
    return toAlertDto(updated);
  });

  mount(x, app, endpoints.recountRoom, async ({ params, body, ctx }) =>
    app.scans.recount(ctx!, body.event_id, params.id, body.count, body.note),
  );

  mount(x, app, endpoints.gateHealth, async ({ query }) => {
    const event = await app.repos.events.byId(query.event_id);
    if (!event) throw new ContractError("NOT_FOUND");
    return { items: await app.gates.health(event) };
  });

  // One gate's per-minute throughput (06 D12, D12b) from the per-gate rollups (D-16): counts only.
  mount(x, app, endpoints.checkpointActivity, async ({ params, query }) => {
    const cp = await app.repos.venues.checkpoint(params.id);
    const event = await app.repos.events.byId(query.event_id);
    if (!cp || !event || event.venue_id !== cp.venue_id) throw new ContractError("NOT_FOUND");
    const current = Math.floor(app.clock.now() / 60_000) * 60_000;
    const from = current - (query.minutes - 1) * 60_000;
    const rows = (await app.repos.rollups.gateRates(event.id)).filter((r) => r.checkpoint_id === cp.id && r.minute_start.getTime() >= from && r.minute_start.getTime() <= current);
    const by = new Map(rows.map((r) => [r.minute_start.getTime(), r]));
    const byResult: Record<string, number> = {};
    for (const r of rows) for (const [k, n] of Object.entries(r.by_result_jsonb)) byResult[k] = (byResult[k] ?? 0) + n;
    return {
      checkpoint_id: cp.id,
      event_id: event.id,
      from: new Date(from).toISOString(),
      minutes: Array.from({ length: query.minutes }, (_, i) => {
        const t = from + i * 60_000;
        const r = by.get(t);
        return { at: new Date(t).toISOString(), scans: r?.scans ?? 0, admitted: r?.admitted ?? 0, denied: r?.denied ?? 0 };
      }),
      by_result: byResult,
    };
  });
}

function inScope(a: BreachAlertRow, scope: readonly string[]) {
  return a.checkpoint_id !== null && scope.includes(a.checkpoint_id);
}
