/**
 * Turning a failed call into words. Every message comes from the contracts' error copy
 * (docs/02 §7: the single source); field messages come from the server's validation and
 * are already written for people.
 *
 * Works for the mock's MockApiError and the real API's ApiFailure alike: both carry `code`
 * and `fields` (field name → message). Read by shape, so neither class is imported here and
 * neither backend is pulled into the other's build.
 */
import { ERROR_COPY, FAILURE_COPY } from "@synan/contracts/copy";

export type ErrorCode = keyof typeof ERROR_COPY;

export interface ErrorInfo {
  code: ErrorCode;
  title: string;
  message: string;
  /** Per-field messages, keyed by the field's name in the request body. */
  fields: Record<string, string>;
}

function field(error: unknown, key: string): unknown {
  return error && typeof error === "object" && key in error ? (error as Record<string, unknown>)[key] : undefined;
}

export function errorCode(error: unknown): ErrorCode {
  const code = field(error, "code");
  const raw = typeof code === "string" ? code : error instanceof Error ? error.message : "";
  return raw in ERROR_COPY ? (raw as ErrorCode) : "INTERNAL";
}

/** Words for "nothing answered" (the real API only; the mock always answers), from the contracts. */
const NO_ANSWER_COPY = { offline: FAILURE_COPY.offline, unreachable: FAILURE_COPY.network } as const;

export function errorCopy(error: unknown): ErrorInfo {
  const code = errorCode(error);
  const silent = noAnswer(error);
  const copy = silent ? NO_ANSWER_COPY[silent] : ERROR_COPY[code];
  return {
    code,
    title: copy.title,
    message: copy.message,
    fields: fieldErrors(error),
  };
}

export function fieldErrors(error: unknown): Record<string, string> {
  const fields = field(error, "fields");
  return fields && typeof fields === "object" ? (fields as Record<string, string>) : {};
}

/**
 * The real API's extras, read by shape (undefined on the mock): the code the server actually sent
 * when an adapter re-coded the failure for a screen, and whether nothing answered at all.
 */
export function serverCode(error: unknown): ErrorCode | undefined {
  const code = field(error, "serverCode");
  return typeof code === "string" && code in ERROR_COPY ? (code as ErrorCode) : undefined;
}

/** Nothing answered (offline, unreachable, timed out): `offline` when the browser says it has no network. */
export function noAnswer(error: unknown): "offline" | "unreachable" | null {
  if (field(error, "kind") !== "network") return null;
  return field(error, "offline") ? "offline" : "unreachable";
}

/** Seconds the server asked to wait before trying again (429), when it said. */
export function retryAfter(error: unknown): number | null {
  const s = field(error, "retryAfterS");
  return typeof s === "number" && s > 0 ? s : null;
}
