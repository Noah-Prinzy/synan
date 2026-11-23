/**
 * Report delivery over @synan/db (migration 0020): report schedules. Recipient lists are encrypted
 * envelopes bound to their row; only @synan/db's helpers read or write them.
 */
import {
  claimDueReportSchedules,
  createReportSchedule,
  deleteReportSchedule,
  finishReportSchedule,
  listReportSchedules,
  setReportScheduleState,
  type AnyDb,
  type Cipher,
  type ReportSchedule,
} from "@synan/db";
import type { ReportScheduleRow, ReportSchedulesRepo } from "./types.js";

const toSchedule = (s: ReportSchedule): ReportScheduleRow => ({
  id: s.id, event_id: s.event_id, format: s.format, kind: s.kind, include_identity: s.include_identity, recipients: s.recipients,
  cadence: s.cadence, next_run_at: s.next_run_at, last_run_at: s.last_run_at, state: s.state, failures: s.failures,
  last_error: s.last_error, created_by: s.created_by, created_at: s.created_at,
});

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
