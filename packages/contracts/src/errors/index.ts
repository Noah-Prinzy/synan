/**
 * Canonical error codes (Zod) and the API error body. The UI copy for errors and scan results
 * lives in the Zod-free `../copy` module and is re-exported here, so existing imports keep working;
 * client bundles that only need copy should import `@synan/contracts/copy` instead.
 */
import { z } from "zod";
import { ERROR_COPY } from "../copy/index.js";

export {
  BAND_ERROR_COPY,
  DENY_RESULTS,
  ERROR_COPY,
  FAILURE_COPY,
  GATE_TONE_VALUES,
  SCAN_RESULT_COPY,
  SCAN_RESULT_TONE,
  type ErrorCopy,
  type ScanResultCopy,
} from "../copy/index.js";

/* -------------------------------------------------------------- API errors */

export const ErrorCode = z.enum([
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "TOKEN_EXPIRED",
  "FORBIDDEN",
  "MFA_REQUIRED",
  "INVALID_CREDENTIALS",
  "INVALID_MFA_CODE",
  "MFA_NOT_ENROLLED",
  "RATE_LIMITED",
  "NOT_FOUND",
  "CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "LINK_INVALID",
  "LINK_EXPIRED",
  "EXPORT_EXPIRED",
  "TICKET_INVALID",
  "CHECKPOINT_NOT_ASSIGNED",
  "OUTSIDE_SHIFT",
  "EVENT_NOT_LIVE",
  "NO_CREDENTIAL",
  "NOT_IMPLEMENTED",
  "INTERNAL",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Every non-2xx REST response body. */
export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    /** Field-level validation issues, when `code` is VALIDATION_FAILED. */
    issues: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional(),
    request_id: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

/** Throwable carrying a canonical code — used by the API and the client SDK. */
export class ContractError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly issues?: { path: string; message: string }[];
  constructor(code: ErrorCode, message?: string, issues?: { path: string; message: string }[]) {
    super(message ?? ERROR_COPY[code].message);
    this.name = "ContractError";
    this.code = code;
    this.status = ERROR_COPY[code].status;
    if (issues) this.issues = issues;
  }
}
