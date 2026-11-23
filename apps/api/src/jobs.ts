/**
 * The background jobs (slice 11). One small interface (lib/jobs.ts) with two runners: in process
 * (memory backend, tests, single-node development) and pg-boss on PostgreSQL (lib/pgboss-jobs.ts),
 * using @synan/db's queue names so the maintenance process's schedules (scheduleDefaultJobs) reach
 * these handlers. Every handler is idempotent and uses server time.
 */
import { JOB_QUEUES } from "@synan/db";
import type { AppContext } from "./app.js";
import { processDataExports } from "./routes/me.js";

export const JOB = JOB_QUEUES;
/** Not yet in @synan/db JOB_QUEUES (requested). */
export const EXPORT_RETENTION_JOB = "exports.retention";

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
  app.jobs.register({ name: JOB.authCleanup, everyMs: 10 * 60_000, run: () => app.auth.cleanup() });
  app.jobs.register({ name: JOB.invitationExpiry, everyMs: 60 * 60_000, run: () => app.repos.maintenance.expireInvitations(now()) });
  app.jobs.register({ name: JOB.webhookDelivery, everyMs: 5_000, run: () => app.webhooks.drain() });
  app.jobs.register({ name: JOB.reportExport, everyMs: 30_000, run: () => app.reportExports.drain() });
  app.jobs.register({ name: JOB.dataRequest, everyMs: 60_000, run: () => processDataExports(app) });
  // Stored export files past the retention period (default 7 days) are deleted; each deletion is audited.
  app.jobs.register({ name: EXPORT_RETENTION_JOB, everyMs: 6 * 3600_000, run: () => app.reportExports.deleteExpired() });
}
