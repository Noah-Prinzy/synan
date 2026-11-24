/** A8: the attendee's data-subject requests (03 §5). */
import { backend } from "./backend";

/** POST /me/data-export: queued; the attendee is emailed when it is ready. */
export function requestDataExport(): Promise<void> {
  return backend.requestDataExport();
}

/** POST /me/data-erasure: queued for an administrator. */
export function requestErasure(): Promise<void> {
  return backend.requestErasure();
}
