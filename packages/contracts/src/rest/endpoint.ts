import { z } from "zod";
import { Id } from "../common.js";
import type { Role } from "../enums/index.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Who may call an endpoint.
 * - `public`   — no token required (a token, if sent, is still verified).
 * - `attendee` — an attendee principal (email-link sign-in).
 * - a `Role`   — an operator or staff principal holding that role.
 * - `device`   — a fixed reader authenticated by its device token (O-17).
 */
export type Access = "public" | "attendee" | "device" | Role;

export interface EndpointDef<
  P extends z.ZodTypeAny = z.ZodTypeAny,
  Q extends z.ZodTypeAny = z.ZodTypeAny,
  B extends z.ZodTypeAny = z.ZodTypeAny,
  R extends z.ZodTypeAny = z.ZodTypeAny,
> {
  method: HttpMethod;
  /** Express-style path relative to `/api/v1`, e.g. `/events/:slug`. */
  path: string;
  access: readonly Access[];
  /** Requires a token that has passed `/auth/mfa/verify` recently. */
  mfa?: boolean;
  /** Written to the hash-chained audit log. */
  audited?: boolean;
  /** Rate-limit bucket applied by the API. */
  rateLimit?: "auth" | "scan" | "resend";
  params: P;
  query: Q;
  body: B;
  response: R;
  /** Success status code (default 200). */
  status?: number;
}

export const NoParams = z.object({}).strict();
export const NoQuery = z.object({}).strip();
export const NoBody = z.undefined().or(z.object({}).strict());

export function endpoint<
  P extends z.ZodTypeAny = typeof NoParams,
  Q extends z.ZodTypeAny = typeof NoQuery,
  B extends z.ZodTypeAny = typeof NoBody,
  R extends z.ZodTypeAny = z.ZodTypeAny,
>(def: {
  method: HttpMethod;
  path: string;
  access: readonly Access[];
  mfa?: boolean;
  audited?: boolean;
  rateLimit?: "auth" | "scan" | "resend";
  params?: P;
  query?: Q;
  body?: B;
  response: R;
  status?: number;
}): EndpointDef<P, Q, B, R> {
  return {
    ...def,
    params: (def.params ?? NoParams) as P,
    query: (def.query ?? NoQuery) as Q,
    body: (def.body ?? NoBody) as B,
  };
}

/** Inferred request/response types for an endpoint. */
export type ParamsOf<E extends EndpointDef> = z.infer<E["params"]>;
export type QueryOf<E extends EndpointDef> = z.input<E["query"]>;
export type BodyOf<E extends EndpointDef> = z.input<E["body"]>;
export type ResponseOf<E extends EndpointDef> = z.infer<E["response"]>;

/** Common role groups. */
export const OPERATORS = ["admin", "organiser"] as const satisfies readonly Access[];
export const ADMIN_ONLY = ["admin"] as const satisfies readonly Access[];
export const SCANNERS = ["security_staff"] as const satisfies readonly Access[];
/** Operators and supervisors: the live screens and reads (D-23). */
export const SUPERVISE = ["admin", "organiser", "supervisor"] as const satisfies readonly Access[];
/** Operators and desk clerks: the registration desk (D-23); clerks are scoped to their assigned events by the handler. */
export const DESK = ["admin", "organiser", "desk_clerk"] as const satisfies readonly Access[];
export const ATTENDEE = ["attendee"] as const satisfies readonly Access[];
export const PUBLIC = ["public"] as const satisfies readonly Access[];

export const IdParam = z.object({ id: Id });
export const SlugParam = z.object({ slug: z.string().min(1).max(80) });
