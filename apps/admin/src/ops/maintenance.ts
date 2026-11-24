/**
 * `Mark for maintenance` (D12b). MOCK ONLY: kept in this page's memory, so it lasts until a
 * reload and nobody else sees it. The API has no maintenance flag on a checkpoint yet;
 * requested as `maintenance_since` on Checkpoint (or GateHealth).
 */
import { Slice } from "../live/slice";

export const maintenance = new Slice<ReadonlyMap<string, number>>(new Map());

export function setMaintenance(checkpointId: string, on: boolean, at: number): void {
  const next = new Map(maintenance.get());
  if (on) next.set(checkpointId, at);
  else next.delete(checkpointId);
  maintenance.set(next);
}
