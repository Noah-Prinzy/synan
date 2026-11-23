/**
 * Report schedules, exported-file retention, the email outbox and attendee notifications.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Cipher } from "./crypto/index";
import { report_schedules, exported_files, email_outbox, notifications, notification_reads } from "./schema/delivery";
import { events } from "./schema/venue";
import { date, num, rows, tsOrNow, type DbOrTx } from "./sqlrows";

type ExportFormat = "xlsx" | "csv" | "pdf";
type ReportKind = "attendance" | "dwell_flow" | "peak_occupancy" | "breach_compliance" | "gate_throughput";

/* ----------------------------------------------------------- report schedules */

const recipientsCtx = (id: string) => ({ table: "report_schedules", column: "recipients_enc", rowId: id });

export interface ReportSchedule {
  id: string;
  event_id: string;
  format: ExportFormat;
  kind: ReportKind | null;
  include_identity: boolean;
  /** Decrypted. */
  recipients: string[];
  cadence: "on_close" | "daily" | "weekly" | "monthly";
  next_run_at: Date | null;
  last_run_at: Date | null;
  state: "active" | "paused" | "done" | "failed";
  failures: number;
  last_error: string | null;
  created_by: string | null;
  created_at: Date;
}
function toSchedule(cipher: Cipher, r: Record<string, unknown>): ReportSchedule {
  return {
    id: String(r.id), event_id: String(r.event_id), format: r.format as ExportFormat, kind: (r.kind as ReportKind | null) ?? null,
    include_identity: Boolean(r.include_identity), recipients: JSON.parse(cipher.decrypt(String(r.recipients_enc), recipientsCtx(String(r.id)))) as string[],
    cadence: r.cadence as ReportSchedule["cadence"], next_run_at: date(r.next_run_at), last_run_at: date(r.last_run_at),
    state: r.state as ReportSchedule["state"], failures: num(r.failures), last_error: (r.last_error as string | null) ?? null,
    created_by: (r.created_by as string | null) ?? null, created_at: date(r.created_at)!,
  };
}

/** Creates a schedule. `firstRunAt` is required for daily/weekly/monthly; on_close runs once the event closes. */
export async function createReportSchedule(
  db: DbOrTx,
  cipher: Cipher,
  i: {
    eventId: string; format?: ExportFormat; kind?: ReportKind | null; includeIdentity?: boolean; recipients: readonly string[];
    cadence: ReportSchedule["cadence"]; firstRunAt?: Date; createdBy?: string | null; now?: Date;
  },
): Promise<string> {
  const format = i.format ?? (i.kind ? "csv" : "xlsx");
  if (format === "csv" && !i.kind) throw new Error("a csv schedule needs a report kind");
  if (i.cadence !== "on_close" && !i.firstRunAt) throw new Error(`a ${i.cadence} schedule needs firstRunAt`);
  if (i.recipients.length === 0) throw new Error("a schedule needs at least one recipient");
  const id = crypto.randomUUID();
  await db.insert(report_schedules).values({
    id, event_id: i.eventId, format, kind: i.kind ?? null, include_identity: format === "xlsx" && (i.includeIdentity ?? false),
    recipients_enc: cipher.encrypt(JSON.stringify([...i.recipients]), recipientsCtx(id)), cadence: i.cadence,
    next_run_at: i.cadence === "on_close" ? null : i.firstRunAt!, created_by: i.createdBy ?? null,
    ...(i.now ? { created_at: i.now, updated_at: i.now } : {}),
  });
  return id;
}

export async function listReportSchedules(db: DbOrTx, cipher: Cipher, q: { eventId?: string } = {}): Promise<ReportSchedule[]> {
  const r = await db.select().from(report_schedules).where(q.eventId ? eq(report_schedules.event_id, q.eventId) : undefined).orderBy(desc(report_schedules.created_at));
  return r.map((x) => toSchedule(cipher, x as unknown as Record<string, unknown>));
}

/** Pause or resume (resuming a failed one resets its failures). */
export async function setReportScheduleState(db: DbOrTx, id: string, state: "active" | "paused", now?: Date): Promise<boolean> {
  const r = await db
    .update(report_schedules)
    .set({ state, failures: 0, lease_until: null, updated_at: now ?? new Date() })
    .where(and(eq(report_schedules.id, id), inArray(report_schedules.state, ["active", "paused", "failed"])))
    .returning({ id: report_schedules.id });
  return r.length === 1;
}

