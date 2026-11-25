/**
 * Typed REST client for Admin Command (02 §5), driven by the contracts' endpoint registry: the
 * entry gives the method, the path, the request schemas (checked before sending) and the response
 * schema (every answer is validated against it). No dependency but `fetch`.
 *
 * Mirrors apps/attendee/src/data/api/client.ts and apps/scanner/src/data/api/client.ts:
 *
 * - Operator session (03 §3): `signIn` with email and password; the access token is refreshed
 *   ahead of expiry, and once more if the server refuses one that looked fresh. Refresh tokens are
 *   single-use, so refreshes (and step-ups, which replace the session family) run one at a time
 *   across tabs under a Web Lock; a tab that waited reuses the pair another tab stored. A refused
 *   refresh ends the session (`onSignedOut`). A refresh whose answer is lost (venue Wi-Fi) is sent
 *   again at once with the SAME token: the server re-issues a rotated token to the same client within
 *   its 10-second reuse grace and reads anything later as theft, so the refresh has a short timeout
 *   and one quick retry, both inside the grace (as the scanner's refreshWithRetry). No answer twice
 *   keeps the session.
 * - MFA step-up (03 §3: 15 minutes, privileged actions): when a call answers MFA_REQUIRED and a
 *   step-up handler is registered, the handler receives a typed `StepUpRequest` (which call, which
 *   attempt, why the last code failed), answers with a code or a cancel, and the original call is
 *   retried once the code is accepted. Concurrent calls share one prompt. With no handler, or on
 *   cancel, the call fails with MFA_REQUIRED.
 * - Every failure is an `ApiFailure` (failure.ts): a contracts ErrorCode, the server's field issues,
 *   or `kind: "network"` when nothing answered.
 */
import { API_BASE_PATH } from "@synan/contracts/common";
import { ApiError, type ErrorCode } from "@synan/contracts/errors";
import { endpoints, type BodyOf, type EndpointDef, type EndpointName, type ParamsOf, type QueryOf, type ResponseOf, type TokenPair } from "@synan/contracts/rest";
import { ApiFailure, STATUS_CODE, type Issue } from "./failure";
import type { OperatorSession, SessionStore } from "./session";

type Endpoints = typeof endpoints;

export type CallInput<K extends EndpointName> = {
  params?: ParamsOf<Endpoints[K]>;
  query?: QueryOf<Endpoints[K]>;
  body?: BodyOf<Endpoints[K]>;
};

export type CallResult<K extends EndpointName> = ResponseOf<Endpoints[K]>;

export interface CallOptions {
  /** `none`: send no token (sign-in). Default: the signed-in operator's. */
  auth?: "default" | "none";
  /** Send exactly this token, with no refresh (logging out a session already removed here). */
  token?: string;
  /** Do not answer MFA_REQUIRED with a step-up prompt; fail instead. */
  noStepUp?: boolean;
  signal?: AbortSignal;
}

/** What the UI is asked when a call needs a fresh second factor. */
export interface StepUpRequest {
  kind: "mfa_required";
  /** The call that needs it (a contracts registry name, e.g. `exportReport`, `publishLayout`). */
  operation: EndpointName;
  /** 1 for the first prompt; higher after a refused code. */
  attempt: number;
  /** Why the previous code was refused (INVALID_MFA_CODE: wrong, expired or already used); null on the first prompt. */
  problem: ApiFailure | null;
}

/** The UI's answer: a six-digit code, or cancel (the call then fails with MFA_REQUIRED). */
export type StepUpAnswer = { code: string } | { cancel: true };
export type StepUpHandler = (request: StepUpRequest) => Promise<StepUpAnswer>;

/**
 * How a prompt ended, for the UI that answered it: accepted, or failed for good (cancelled, every
 * attempt used, rate limited, no answer, no authenticator enrolled). A code that is refused and
 * re-asked does not settle; the handler is simply called again.
 */
export type StepUpOutcome = { ok: true } | { ok: false; error: unknown };

