/**
 * A small typed client for the Synan REST API (docs/02 §5), driven by the endpoint definitions in
 * @synan/contracts/rest: the definition gives the method, the path, who may call it, and the
 * response schema every answer is validated against. No other dependency than `fetch`.
 *
 * - Access tokens: sent as `Authorization: Bearer`. One that has expired (or is about to) is
 *   refreshed first; a 401 TOKEN_EXPIRED is refreshed and retried once.
 * - Refresh tokens rotate and are single-use: two tabs refreshing the same one would look like
 *   theft and end the session, so refreshes run one at a time per browser (Web Locks when
 *   available) and a tab that waited reuses the pair the other tab stored.
 * - A refresh whose answer is lost (venue Wi-Fi) is sent again at once with the SAME token: the
 *   server re-issues a rotated token to the same client within its 10-second reuse grace, and
 *   reads anything later as theft. So the refresh has a short timeout and one quick retry, both
 *   inside the grace (as the Gate Scanner's refreshWithRetry). No answer twice keeps the session.
 * - Every failure is an `ApiFailure` with a contracts ErrorCode (or OFFLINE / NETWORK), mapped to
 *   words in one place (data/failure.ts).
 */
import { API_BASE_PATH } from "@synan/contracts/common";
import { ApiError } from "@synan/contracts/errors";
import type { BodyOf, EndpointDef, ParamsOf, QueryOf, ResponseOf, TokenPair } from "@synan/contracts/rest";
import { ApiFailure, type FailureCode } from "../failure";
import type { SessionStore, StoredSession } from "./session";

export type CallInput<E extends EndpointDef> = {
  params?: ParamsOf<E>;
  query?: QueryOf<E>;
  body?: BodyOf<E>;
};

export type CallOptions = {
  /** `none`: never send a token (sign-in endpoints). Default: send one when signed in. */
  auth?: "default" | "none";
  /** Send exactly this access token, with no refresh (signing out a session already removed from the device). */
  token?: string;
};

export interface ApiClient {
  call<E extends EndpointDef>(def: E, input?: CallInput<E>, options?: CallOptions): Promise<ResponseOf<E>>;
}

export interface ApiClientOptions {
  /** API origin, e.g. `http://127.0.0.1:5180` (the client adds /api/v1). */
  baseUrl: string;
  session: SessionStore;
  /** endpoints.refresh, passed in so this module needs no particular endpoint group. */
  refresh: EndpointDef;
  /** Called once when the server refuses the session (refresh answered 401): it is over. */
  onSignedOut?: () => void;
  fetch?: typeof fetch;
  now?: () => number;
  online?: () => boolean;
  /** Run `task` exclusively across tabs. Default: the Web Locks API when present. */
  lock?: <T>(name: string, task: () => Promise<T>) => Promise<T>;
  timeoutMs?: number;
}

/** Refresh this long before the access token's stated expiry (clock skew, slow networks). */
const EXPIRY_MARGIN_MS = 30_000;
/**
 * A refresh waits at most this long, then the SAME token is sent once more after
 * REFRESH_RETRY_DELAY_MS: both attempts fit inside the server's 10-second reuse grace (4 + 0.5 + 4 s),
 * where a later retry would read as reuse and end the session. As the scanner (apps/scanner config.ts).
 */
export const REFRESH_TIMEOUT_MS = 4000;
export const REFRESH_RETRY_DELAY_MS = 500;

const STATUS_CODE: Record<number, FailureCode> = {
  400: "VALIDATION_FAILED",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  429: "RATE_LIMITED",
  501: "NOT_IMPLEMENTED",
};

function defaultLock<T>(name: string, task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  return locks ? (locks.request(name, task) as Promise<T>) : task();
}

export function buildPath(path: string, params: Record<string, unknown> | undefined): string {
  return path.replace(/:([A-Za-z_]+)/g, (_, name: string) => {
    const value = params?.[name];
    if (value === undefined || value === null || value === "") throw new Error(`Missing path parameter :${name} for ${path}`);
    return encodeURIComponent(String(value));
  });
}

