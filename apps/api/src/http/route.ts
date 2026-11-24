/**
 * Mounts a contract endpoint on Express. Every request passes, in order:
 *   bearer verification → rate limit (signed in: per subject; public sign-in endpoints: per IP,
 *   failures only; anonymous calls to protected endpoints: per IP; `public` reads: every call, per
 *   IP or subject) → RBAC (def.access)
 *   → MFA freshness (def.mfa) → Zod validation of params, query, body → handler
 *   → response validated against def.response (outside production) → JSON.
 */
import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { ContractError } from "@synan/contracts/errors";
import type { EndpointDef } from "@synan/contracts/rest";
import { API_BASE_PATH } from "@synan/contracts/common";
import type { AuthContext } from "../domain/principal.js";
import type { AppContext } from "../app.js";

export interface HandlerInput<E extends EndpointDef> {
  params: z.output<E["params"]>;
  query: z.output<E["query"]>;
  body: z.output<E["body"]>;
  ctx: AuthContext | null;
  ip: string;
  req: Request;
}

export type Handler<E extends EndpointDef> = (input: HandlerInput<E>) => Promise<z.input<E["response"]>>;

function issuesOf(err: z.ZodError, prefix: string) {
  return err.issues.map((i) => ({ path: [prefix, ...i.path.map(String)].join("."), message: i.message }));
}

function parseOrThrow<S extends z.ZodTypeAny>(schema: S, value: unknown, where: string): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new ContractError("VALIDATION_FAILED", undefined, issuesOf(r.error, where));
  return r.data;
}

export function allowed(def: EndpointDef, ctx: AuthContext | null): boolean {
  if (def.access.includes("public")) return true;
  if (!ctx) return false;
  if (ctx.kind === "attendee") return def.access.includes("attendee");
  if (ctx.kind === "device") return def.access.includes("device");
  return ctx.role !== null && def.access.includes(ctx.role);
}

/**
 * The bearer's principal, or null without one. On an endpoint scanners use (`scanner`), a refused
 * token is reported as a rogue scanner connection (03 §8.2) — except an expired one, which is the
 * normal cue to refresh.
 */
export async function authenticate(app: AppContext, req: Request, scanner?: { channel: string }): Promise<AuthContext | null> {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer ([A-Za-z0-9._-]+)$/.exec(h);
  let ctx: AuthContext;
  try {
    if (!m) throw new ContractError("UNAUTHENTICATED");
    ctx = await app.auth.verifyAccess(m[1]!);
  } catch (e) {
    if (scanner && !(e instanceof ContractError && e.code === "TOKEN_EXPIRED")) {
      await app.scannerTrust.refused({ reason: "invalid_access_token", channel: scanner.channel, ip });
    }
    throw e;
  }
  if (ctx.kind === "device") {
    // Retiring a device or moving it takes effect on its next request, not when its token expires.
    const d = await app.repos.devices.byId(ctx.sub);
    const reason = !d || d.state !== "active" ? "device_not_active"
      : d.checkpoint_id !== (ctx.checkpointId ?? null) ? "device_moved"
      : d.token_version !== (ctx.tokenVersion ?? null) ? "device_token_rotated" : null;
    if (reason) {
      await app.scannerTrust.refused({ reason, channel: scanner?.channel ?? `${req.method} ${req.path}`, ip, deviceId: ctx.sub, checkpointId: ctx.checkpointId ?? null, venueId: d?.venue_id ?? null });
      throw new ContractError("UNAUTHENTICATED"); // retired, moved, or its token rotated since this access token was minted
    }
  }
  return ctx;
}

export function mount<E extends EndpointDef>(express: Express, app: AppContext, def: E, handler: Handler<E>) {
  const method = def.method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete";
  const path = API_BASE_PATH + def.path;
  app.mounted.add(def);
  express[method](path, async (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const limits = app.config.rateLimits;
    const ipKey = def.rateLimit === "scan" ? `ip:${ip}:scan` : `ip:${ip}:${def.path}`;
    const ipLimit = def.rateLimit === "scan" ? limits.scanPerMin * 2 : limits.authPerMin;
    let chargeIpOnFailure = false;
    try {
      const limited = (retry: number | null) => {
        if (retry !== null) {
          res.setHeader("Retry-After", String(retry));
          throw new ContractError("RATE_LIMITED");
        }
      };
      const rl = (key: string, limit: number, windowMs: number) => limited(app.rateLimiter.hit(key, limit, windowMs));

      // Authenticate before charging any shared per-IP bucket, so anonymous traffic from a shared
      // address (venue NAT, guest Wi-Fi, a proxy) cannot exhaust the bucket real users depend on.
      let ctx: AuthContext | null = null;
      let authError: unknown = null;
      try {
        // Endpoints a gate device may call are scanner endpoints: a refused token there is a rogue connection.
        ctx = await authenticate(app, req, def.access.includes("device") ? { channel: `${def.method} ${def.path}` } : undefined);
      } catch (e) {
        authError = e;
      }
      if (def.rateLimit === "auth" || def.rateLimit === "scan") {
        if (ctx) {
          // Signed-in callers are limited per subject (03 §3 "per-token"), never by their address.
          if (def.rateLimit === "scan") rl(`sub:${ctx.sub}:scan`, limits.scanPerMin, 60_000);
          else rl(`sub:${ctx.sub}:${def.path}`, limits.authPerMin, 60_000);
        } else if (def.access.includes("public") && def.rateLimit === "auth") {
          // Public sign-in endpoints: only failures count against the address.
          limited(app.rateLimiter.blocked(ipKey, ipLimit, 60_000));
          chargeIpOnFailure = true;
        } else {
          rl(ipKey, ipLimit, 60_000); // anonymous call to a protected endpoint
        }
      }
      if (def.rateLimit === "public") {
        // Anonymous reads: every call counts, per address; a signed-in caller per subject.
        rl(ctx ? `sub:${ctx.sub}:${def.path}` : `ip:${ip}:${def.path}`, app.config.publicReadsPerMin, 60_000);
      }
      if (authError) throw authError;
      if (!allowed(def, ctx)) throw new ContractError(ctx ? "FORBIDDEN" : "UNAUTHENTICATED");
      if (def.mfa && ctx && !app.auth.isMfaFresh(ctx)) throw new ContractError("MFA_REQUIRED");

      if (ctx && def.rateLimit === "resend") rl(`sub:${ctx.sub}:${def.path}`, limits.resendPerHour, 3_600_000);

      const params = parseOrThrow(def.params, req.params ?? {}, "params");
      const query = parseOrThrow(def.query, req.query ?? {}, "query");
      const body = parseOrThrow(def.body, req.body, "body");

      const out = await handler({ params, query, body, ctx, ip, req } as HandlerInput<E>);
      if (app.config.validateResponses) {
        const check = def.response.safeParse(out);
        if (!check.success) {
          console.error(`[contract] response for ${def.method} ${def.path} violates its schema`, check.error.issues);
          throw new ContractError("INTERNAL", "Response failed contract validation");
        }
      }
      res.status(def.status ?? 200).json(out);
    } catch (e) {
      if (chargeIpOnFailure && !(e instanceof ContractError && e.code === "RATE_LIMITED")) {
        app.rateLimiter.hit(ipKey, ipLimit, 60_000);
      }
      next(e);
    }
  });
}

/** Mount an endpoint the server does not implement yet: full auth/RBAC, then 501. */
export function mountNotImplemented(express: Express, app: AppContext, def: EndpointDef) {
  mount(express, app, def, async () => {
    throw new ContractError("NOT_IMPLEMENTED");
  });
  app.mounted.delete(def);
}
