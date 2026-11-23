/**
 * Gate devices and fixed-reader authentication (O-17). Registration, rotation and retirement are
 * admin actions with MFA, audited; the device token is shown once. A fixed reader must sit at one
 * checkpoint of the device's venue.
 */
import type { Express } from "express";
import { ContractError } from "@synan/contracts/errors";
import { endpoints } from "@synan/contracts/rest";
import type { AppContext } from "../app.js";
import { mount } from "../http/route.js";
import type { DeviceRow } from "../repo/types.js";

export const deviceDto = (d: DeviceRow) => ({
  id: d.id, venue_id: d.venue_id, kind: d.kind, label: d.label, hardware_id: d.hardware_id, checkpoint_id: d.checkpoint_id, state: d.state,
  last_heartbeat_at: d.last_heartbeat_at?.toISOString() ?? null, last_clock_offset_ms: d.last_clock_offset_ms, last_queue_depth: d.last_queue_depth,
  created_at: d.created_at.toISOString(),
});

export function deviceRoutes(x: Express, app: AppContext) {
  const audit = (actor: string, action: string, target: string, meta: Record<string, unknown> = {}) => app.audit.append({ actorId: actor, action, target, meta });
  const or404 = async (id: string) => {
    const d = await app.repos.devices.byId(id);
    if (!d) throw new ContractError("NOT_FOUND");
    return d;
  };

  mount(x, app, endpoints.listDevices, async ({ query }) => ({ items: (await app.repos.devices.list(query.venue_id)).map(deviceDto) }));

  mount(x, app, endpoints.registerDevice, async ({ body, ctx }) => {
    const venue = await app.repos.venues.venue(body.venue_id);
    if (!venue) throw new ContractError("VALIDATION_FAILED", "venue not found", [{ path: "body.venue_id", message: "not found" }]);
    if (body.checkpoint_id) {
      const cp = await app.repos.venues.checkpoint(body.checkpoint_id);
      if (!cp || cp.venue_id !== venue.id) throw new ContractError("VALIDATION_FAILED", "checkpoint is not in this venue", [{ path: "body.checkpoint_id", message: "not in venue" }]);
    } else if (body.kind === "fixed_reader") {
      throw new ContractError("VALIDATION_FAILED", "a fixed reader needs its checkpoint", [{ path: "body.checkpoint_id", message: "required" }]);
    }
    const r = await app.repos.devices.register({ venueId: venue.id, kind: body.kind, label: body.label, hardwareId: body.hardware_id, checkpointId: body.checkpoint_id });
    if (r === "duplicate") throw new ContractError("CONFLICT", "A device with this hardware id is already registered.");
    await audit(ctx!.sub, "device.register", `device:${r.id}`, { kind: body.kind, checkpoint_id: body.checkpoint_id });
    return { device: deviceDto((await app.repos.devices.byId(r.id))!), token: r.token };
  });

  mount(x, app, endpoints.rotateDeviceToken, async ({ params, ctx }) => {
    const d = await or404(params.id);
    if (d.state !== "active") throw new ContractError("CONFLICT", "The device is not active.");
    const token = await app.repos.devices.rotateToken(d.id);
    await audit(ctx!.sub, "device.rotate_token", `device:${d.id}`);
    return { device: deviceDto(d), token };
  });

  mount(x, app, endpoints.retireDevice, async ({ params, ctx }) => {
    const d = await or404(params.id);
    if (d.state !== "retired") {
      await app.repos.devices.retire(d.id, new Date(app.clock.now()));
      await audit(ctx!.sub, "device.retire", `device:${d.id}`);
    }
    return deviceDto((await app.repos.devices.byId(d.id))!);
  });

  mount(x, app, endpoints.deviceToken, async ({ body }) => app.auth.deviceToken(body.device_token));

  mount(x, app, endpoints.deviceHeartbeat, async ({ body, ctx }) => {
    const now = app.clock.now();
    const r = await app.repos.devices.heartbeat({ deviceId: ctx!.sub, clockOffsetMs: body.clock_offset_ms, queueDepth: body.queue_depth, appVersion: body.app_version ?? null, now: new Date(now) });
    if (r !== "ok") throw new ContractError("UNAUTHENTICATED");
    if (ctx!.checkpointId) {
      app.scans.gates.set(ctx!.checkpointId, { checkpointId: ctx!.checkpointId, lastSeenAt: now, clockOffsetMs: body.clock_offset_ms, deviceId: `device:${ctx!.sub}`, queueDepth: body.queue_depth });
    }
    return { server_time: new Date(now).toISOString() };
  });
}
