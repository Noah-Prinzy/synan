/**
 * Staff on gates, shift handover, gate devices and health, event administration (duplicate,
 * readiness), session-end resets and purge scheduling.
 */
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { hashToken } from "./auth";
import { devices } from "./schema/operations2";
import type { CheckpointPosition } from "./schema/venue";
import { date, json, num, numOrNull, rows, tsOrNow, type DbOrTx } from "./sqlrows";

/* ---------------------------------------------------------------------- staff */

export interface OnDutyRow {
  assignment_id: string;
  user_id: string;
  display_name: string;
  role: string;
  event_id: string | null;
  shift_start: Date;
  shift_end: Date;
}
/** Who is on a gate now (or at `at`). */
export async function staffOnDuty(db: DbOrTx, checkpointId: string, at?: Date): Promise<OnDutyRow[]> {
  return (await rows(db, sql`select * from public.staff_on_duty(${checkpointId}::uuid, ${tsOrNow(at)})`)).map((x) => ({
    assignment_id: String(x.assignment_id), user_id: String(x.user_id), display_name: String(x.display_name), role: String(x.role),
    event_id: (x.event_id as string | null) ?? null, shift_start: date(x.shift_start)!, shift_end: date(x.shift_end)!,
  }));
}

export interface CurrentAssignmentRow {
  assignment_id: string;
  checkpoint_id: string;
  checkpoint_label: string;
  event_id: string | null;
  shift_start: Date;
  shift_end: Date;
  /** True for the shift in progress; false for one starting within the horizon. */
  current: boolean;
}
/** A user's shift in progress and those starting within `horizon` (Postgres interval, default 12 hours). */
export async function currentAssignments(db: DbOrTx, userId: string, opts: { at?: Date; horizon?: string } = {}): Promise<CurrentAssignmentRow[]> {
  return (
    await rows(db, sql`select * from public.current_assignments(${userId}::uuid, ${tsOrNow(opts.at)}, ${opts.horizon ?? "12 hours"}::interval)`)
  ).map((x) => ({
    assignment_id: String(x.assignment_id), checkpoint_id: String(x.checkpoint_id), checkpoint_label: String(x.checkpoint_label),
    event_id: (x.event_id as string | null) ?? null, shift_start: date(x.shift_start)!, shift_end: date(x.shift_end)!, current: Boolean(x.current),
  }));
}

export interface HandoverSummary {
  assignment_id: string;
  checkpoint_id: string;
  user_id: string;
  period_start: Date;
  period_end: Date;
  scans: number;
  /** admitted + already_inside */
  let_through: number;
  refused: number;
  duplicates: number;
  /** Decided on the device while offline. */
  offline: number;
  /** Received after the shift ended: they were still queued on the device at handover. */
  late_synced: number;
  by_result: Record<string, number>;
  first_scan_at: Date | null;
  last_scan_at: Date | null;
}
const toSummary = (x: Record<string, unknown>): HandoverSummary => ({
  assignment_id: String(x.assignment_id), checkpoint_id: String(x.checkpoint_id), user_id: String(x.user_id),
  period_start: date(x.period_start)!, period_end: date(x.period_end)!, scans: num(x.scans), let_through: num(x.let_through),
  refused: num(x.refused), duplicates: num(x.duplicates), offline: num(x.offline), late_synced: num(x.late_synced),
  by_result: json(x.by_result), first_scan_at: date(x.first_scan_at), last_scan_at: date(x.last_scan_at),
});

/** What happened at the gate during a shift. */
export async function shiftHandoverSummary(db: DbOrTx, assignmentId: string): Promise<HandoverSummary | null> {
  const r = await rows(db, sql`select * from public.shift_handover_summary(${assignmentId}::uuid)`);
  return r[0] ? toSummary(r[0]) : null;
}

/** Ends a shift (explicit handover): stamps it, writes the audit entry, returns the summary. */
export async function handOverShift(db: DbOrTx, assignmentId: string, opts: { actorId?: string | null; now?: Date } = {}): Promise<HandoverSummary> {
  const r = await rows<{ s: unknown }>(db, sql`select s from public.shift_handover(${assignmentId}::uuid, ${opts.actorId ?? null}::uuid, ${tsOrNow(opts.now)}) s`);
  return toSummary(json<Record<string, unknown>>(r[0]!.s));
}

/* -------------------------------------------------------------------- devices */

export type Device = typeof devices.$inferSelect;

/**
 * Registers a gate device. Fixed readers and kiosks get a device token (returned once; only its
 * hash is stored) to authenticate without a signed-in user (O-17).
 */
