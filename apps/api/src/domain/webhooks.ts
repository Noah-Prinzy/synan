/**
 * Outbound webhooks (02 §6, 03 §3): HMAC-signed mirrors of `/stream/alerts`, on @synan/db's
 * delivery queue (leases, backoff 30 s × 2^(n−1) capped at 1 h, dead after 8 attempts, delivery log).
 *   X-Synan-Signature: t=<unix s>,v1=<hex HMAC-SHA-256(secret, "<t>.<body>")>
 * Alert payloads carry no personal data; the credential link is removed before anything leaves.
 *
 * SSRF: the host is resolved and every address checked at creation and again at each delivery; the
 * request is then made to the vetted address (pinned), so a DNS answer cannot change between the
 * check and the connection. Redirects are never followed.
 */
import { describeError } from "@synan/db";
import { createHmac, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { ContractError } from "@synan/contracts/errors";
import type { BreachAlert, WebhookEventName } from "@synan/contracts/rest";
import { WEBHOOK_DELIVERY_HEADER, WEBHOOK_EVENT_HEADER, WEBHOOK_SIGNATURE_HEADER } from "@synan/contracts/rest";
import type { Clock } from "../lib/clock.js";
import type { Repos } from "../repo/types.js";
import type { AlertService } from "./alerts.js";

const TIMEOUT_MS = 5_000;

/** Resolves a host name to its addresses (injectable for tests). */
export type HostResolver = (host: string) => Promise<string[]>;
export const dnsResolver: HostResolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

export interface WebhookTransport {
  /** POST to `url`, connecting only to `address` (already vetted). */
  post(url: string, address: string, body: string, headers: Record<string, string>, timeoutMs: number): Promise<{ status: number }>;
}

/** HTTPS with the connection pinned to the vetted address; TLS still verifies the URL's host name. */
export const httpsTransport: WebhookTransport = {
  post(url, address, body, headers, timeoutMs) {
    const pinned: LookupFunction = (_h, opts, cb) => {
      const family = isIP(address);
      if ((opts as { all?: boolean }).all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address, family }]);
      else cb(null, address, family);
    };
    return new Promise((resolve, reject) => {
      const req = request(url, { method: "POST", headers: { ...headers, "content-length": Buffer.byteLength(body) }, lookup: pinned, timeout: timeoutMs }, (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
      });
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", reject);
      req.end(body);
    });
  },
};

export function signWebhook(secret: string, t: number, body: string): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

/** True for loopback, private, link-local, CGNAT, multicast, unspecified and IPv4-mapped addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x.startsWith("::ffff:")) return isPrivateAddress(x.slice(7)) || !isIP(x.slice(7));
    return x === "::1" || x === "::" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe8") || x.startsWith("fe9") || x.startsWith("fea") || x.startsWith("feb") || x.startsWith("ff");
  }
  return true; // not an address at all
}

const notPublic = () => new ContractError("VALIDATION_FAILED", "The webhook URL must be a public https address.", [{ path: "body.url", message: "not a public https address" }]);

/** Resolves the URL's host; every address must be public. Returns the address to connect to. */
export async function vetWebhookUrl(raw: string, resolve: HostResolver): Promise<string> {
  const u = new URL(raw);
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (u.protocol !== "https:" || u.username || u.password) throw notPublic();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw notPublic();
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await resolve(host);
  } catch {
    throw new ContractError("VALIDATION_FAILED", "The webhook host does not resolve.", [{ path: "body.url", message: "does not resolve" }]);
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw notPublic();
  return addresses[0]!;
}

export class WebhookService {
  private draining: Promise<void> | null = null;

  constructor(
    private readonly repos: Repos,
    private readonly clock: Clock,
    private readonly transport: WebhookTransport = httpsTransport,
    readonly resolve: HostResolver = dnsResolver,
  ) {}

  attach(alerts: AlertService) {
    alerts.events.on("raised", (a: BreachAlert) => void this.enqueue("alert.raised", a).catch(logErr));
    alerts.events.on("updated", (a: BreachAlert) => void this.enqueue("alert.updated", a).catch(logErr));
  }

  async enqueue(event: WebhookEventName, alert: BreachAlert): Promise<number> {
    const [org] = await this.repos.venues.organizations();
    if (!org) return 0;
    const now = new Date(this.clock.now());
    // `id` names the event (shared by every endpoint); the delivery id travels in X-Synan-Delivery.
    const payload = { id: randomUUID(), event, created_at: now.toISOString(), data: { ...alert, credential_id: null } };
    const n = await this.repos.webhookDeliveries.enqueue({ orgId: org.id, event, payload, alertId: alert.id, now });
    if (n) void this.drain().catch(logErr);
    return n;
  }

  /** Attempt every due delivery once. Concurrent calls share one run. */
  drain(): Promise<void> {
    this.draining ??= this.run().finally(() => (this.draining = null));
    return this.draining;
  }

  private async run() {
    for (;;) {
      const due = await this.repos.webhookDeliveries.claim(new Date(this.clock.now()), 50);
      if (due.length === 0) return;
      for (const d of due) {
        const body = JSON.stringify(d.payload);
        let ok = false;
        let status: number | null = null;
        let error: string | null = null;
        try {
          const address = await vetWebhookUrl(d.url, this.resolve); // re-checked at every delivery
          const t = Math.floor(this.clock.now() / 1000);
          const r = await this.transport.post(d.url, address, body, {
            "content-type": "application/json",
            [WEBHOOK_EVENT_HEADER]: d.event,
            [WEBHOOK_DELIVERY_HEADER]: d.delivery_id,
            [WEBHOOK_SIGNATURE_HEADER]: signWebhook(d.secret, t, body),
          }, TIMEOUT_MS);
          status = r.status;
          ok = r.status >= 200 && r.status < 300;
          if (!ok) error = `HTTP ${r.status}`;
        } catch (e) {
          error = e instanceof ContractError ? "address not public" : e instanceof Error ? e.name : "error"; // never the URL or body
        }
        await this.repos.webhookDeliveries.record({ deliveryId: d.delivery_id, ok, responseCode: status, error, now: new Date(this.clock.now()) });
      }
    }
  }
}

function logErr(e: unknown) {
  console.error("[webhooks]", describeError(e));
}
