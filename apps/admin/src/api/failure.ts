/**
 * Every failed call to the real API is one `ApiFailure`, and this file is the one place it becomes
 * words (02 §7: the copy comes from the contracts, never retyped).
 *
 * Compatibility with today's screens: `kit/errors.ts` reads `MockApiError#code`, and otherwise
 * `error.message`. An ApiFailure's `message` is its code, so `errorCode()` already works with it;
 * `fields` has the same shape as `MockApiError#fields` (field name → message), but kit/errors reads
 * fields only from a MockApiError, so that file needs a one-line change at switch-over (see index.ts).
 *
 * Zod-free on purpose: the copy module is plain data.
 */
import { ERROR_COPY, FAILURE_COPY } from "@synan/contracts/copy";
import type { ErrorCode } from "@synan/contracts/errors";

/** One field-level problem as the API reports it (`path` like `body.rooms.3.zone_id`, or `zone:<id>`). */
export interface Issue {
  path: string;
  message: string;
}

/** `http`: the server answered. `network`: no answer (offline, unreachable, timed out, CORS). */
export type FailureKind = "http" | "network";

export class ApiFailure extends Error {
  /**
   * Per-field messages keyed like the mock's (`title`, `slug`, `room:<id>`, `rules`): the request
   * prefix (`body.`, `query.`, `params.`) is dropped, and the first path segment is also set, so a
   * screen that looks for `rules` finds `rules.3.room_id`'s message.
   */
  readonly fields: Record<string, string>;

  constructor(
    /** What screens branch on. For a network failure: INTERNAL (contracts has no code for it), with `kind: "network"`. */
    readonly code: ErrorCode,
    /** HTTP status; 0 when there was no answer. */
    readonly status: number,
    options: {
      kind?: FailureKind;
      /** The server's own message (developer-facing English; never shown as UI copy). */
      detail?: string;
      issues?: Issue[];
      /** The code the server sent, when an adapter re-coded the failure for a screen (e.g. CONFLICT → VALIDATION_FAILED). */
      serverCode?: ErrorCode;
      requestId?: string;
      /** Seconds the server asked us to wait (429). */
      retryAfterS?: number | null;
      offline?: boolean;
    } = {},
  ) {
    // The code as the message: kit/errors.ts's errorCode() falls back to `error.message`.
    super(code);
    this.name = "ApiFailure";
    this.kind = options.kind ?? "http";
    this.detail = options.detail ?? null;
    this.issues = options.issues ?? [];
    this.serverCode = options.serverCode ?? code;
    this.requestId = options.requestId ?? null;
    this.retryAfterS = options.retryAfterS ?? null;
    this.offline = options.offline ?? false;
    this.fields = fieldsOf(this.issues);
  }

  readonly kind: FailureKind;
  readonly detail: string | null;
  readonly issues: Issue[];
  readonly serverCode: ErrorCode;
  readonly requestId: string | null;
  readonly retryAfterS: number | null;
  /** Network failure while the browser reports itself offline. */
  readonly offline: boolean;

  /** A copy with another code (and optionally other issues): an adapter's re-coding for a screen. */
  recode(code: ErrorCode, issues: Issue[] = this.issues): ApiFailure {
    return new ApiFailure(code, this.status, {
      kind: this.kind,
      detail: this.detail ?? undefined,
      issues,
      serverCode: this.serverCode,
      requestId: this.requestId ?? undefined,
      retryAfterS: this.retryAfterS,
      offline: this.offline,
    });
  }
}

export function isApiFailure(error: unknown): error is ApiFailure {
  return error instanceof ApiFailure;
}

/** `body.rooms.3.zone_id` → `rooms.3.zone_id`; `zone:<id>` stays as it is. */
export function fieldKey(path: string): string {
  return path.replace(/^(body|query|params)\.?/, "") || "form";
}

/** Field name → first message, with the first path segment set too (`rules.3.room_id` also fills `rules`). */
export function fieldsOf(issues: readonly Issue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = fieldKey(issue.path);
    out[key] ??= issue.message;
    const head = key.split(".")[0];
    if (head && head !== key) out[head] ??= issue.message;
  }
  return out;
}

/** What a screen shows for a failure: the contracts' copy, plus the server's field messages. */
export interface FailureCopy {
  code: ErrorCode;
  title: string;
  message: string;
  fields: Record<string, string>;
  issues: Issue[];
  /** True when nothing answered: retrying later may work. */
  network: boolean;
}


/** The single error mapper: any thrown value → the copy to show. */
export function failureCopy(error: unknown): FailureCopy {
  if (error instanceof ApiFailure) {
    if (error.kind === "network") {
      // Words for "no answer" come from the contracts (FAILURE_COPY), like every other failure's.
      const { title, message } = error.offline ? FAILURE_COPY.offline : FAILURE_COPY.network;
      return { code: error.code, title, message, fields: {}, issues: [], network: true };
    }
    const copy = ERROR_COPY[error.code];
    return { code: error.code, title: copy.title, message: copy.message, fields: error.fields, issues: error.issues, network: false };
  }
  const copy = ERROR_COPY.INTERNAL;
  return { code: "INTERNAL", title: copy.title, message: copy.message, fields: {}, issues: [], network: false };
}

/** HTTP status → code, for an error body that is missing or not the contract's. */
export const STATUS_CODE: Readonly<Record<number, ErrorCode>> = {
  400: "VALIDATION_FAILED",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  429: "RATE_LIMITED",
  501: "NOT_IMPLEMENTED",
};
