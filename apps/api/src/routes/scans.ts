import type { Express } from "express";
import { ContractError } from "@synan/contracts/errors";
import { endpoints } from "@synan/contracts/rest";
import type { AppContext } from "../app.js";
import { toAlertDto } from "../domain/alerts.js";
import { CLOCK_FAULT_MS } from "../domain/decision.js";
import { mount } from "../http/route.js";
import type { ScanRow } from "../repo/types.js";

const scanDto = (s: ScanRow) => ({
  id: s.id,
  event_id: s.event_id,
  checkpoint_id: s.checkpoint_id,
  ephemeral_id: s.ephemeral_id,
  carrier_kind: s.carrier_kind,
  result: s.result,
  occurred_at: s.occurred_at.toISOString(),
  received_at: s.received_at.toISOString(),
  clock_offset_ms: s.clock_offset_ms,
  offline: s.offline_bool,
});

export function scanRoutes(x: Express, app: AppContext) {
  mount(x, app, endpoints.postScans, async ({ body, ctx }) => app.scans.ingest(ctx!, body));

  mount(x, app, endpoints.listScans, async ({ query }) => {
    // Operators see ephemeral ids and checkpoints only, never identities (03 §5).
    const rows = await app.repos.scans.page(query.event_id, {
      checkpointId: query.checkpoint_id,
      result: query.result,
      limit: query.limit + 1,
      before: query.cursor,
    });
    const page = rows.slice(0, query.limit);
    return { items: page.map(scanDto), next_cursor: rows.length > query.limit ? page[page.length - 1]!.id : null };
  });

  mount(x, app, endpoints.listAlerts, async ({ query }) => {
    const rows = await app.repos.alerts.list({ eventId: query.event_id, state: query.state, severity: query.severity, limit: query.limit });
    return { items: rows.map(toAlertDto), next_cursor: null };
  });

  mount(x, app, endpoints.ackAlert, async ({ params, ctx }) => {
    const a = await app.repos.alerts.byId(params.id);
    if (!a) throw new ContractError("NOT_FOUND");
    if (a.state !== "open") throw new ContractError("CONFLICT", "Alert is not open.");
    const updated = await app.alerts.update(a.id, { state: "acked", acked_by: ctx!.sub, acked_at: new Date(app.clock.now()) });
    await app.audit.append({ actorId: ctx!.sub, action: "alert.ack", target: `alert:${a.id}`, meta: { kind: a.kind } });
    return toAlertDto(updated);
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
    const cps = await app.repos.venues.checkpointsOfVenue(event.venue_id);
    const now = app.clock.now();
    const rates = await app.repos.rollups.gateRates(event.id);
    const minute = Math.floor(now / 60_000) * 60_000 - 60_000;
    return {
      items: cps.map((cp) => {
        const g = app.scans.gates.get(cp.id);
        const live = g && now - g.lastSeenAt <= 60_000;
        return {
          checkpoint_id: cp.id,
          label: cp.label,
          link_state: live ? ("online" as const) : ("offline" as const),
          last_heartbeat_at: g ? new Date(g.lastSeenAt).toISOString() : null,
          queue_depth: 0,
          clock_offset_ms: g?.clockOffsetMs ?? null,
          clock_fault: g ? Math.abs(g.clockOffsetMs) > CLOCK_FAULT_MS : false,
          scans_last_minute: rates.find((r) => r.checkpoint_id === cp.id && r.minute_start.getTime() === minute)?.scans ?? 0,
        };
      }),
    };
  });
}