export interface ApiClient {
  call<K extends EndpointName>(name: K, input?: CallInput<K>, options?: CallOptions): Promise<CallResult<K>>;
  /** POST /auth/login. Stores the session. INVALID_CREDENTIALS / RATE_LIMITED on failure. */
  signIn(email: string, password: string): Promise<OperatorSession>;
  /** Forget the session here at once; end the family on the server (best effort). */
  signOut(): Promise<void>;
  /** POST /auth/mfa/verify with a code (no prompt): the session becomes stepped up for 15 minutes. */
  stepUp(code: string): Promise<OperatorSession>;
  /** Register the UI's step-up prompt. Only one at a time; returns an unregister. */
  onStepUp(handler: StepUpHandler): () => void;
  /** Told once per prompt how it ended, so the prompt can close (or explain) when no retry follows. */
  onStepUpSettled(listener: (outcome: StepUpOutcome) => void): () => void;
  /** Called once when the server refuses the session (refresh answered 401). */
  onSignedOut(listener: () => void): () => void;
  readonly session: SessionStore;
  /** Server time minus local time, from the last GET /time (0 until known). */
  offsetMs(): number;
  /** GET /time; updates `offsetMs`. */
  syncTime(): Promise<number>;
  /** `ws://host:port` for the WebSocket channels. */
  readonly wsBase: string;
}

export interface ApiClientOptions {
  /** API origin, e.g. `http://127.0.0.1:5180` (a trailing `/api/v1` is accepted and ignored). */
  baseUrl: string;
  session: SessionStore;
  fetch?: typeof fetch;
  now?: () => number;
  online?: () => boolean;
  /** Run `task` exclusively across tabs. Default: the Web Locks API when present. */
  lock?: <T>(name: string, task: () => Promise<T>) => Promise<T>;
  timeoutMs?: number;
  /** Contract mismatches and dropped frames are reported here (development). */
  debug?: (message: string, detail?: unknown) => void;
}

/** Refresh this long before the access token's stated expiry (clock skew, slow networks). */
const EXPIRY_MARGIN_MS = 30_000;
/** A wrong code may be re-entered this many times per prompt (the server allows 5 per 15 minutes). */
export const STEP_UP_ATTEMPTS = 3;
const LOCK_NAME = "synan.admin.auth";
/**
 * A refresh waits at most this long, then the SAME token is sent once more after
 * REFRESH_RETRY_DELAY_MS: both attempts fit inside the server's 10-second reuse grace (4 + 0.5 + 4 s),
 * where a later retry would read as reuse and end the session. As the scanner (apps/scanner config.ts).
 */
export const REFRESH_TIMEOUT_MS = 4000;
export const REFRESH_RETRY_DELAY_MS = 500;

