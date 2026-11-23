/**
 * Outbound webhooks (02 §6, 06 D10): endpoints with an encrypted signing secret, a delivery queue
 * with leases and exponential backoff, and the delivery log.
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Cipher } from "./crypto/index";
import { webhook_endpoints } from "./schema/operations";
import { webhook_deliveries } from "./schema/operations2";
import { date, num, rows, tsOrNow, type DbOrTx, type Page } from "./sqlrows";

const secretCtx = (id: string) => ({ table: "webhook_endpoints", column: "secret", rowId: id });

/** Creates an endpoint. Returns the plaintext secret once (generated when not given) for the receiver. */
export async function createWebhookEndpoint(
  db: DbOrTx,
  cipher: Cipher,
  i: { orgId: string; url: string; events: readonly string[]; secret?: string; active?: boolean },
): Promise<{ id: string; secret: string }> {
  const id = randomUUID();
  const secret = i.secret ?? randomBytes(32).toString("base64url");
  await db.insert(webhook_endpoints).values({
    id, org_id: i.orgId, url: i.url, events: [...i.events], active: i.active ?? true, secret: cipher.encrypt(secret, secretCtx(id)),
  });
  return { id, secret };
}

/** Replaces an endpoint's signing secret; returns the new plaintext once. */
export async function rotateWebhookSecret(db: DbOrTx, cipher: Cipher, endpointId: string, secret?: string): Promise<string> {
  const s = secret ?? randomBytes(32).toString("base64url");
  await db.update(webhook_endpoints).set({ secret: cipher.encrypt(s, secretCtx(endpointId)) }).where(eq(webhook_endpoints.id, endpointId));
  return s;
}

export async function readWebhookSecret(db: DbOrTx, cipher: Cipher, endpointId: string): Promise<string | null> {
  const r = await db.select({ s: webhook_endpoints.secret }).from(webhook_endpoints).where(eq(webhook_endpoints.id, endpointId)).limit(1);
  return r[0] ? cipher.decrypt(r[0].s, secretCtx(endpointId)) : null;
}

/**
 * The signature header value for a delivery: `t=<unix seconds>,v1=<hex HMAC-SHA-256 of "t.body">`.
 * Receivers recompute it with the shared secret and reject stale timestamps.
 */
export function signWebhookBody(secret: string, body: string, at: Date = new Date()): string {
  const t = Math.floor(at.getTime() / 1000);
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex")}`;
}

/** Queues one event for every active endpoint of the organisation subscribed to it ("*" = all). */
export async function enqueueWebhookEvent(
  db: DbOrTx,
  i: { orgId: string; event: string; payload: Record<string, unknown>; alertId?: string | null; now?: Date },
): Promise<number> {
  const r = await rows(
    db,
    sql`select public.webhook_enqueue(${i.orgId}::uuid, ${i.event}, ${JSON.stringify(i.payload)}::jsonb, ${i.alertId ?? null}::uuid, ${tsOrNow(i.now)}) as n`,
  );
  return num(r[0]!.n);
}

export interface ClaimedDelivery {
  delivery_id: string;
  endpoint_id: string;
  url: string;
  /** Decrypted signing secret. */
  secret: string;
  event: string;
  payload: Record<string, unknown>;
  /** Attempts made before this one. */
  attempt: number;
}

/** Claims due deliveries (leased; safe with concurrent workers). Secrets come back decrypted. */
export async function claimWebhookDeliveries(
  db: DbOrTx,
  cipher: Cipher,
  opts: { limit?: number; leaseSeconds?: number; now?: Date } = {},
): Promise<ClaimedDelivery[]> {
  const r = await rows(
    db,
    sql`select * from public.webhook_claim(${opts.limit ?? 20}::integer, make_interval(secs => ${opts.leaseSeconds ?? 120}), ${tsOrNow(opts.now)})`,
  );
  return r.map((x) => ({
    delivery_id: String(x.delivery_id),
    endpoint_id: String(x.endpoint_id),
    url: String(x.url),
    secret: cipher.decrypt(String(x.secret), secretCtx(String(x.endpoint_id))),
    event: String(x.event),
    payload: (typeof x.payload === "string" ? JSON.parse(x.payload) : x.payload) as Record<string, unknown>,
    attempt: num(x.attempt),
  }));
}

/** Records an attempt: success → succeeded; failure → retried (30 s × 2^n, ≤ 1 h) until maxAttempts, then dead. */
export async function recordWebhookAttempt(
  db: DbOrTx,
  i: { deliveryId: string; ok: boolean; responseCode?: number | null; error?: string | null; durationMs?: number | null; maxAttempts?: number; now?: Date },
): Promise<{ state: "pending" | "succeeded" | "dead"; attempt: number; next_attempt_at: Date }> {
  const x = (
    await rows(
      db,
      sql`select * from public.webhook_record_attempt(${i.deliveryId}::uuid, ${i.ok}, ${i.responseCode ?? null}::integer, ${i.error ?? null},
            ${i.durationMs ?? null}::integer, ${i.maxAttempts ?? 8}::integer, ${tsOrNow(i.now)})`,
    )
  )[0]!;
  return { state: x.state as "pending" | "succeeded" | "dead", attempt: num(x.attempt), next_attempt_at: date(x.next_attempt_at)! };
}

export type WebhookDelivery = typeof webhook_deliveries.$inferSelect;
/** The delivery log (06 D10), newest first. */
export async function listWebhookDeliveries(
  db: DbOrTx,
  q: { endpointId?: string; state?: WebhookDelivery["state"]; limit?: number; offset?: number } = {},
): Promise<Page<WebhookDelivery>> {
  const conds = [q.endpointId ? eq(webhook_deliveries.endpoint_id, q.endpointId) : undefined, q.state ? eq(webhook_deliveries.state, q.state) : undefined].filter(Boolean);
  const where = conds.length ? and(...(conds as never[])) : undefined;
  const items = await db.select().from(webhook_deliveries).where(where).orderBy(desc(webhook_deliveries.created_at)).limit(q.limit ?? 50).offset(q.offset ?? 0);
  const total = num((await db.select({ n: sql<number>`count(*)` }).from(webhook_deliveries).where(where))[0]!.n);
  return { items, total };
}
