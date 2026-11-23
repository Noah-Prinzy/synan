/**
 * Turning a failed call into words. Every message comes from the contracts' error copy
 * (docs/02 §7: the single source); field messages come from the server's validation and
 * are already written for people.
 */
import { ERROR_COPY } from "@synan/contracts/copy";
import { MockApiError } from "@synan/mock/command";

export type ErrorCode = keyof typeof ERROR_COPY;

export interface ErrorInfo {
  code: ErrorCode;
  title: string;
  message: string;
  /** Per-field messages, keyed by the field's name in the request body. */
  fields: Record<string, string>;
}

export function errorCode(error: unknown): ErrorCode {
  const raw = error instanceof MockApiError ? error.code : error instanceof Error ? error.message : "";
  return raw in ERROR_COPY ? (raw as ErrorCode) : "INTERNAL";
}

export function errorCopy(error: unknown): ErrorInfo {
  const code = errorCode(error);
  const copy = ERROR_COPY[code];
  return {
    code,
    title: copy.title,
    message: copy.message,
    fields: error instanceof MockApiError ? error.fields : {},
  };
}

export function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof MockApiError ? error.fields : {};
}