export async function deleteReportSchedule(db: DbOrTx, id: string): Promise<boolean> {
  return (await db.delete(report_schedules).where(eq(report_schedules.id, id)).returning({ id: report_schedules.id })).length === 1;
}

/** Claims due schedules (leased, safe with concurrent workers), recipients decrypted. */
export async function claimDueReportSchedules(
  db: DbOrTx,
  cipher: Cipher,
  opts: { limit?: number; leaseMinutes?: number; now?: Date } = {},
): Promise<ReportSchedule[]> {
  const r = await rows(db, sql`select * from public.report_schedule_claim(${opts.limit ?? 10}::integer, make_interval(mins => ${opts.leaseMinutes ?? 15}), ${tsOrNow(opts.now)})`);
  return r.map((x) => toSchedule(cipher, x));
}

/** Records a run: success advances next_run_at (on_close → done); three failures in a row → failed. */
export async function finishReportSchedule(
  db: DbOrTx,
  id: string,
  i: { ok: boolean; error?: string | null; now?: Date },
): Promise<{ state: ReportSchedule["state"]; next_run_at: Date | null }> {
  const x = (await rows(db, sql`select * from public.report_schedule_finish(${id}::uuid, ${i.ok}, ${i.error ?? null}, ${tsOrNow(i.now)})`))[0]!;
  return { state: x.state as ReportSchedule["state"], next_run_at: date(x.next_run_at) };
}

/* ------------------------------------------------------------ exported files */

export type ExportedFile = typeof exported_files.$inferSelect;

/** Records an exported file (retention default 7 days). A file with identity is audited. */
export async function recordExportedFile(
  db: DbOrTx,
  i: {
    reportId?: string | null; dataRequestId?: string | null; objectKey: string; contentType: string; sizeBytes?: number | null;
    containsIdentity: boolean; keyId?: string | null; retentionDays?: number; actorId?: string | null; now?: Date;
  },
): Promise<string> {
  const r = await rows<{ id: string }>(
    db,
    sql`select public.exported_file_record(${i.reportId ?? null}::uuid, ${i.dataRequestId ?? null}::uuid, ${i.objectKey}, ${i.contentType},
          ${i.sizeBytes ?? null}::bigint, ${i.containsIdentity}, ${i.keyId ?? null}, make_interval(days => ${i.retentionDays ?? 7}),
          ${i.actorId ?? null}::uuid, ${tsOrNow(i.now)}) as id`,
  );
  return String(r[0]!.id);
}

/** Files past retention and not yet deleted. Delete each object, then markExportedFilesDeleted. */
export async function exportedFilesDue(db: DbOrTx, opts: { now?: Date; limit?: number } = {}): Promise<ExportedFile[]> {
  const r = await rows(db, sql`select * from public.exported_files_due(${tsOrNow(opts.now)}, ${opts.limit ?? 100}::integer)`);
  return r.map((x) => ({
    id: String(x.id), report_id: (x.report_id as string | null) ?? null, data_request_id: (x.data_request_id as string | null) ?? null,
    object_key: String(x.object_key), content_type: String(x.content_type), size_bytes: x.size_bytes == null ? null : num(x.size_bytes),
    contains_identity: Boolean(x.contains_identity), key_id: (x.key_id as string | null) ?? null, created_at: date(x.created_at)!,
    expires_at: date(x.expires_at)!, deleted_at: date(x.deleted_at),
  }));
}

/** Marks files deleted (objects already removed) with one audit entry each. Returns how many. */
export async function markExportedFilesDeleted(db: DbOrTx, ids: readonly string[], opts: { actorId?: string | null; now?: Date } = {}): Promise<number> {
  if (!ids.length) return 0;
  const r = await rows<{ n: number }>(
    db,
    sql`select public.exported_files_mark_deleted(${`{${ids.join(",")}}`}::uuid[], ${opts.actorId ?? null}::uuid, ${tsOrNow(opts.now)}) as n`,
  );
  return num(r[0]!.n);
}

