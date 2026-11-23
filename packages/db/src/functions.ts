/**
 * Typed wrappers for the SQL functions defined in migrations/0002_rules.sql.
 * They accept any Drizzle database or transaction over this schema (node-postgres or PGlite).
 */
import { sql } from "drizzle-orm";
import type { AnyDb, AnyTx } from "./client";

type Db = AnyDb | AnyTx;

async function rows<T = Record<string, unknown>>(db: Db, query: ReturnType<typeof sql>): Promise<T[]> {
  const res = (await db.execute(query)) as unknown as { rows: T[] };
  return res.rows;
}

const toDate = (v: unknown): Date | null => (v == null ? null : v instanceof Date ? v : new Date(String(v)));
const toNum = (v: unknown): number => (typeof v === "number" ? v : Number(v));

export interface RoomOccupancy {
  room_id: string;
  occupancy: number;
  capacity: number;
  warn_at_pct: number;
  block_at_pct: number;
  /** Percent of capacity, 1 decimal; null when capacity is 0. */
  pct: number | null;
  status: "ok" | "warn" | "block";
  /** True if the derived count was clamped at zero at least once (01 §7 reconciliation fault). */
  reconciliation_fault: boolean;
  last_change_at: Date | null;
}

/** Occupancy of every room of an event, derived from scans + occupancy_adjustments. */
export async function roomOccupancy(db: Db, eventId: string, asOf?: Date): Promise<RoomOccupancy[]> {
  const r = await rows(
    db,
    asOf
      ? sql`select * from public.room_occupancy(${eventId}::uuid, ${asOf.toISOString()}::timestamptz)`
      : sql`select * from public.room_occupancy(${eventId}::uuid)`,
  );
  return r.map((x) => ({
    room_id: String(x.room_id),
    occupancy: toNum(x.occupancy),
    capacity: toNum(x.capacity),
    warn_at_pct: toNum(x.warn_at_pct),
    block_at_pct: toNum(x.block_at_pct),
    pct: x.pct == null ? null : toNum(x.pct),
    status: x.status as RoomOccupancy["status"],
    reconciliation_fault: Boolean(x.reconciliation_fault),
    last_change_at: toDate(x.last_change_at),
  }));
}

export interface CountedRoom {
  room_id: string;
  /** Write the implied_exit scan against this checkpoint (the door they were counted in through). */
  checkpoint_id: string;
  entered_at: Date;
}

/**
 * The room a person is currently counted in, or null. Call before recording an admission to a
 * different room; if it returns a room, write an `implied_exit` scan for it (D-10).
 */
export async function lastCountedRoom(
  db: Db,
  eventId: string,
  ephemeralId: string,
  asOf?: Date,
): Promise<CountedRoom | null> {
  const r = await rows(
    db,
    asOf
      ? sql`select * from public.last_counted_room(${eventId}::uuid, ${ephemeralId}::uuid, ${asOf.toISOString()}::timestamptz)`
      : sql`select * from public.last_counted_room(${eventId}::uuid, ${ephemeralId}::uuid)`,
  );
  const x = r[0];
  return x ? { room_id: String(x.room_id), checkpoint_id: String(x.checkpoint_id), entered_at: toDate(x.entered_at)! } : null;
}

/**
 * Post-event purge for one event (03 §6). Throws unless the event is closed/archived and its grace
 * period has elapsed (`force` skips only the grace check). Idempotent.
 */
export async function purgeEventMovementData(
  db: Db,
  eventId: string,
  options: { force?: boolean; actorId?: string | null } = {},
): Promise<{ scans_dropped: number; ephemeral_ids_deleted: number }> {
  const r = await rows(
    db,
    sql`select * from public.purge_event_movement_data(${eventId}::uuid, ${options.force ?? false}, ${options.actorId ?? null}::uuid)`,
  );
  const x = r[0]!;
  return { scans_dropped: toNum(x.scans_dropped), ephemeral_ids_deleted: toNum(x.ephemeral_ids_deleted) };
}

/** Recomputes occupancy_rollups and gate_rate_rollups for one event from its scans. */
export async function rebuildEventRollups(
  db: Db,
  eventId: string,
): Promise<{ occupancy_rows: number; gate_rate_rows: number }> {
  const r = await rows(db, sql`select * from public.rebuild_event_rollups(${eventId}::uuid)`);
  const x = r[0]!;
  return { occupancy_rows: toNum(x.occupancy_rows), gate_rate_rows: toNum(x.gate_rate_rows) };
}

/** Writes and returns one attendance snapshot for an event. */
export async function takeAttendanceSnapshot(db: Db, eventId: string) {
  const r = await rows(db, sql`select * from public.take_attendance_snapshot(${eventId}::uuid)`);
  const x = r[0]!;
  return {
    event_id: String(x.event_id),
    taken_at: toDate(x.taken_at)!,
    registered: toNum(x.registered),
    checked_in: toNum(x.checked_in),
    on_site: toNum(x.on_site),
    by_tier_jsonb: x.by_tier_jsonb as Record<string, { registered: number; checked_in: number; on_site: number }>,
  };
}

/** Walks the audit hash chain. An empty array means the chain is intact. */
export async function auditVerify(db: Db): Promise<{ entry_id: number | null; problem: string }[]> {
  const r = await rows(db, sql`select * from public.audit_verify()`);
  return r.map((x) => ({ entry_id: x.entry_id == null ? null : toNum(x.entry_id), problem: String(x.problem) }));
}

/** Deletes audit entries older than 12 months (D-03) while keeping the chain verifiable. */
export async function auditPrune(db: Db): Promise<number> {
  const r = await rows(db, sql`select public.audit_prune() as n`);
  return toNum(r[0]!.n);
}

/**
 * Deletes breach alerts older than `olderThanMonths` (default and minimum 12: D-03, O-11), with
 * their finished webhook deliveries; an alert whose delivery is still pending waits for a later
 * run. Writes one audit entry when it deletes anything. Returns the number of alerts deleted
 * (migration 0022). Run it daily from a job worker (app_api).
 */
export async function alertsPrune(db: Db, opts: { olderThanMonths?: number; now?: Date } = {}): Promise<number> {
  const now = opts.now ? sql`${opts.now.toISOString()}::timestamptz` : sql`now()`;
  const r = await rows(db, sql`select public.alerts_prune(${opts.olderThanMonths ?? 12}::integer, ${now}) as n`);
  return toNum(r[0]!.n);
}

/** Erasure: scrubs an attendee's identifying columns, keeps the row, writes an audit entry. */
export async function eraseAttendee(db: Db, attendeeId: string, actorId?: string | null): Promise<boolean> {
  const r = await rows(db, sql`select pii_vault.erase_attendee(${attendeeId}::uuid, ${actorId ?? null}::uuid) as ok`);
  return Boolean(r[0]!.ok);
}

/** Name of an event's scan partition. */
export function scanPartitionName(eventId: string): string {
  return `scans_${eventId.replaceAll("-", "")}`;
}
