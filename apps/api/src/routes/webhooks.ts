/** Slice 7 — webhook endpoints CRUD and the delivery log. Admin only, MFA for every change, audited. */
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { ContractError } from "@synan/contracts/errors";
import { endpoints, type WebhookEventName } from "@synan/contracts/rest";
import type { AppContext } from "../app.js";
import { vetWebhookUrl } from "../domain/webhooks.js";
import { mount } from "../http/route.js";
import { randomToken } from "../lib/crypto.js";
import type { WebhookDeliveryRow, WebhookEndpointRow } from "../repo/types.js";

const dto = (w: WebhookEndpointRow) => ({ id: w.id, url: w.url, events: w.events as WebhookEventName[], active: w.active, created_at: w.created_at.toISOString() });
const deliveryDto = (d: WebhookDeliveryRow) => ({
  id: d.id, endpoint_id: d.endpoint_id, event: d.event as WebhookEventName, state: d.state, attempts: d.attempt,
  last_status: d.response_code, last_error: d.last_error, next_attempt_at: d.state === "pending" ? d.next_attempt_at.toISOString() : null,
  created_at: d.created_at.toISOString(), delivered_at: d.delivered_at?.toISOString() ?? null,
});
const newSecret = () => `whsec_${randomToken(32)}`;

export function webhookRoutes(x: Express, app: AppContext) {
  const audit = (actor: string, action: string, target: string, meta: Record<string, unknown> = {}) => app.audit.append({ actorId: actor, action, target, meta });
  const or404 = async (id: string) => {
    const w = await app.repos.webhooks.byId(id);
    if (!w) throw new ContractError("NOT_FOUND");
    return w;
  };

  mount(x, app, endpoints.listWebhooks, async () => ({ items: (await app.repos.webhooks.list()).map(dto) }));

  mount(x, app, endpoints.createWebhook, async ({ body, ctx }) => {
    await vetWebhookUrl(body.url, app.webhooks.resolve);
    const [org] = await app.repos.venues.organizations();
    if (!org) throw new ContractError("CONFLICT", "Create the organisation first.");
    const row: WebhookEndpointRow = { id: randomUUID(), org_id: org.id, url: body.url, secret: newSecret(), events: [...new Set(body.events)], active: true, created_at: new Date(app.clock.now()) };
    await app.repos.webhooks.insert(row);
    await audit(ctx!.sub, "webhook.create", `webhook:${row.id}`, { host: new URL(row.url).host, events: row.events });
    return { ...dto(row), secret: row.secret };
  });

  mount(x, app, endpoints.updateWebhook, async ({ params, body, ctx }) => {
    await or404(params.id);
    if (body.url) await vetWebhookUrl(body.url, app.webhooks.resolve);
    const w = await app.repos.webhooks.update(params.id, { ...body, ...(body.events ? { events: [...new Set(body.events)] } : {}) });
    await audit(ctx!.sub, "webhook.update", `webhook:${w.id}`, { fields: Object.keys(body) });
    return dto(w);
  });

  mount(x, app, endpoints.deleteWebhook, async ({ params, ctx }) => {
    await or404(params.id);
    await app.repos.webhooks.delete(params.id);
    await audit(ctx!.sub, "webhook.delete", `webhook:${params.id}`);
    return { ok: true as const };
  });

  mount(x, app, endpoints.rotateWebhookSecret, async ({ params, ctx }) => {
    await or404(params.id);
    const secret = newSecret();
    const w = await app.repos.webhooks.update(params.id, { secret });
    await audit(ctx!.sub, "webhook.rotate_secret", `webhook:${w.id}`);
    return { ...dto(w), secret };
  });

  mount(x, app, endpoints.webhookDeliveries, async ({ params, query }) => {
    await or404(params.id);
    const offset = query.cursor ? Number(query.cursor) : 0;
    if (!Number.isInteger(offset) || offset < 0) throw new ContractError("VALIDATION_FAILED", "invalid cursor", [{ path: "query.cursor", message: "invalid" }]);
    const rows = await app.repos.webhookDeliveries.forEndpoint(params.id, { offset, limit: query.limit + 1 });
    const page = rows.slice(0, query.limit);
    return { items: page.map(deliveryDto), next_cursor: rows.length > query.limit ? String(offset + query.limit) : null };
  });
}