export async function listExportedFiles(db: DbOrTx, q: { reportId?: string; dataRequestId?: string } = {}): Promise<ExportedFile[]> {
  const conds = [q.reportId ? eq(exported_files.report_id, q.reportId) : undefined, q.dataRequestId ? eq(exported_files.data_request_id, q.dataRequestId) : undefined].filter(Boolean);
  return db.select().from(exported_files).where(conds.length ? and(...(conds as never[])) : undefined).orderBy(desc(exported_files.created_at));
}

/* --------------------------------------------------------------- email outbox */

const toCtx = (id: string) => ({ table: "email_outbox", column: "to_enc", rowId: id });
const contentCtx = (id: string) => ({ table: "email_outbox", column: "content_enc", rowId: id });

export interface EmailContent {
  subject: string;
  text: string;
  html?: string;
  [k: string]: unknown;
}

/**
 * Puts an email in the outbox (recipient and content encrypted) and returns its id. Enqueue the
 * pg-boss job with only `{ outbox_id }` — in the same transaction (enqueueInTransaction).
 */
export async function enqueueEmail(db: DbOrTx, cipher: Cipher, i: { template: string; to: string; content: EmailContent; now?: Date }): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(email_outbox).values({
    id, template: i.template, to_enc: cipher.encrypt(i.to, toCtx(id)), content_enc: cipher.encrypt(JSON.stringify(i.content), contentCtx(id)),
    ...(i.now ? { created_at: i.now } : {}),
  });
  return id;
}

/**
 * How long a claim holds an email (seconds). A `sending` row claimed longer ago than this was
 * abandoned (worker crash) and is claimed again; keep the mail provider's timeout well below it.
 */
export const EMAIL_CLAIM_LEASE_SECONDS = 120;

const leaseInterval = (seconds: number | undefined) => sql`make_interval(secs => ${seconds ?? EMAIL_CLAIM_LEASE_SECONDS}::double precision)`;

/**
 * Claims an email for sending, decrypted; null when already sent, in flight under a live lease, or
 * out of attempts. Also reclaims a `sending` row whose claim is older than `leaseSeconds` (default
 * EMAIL_CLAIM_LEASE_SECONDS); every claim, reclaims included, counts one attempt. Atomic: of
 * concurrent claimers exactly one gets the row.
 */
export async function claimEmail(
  db: DbOrTx,
  cipher: Cipher,
  id: string,
  opts: { maxAttempts?: number; leaseSeconds?: number; now?: Date } = {},
): Promise<{ id: string; template: string; to: string; content: EmailContent; attempts: number } | null> {
  const r = await rows(
    db,
    sql`select * from public.email_claim(${id}::uuid, ${opts.maxAttempts ?? 5}::integer, ${tsOrNow(opts.now)}, ${leaseInterval(opts.leaseSeconds)})`,
  );
  const x = r[0];
  if (!x) return null;
  return {
    id, template: String(x.template), to: cipher.decrypt(String(x.to_enc), toCtx(id)),
    content: JSON.parse(cipher.decrypt(String(x.content_enc), contentCtx(id))) as EmailContent, attempts: num(x.attempts),
  };
}

/**
 * Ids of emails to claim, oldest first: queued, failed with attempts left, and `sending` ones whose
 * claim lease has run out. Reads no address or content.
 */
export async function emailsDue(
  db: DbOrTx,
  opts: { maxAttempts?: number; limit?: number; leaseSeconds?: number; now?: Date } = {},
): Promise<string[]> {
  const r = await rows<{ id: string }>(
    db,
    sql`select id from public.email_due(${opts.maxAttempts ?? 5}::integer, ${opts.limit ?? 100}::integer, ${leaseInterval(opts.leaseSeconds)}, ${tsOrNow(opts.now)}) as id`,
  );
  return r.map((x) => String(x.id));
}

export async function finishEmail(db: DbOrTx, id: string, i: { ok: boolean; error?: string | null; providerId?: string | null; now?: Date }): Promise<"sent" | "failed" | null> {
  const r = await rows<{ s: string | null }>(db, sql`select public.email_finish(${id}::uuid, ${i.ok}, ${i.error ?? null}, ${i.providerId ?? null}, ${tsOrNow(i.now)}) as s`);
  return (r[0]?.s as "sent" | "failed" | null) ?? null;
}

