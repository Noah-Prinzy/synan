/**
 * The one place a failed call is classified. Every API failure is an `ApiFailure` carrying a
 * canonical code from @synan/contracts (or OFFLINE / NETWORK when no answer arrived); screens ask
 * here which designed state to show (offline or error), and ./failure-copy for the words, which
 * come from `@synan/contracts/copy` and are never retyped. Split in two so the copy table is not
 * loaded with every screen.
 */
import type { ErrorCode } from "@synan/contracts/errors";

export type FailureCode = ErrorCode | "OFFLINE" | "NETWORK";

export class ApiFailure extends Error {
  readonly code: FailureCode;
  readonly status: number;
  readonly issues?: { path: string; message: string }[];
  constructor(code: FailureCode, status: number, message?: string, issues?: { path: string; message: string }[]) {
    super(message ?? code);
    this.name = "ApiFailure";
    this.code = code;
    this.status = status;
    if (issues) this.issues = issues;
  }
}

export function isFailure(error: unknown, ...codes: FailureCode[]): error is ApiFailure {
  return error instanceof ApiFailure && (codes.length === 0 || codes.includes(error.code));
}

/** Which designed state a failed load shows: offline when no answer could arrive, else error. */
export function failureKind(error: unknown): "offline" | "error" {
  if (typeof navigator !== "undefined" && !navigator.onLine) return "offline";
  return isFailure(error, "OFFLINE") ? "offline" : "error";
}
