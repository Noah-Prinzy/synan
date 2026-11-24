/** Words for a failure (see ./failure): the contracts' error copy, by code. */
import { ERROR_COPY, type ErrorCopy } from "@synan/contracts/copy";
import { ApiFailure, failureKind } from "./failure";

export function failureCopy(error: unknown): Pick<ErrorCopy, "title" | "message"> {
  // The portal's own offline wording (components/states.tsx).
  if (failureKind(error) === "offline") return { title: "You're offline.", message: "You're offline." };
  if (error instanceof ApiFailure && error.code !== "OFFLINE" && error.code !== "NETWORK") {
    const { title, message } = ERROR_COPY[error.code];
    return { title, message };
  }
  return { title: ERROR_COPY.INTERNAL.title, message: ERROR_COPY.INTERNAL.message };
}
