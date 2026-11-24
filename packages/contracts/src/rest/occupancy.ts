/**
 * Public room occupancy for event pages (addition; not in 02 §5). The anonymous `/stream/telemetry`
 * stays closed to the public (O-19); this is a small, cacheable REST read of the same public scope.
 */
import { z } from "zod";
import { Id, IsoDateTime } from "../common.js";
import { OccupancyTotals, RoomOccupancy, ZoneOccupancy } from "../ws/index.js";
import { endpoint, IdParam, PUBLIC } from "./endpoint.js";

/**
 * The public scope, k-anonymised (O-08): a count below the minimum crowd size is null, and a
 * suppressed room's `level` reads `ok`. Totals add up only the rooms and zones that are shown, so
 * no suppressed count can be recovered by subtraction. Counts are zero (so null) unless the event is
 * live. Cache for `max_age_s`.
 */
export const PublicOccupancy = z.object({
  event_id: Id,
  as_of: IsoDateTime,
  live: z.boolean(),
  rooms: z.array(RoomOccupancy),
  zones: z.array(ZoneOccupancy),
  totals: OccupancyTotals,
  max_age_s: z.number().int().min(0),
});
export type PublicOccupancy = z.infer<typeof PublicOccupancy>;

export const occupancyEndpoints = {
  /** Published or live events the caller may see (an unlisted event only for its registered attendees). Per-address limit. */
  publicOccupancy: endpoint({ method: "GET", path: "/events/:id/occupancy", access: PUBLIC, rateLimit: "public", params: IdParam, response: PublicOccupancy }),
} as const;
