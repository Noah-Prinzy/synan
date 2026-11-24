/**
 * The background jobs (slice 11). One small interface (lib/jobs.ts) with two runners: in process
 * (memory backend, tests, single-node development) and pg-boss on PostgreSQL (lib/pgboss-jobs.ts),
 * using @synan/db's queue names so the maintenance process's schedules (scheduleDefaultJobs) reach
 * these handlers. Every handler is idempotent and uses server time.
 */
import { JOB_QUEUES } from "@synan/db";
import type { AppContext } from "./app.js";
import { ALERT_RETENTION_MONTHS, AUDIT_RETENTION_MONTHS } from "./domain/audit.js";
import { processDataExports } from "./routes/me.js";

const DAY_MS = 24 * 3600_000;

export const JOB = JOB_QUEUES;

export function registerJobs(app: AppContext) {
  const now = () => new Date(app.clock.now());
  const live = async () => app.repos.events.listAll({ state: "live", limit: 1000 });

  // Post-event purge after the grace period (03 §6): rollups rebuilt, scans and the ID mapping destroyed.
  app.jobs.register({
    name: JOB.purge, everyMs: 15 * 60_000,
    run: async () => {
      for (const id of await app.repos.maintenance.eventsDueForPurge(now())) await app.repos.reports.purge(id, null);
      app.scans.forgetProjections();
    },
  });
  // Session-end occupancy reset (D-10).
  app.jobs.register({
    name: JOB.sessionReset, everyMs: 60_000,
    run: async () => {
      let n = 0;
      for (const e of await live()) n += await app.repos.maintenance.applySessionResets(e.id, now());
      if (n) app.scans.forgetProjections();
    },
  });
  // Rollups follow the live data, so reports and the summary stay current (≈ 5 minutes).
  app.jobs.register({
    name: JOB.rollupRebuild, everyMs: 5 * 60_000,
    run: async () => {
      for (const e of await live()) await app.repos.reports.rebuildRollups(e.id);
    },
  });
  // Expired sign-in state, desk codes and invites.
  // Pending self-service registrations go with their expired link (unused: purged, 03 §6).
  app.jobs.register({ name: JOB.authCleanup, everyMs: 10 * 60_000, run: async () => { await app.auth.cleanup(); await app.repos.pendingRegistrations.cleanup(now()); } });
  app.jobs.register({ name: JOB.invitationExpiry, everyMs: 60 * 60_000, run: () => app.repos.maintenance.expireInvitations(now()) });
  app.jobs.register({ name: JOB.webhookDelivery, everyMs: 5_000, run: () => app.webhooks.drain() });
  app.jobs.register({ name: JOB.reportExport, everyMs: 30_000, run: () => app.reportExports.drain() });
  // Email (D-17): one queued item by outbox id, or a sweep of everything due (retries included).
  app.jobs.register({ name: JOB.email, everyMs: 30_000, run: (data) => app.mail.run(data) });
  // Scheduled reports (01 §10): due schedules, and on_close ones once their event has closed (kicked at close).
  app.jobs.register({ name: JOB.scheduledReport, everyMs: 60_000, run: () => app.reportSchedules.run() });
  app.jobs.register({ name: JOB.dataRequest, everyMs: 60_000, run: () => processDataExports(app) });
  // Exported files past retention (default 7 days): objects deleted, then marked (audited); then sent
  // email, expired notifications and finished schedules are removed (@synan/db delivery.cleanup).
  app.jobs.register({
    name: JOB.deliveryCleanup, everyMs: 60 * 60_000,
    run: async () => {
      await app.reportExports.deleteExpired();
      await app.repos.exportedFiles.cleanupDelivery(now());
    },
  });
  // Retention (03 §6, D-03), daily on one queue (the maintenance process schedules `audit.prune`
  // at 03:30): audit entries and breach alerts older than 12 months. The audit log keeps verifying
  // after a prune (the store records the hash the pruned run ended on). Each prune that removed
  // something is audited: `retention.audit_pruned` here, `retention.alerts_pruned` by the store.
  // The two are independent: one failing does not skip the other.
  app.jobs.register({
    name: JOB.auditPrune, everyMs: DAY_MS,
    run: async () => {
      const results = await Promise.allSettled([
        (async () => {
          const n = await app.repos.audit.prune(now());
          if (n > 0) await app.audit.append({ actorId: null, action: "retention.audit_pruned", target: "audit_log", meta: { deleted: n, months: AUDIT_RETENTION_MONTHS } });
        })(),
        app.repos.alerts.prune({ olderThanMonths: ALERT_RETENTION_MONTHS, now: now() }),
      ]);
      const failed = results.find((r) => r.status === "rejected");
      if (failed) throw (failed as PromiseRejectedResult).reason;
    },
  });
}
