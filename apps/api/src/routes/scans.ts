import type { Express } from "express";
import { ContractError } from "@synan/contracts/errors";
import { endpoints, type BreachAlert } from "@synan/contracts/rest";
import type { AppContext } from "../app.js";
import { toAlertDto } from "../domain/alerts.js";
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
});

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

  mount(x, app, endpoints.listScans, async ({ query }) => {
    const rows = await app.repos.scans.page(query.event_id, {
      checkpointId: query.checkpoint_id,
      result: query.result,
      limit: query.limit + 1,
      before: query.cursor,
    });
    const page = rows.slice(0, query.limit);
    return { items: page.map((s) => scanDto(s)), next_cursor: rows.length > query.limit ? page[page.length - 1]!.id : null };
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
}

function inScope(a: BreachAlertRow, scope: readonly string[]) {
  return a.checkpoint_id !== null && scope.includes(a.checkpoint_id);
}
