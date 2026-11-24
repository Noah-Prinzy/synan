/**
 * Venue layouts and event drafts (migration 0025): the whole-layout publish with its optimistic
 * version, and deleting a draft event. Duplication is `duplicateEvent` in ./operations.
 */
import { sql } from "drizzle-orm";
import type { GridShape } from "./schema/venue";
import { json, num, rows, tsOrNow, type DbOrTx } from "./sqlrows";

export interface LayoutZoneInput {
  id: string;
  name: string;
  /** One of the layout's floors, or null. */
  floor: string | null;
  geometry: GridShape | null;
}
export interface LayoutRoomInput {
  id: string;
  zone_id: string;
  name: string;
  capacity: number;
  warn_at_pct: number;
  block_at_pct: number;
  capacity_policy: "block" | "admit_with_alert";
  continuous: boolean;
  geometry: GridShape | null;
}
export interface LayoutBlocker {
  kind: "zone" | "room";
  id: string;
  /** in_use: an event past draft (or recorded history) uses it; has_checkpoints: gates or doors are on it; doors_in_other_zone: a room whose doors are in its old zone moved zone. */
  reason: "in_use" | "has_checkpoints" | "doors_in_other_zone";
}
export interface PublishLayoutResult {
  status: "ok" | "version_conflict" | "foreign_id" | "blocked";
  /** The new version when ok; otherwise the stored one. */
  layout_version: number;
  zones_added: number;
  zones_removed: number;
  rooms_added: number;
  rooms_removed: number;
  blocking: LayoutBlocker[];
}

/**
 * Replaces a venue's floors, zones (in list order) and rooms in one step, if the stored layout version
 * is still `expectedVersion`. Zones and rooms not in the lists are removed (a draft event lets go of a
 * removed room); new ids are created. Throws when the venue does not exist.
 */
export async function publishVenueLayout(
  db: DbOrTx,
  i: { venueId: string; expectedVersion: number; floors: string[]; zones: LayoutZoneInput[]; rooms: LayoutRoomInput[]; now?: Date },
): Promise<PublishLayoutResult> {
  const r = await rows(
    db,
    sql`select * from public.venue_layout_publish(${i.venueId}::uuid, ${i.expectedVersion}::integer,
          ${sql`ARRAY[${sql.join(i.floors.map((f) => sql`${f}`), sql`, `)}]::text[]`},
          ${JSON.stringify(i.zones)}::jsonb, ${JSON.stringify(i.rooms)}::jsonb, ${tsOrNow(i.now)})`,
  );
  const x = r[0]!;
  return {
    status: String(x.status) as PublishLayoutResult["status"],
    layout_version: num(x.layout_version),
    zones_added: num(x.zones_added),
    zones_removed: num(x.zones_removed),
    rooms_added: num(x.rooms_added),
    rooms_removed: num(x.rooms_removed),
    blocking: json<LayoutBlocker[]>(x.blocking ?? "[]"),
  };
}

export type DeleteDraftStatus = "deleted" | "not_found" | "not_draft" | "has_registrations" | "has_history";

/**
 * Deletes a draft event and what hangs off it (rooms, sessions, rules, invitations, shifts tied to it,
 * schedules). Refused for an event past draft, or one with registrations or recorded history. The
 * caller audits.
 */
export async function deleteDraftEvent(db: DbOrTx, eventId: string): Promise<DeleteDraftStatus> {
  const r = await rows<{ s: string }>(db, sql`select public.event_delete_draft(${eventId}::uuid) as s`);
  return r[0]!.s as DeleteDraftStatus;
}
