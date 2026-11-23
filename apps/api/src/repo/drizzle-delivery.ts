/**
 * Report delivery over @synan/db (migration 0020): report schedules. Recipient lists are encrypted
 * envelopes bound to their row; only @synan/db's helpers read or write them.
 */
import {
  claimDueReportSchedules,
  cleanupDelivery,
  createReportSchedule,
  deleteReportSchedule,
  exportedFilesDue,
  finishReportSchedule,
  listExportedFiles,
  listReportSchedules,
  markExportedFilesDeleted,
  recordExportedFile,
  setReportScheduleState,
  type AnyDb,
  type Cipher,
  type ReportSchedule,
} from "@synan/db";
import type { ExportedFilesRepo, ReportScheduleRow, ReportSchedulesRepo } from "./types.js";

const toSchedule = (s: ReportSchedule): ReportScheduleRow => ({
  id: s.id, event_id: s.event_id, format: s.format, kind: s.kind, include_identity: s.include_identity, recipients: s.recipients,
  cadence: s.cadence, next_run_at: s.next_run_at, last_run_at: s.last_run_at, state: s.state, failures: s.failures,
  last_error: s.last_error, created_by: s.created_by, created_at: s.created_at,
});

export function drizzleExportedFiles(db: AnyDb): ExportedFilesRepo {
  return {
    async record(i) {
      return recordExportedFile(db, {
        reportId: i.reportId, dataRequestId: i.dataRequestId, objectKey: i.objectKey, contentType: i.contentType, sizeBytes: i.sizeBytes,
        containsIdentity: i.containsIdentity, keyId: i.keyId, retentionDays: i.retentionDays, actorId: i.actorId, now: i.now,
      });
    },
    async due(now, limit) {
      return exportedFilesDue(db, { now, limit });
    },
    async markDeleted(ids, { actorId, now }) {
      return markExportedFilesDeleted(db, ids, { actorId, now });
    },
    async list(q) {
      return listExportedFiles(db, q);
    },
    async cleanupDelivery(now) {
      return cleanupDelivery(db, now);
    },
  };
}

export function drizzleReportSchedules(db: AnyDb, cipher: Cipher): ReportSchedulesRepo {
  return {
    async create(i) {
      return createReportSchedule(db, cipher, {
        eventId: i.eventId, format: i.format, kind: i.kind, includeIdentity: i.includeIdentity, recipients: i.recipients,
        cadence: i.cadence, firstRunAt: i.firstRunAt ?? undefined, createdBy: i.createdBy, now: i.now,
      });
    },
    async list(eventId) {
      return (await listReportSchedules(db, cipher, { eventId })).map(toSchedule);
    },
    async setState(id, state, now) {
      return setReportScheduleState(db, id, state, now);
    },
    async delete(id) {
      return deleteReportSchedule(db, id);
    },
    async claimDue(now, { limit, leaseMinutes }) {
      return (await claimDueReportSchedules(db, cipher, { limit, leaseMinutes, now })).map(toSchedule);
    },
    async finish(id, i) {
      return finishReportSchedule(db, id, { ok: i.ok, error: i.error, now: i.now });
    },
  };
}
