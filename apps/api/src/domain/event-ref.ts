/** The short event reference carried on attendee self-service items (passes, registrations, agenda). */
import type { EventRef } from "@synan/contracts/rest";
import type { EventRow, Repos } from "../repo/types.js";

export async function eventRef(repos: Repos, e: EventRow): Promise<EventRef> {
  const venue = e.venue_id ? await repos.venues.venue(e.venue_id) : null;
  return {
    id: e.id, slug: e.slug, title: e.title,
    starts_at: e.starts_at?.toISOString() ?? null, ends_at: e.ends_at?.toISOString() ?? null,
    timezone: e.timezone, state: e.state, venue_name: venue?.name ?? null,
  };
}

/**
 * Of several events, the one an attendee means without saying: the live one (earliest start), else
 * the next to start, else the most recent. Null for none.
 */
export function currentOf<T>(items: { item: T; event: EventRow }[], now: number): T | null {
  const start = (e: EventRow) => e.starts_at?.getTime() ?? Number.POSITIVE_INFINITY;
  const live = items.filter((x) => x.event.state === "live").sort((a, b) => start(a.event) - start(b.event));
  if (live.length) return live[0]!.item;
  const next = items.filter((x) => start(x.event) > now && x.event.state !== "archived").sort((a, b) => start(a.event) - start(b.event));
  if (next.length) return next[0]!.item;
  const recent = [...items].sort((a, b) => (b.event.ends_at?.getTime() ?? start(b.event)) - (a.event.ends_at?.getTime() ?? start(a.event)));
  return recent[0]?.item ?? null;
}
