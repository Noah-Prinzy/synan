/**
 * Scoping of non-operators to their current assignments (03 §4). Server time is the authority: a
 * shift is current when shift_start ≤ now < shift_end on the server's clock.
 */
import type { AppContext } from "../app.js";
import type { CheckpointRow, StaffAssignmentRow } from "../repo/types.js";
import type { AuthContext } from "./principal.js";

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
