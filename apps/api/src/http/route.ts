/**
 * Mounts a contract endpoint on Express. Every request passes, in order:
 *   per-IP rate limit → bearer verification → RBAC (def.access) → MFA freshness (def.mfa)
 *   → per-subject rate limit → Zod validation of params, query, body → handler
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
  return ctx.role !== null && def.access.includes(ctx.role);
}

export async function authenticate(app: AppContext, req: Request): Promise<AuthContext | null> {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer ([A-Za-z0-9._-]+)$/.exec(h);
  if (!m) throw new ContractError("UNAUTHENTICATED");
  return app.auth.verifyAccess(m[1]!);
}

export function mount<E extends EndpointDef>(express: Express, app: AppContext, def: E, handler: Handler<E>) {
  const method = def.method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete";
  const path = API_BASE_PATH + def.path;
  app.mounted.add(def);
  express[method](path, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
      const limits = app.config.rateLimits;
      const rl = (key: string, limit: number, windowMs: number) => {
        const retry = app.rateLimiter.hit(key, limit, windowMs);
        if (retry !== null) {
          res.setHeader("Retry-After", String(retry));
          throw new ContractError("RATE_LIMITED");
        }
      };
      if (def.rateLimit === "auth") rl(`ip:${ip}:${def.path}`, limits.authPerMin, 60_000);
      if (def.rateLimit === "scan") rl(`ip:${ip}:scan`, limits.scanPerMin * 2, 60_000);

      const ctx = await authenticate(app, req);
      if (!allowed(def, ctx)) throw new ContractError(ctx ? "FORBIDDEN" : "UNAUTHENTICATED");
      if (def.mfa && ctx && !app.auth.isMfaFresh(ctx)) throw new ContractError("MFA_REQUIRED");

      if (ctx && def.rateLimit === "scan") rl(`sub:${ctx.sub}:scan`, limits.scanPerMin, 60_000);
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
