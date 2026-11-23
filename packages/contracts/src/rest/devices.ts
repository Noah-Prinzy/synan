/**
 * Gate devices and fixed-reader authentication (O-17, D-09). Not in 02 §5; proposed.
 *
 * A fixed reader holds a device token (shown once at registration or rotation; only its hash is
 * stored). It exchanges the token at POST /auth/device-token for a short-lived access token whose
 * principal kind is `device`, bound to its one checkpoint. With it the reader may post scans for that
 * checkpoint at any time (no shift), fetch that checkpoint's allowlist, and send heartbeats.
 * Retiring a device or rotating its token takes effect on the next request.
 */
import { z } from "zod";
import { Id, IsoDateTime } from "../common.js";
import { ADMIN_ONLY, endpoint, IdParam, OPERATORS, PUBLIC } from "./endpoint.js";

export const DeviceKind = z.enum(["scanner", "fixed_reader", "kiosk"]);
export const DeviceState = z.enum(["active", "maintenance", "retired", "lost"]);
export const Device = z.object({
  id: Id,
  venue_id: Id,
  kind: DeviceKind,
  label: z.string(),
  hardware_id: z.string(),
  checkpoint_id: Id.nullable(),
  state: DeviceState,
  last_heartbeat_at: IsoDateTime.nullable(),
  last_clock_offset_ms: z.number().int().nullable(),
  last_queue_depth: z.number().int().nullable(),
  created_at: IsoDateTime,
});
export type Device = z.infer<typeof Device>;
/** The token is returned once and never again. */
export const DeviceWithToken = z.object({ device: Device, token: z.string().nullable() });

export const RegisterDevice = z.object({
  venue_id: Id,
  kind: DeviceKind,
  label: z.string().min(1).max(120),
  hardware_id: z.string().min(1).max(128),
  /** Required for a fixed reader. */
  checkpoint_id: Id.nullable().default(null),
});
export const DeviceTokenRequest = z.object({ device_token: z.string().min(20).max(256) });
export const DeviceAccessToken = z.object({
  token_type: z.literal("Bearer"),
  access_token: z.string(),
  access_expires_at: IsoDateTime,
  device_id: Id,
  checkpoint_id: Id.nullable(),
});
export const DeviceHeartbeat = z.object({
  queue_depth: z.number().int().min(0),
  clock_offset_ms: z.number().int(),
  app_version: z.string().max(64).optional(),
});

export const deviceEndpoints = {
  listDevices: endpoint({ method: "GET", path: "/devices", access: OPERATORS, query: z.object({ venue_id: Id.optional() }), response: z.object({ items: z.array(Device) }) }),
  registerDevice: endpoint({ method: "POST", path: "/devices", access: ADMIN_ONLY, mfa: true, audited: true, body: RegisterDevice, response: DeviceWithToken, status: 201 }),
  rotateDeviceToken: endpoint({ method: "POST", path: "/devices/:id/rotate-token", access: ADMIN_ONLY, mfa: true, audited: true, params: IdParam, response: DeviceWithToken }),
  retireDevice: endpoint({ method: "POST", path: "/devices/:id/retire", access: ADMIN_ONLY, mfa: true, audited: true, params: IdParam, response: Device }),
  deviceToken: endpoint({ method: "POST", path: "/auth/device-token", access: PUBLIC, rateLimit: "auth", body: DeviceTokenRequest, response: DeviceAccessToken }),
  deviceHeartbeat: endpoint({ method: "POST", path: "/devices/heartbeat", access: ["device"], rateLimit: "scan", body: DeviceHeartbeat, response: z.object({ server_time: IsoDateTime }) }),
} as const;
