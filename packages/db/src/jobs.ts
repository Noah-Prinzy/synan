/**
 * Background jobs on pg-boss (D-17), and the report-export job state in `event_reports`.
 *
 * Roles (migration 0014 §I):
 *   - the migrating role installs the pg-boss schema (installJobSchema), which then belongs to
 *     app_jobs;
 *   - app_api may enqueue, fetch, complete and fail jobs (DML only) — API processes and workers;
 *   - one maintenance process logs in as a member of app_jobs and runs pg-boss supervision and
 *     cron schedules (createJobs({ mode: "maintenance" })), which create pg-boss's daily partitions.
 */
import type { PGlite } from "@electric-sql/pglite";
import { and, desc, eq, sql } from "drizzle-orm";
import { fromDrizzle, fromPglite, PgBoss, type SendOptions } from "pg-boss";
import type { AnyDb, AnyTx } from "./client";
import { event_reports } from "./schema/analytics";
import { date, num, rows, tsOrNow, type DbOrTx, type Page } from "./sqlrows";

export const JOB_SCHEMA = "pgboss";

/** Every queue the system uses. Created at install time, so no process needs DDL at run time. */
export const JOB_QUEUES = {
  /** Purge movement data of events whose grace period has run out (eventsDueForPurge → purgeEventMovementData). */
  purge: "event.purge",
  /** Session-end occupancy resets for live events (applySessionResets). */
  sessionReset: "occupancy.session_reset",
  /** Rebuild rollups of live events so reports follow the live data (rebuildEventRollups). */
  rollupRebuild: "rollups.rebuild",
  /** Delete expired sign-in state (cleanupAuthState). */
  authCleanup: "auth.cleanup",
  /** Mark expired invitations (expireInvitations). */
  invitationExpiry: "invitations.expire",
  /** Build a report export (claimReport → completeReport / failReport). */
  reportExport: "report.export",
  /** Scheduled report emails (claimDueReportSchedules → requestReport → email → finishReportSchedule). */
  scheduledReport: "report.scheduled",
  /** Transactional email. Payload is `{ outbox_id }` only (enqueueEmail → claimEmail → finishEmail). */
  email: "email.send",
  /** Send due webhook deliveries (claimWebhookDeliveries → recordWebhookAttempt). */
  webhookDelivery: "webhook.deliver",
  /** Attendee export / erasure requests (claimDataRequest → …). */
  dataRequest: "data_request.process",
  /** Delete audit entries older than 12 months (auditPrune). */
  auditPrune: "audit.prune",
  /**
   * Delete exported files past retention (exportedFilesDue → delete objects → markExportedFilesDeleted),
   * then finished schedules, sent email and expired notifications (cleanupDelivery).
   */
  deliveryCleanup: "delivery.cleanup",
} as const;
export type JobQueue = (typeof JOB_QUEUES)[keyof typeof JOB_QUEUES];

/** Suggested cron schedules for the maintenance process (scheduleDefaultJobs). */
export const JOB_SCHEDULES: { queue: JobQueue; cron: string }[] = [
  { queue: JOB_QUEUES.purge, cron: "*/15 * * * *" },
  { queue: JOB_QUEUES.sessionReset, cron: "* * * * *" },
  { queue: JOB_QUEUES.rollupRebuild, cron: "*/5 * * * *" },
  { queue: JOB_QUEUES.authCleanup, cron: "*/10 * * * *" },
  { queue: JOB_QUEUES.invitationExpiry, cron: "0 * * * *" },
  { queue: JOB_QUEUES.webhookDelivery, cron: "* * * * *" },
  { queue: JOB_QUEUES.dataRequest, cron: "*/5 * * * *" },
  { queue: JOB_QUEUES.auditPrune, cron: "30 3 * * *" },
  { queue: JOB_QUEUES.scheduledReport, cron: "*/5 * * * *" },
  { queue: JOB_QUEUES.deliveryCleanup, cron: "15 * * * *" },
];

type Target = { connectionString: string } | { pglite: PGlite };
const dbOptions = (t: Target) =>
  "pglite" in t ? { db: fromPglite(t.pglite as never), backend: "pglite" as const } : { connectionString: t.connectionString, max: 2 };

/**
 * Installs or upgrades the pg-boss schema and creates every queue, as the migrating role, then
 * hands the schema to app_jobs and grants app_api (job_schema_grants). Idempotent; runMigrations()
 * calls it. On PGlite pass { pglite }.
 */
export async function installJobSchema(target: Target): Promise<void> {
  const boss = new PgBoss({ ...dbOptions(target), schema: JOB_SCHEMA, migrate: true, createSchema: true, supervise: false, schedule: false } as never);
  boss.on("error", () => undefined);
  await boss.start();
  try {
    const existing = new Set((await boss.getQueues()).map((q) => q.name));
    for (const name of Object.values(JOB_QUEUES)) if (!existing.has(name)) await boss.createQueue(name);
  } finally {
    await boss.stop({ graceful: false, wait: true } as never);
  }
  if ("pglite" in target) await target.pglite.query(`select public.job_schema_grants($1)`, [JOB_SCHEMA]);
  else {
    const pg = (await import("pg")).default;
    const c = new pg.Client({ connectionString: target.connectionString });
    await c.connect();
    try {
      await c.query(`select public.job_schema_grants($1)`, [JOB_SCHEMA]);
    } finally {
      await c.end();
    }
  }
}