export async function registerDevice(
  db: DbOrTx,
  i: { venueId: string; kind: Device["kind"]; label: string; hardwareId: string; checkpointId?: string | null; issueToken?: boolean; now?: Date },
): Promise<{ id: string; token: string | null; token_version: number }> {
  const now = i.now ?? new Date();
  const token = (i.issueToken ?? i.kind !== "scanner") ? randomBytes(32).toString("base64url") : null;
  const [d] = await db
    .insert(devices)
    .values({
      venue_id: i.venueId, kind: i.kind, label: i.label, hardware_id: i.hardwareId, checkpoint_id: i.checkpointId ?? null,
      token_hash: token ? hashToken(token) : null, token_rotated_at: token ? now : null, created_at: now,
    })
    .returning({ id: devices.id, token_version: devices.token_version });
  return { id: d!.id, token, token_version: d!.token_version };
}

/**
 * Replaces a device's token; the old one stops working immediately, and token_version goes up so
 * access tokens minted from the old one fail their next check (deviceTokenVersion). Returns the
 * new token (the return type is unchanged; read the new version with deviceTokenVersion or
 * rotateDeviceTokenVersioned).
 */
export async function rotateDeviceToken(db: DbOrTx, deviceId: string, opts: { now?: Date } = {}): Promise<string> {
  const r = await rotateDeviceTokenVersioned(db, deviceId, opts);
  if (!r) throw new Error(`device ${deviceId} does not exist`);
  return r.token;
}

/** As rotateDeviceToken, also returning the new token_version; null when the device does not exist. */
export async function rotateDeviceTokenVersioned(
  db: DbOrTx,
  deviceId: string,
  opts: { now?: Date } = {},
): Promise<{ token: string; token_version: number } | null> {
  const token = randomBytes(32).toString("base64url");
  const r = await db
    .update(devices)
    .set({ token_hash: hashToken(token), token_rotated_at: opts.now ?? new Date() })
    .where(eq(devices.id, deviceId))
    .returning({ token_version: devices.token_version });
  return r[0] ? { token, token_version: r[0].token_version } : null;
}

/**
 * The per-request check for a device access token: valid only while the device is active and the
 * token's version equals the current one. Any rotation or move out of `active` bumps the version.
 */
export async function deviceTokenVersion(db: DbOrTx, deviceId: string): Promise<{ token_version: number; state: Device["state"] } | null> {
  const r = await db.select({ token_version: devices.token_version, state: devices.state }).from(devices).where(eq(devices.id, deviceId)).limit(1);
  return r[0] ?? null;
}

/** Changes a device's state (maintenance, retired, lost; or back to active). Leaving `active` bumps token_version. */
export async function setDeviceState(db: DbOrTx, deviceId: string, state: Device["state"]): Promise<{ token_version: number } | null> {
  const r = await db.update(devices).set({ state }).where(eq(devices.id, deviceId)).returning({ token_version: devices.token_version });
  return r[0] ?? null;
}

/** The active device holding this token, or null. */
export async function authenticateDevice(db: DbOrTx, token: string): Promise<Device | null> {
  const r = await db.select().from(devices).where(sql`${devices.token_hash} = ${hashToken(token)} and ${devices.state} = 'active'`).limit(1);
  return r[0] ?? null;
}

/** A device heartbeat: updates the device and its checkpoint's gate-health fields. */
export async function recordHeartbeat(
  db: DbOrTx,
  i: {
    deviceId: string; checkpointId?: string | null; clockOffsetMs?: number | null; queueDepth?: number | null; appVersion?: string | null; ip?: string | null; now?: Date;
    /** `issued_at` of the allowlist the device holds (0029); null/absent keeps the last one reported. */
    allowlistIssuedAt?: Date | null;
  },
): Promise<"ok" | "unknown_device" | "not_active"> {
  const x = (
    await rows(
      db,
      sql`select * from public.device_heartbeat(${i.deviceId}::uuid, ${i.checkpointId ?? null}::uuid, ${i.clockOffsetMs ?? null}::integer,
            ${i.queueDepth ?? null}::integer, ${i.appVersion ?? null}, ${i.ip ?? null}::inet, ${tsOrNow(i.now)},
            ${i.allowlistIssuedAt ? i.allowlistIssuedAt.toISOString() : null}::timestamptz)`,
    )
  )[0]!;
  return x.status as "ok" | "unknown_device" | "not_active";
}

