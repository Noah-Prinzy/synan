/**
 * `Mark for maintenance` (D12b). The API has no maintenance flag on a checkpoint, so a mark could
 * only live in this page's memory: lost on reload and unseen by anyone else. Until the server
 * stores it (requested as `maintenance_since` on Checkpoint or GateHealth, with an endpoint to set
 * and clear it, audited), the control is not offered: `MAINTENANCE_STORED` is false and the gate
 * page leaves the button out. To restore it, back `setMaintenance` with that endpoint, fill the
 * slice from the server, and set the flag to true; the gate list and the gate page already show a
 * mark when the slice has one.
 */
import { Slice } from "../live/slice";

/** Whether a maintenance mark is kept anywhere but this page. False until the API stores it. */
export const MAINTENANCE_STORED = false;

export const maintenance = new Slice<ReadonlyMap<string, number>>(new Map());

export function setMaintenance(checkpointId: string, on: boolean, at: number): void {
  const next = new Map(maintenance.get());
  if (on) next.set(checkpointId, at);
  else next.delete(checkpointId);
  maintenance.set(next);
}
