/**
 * The desk's one client and how its failures read. `createDeskMock` puts the desk's contract-
 * shaped calls (packages/mock/src/command/desk.ts names the endpoint of each) on top of the
 * admin's `configure`, so a band bound here shows in the event workspace at once.
 *
 *   mock (VITE_API_URL unset)  the demo rules are on: named demo bands, the mock second factor,
 *                              mock desk codes, the offline switch.
 *   real API                   calls pass straight through to the API client, which asks for
 *                              the second factor itself. Desk codes are not wired yet there.
 *
 * Replacing this with a direct fetch client means re-implementing `DeskApi`; nothing else in
 * this folder changes.
 */
import { ERROR_COPY } from "@synan/contracts/copy";
import { createDeskMock } from "@synan/mock/command";
import { errorCode, fieldErrors, noAnswer, type ErrorCode } from "../kit/errors";
import { clock, configure, devParams, mode } from "../live/backend";

export const desk = createDeskMock({ configure, clock, latencyMs: devParams.slow ? 2500 : 300, demo: mode === "mock" });

/** True while the desk runs on the mock: its development panel and second-factor mock show. */
export const deskIsMock = mode === "mock";

/** Server time as the desk counts it (a code's expiry). */
export const deskNow = (): number => clock.now();

/** A request that never reached the server: the mock throws a TypeError as `fetch` does; the API client says `network`. */
export function isOffline(error: unknown): boolean {
  return error instanceof TypeError || noAnswer(error) !== null || (typeof navigator !== "undefined" && navigator.onLine === false);
}

export function deskErrorCode(error: unknown): ErrorCode {
  return errorCode(error);
}

/**
 * The message for one field of a request (`identifier`, `reason`, `code`), whether the server
 * named it plainly or by its path in the body (`body.identifier`).
 */
export function fieldMessage(error: unknown, field: string): string | null {
  const fields = fieldErrors(error);
  return fields[field] ?? fields[`body.${field}`] ?? null;
}

/**
 * A failed desk call in one plain sentence. `subject` says what did not happen ("The band was
 * not bound"), so an offline or unexpected failure still tells the clerk where they stand.
 */
export function deskFailure(error: unknown, subject: string): string {
  if (isOffline(error)) return `${subject}: you are offline. Nothing changed. Try again when the connection is back.`;
  const code = errorCode(error);
  switch (code) {
    case "CONFLICT":
      return `${subject}: it was changed a moment ago, or the band is already in use. Look again, then try once more.`;
    case "NOT_FOUND":
      return `${subject}: this registration is not at your desk any more. Search for them again.`;
    case "NO_CREDENTIAL":
      return `${subject}: no pass has been issued for this registration yet. Ask a supervisor.`;
    case "FORBIDDEN":
      return `${subject}: your role does not allow it. Ask a supervisor.`;
    case "RATE_LIMITED":
      return `${subject}: that was tried a moment ago. Wait a minute, then try again.`;
    case "UNAUTHENTICATED":
    case "TOKEN_EXPIRED":
      return `${subject}: your session has ended. Sign in again; your search will still be here.`;
    case "NOT_IMPLEMENTED":
      return `${subject}: this server does not offer it yet. Scan the band at the desk instead.`;
    default:
      return `${subject}. ${ERROR_COPY[code].message}`;
  }
}