export interface GateHealthRow {
  checkpoint_id: string;
  label: string;
  direction: string;
  perimeter: boolean;
  hardware_id: string | null;
  link_state: "online" | "offline" | "unknown";
  last_heartbeat_at: Date | null;
  heartbeat_age_s: number | null;
  clock_offset_ms: number | null;
  clock_fault: boolean;
  queue_depth: number | null;
  last_scan_at: Date | null;
  scans_last_15m: number;
  staff_on_duty: number;
  /** checkpoints.position_jsonb: where the gate sits on the venue grid; null when not placed. */
  position: CheckpointPosition | null;
  /** Oldest allowlist `issued_at` among the gate's active devices heard from in the last 15 minutes (0029). */
  allowlist_issued_at: Date | null;
  /** That allowlist is more than 15 minutes old. */
  allowlist_stale: boolean;
}
/** Gate health for a venue (06 D12), faults first. Pass the event for last-scan and throughput figures. */
export async function gateHealth(db: DbOrTx, venueId: string, opts: { eventId?: string | null; now?: Date } = {}): Promise<GateHealthRow[]> {
  return (await rows(db, sql`select * from public.gate_health(${venueId}::uuid, ${opts.eventId ?? null}::uuid, ${tsOrNow(opts.now)})`)).map((x) => ({
    checkpoint_id: String(x.checkpoint_id), label: String(x.label), direction: String(x.direction), perimeter: Boolean(x.perimeter),
    hardware_id: (x.hardware_id as string | null) ?? null, link_state: x.link_state as GateHealthRow["link_state"],
    last_heartbeat_at: date(x.last_heartbeat_at), heartbeat_age_s: numOrNull(x.heartbeat_age_s), clock_offset_ms: numOrNull(x.clock_offset_ms),
    clock_fault: Boolean(x.clock_fault), queue_depth: numOrNull(x.queue_depth), last_scan_at: date(x.last_scan_at),
    scans_last_15m: num(x.scans_last_15m), staff_on_duty: num(x.staff_on_duty),
    position: x.position == null ? null : json<CheckpointPosition>(x.position),
    allowlist_issued_at: date(x.allowlist_issued_at), allowlist_stale: Boolean(x.allowlist_stale),
  }));
}

/* ------------------------------------------------------- events: admin and jobs */

/**
 * Duplicates an event as a draft starting at `startsAt` (rooms, sessions, rules shifted; no attendees).
 * With `startsAt` null the copy has no dates and no sessions, and keeps only the rules without a time
 * window. Audited (`event.duplicate`) by the database.
 */
export async function duplicateEvent(
  db: DbOrTx,
  i: { eventId: string; slug: string; title: string; startsAt: Date | null; actorId?: string | null },
): Promise<string> {
  const r = await rows<{ id: string }>(
    db,
    sql`select public.event_duplicate(${i.eventId}::uuid, ${i.slug}, ${i.title}, ${i.startsAt?.toISOString() ?? null}::timestamptz, ${i.actorId ?? null}::uuid) as id`,
  );
  return String(r[0]!.id);
}

export interface ReadinessCheck {
  check_name: "rooms" | "pass_template" | "access_rules" | "room_doors" | "perimeter_gate" | "sessions_in_window" | "staff_assigned" | "signing_key" | "starts_in_future";
  ok: boolean;
  /** Publishing is refused while a blocking check fails. */
  blocking: boolean;
  detail: string | null;
}
/** The publish readiness checklist (06 D5/D6). Email-domain verification is the API's. */
export async function eventReadiness(db: DbOrTx, eventId: string, now?: Date): Promise<{ ready: boolean; checks: ReadinessCheck[] }> {
  const checks = (await rows(db, sql`select * from public.event_readiness(${eventId}::uuid, ${tsOrNow(now)})`)).map((x) => ({
    check_name: x.check_name as ReadinessCheck["check_name"], ok: Boolean(x.ok), blocking: Boolean(x.blocking), detail: (x.detail as string | null) ?? null,
  }));
  return { ready: checks.every((c) => c.ok || !c.blocking), checks };
}

/** Applies due session-end resets for an event (idempotent; schedule every minute for live events). */
export async function applySessionResets(db: DbOrTx, eventId: string, now?: Date): Promise<{ room_id: string; at: Date; delta: number }[]> {
  return (await rows(db, sql`select * from public.occupancy_apply_session_resets(${eventId}::uuid, ${tsOrNow(now)})`)).map((x) => ({
    room_id: String(x.room_id), at: date(x.at)!, delta: num(x.delta),
  }));
}

/** Events whose purge is due (or, with dueOnly false, every closed unpurged event and when it is due). */
export async function eventsDueForPurge(
  db: DbOrTx,
  opts: { now?: Date; orgId?: string | null; dueOnly?: boolean } = {},
): Promise<{ event_id: string; org_id: string; slug: string; closed_at: Date; due_at: Date; due: boolean }[]> {
  return (
    await rows(db, sql`select * from public.events_due_for_purge(${tsOrNow(opts.now)}, ${opts.orgId ?? null}::uuid, ${opts.dueOnly ?? true})`)
  ).map((x) => ({
    event_id: String(x.event_id), org_id: String(x.org_id), slug: String(x.slug), closed_at: date(x.closed_at)!, due_at: date(x.due_at)!, due: Boolean(x.due),
  }));
}