/* -------------------------------------------------------------- notifications */

type NotificationKind = "pass" | "session" | "capacity" | "event" | "security";
/** The contracts' Notification shape. */
export interface AttendeeNotification {
  id: string;
  kind: NotificationKind;
  at: Date;
  title: string;
  body: string;
  read: boolean;
}

/** A personal notification (default life 30 days). Text must be generic: no location or movement. */
export async function notifyAttendee(
  db: DbOrTx,
  i: { attendeeId: string; kind: NotificationKind; title: string; body: string; eventId?: string | null; ttlDays?: number; now?: Date },
): Promise<string> {
  const now = i.now ?? new Date();
  const [r] = await db
    .insert(notifications)
    .values({
      attendee_id: i.attendeeId, event_id: i.eventId ?? null, kind: i.kind, title: i.title, body: i.body,
      created_at: now, expires_at: new Date(now.getTime() + (i.ttlDays ?? 30) * 86_400_000),
    })
    .returning({ id: notifications.id });
  return r!.id;
}

/** A broadcast to an event's confirmed registrations (optionally one tier). Expires 7 days after the event ends by default. */
export async function broadcastNotification(
  db: DbOrTx,
  i: { eventId: string; tier?: "VIP" | "ORDINARY" | "PRIVATE_INVITE" | "PUBLIC" | null; kind: NotificationKind; title: string; body: string; expiresAt?: Date; now?: Date },
): Promise<string> {
  let expires = i.expiresAt;
  if (!expires) {
    const ev = await db.select({ ends: events.ends_at }).from(events).where(eq(events.id, i.eventId)).limit(1);
    if (!ev[0]) throw new Error(`event ${i.eventId} does not exist`);
    expires = new Date(ev[0].ends.getTime() + 7 * 86_400_000);
  }
  const [r] = await db
    .insert(notifications)
    .values({
      event_id: i.eventId, audience_tier: i.tier ?? null, kind: i.kind, title: i.title, body: i.body, expires_at: expires,
      ...(i.now ? { created_at: i.now } : {}),
    })
    .returning({ id: notifications.id });
  return r!.id;
}

/** GET /me/notifications: personal and broadcast notifications, newest first, with read state. */
export async function listNotifications(db: DbOrTx, attendeeId: string, opts: { now?: Date; limit?: number } = {}): Promise<AttendeeNotification[]> {
  const r = await rows(db, sql`select * from public.notifications_for_attendee(${attendeeId}::uuid, ${tsOrNow(opts.now)}, ${opts.limit ?? 50}::integer)`);
  return r.map((x) => ({ id: String(x.id), kind: x.kind as NotificationKind, at: date(x.at)!, title: String(x.title), body: String(x.body), read: Boolean(x.read) }));
}

/** Marks notifications read — only those visible to this attendee. Returns how many were newly marked. */
export async function markNotificationsRead(db: DbOrTx, attendeeId: string, ids: readonly string[], now?: Date): Promise<number> {
  if (!ids.length) return 0;
  const visible = new Set((await listNotifications(db, attendeeId, { now, limit: 10_000 })).map((n) => n.id));
  const mine = ids.filter((id) => visible.has(id));
  if (!mine.length) return 0;
  const r = await db
    .insert(notification_reads)
    .values(mine.map((id) => ({ notification_id: id, attendee_id: attendeeId, ...(now ? { read_at: now } : {}) })))
    .onConflictDoNothing()
    .returning({ id: notification_reads.notification_id });
  return r.length;
}

/* ------------------------------------------------------------------ cleanup */

/**
 * Deletes sent/failed email after 7 days, expired notifications, finished schedules after 30 days.
 * Email left `sending` for over a day (abandoned, e.g. out of attempts) is first marked failed.
 */
export async function cleanupDelivery(db: DbOrTx, now?: Date): Promise<{ emails: number; notifications: number; schedules: number }> {
  const x = (await rows(db, sql`select * from public.delivery_cleanup(${tsOrNow(now)})`))[0]!;
  return { emails: num(x.emails), notifications: num(x.notifications), schedules: num(x.schedules) };
}
