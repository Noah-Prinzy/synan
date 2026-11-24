/**
 * The attendee's session (A9). Email link only (03 §3). The source decides where the session
 * lives: the mock keeps `{ email, name }` in localStorage; the real API keeps its token pair
 * (data/api/session.ts). Either way a change fires SESSION_EVENT, and useSession re-renders.
 */
import { useSyncExternalStore } from "react";
import { backend, type Session, type VerifyOutcome } from "./backend";
import { clearResources } from "./resource";
import { SESSION_EVENT } from "./shared";

export type { Session };

export function getSession(): Session | null {
  return backend.readSession();
}

/** POST /auth/email-link. Always answers the same, whether or not the address is known. */
export function requestSignInLink(email: string, next: string): Promise<void> {
  return backend.requestSignInLink(email.trim(), next);
}

/** POST /auth/verify: redeem the emailed link's token. Starts the session. */
export async function verifyToken(token: string, next: string): Promise<VerifyOutcome> {
  const outcome = await backend.verifyLink(token, next);
  // What the server answers depends on who is signed in (the mock's answers do not).
  if (outcome.ok && backend.mode === "api") clearResources();
  return outcome;
}

/** PATCH /users/:id/profile (full_name). The session keeps the new name. */
export function updateName(name: string): Promise<void> {
  return backend.updateName(name);
}

export function signOut(): void {
  backend.signOut();
  if (backend.mode === "api") clearResources();
}

/** Mock build only: the path standing in for the emailed link. */
export function emailedLinkFor(email: string, next: string): string | null {
  return backend.emailedLinkFor(email, next);
}

function subscribe(listener: () => void): () => void {
  const onChange = () => {
    refreshSnapshot();
    listener();
  };
  window.addEventListener("storage", onChange);
  window.addEventListener(SESSION_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SESSION_EVENT, onChange);
  };
}

let cached: Session | null = null;
let loaded = false;

/** Keeps the same object while the email and name are unchanged, so a token refresh re-renders nothing. */
function refreshSnapshot(): Session | null {
  const next = backend.readSession();
  if (!loaded || next?.email !== cached?.email || next?.name !== cached?.name) cached = next;
  loaded = true;
  return cached;
}

function getSnapshot(): Session | null {
  return loaded ? cached : refreshSnapshot();
}

export function useSession(): Session | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}
