/**
 * Scoping of non-operators to their current assignments (03 §4). Server time is the authority: a
 * shift is current when shift_start ≤ now < shift_end on the server's clock.
 */
import type { AppContext } from "../app.js";
import { sha256b64url } from "../lib/crypto.js";
import type { CheckpointRow, Repos, StaffAssignmentRow } from "../repo/types.js";
import type { AuthContext } from "./principal.js";

/** How a scanner install is recorded against an assignment: base64url SHA-256 of its client device id (never the id itself). */
export const scannerHash = (clientDeviceId: string) => sha256b64url(`scanner:${clientDeviceId}`);

const noted = new Set<string>();
/**
 * Record that the assignee used this scanner install during the shift (POST /scans, REST and stream
 * heartbeats). A scan queued under the shift may later be synced from it by whoever staffs the gate
 * next (01 §8). Written once per process and install; the store ignores repeats and keeps at most 8.
 */
export async function noteScanner(repos: Repos, a: StaffAssignmentRow, clientDeviceId: string | undefined | null) {
  if (!clientDeviceId) return;
  const h = scannerHash(clientDeviceId);
  const key = `${a.id}|${h}`;
  if (noted.has(key) || (a.scanner_device_hashes ?? []).includes(h)) return;
  await repos.staff.noteDevice(a.id, h);
  noted.add(key);
}

export async function currentAssignments(app: AppContext, userId: string): Promise<StaffAssignmentRow[]> {
  const t = app.clock.now();
  return (await app.repos.staff.assignmentsFor(userId)).filter((a) => a.shift_start.getTime() <= t && t < a.shift_end.getTime());
}

/** Checkpoints the caller is staffing now, optionally only in one venue. */
export async function currentCheckpoints(app: AppContext, userId: string, venueId?: string): Promise<CheckpointRow[]> {
  const out: CheckpointRow[] = [];
  for (const a of await currentAssignments(app, userId)) {
    const cp = await app.repos.venues.checkpoint(a.checkpoint_id);
    if (cp && (!venueId || cp.venue_id === venueId)) out.push(cp);
  }
  return out;
}

/** Operators always; staff only while staffing a perimeter gate or desk of this venue. */
export async function mayRunDesk(app: AppContext, ctx: AuthContext, venueId: string): Promise<boolean> {
  if (ctx.kind === "operator") return true;
  return (await currentCheckpoints(app, ctx.sub, venueId)).some((c) => c.perimeter_bool);
}

/**
 * The events a desk clerk may work now (D-23): those of their current, not handed-over assignments
 * at a perimeter desk — the assignment's event, or (an assignment without one) every published or
 * live event at that desk's venue.
 */
export async function deskEventIds(app: AppContext, userId: string): Promise<string[]> {
  const out = new Set<string>();
  for (const a of await currentAssignments(app, userId)) {
    if (a.handed_over_at) continue;
    const cp = await app.repos.venues.checkpoint(a.checkpoint_id);
    if (!cp?.perimeter_bool) continue;
    if (a.event_id) out.add(a.event_id);
    else for (const e of await app.repos.events.listAll({ limit: 1000 })) if (e.venue_id === cp.venue_id && (e.state === "published" || e.state === "live")) out.add(e.id);
  }
  return [...out];
}

/**
 * Desk work on one event: operators always; a desk clerk only for an event of their current desk
 * assignment; anyone else as `mayRunDesk` (security staff at a perimeter desk of the venue).
 * Refusals answer like a missing record (no hint that it exists).
 */
export async function mayWorkDeskFor(app: AppContext, ctx: AuthContext, event: { id: string; venue_id: string | null }): Promise<boolean> {
  if (ctx.kind === "operator") return true;
  if (ctx.role === "desk_clerk") return (await deskEventIds(app, ctx.sub)).includes(event.id);
  return event.venue_id !== null && mayRunDesk(app, ctx, event.venue_id);
}