function defaultLock<T>(name: string, task: () => Promise<T>): Promise<T> {
  const locks = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
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

/** Check one part of a request against its schema; a mismatch fails here, before the network. */
function checked(schema: EndpointDef["params"], value: unknown, where: "params" | "query" | "body"): unknown {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues: Issue[] = result.error.issues.map((issue) => ({
    path: [where, ...issue.path.map(String)].join("."),
    message: issue.message,
  }));
  throw new ApiFailure("VALIDATION_FAILED", 0, { detail: "Request failed contract validation (not sent)", issues });
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const origin = options.baseUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  const base = origin + API_BASE_PATH;
  const doFetch = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const now = options.now ?? Date.now;
  const online = options.online ?? (() => (globalThis as { navigator?: { onLine?: boolean } }).navigator?.onLine ?? true);
  const lock = options.lock ?? defaultLock;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const debug = options.debug ?? (() => undefined);
  const { session } = options;
  const signedOutListeners = new Set<() => void>();
  const settledListeners = new Set<(outcome: StepUpOutcome) => void>();
  let stepUpHandler: StepUpHandler | null = null;
  let refreshing: Promise<OperatorSession> | null = null;
  let steppingUp: Promise<OperatorSession> | null = null;
  let offset = 0;

  const fresh = (s: OperatorSession) => s.access_expires_at - EXPIRY_MARGIN_MS > now();

  const signedOut = () => {
    for (const listener of signedOutListeners) listener();
  };

  /** One HTTP exchange, no token logic. Throws ApiFailure; returns the validated response. */
  async function send<K extends EndpointName>(name: K, input: CallInput<K>, token: string | null, signal?: AbortSignal, waitMs = timeoutMs): Promise<CallResult<K>> {
    const def = endpoints[name] as EndpointDef;
    const params = checked(def.params, input.params ?? {}, "params") as Record<string, unknown>;
    // The query is checked against its schema, but sent as the caller wrote it: a schema may transform
    // a field (`checkpoint_ids`: "a,b" → [a, b]) that the server expects in its written form.
    checked(def.query, input.query ?? {}, "query");
    const query = (input.query ?? {}) as Record<string, unknown>;
    const hasBody = def.method !== "GET" && def.method !== "DELETE";
    const body = hasBody ? checked(def.body, input.body, "body") : undefined;

    const url = base + buildPath(def.path, params) + buildQuery(query);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload: string | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), waitMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);
    let response: Response;
    try {
      response = await doFetch(url, { method: def.method, headers, body: payload, signal: controller.signal, credentials: "omit", cache: "no-store" });
    } catch {
      // No answer: offline, unreachable, refused by CORS, timed out or aborted.
      const isOnline = online();
      throw new ApiFailure("INTERNAL", 0, { kind: "network", offline: !isOnline, detail: `${def.method} ${def.path}: no answer` });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
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
      const retry = Number(response.headers.get("Retry-After"));
      const retryAfterS = Number.isFinite(retry) && retry > 0 ? retry : null;
      const parsed = ApiError.safeParse(json);
      if (parsed.success) {
        const { code, message, issues, request_id } = parsed.data.error;
        throw new ApiFailure(code, response.status, { detail: message, issues, requestId: request_id, retryAfterS });
      }
      throw new ApiFailure(STATUS_CODE[response.status] ?? "INTERNAL", response.status, { retryAfterS, detail: `HTTP ${response.status}` });
    }

    const result = def.response.safeParse(json);
    if (!result.success) {
      // The server broke its contract: treat it as a server error, and say where.
      debug(`[api] ${def.method} ${def.path}: response does not match its contract`, result.error.issues);
      throw new ApiFailure("INTERNAL", response.status, { detail: "Response failed contract validation" });
    }
    return result.data as CallResult<K>;
  }

  /**
   * POST /auth/refresh with one retry of the SAME token when no answer came back (no answer, timeout,
   * 5xx): the server may have rotated it and lost the answer, and re-issues to the same client within
   * 10 seconds. A refusal (4xx) is never retried.
   */
  async function refreshWithRetry(token: string): Promise<TokenPair> {
    const exchange = () => send("refresh", { body: { refresh_token: token } }, null, undefined, REFRESH_TIMEOUT_MS) as Promise<TokenPair>;
    try {
      return await exchange();
    } catch (error) {
      if (!(error instanceof ApiFailure && (error.kind === "network" || error.status >= 500))) throw error;
      await new Promise((resolve) => setTimeout(resolve, REFRESH_RETRY_DELAY_MS));
      return exchange();
    }
  }

  /** Exchange the refresh token, once per browser at a time. Resolves with the stored session. */
  function refresh(stale: OperatorSession): Promise<OperatorSession> {
    refreshing ??= lock(LOCK_NAME, async () => {
      const current = session.read();
      if (!current) throw new ApiFailure("UNAUTHENTICATED", 401);
      // Another tab refreshed (or stepped up) while this one waited: use its pair.
      if (current.refresh_token !== stale.refresh_token && fresh(current)) return current;
      try {
        const pair = await refreshWithRetry(current.refresh_token);
        return session.save(pair, "refresh");
      } catch (error) {
        if (error instanceof ApiFailure && error.kind === "http" && (error.status === 401 || error.status === 400)) {
          // Refused: expired, revoked (sign-out elsewhere), or reused. The session is over.
          session.clear();
          signedOut();
        }
        throw error;
      }
    }).finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  /** A usable session: refreshed first when its access token is (nearly) expired. */
  async function usable(): Promise<OperatorSession> {
    const current = session.read();
    if (!current) throw new ApiFailure("UNAUTHENTICATED", 401);
    return fresh(current) ? current : refresh(current);
  }

  /** POST /auth/mfa/verify under the auth lock (it replaces the session family). */
  async function verifyCode(code: string): Promise<OperatorSession> {
    const current = await usable();
    return lock(LOCK_NAME, async () => {
      // Use whatever pair is current after waiting for the lock (another tab may have refreshed).
      const latest = session.read() ?? current;
      const pair = (await send("mfaVerify", { body: { code } }, latest.access_token)) as TokenPair;
      return session.save(pair, "step-up");
    });
  }

  /** Ask the UI for a code (sharing one prompt between concurrent calls) until one is accepted. */
  function promptStepUp(operation: EndpointName, original: ApiFailure): Promise<OperatorSession> {
    const handler = stepUpHandler;
    if (!handler) return Promise.reject(original);
    steppingUp ??= (async () => {
      let problem: ApiFailure | null = null;
      for (let attempt = 1; attempt <= STEP_UP_ATTEMPTS; attempt++) {
        const answer = await handler({ kind: "mfa_required", operation, attempt, problem });
        if ("cancel" in answer) throw original;
        try {
          return await verifyCode(answer.code.trim());
        } catch (error) {
          const retryable = error instanceof ApiFailure && (error.code === "INVALID_MFA_CODE" || (error.code === "VALIDATION_FAILED" && error.status === 0));
          if (!retryable) throw error;
          problem = error;
        }
      }
      throw problem ?? original;
    })()
      .then(
        (stepped) => {
          for (const listener of settledListeners) listener({ ok: true });
          return stepped;
        },
        (error: unknown) => {
          for (const listener of settledListeners) listener({ ok: false, error });
          throw error;
        },
      )
      .finally(() => {
        steppingUp = null;
      });
    return steppingUp;
  }

  async function call<K extends EndpointName>(name: K, input: CallInput<K> = {}, callOptions: CallOptions = {}): Promise<CallResult<K>> {
    if (callOptions.token) return send(name, input, callOptions.token, callOptions.signal);
    const def = endpoints[name] as EndpointDef;
    const isPublic = def.access.includes("public");
    if (callOptions.auth === "none") return send(name, input, null, callOptions.signal);

    let current: OperatorSession | null = session.read();
    if (!current && !isPublic) throw new ApiFailure("UNAUTHENTICATED", 401);
    if (current && !fresh(current)) current = await refresh(current);

    const attempt = (s: OperatorSession | null) => send(name, input, s?.access_token ?? null, callOptions.signal);
    try {
      return await attempt(current);
    } catch (error) {
      if (!(error instanceof ApiFailure) || !current) throw error;
      // The token was refused although it looked fresh (server clock, a restarted server's new
      // signing key, a step-up in another tab): refresh once and retry.
      if (error.status === 401 && (error.code === "TOKEN_EXPIRED" || error.code === "UNAUTHENTICATED") && name !== "refresh") {
        const renewed = await refresh(current);
        return attempt(renewed);
      }
      if (error.code === "MFA_REQUIRED" && !callOptions.noStepUp && name !== "mfaVerify") {
        const stepped = await promptStepUp(name, error);
        return attempt(stepped);
      }
      throw error;
    }
  }

  return {
    call,
    session,
    wsBase: origin.replace(/^http/, "ws"),
    async signIn(email, password) {
      const pair = (await send("login", { body: { email: email.trim(), password } }, null)) as TokenPair;
      return session.save(pair, "login");
    },
    async signOut() {
      // The device forgets at once; the family is ended on the server with the token captured here.
      const ending = session.read();
      session.clear();
      if (ending) await send("logout", {}, ending.access_token).catch(() => undefined);
    },
    stepUp: (code) => verifyCode(code.trim()),
    onStepUp(handler) {
      stepUpHandler = handler;
      return () => {
        if (stepUpHandler === handler) stepUpHandler = null;
      };
    },
    onStepUpSettled(listener) {
      settledListeners.add(listener);
      return () => settledListeners.delete(listener);
    },
    onSignedOut(listener) {
      signedOutListeners.add(listener);
      return () => signedOutListeners.delete(listener);
    },
    offsetMs: () => offset,
    async syncTime() {
      const sent = now();
      const time = await send("time", {}, null);
      const received = now();
      offset = time.epoch_ms - Math.round((sent + received) / 2);
      return offset;
    },
  };
}

/** Every item of a cursor-paginated list, up to `maxPages` pages (the server caps `limit` at 500). */
export async function allPages<T>(
  page: (cursor: string | undefined) => Promise<{ items: T[]; next_cursor: string | null }>,
  maxPages = 20,
): Promise<{ items: T[]; complete: boolean }> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const result = await page(cursor);
    items.push(...result.items);
    if (!result.next_cursor) return { items, complete: true };
    cursor = result.next_cursor;
  }
  return { items, complete: false };
}

export type { ErrorCode };
