/**
 * Typed REST client (02 §5) over fetch: request and response types come from
 * `@synan/contracts/rest` (type-only, so no Zod reaches the bundle). Paths are listed here and
 * checked against the contracts' `endpoints` registry by test/paths.test.ts.
 *
 * Session (03 §3): `POST /auth/login` → a short-lived access token and a rotating refresh token.
 * Refresh tokens are single-use and reuse revokes the whole session, so a refresh runs under a Web
 * Lock shared by every tab, and a tab that waited re-reads the tokens another tab just stored. A
 * refresh whose answer is lost is retried once with the same token, inside the server's grace.
 */
import type { BodyOf, endpoints, ParamsOf, QueryOf, ResponseOf, TokenPair } from "@synan/contracts/rest";
import type { ErrorCode } from "@synan/contracts/errors";
import { REFRESH_RETRY_DELAY_MS, REFRESH_TIMEOUT_MS, REQUEST_TIMEOUT_MS, REST_BASE } from "./config";

type Endpoints = typeof endpoints;

/** The endpoints the scanner calls. Must equal `endpoints[name]` (method, path) — see the test. */
export const PATHS = {
  login: { method: "POST", path: "/auth/login" },
  refresh: { method: "POST", path: "/auth/refresh" },
  logout: { method: "POST", path: "/auth/logout" },
  wsTicket: { method: "POST", path: "/auth/ws-ticket" },
  signingKeys: { method: "GET", path: "/auth/signing-keys" },
  time: { method: "GET", path: "/time" },
  myAssignments: { method: "GET", path: "/me/assignments" },
  getEvent: { method: "GET", path: "/events/:slug" },
  allowlist: { method: "GET", path: "/events/:id/allowlist" },
  postScans: { method: "POST", path: "/scans" },
  undoScan: { method: "POST", path: "/scans/:id/undo" },
  gateHeartbeat: { method: "POST", path: "/gates/heartbeat" },
  handover: { method: "POST", path: "/staff-assignments/:id/handover" },
  // Public: staff activation (screens/activate.tsx), called without a session.
  checkActivation: { method: "POST", path: "/auth/activate/check" },
  activateStaff: { method: "POST", path: "/auth/activate" },
} as const satisfies { [K in keyof Endpoints]?: { method: Endpoints[K]["method"]; path: string } };

export type Op = keyof typeof PATHS;

export interface CallInput<K extends Op> {
  params?: ParamsOf<Endpoints[K]>;
  query?: QueryOf<Endpoints[K]>;
  body?: BodyOf<Endpoints[K]>;
}

/** A failed call. `kind: "network"` covers no answer, a timeout, and 5xx (the server may have acted). */
export class ApiFailure extends Error {
  constructor(
    readonly kind: "network" | "http",
    readonly status: number,
    readonly code: ErrorCode | null,
    message: string,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
  /** The server may or may not have applied the request. */
  get ambiguous(): boolean {
    return this.kind === "network" || this.status >= 500;
  }
}

/* ------------------------------------------------------------ session */

export interface Session {
  access_token: string;
  access_expires_at: number;
  refresh_token: string;
  refresh_expires_at: number;
  sub: string;
  email: string | null;
}

const SESSION_KEY = "syn.scanner.session.v1";
const LOCK = "synan-scanner-refresh";

export function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function writeSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage blocked: the session lives in memory for this tab */
  }
  memory = s;
  for (const l of sessionListeners) l(s);
}

let memory: Session | null = null;
const sessionListeners = new Set<(s: Session | null) => void>();

export function onSession(l: (s: Session | null) => void): () => void {
  sessionListeners.add(l);
  return () => sessionListeners.delete(l);
}

export function currentSession(): Session | null {
  return readSession() ?? memory;
}

// Another tab signed in, refreshed or signed out.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === SESSION_KEY) for (const l of sessionListeners) l(readSession());
  });
}

function fromPair(p: TokenPair): Session {
  return {
    access_token: p.access_token,
    access_expires_at: Date.parse(p.access_expires_at),
    refresh_token: p.refresh_token,
    refresh_expires_at: Date.parse(p.refresh_expires_at),
    sub: p.principal.sub,
    email: p.principal.email,
  };
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  return locks ? locks.request(LOCK, fn) : fn();
}

let refreshing: Promise<Session | null> | null = null;

/**
 * POST /auth/refresh with one retry of the SAME token when no answer came back (no answer, timeout,
 * 5xx). The server may have rotated it and lost the answer; it re-issues to the same client within
 * 10 seconds, so the retry is what saves the session (a new token would not exist to send).
 */
