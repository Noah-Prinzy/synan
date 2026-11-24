/** A8: the attendee's own details (GET /me, PATCH /me/profile) and data-subject requests (03 §5). */
import { backend, type Profile } from "./backend";

export type { Profile };

/** GET /me: the name on the pass, and the phone on file, masked. */
export function loadProfile(): Profile | Promise<Profile> {
  return backend.loadProfile();
}

/** PATCH /me/profile. The pass and the session take the new name. A blank phone keeps the one on file. */
export function updateProfile(change: { name?: string; phone?: string }): Promise<Profile> {
  return backend.updateProfile(change);
}

/** POST /me/data-export: queued; the attendee is emailed when it is ready. */
export function requestDataExport(): Promise<void> {
  return backend.requestDataExport();
}

/** POST /me/data-erasure: queued for an administrator. */
export function requestErasure(): Promise<void> {
  return backend.requestErasure();
}