/**
 * A pg-boss instance for this system. `worker` (default): sends and works jobs as app_api, never
 * migrates or supervises. `maintenance`: one per deployment, logged in as a member of app_jobs;
 * runs supervision and cron schedules. Call `.start()` yourself.
 */
export function createJobs(target: Target & { mode?: "worker" | "maintenance"; applicationName?: string; max?: number }): PgBoss {
  const maintenance = target.mode === "maintenance";
  return new PgBoss({
    ...dbOptions(target),
    ...(target.max ? { max: target.max } : {}),
    schema: JOB_SCHEMA,
    migrate: false,
    createSchema: false,
    supervise: maintenance,
    schedule: maintenance,
    application_name: target.applicationName ?? (maintenance ? "jobs-maintenance" : "jobs-worker"),
  } as never);
}

/** Registers JOB_SCHEDULES on a maintenance instance. */
export async function scheduleDefaultJobs(boss: PgBoss): Promise<void> {
  for (const s of JOB_SCHEDULES) await boss.schedule(s.queue, s.cron);
}

/**
 * Enqueues a job inside the caller's Drizzle transaction, so the job exists only if the
 * transaction commits (e.g. "report requested" and its export job).
 */
export async function enqueueInTransaction(
  boss: PgBoss,
  tx: AnyDb | AnyTx,
  queue: JobQueue,
  data: Record<string, unknown>,
  options: SendOptions = {},
): Promise<string | null> {
  return boss.send(queue, data, { ...options, db: fromDrizzle(tx as never, sql as never) });
}

/* ----------------------------------------------------------------- report jobs */

export type EventReport = typeof event_reports.$inferSelect;
type ReportKind = NonNullable<EventReport["kind"]>;

/**
 * Queues an export (state queued). `format`: "xlsx" the whole-event workbook (default), "pdf" the
 * summary, "csv" one report (needs `kind`). Pair with enqueueInTransaction(JOB_QUEUES.reportExport).
 */
export async function requestReport(
  db: DbOrTx,
  i: {
    eventId: string;
    format?: EventReport["format"];
    kind?: ReportKind | null;
    includeIdentity?: boolean;
    requestedBy?: string | null;
    params?: Record<string, unknown>;
  },
): Promise<string> {
  const format = i.format ?? (i.kind ? "csv" : "xlsx");
  if (format === "csv" && !i.kind) throw new Error("a csv export needs a report kind");
  const [r] = await db
    .insert(event_reports)
    .values({
      event_id: i.eventId, format, kind: i.kind ?? null, include_identity: format === "xlsx" && (i.includeIdentity ?? false),
      requested_by: i.requestedBy ?? null, params_jsonb: i.params ?? {},
    })
    .returning({ id: event_reports.id });
  return r!.id;
}

/** Claims the oldest queued report (queued → running); null when none. Safe with concurrent workers. */
export async function claimReport(db: DbOrTx, now?: Date): Promise<EventReport | null> {
  const r = await rows<Record<string, unknown>>(db, sql`select * from public.report_claim(${tsOrNow(now)})`);
  if (!r[0]) return null;
  const x = r[0];
  return {
    id: String(x.id), event_id: String(x.event_id), kind: (x.kind as ReportKind | null) ?? null, state: x.state as EventReport["state"],
    format: x.format as EventReport["format"], include_identity: Boolean(x.include_identity),
    object_key: (x.object_key as string | null) ?? null, requested_by: (x.requested_by as string | null) ?? null,
    params_jsonb: (typeof x.params_jsonb === "string" ? JSON.parse(x.params_jsonb) : x.params_jsonb) as unknown,
    summary_object_key: (x.summary_object_key as string | null) ?? null, error: (x.error as string | null) ?? null,
    created_at: date(x.created_at)!, started_at: date(x.started_at), completed_at: date(x.completed_at),
  };
}

/** running → ready, with the CSV object key and optionally the PDF summary's. */
export async function completeReport(db: DbOrTx, reportId: string, i: { objectKey: string; summaryObjectKey?: string | null; now?: Date }): Promise<boolean> {
  const r = await db
    .update(event_reports)
    .set({ state: "ready", object_key: i.objectKey, summary_object_key: i.summaryObjectKey ?? null, completed_at: i.now ?? new Date(), error: null })
    .where(and(eq(event_reports.id, reportId), eq(event_reports.state, "running")))
    .returning({ id: event_reports.id });
  return r.length === 1;
}

/** running → failed, with the error (no personal data). */
export async function failReport(db: DbOrTx, reportId: string, error: string, now?: Date): Promise<boolean> {
  const r = await db
    .update(event_reports)
    .set({ state: "failed", error: error.slice(0, 1000), completed_at: now ?? new Date() })
    .where(and(eq(event_reports.id, reportId), eq(event_reports.state, "running")))
    .returning({ id: event_reports.id });
  return r.length === 1;
}

/** Generated reports, newest first (06 D13). */
export async function listReports(
  db: DbOrTx,
  q: { eventId?: string; state?: EventReport["state"]; limit?: number; offset?: number } = {},
): Promise<Page<EventReport>> {
  const conds = [q.eventId ? eq(event_reports.event_id, q.eventId) : undefined, q.state ? eq(event_reports.state, q.state) : undefined].filter(Boolean);
  const where = conds.length ? and(...(conds as never[])) : undefined;
  const items = await db.select().from(event_reports).where(where).orderBy(desc(event_reports.created_at)).limit(q.limit ?? 50).offset(q.offset ?? 0);
  const total = num((await db.select({ n: sql<number>`count(*)` }).from(event_reports).where(where))[0]!.n);
  return { items, total };
}