export function buildQuery(query: Record<string, unknown> | undefined): string {
  if (!query) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) for (const item of value) search.append(key, String(item));
    else search.append(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const base = options.baseUrl.replace(/\/+$/, "") + API_BASE_PATH;
  const doFetch = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const now = options.now ?? Date.now;
  const online = options.online ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const lock = options.lock ?? defaultLock;
  const timeoutMs = options.timeoutMs ?? 15_000;
  let refreshing: Promise<StoredSession> | null = null;

  const fresh = (session: StoredSession) => Date.parse(session.access_expires_at) - EXPIRY_MARGIN_MS > now();

  /** One HTTP exchange: no token logic. Throws ApiFailure; returns the validated response. */
  async function send<E extends EndpointDef>(def: E, input: CallInput<E>, token: string | null, waitMs = timeoutMs): Promise<ResponseOf<E>> {
    const url = base + buildPath(def.path, input.params as Record<string, unknown> | undefined) + buildQuery(input.query as Record<string, unknown> | undefined);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    let body: string | undefined;
    if (input.body !== undefined && def.method !== "GET") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(input.body);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), waitMs);
    let response: Response;
    try {
      response = await doFetch(url, { method: def.method, headers, body, signal: controller.signal, credentials: "omit" });
    } catch {
      // No answer: the network is down, the server is unreachable, CORS refused it, or it timed out.
      throw new ApiFailure(online() ? "NETWORK" : "OFFLINE", 0);
    } finally {
      clearTimeout(timer);
    }

    let json: unknown = undefined;
    const text = await response.text().catch(() => "");
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }

    if (!response.ok) {
      const parsed = ApiError.safeParse(json);
      if (parsed.success) {
        const { code, message, issues } = parsed.data.error;
        throw new ApiFailure(code, response.status, message, issues);
      }
      throw new ApiFailure(STATUS_CODE[response.status] ?? "INTERNAL", response.status);
    }

    const checked = def.response.safeParse(json);
    if (!checked.success) {
      // The server broke its contract: treat as a server error, and say where in development.
      if (import.meta.env.DEV) console.error(`[api] ${def.method} ${def.path}: response does not match its contract`, checked.error.issues);
      throw new ApiFailure("INTERNAL", response.status, "Response failed contract validation");
    }
    return checked.data as ResponseOf<E>;
  }

  /**
   * POST /auth/refresh with one retry of the SAME token when no answer came back (no answer, timeout,
   * 5xx): the server may have rotated it and lost the answer, and re-issues to the same client within
   * 10 seconds. A refusal (4xx) is never retried.
   */
  async function refreshWithRetry(token: string): Promise<TokenPair> {
    const exchange = () => send(options.refresh, { body: { refresh_token: token } }, null, REFRESH_TIMEOUT_MS) as Promise<TokenPair>;
    try {
      return await exchange();
    } catch (error) {
      if (!(error instanceof ApiFailure && (error.status === 0 || error.status >= 500))) throw error;
      await new Promise((resolve) => setTimeout(resolve, REFRESH_RETRY_DELAY_MS));
      return exchange();
    }
  }

  /** Exchange the refresh token, once per browser at a time. Resolves with the stored session. */
  function refresh(stale: StoredSession): Promise<StoredSession> {
    refreshing ??= lock("synan.auth.refresh", async () => {
      const current = options.session.read();
      if (!current) throw new ApiFailure("UNAUTHENTICATED", 401);
      // Another tab refreshed while this one waited for the lock: use its pair.
      if (current.refresh_token !== stale.refresh_token && fresh(current)) return current;
      try {
        const pair = await refreshWithRetry(current.refresh_token);
        return options.session.save(pair);
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 401) {
          // Refused: expired, revoked (sign-out elsewhere, erasure) or reused. The session is over.
          options.session.clear();
          options.onSignedOut?.();
        }
        throw error;
      }
    }).finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function call<E extends EndpointDef>(def: E, input: CallInput<E> = {}, callOptions: CallOptions = {}): Promise<ResponseOf<E>> {
    if (callOptions.token) return send(def, input, callOptions.token);
    const isPublic = def.access.includes("public");
    let session = callOptions.auth === "none" ? null : options.session.read();
    if (!session && !isPublic) throw new ApiFailure("UNAUTHENTICATED", 401);

    if (session && !fresh(session)) {
      try {
        session = await refresh(session);
      } catch (error) {
        // A public endpoint still answers without a token; a protected one cannot.
        if (!isPublic || (error instanceof ApiFailure && (error.code === "OFFLINE" || error.code === "NETWORK"))) throw error;
        session = null;
      }
    }

    try {
      return await send(def, input, session?.access_token ?? null);
    } catch (error) {
      // The token was refused although it looked fresh (server clock, a restarted server's new
      // signing key): refresh once and retry.
      const refused = error instanceof ApiFailure && error.status === 401 && (error.code === "TOKEN_EXPIRED" || error.code === "UNAUTHENTICATED");
      if (!session || !refused || def === options.refresh) throw error;
      let renewed: StoredSession;
      try {
        renewed = await refresh(session);
      } catch (refreshError) {
        if (isPublic && refreshError instanceof ApiFailure && refreshError.status === 401) return send(def, input, null);
        throw refreshError;
      }
      return send(def, input, renewed.access_token);
    }
  }

  return { call };
}
