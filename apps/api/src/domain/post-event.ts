/**
 * The post-event summary (D-21) in the contract's shape, from @synan/db's postEventSummary (and its
 * in-memory mirror): computed from rollups, frozen by the purge, so it reads the same afterwards.
 */
import { SEVERITY_VALUES, type AttendeeTier } from "@synan/contracts/enums";
import type { PostEventSummary } from "@synan/contracts/rest";
import { ContractError } from "@synan/contracts/errors";
import type { AppContext } from "../app.js";
import type { DbPostEventSummary } from "../repo/types.js";

export function toSummaryDto(s: DbPostEventSummary): Omit<PostEventSummary, "downloads"> {
  const h = s.headline;
  return {
    event_id: s.event.id,
    state: s.event.state as PostEventSummary["state"],
    provisional: s.provisional,
    as_of: s.computed_at.toISOString(),
    frozen: s.frozen,
    frozen_at: s.frozen_at?.toISOString() ?? null,
    rollups_rebuilt_at: s.rollups_rebuilt_at?.toISOString() ?? null,
    headline: {
      registered: h.registered, checked_in: h.checked_in, no_shows: h.no_shows, peak_on_site: h.peak_on_site,
      peak_on_site_at: h.peak_on_site_at?.toISOString() ?? null, rooms_at_capacity: h.rooms_at_capacity, alerts_raised: h.alerts_total,
    },
    attendance_by_tier: s.attendance_by_tier.map((t) => ({ ...t, tier: t.tier as AttendeeTier })),
    occupancy_curve: s.onsite_curve.points.map((p) => ({ at: p.t.toISOString(), on_site: p.on_site })),
    busiest_rooms: s.busiest_rooms.map((r) => ({ room_id: r.room_id, name: r.name, capacity: r.capacity, peak: r.peak, peak_at: r.peak_at?.toISOString() ?? null })),
    busiest_gates: s.busiest_gates,
    alerts: {
      by_severity: Object.fromEntries(SEVERITY_VALUES.map((v) => [v, h.alerts_by_severity[v] ?? 0])) as PostEventSummary["alerts"]["by_severity"],
      ack_p50_s: h.ack_median_s,
      resolve_p50_s: h.resolve_median_s,
    },
    purge: { purged_at: s.purge.purged_at?.toISOString() ?? null, due_at: s.purge.due_at?.toISOString() ?? null, scans_available: s.purge.scans_available },
  };
}

export async function loadSummary(app: AppContext, eventId: string): Promise<DbPostEventSummary> {
  const s = await app.repos.reports.postEventSummary(eventId, new Date(app.clock.now()));
  if (!s) throw new ContractError("NOT_FOUND");
  return s;
}
