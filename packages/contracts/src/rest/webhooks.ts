/**
 * Outbound webhooks (02 §6, 03 §3): HMAC-signed mirrors of `/stream/alerts`. Not in 02 §5; proposed.
 *
 * Delivery: POST, JSON body `WebhookEnvelope`, headers
 *   `X-Synan-Event: <event>`, `X-Synan-Delivery: <delivery id>`,
 *   `X-Synan-Signature: t=<unix seconds>,v1=<hex HMAC-SHA-256 of "<t>.<raw body>" with the endpoint secret>`.
 * Receivers must check the signature and reject a `t` more than 5 minutes from their clock.
 * Retries with backoff 30 s × 2^(n−1), capped at 1 h; after the eighth failure the delivery is `dead`.
 * `WebhookEnvelope.id` names the event (shared by every endpoint); `X-Synan-Delivery` names the delivery.
 */
import { z } from "zod";
import { Id, IsoDateTime, Ok, pageOf, PageQuery } from "../common.js";
import { BreachAlert } from "./scans.js";
import { ADMIN_ONLY, endpoint, IdParam } from "./endpoint.js";

export const WebhookEventName = z.enum(["alert.raised", "alert.updated"]);
export type WebhookEventName = z.infer<typeof WebhookEventName>;

export const WEBHOOK_SIGNATURE_HEADER = "X-Synan-Signature";
export const WEBHOOK_EVENT_HEADER = "X-Synan-Event";
export const WEBHOOK_DELIVERY_HEADER = "X-Synan-Delivery";

export const WebhookEndpoint = z.object({
  id: Id,
  url: z.url(),
  events: z.array(WebhookEventName),
  active: z.boolean(),
  created_at: IsoDateTime,
});
export type WebhookEndpoint = z.infer<typeof WebhookEndpoint>;
/** Returned once, on create and on rotation. Never readable afterwards. */
export const WebhookEndpointWithSecret = WebhookEndpoint.extend({ secret: z.string() });

const HttpsUrl = z.url().max(2048).refine((u) => u.startsWith("https://"), "must be https");
export const CreateWebhook = z.object({ url: HttpsUrl, events: z.array(WebhookEventName).min(1) });
export const UpdateWebhook = z.object({ url: HttpsUrl.optional(), events: z.array(WebhookEventName).min(1).optional(), active: z.boolean().optional() });

export const WebhookDeliveryState = z.enum(["pending", "in_flight", "succeeded", "dead"]);
export const WebhookDelivery = z.object({
  id: Id,
  endpoint_id: Id,
  event: WebhookEventName,
  state: WebhookDeliveryState,
  attempts: z.number().int(),
  last_status: z.number().int().nullable(),
  last_error: z.string().nullable(),
  next_attempt_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
  delivered_at: IsoDateTime.nullable(),
});
export type WebhookDelivery = z.infer<typeof WebhookDelivery>;

/** The JSON body of every delivery. Alert payloads carry no personal data and no credential link. */
export const WebhookEnvelope = z.object({
  id: Id,
  event: WebhookEventName,
  created_at: IsoDateTime,
  data: BreachAlert,
});
export type WebhookEnvelope = z.infer<typeof WebhookEnvelope>;

export const webhookEndpoints = {
  listWebhooks: endpoint({ method: "GET", path: "/webhooks", access: ADMIN_ONLY, response: z.object({ items: z.array(WebhookEndpoint) }) }),
  createWebhook: endpoint({ method: "POST", path: "/webhooks", access: ADMIN_ONLY, mfa: true, audited: true, body: CreateWebhook, response: WebhookEndpointWithSecret, status: 201 }),
  updateWebhook: endpoint({ method: "PATCH", path: "/webhooks/:id", access: ADMIN_ONLY, mfa: true, audited: true, params: IdParam, body: UpdateWebhook, response: WebhookEndpoint }),
  deleteWebhook: endpoint({ method: "DELETE", path: "/webhooks/:id", access: ADMIN_ONLY, mfa: true, audited: true, params: IdParam, response: Ok }),
  rotateWebhookSecret: endpoint({ method: "POST", path: "/webhooks/:id/rotate-secret", access: ADMIN_ONLY, mfa: true, audited: true, params: IdParam, response: WebhookEndpointWithSecret }),
  webhookDeliveries: endpoint({ method: "GET", path: "/webhooks/:id/deliveries", access: ADMIN_ONLY, params: IdParam, query: PageQuery, response: pageOf(WebhookDelivery) }),
} as const;
