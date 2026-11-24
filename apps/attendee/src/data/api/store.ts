/** What the API source keeps on the device, and the state its two halves share. Zod-free. */
import type { Notification, PortalCodeBatch } from "@synan/contracts/rest";
import type { Pass } from "../pass";
import type { SessionStore } from "./session";

export const PASS_KEY = "synan.api.pass";
export const CODES_KEY = "synan.api.codes";
export const PENDING_KEY = "synan.api.pending-registration";

/** A registration sent with POST /users/register, finished (POST /registrations) once the emailed link is opened. */
export type Pending = {
  slug: string;
  email: string;
  name: string;
  profile: Record<string, string | string[]>;
  zoneConsent: boolean;
  at: number;
};

/** Kept per person: a pass or codes are only ever shown to the account they were fetched for. */
export type Kept<T> = { sub: string; value: T; offset?: number; eventId?: string };

export function readJson<T>(key: string): T | null {
  try {
    const text = localStorage.getItem(key);
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: kept for this page only.
  }
}

/** The state the always-loaded half (./backend) shares with the network half (./remote). */
export interface CoreState {
  /** API origin, e.g. http://127.0.0.1:5180 */
  readonly origin: string;
  readonly session: SessionStore;
  pass(): Pass | null;
  setPass(pass: Pass | null): void;
  notifications(): Notification[] | null;
  setNotifications(items: Notification[] | null): void;
  keepCodes(batch: PortalCodeBatch, offsetMs: number, eventId: string): void;
  /** The codes kept for the pass shown now (another event's codes never are). */
  keptCodes(): PortalCodeBatch | null;
  /** Sign-out, or the server ended the session: nothing of this person stays on the device. */
  forgetPerson(): void;
  bump(): void;
}