export async function refreshWithRetry(
  token: string,
  send: (token: string) => Promise<TokenPair> = (t) => raw("refresh", { body: { refresh_token: t } }, null, REFRESH_TIMEOUT_MS),
  pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<TokenPair> {
  try {
    return await send(token);
  } catch (e) {
    if (!(e instanceof ApiFailure && e.ambiguous)) throw e;
    await pause(REFRESH_RETRY_DELAY_MS);
    return send(token);
  }
}

/** Rotate the refresh token once, across tabs. Null when the session is gone (sign in again). */
export function refreshSession(stale: Session): Promise<Session | null> {
  refreshing ??= withLock(async () => {
    const now = currentSession();
    // Another tab already rotated it while we waited.
    if (now && now.refresh_token !== stale.refresh_token) return now;
    if (!now) return null;
    try {
      const pair = await refreshWithRetry(now.refresh_token);
      const s = fromPair(pair);
      writeSession(s);
      return s;
    } catch (e) {
      // Refused (reuse detected, expired, revoked): the session is over. No answer twice keeps it.
      if (e instanceof ApiFailure && e.kind === "http" && (e.status === 401 || e.status === 400)) writeSession(null);
      throw e;
    }
  }).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function signIn(email: string, password: string): Promise<Session> {
  const pair = await raw("login", { body: { email, password } }, null);
  if (pair.principal.role !== "security_staff") {
    // The scanner is for gate staff; any other role would be refused at every gate.
    throw new ApiFailure("http", 403, "FORBIDDEN", "This account is not a gate staff account.");
  }
  const s = fromPair(pair);
  writeSession(s);
  return s;
}

export async function signOut(): Promise<void> {
  const s = currentSession();
  writeSession(null);
  if (s) await raw("logout", {}, s.access_token).catch(() => undefined);
}

/* ------------------------------------------------------------ calls */

function url<K extends Op>(op: K, input: CallInput<K>): string {
  let path: string = PATHS[op].path;
  for (const [k, v] of Object.entries((input.params ?? {}) as Record<string, string>)) path = path.replace(`:${k}`, encodeURIComponent(v));
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries((input.query ?? {}) as Record<string, unknown>)) if (v !== undefined && v !== null) q.set(k, String(v));
  const qs = q.toString();
  return `${REST_BASE}${path}${qs ? `?${qs}` : ""}`;
}

async function raw<K extends Op>(op: K, input: CallInput<K>, token: string | null, timeoutMs = REQUEST_TIMEOUT_MS, signal?: AbortSignal): Promise<ResponseOf<Endpoints[K]>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort);
  let res: Response;
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (input.body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    res = await fetch(url(op, input), {
      method: PATHS[op].method,
      headers,
      body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
      signal: ctrl.signal,
      cache: "no-store",
      credentials: "omit",
    });
  } catch {
    throw new ApiFailure("network", 0, null, "No answer from the server.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    if (res.ok) throw new ApiFailure("network", res.status, null, "Unreadable answer from the server.");
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: ErrorCode; message?: string } } | null)?.error;
    const retry = Number(res.headers.get("Retry-After"));
    throw new ApiFailure(res.status >= 500 ? "network" : "http", res.status, err?.code ?? null, err?.message ?? `HTTP ${res.status}`, Number.isFinite(retry) && retry > 0 ? retry * 1000 : null);
  }
  return json as ResponseOf<Endpoints[K]>;
}

/**
 * Call an endpoint as the signed-in user. Refreshes ahead of expiry and once on TOKEN_EXPIRED.
 * Throws ApiFailure(http 401, UNAUTHENTICATED) when there is no usable session.
 */
export async function call<K extends Op>(op: K, input: CallInput<K> = {}, opts: { timeoutMs?: number; signal?: AbortSignal; auth?: boolean } = {}): Promise<ResponseOf<Endpoints[K]>> {
  if (opts.auth === false) return raw(op, input, null, opts.timeoutMs, opts.signal);
  let s = currentSession();
  if (!s) throw new ApiFailure("http", 401, "UNAUTHENTICATED", "Sign in to continue.");
  if (s.access_expires_at - Date.now() < 60_000) s = (await refreshSession(s)) ?? null;
  if (!s) throw new ApiFailure("http", 401, "UNAUTHENTICATED", "Sign in to continue.");
  try {
    return await raw(op, input, s.access_token, opts.timeoutMs, opts.signal);
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 401 && e.code === "TOKEN_EXPIRED") {
      const next = await refreshSession(s);
      if (!next) throw new ApiFailure("http", 401, "UNAUTHENTICATED", "Sign in to continue.");
      return raw(op, input, next.access_token, opts.timeoutMs, opts.signal);
    }
    throw e;
  }
}
