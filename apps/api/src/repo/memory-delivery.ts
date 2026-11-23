/**
 * In-memory report schedules (and, later, the rest of report delivery), mirroring @synan/db
 * migration 0020 (report_schedule_claim / report_schedule_finish) step for step.
 */
import { randomUUID } from "node:crypto";
import type { MemoryTables } from "./memory.js";
import type { AuditRow, ExportedFilesRepo, ReportScheduleRow, ReportSchedulesRepo } from "./types.js";

export interface MemSchedule extends ReportScheduleRow {
  lease_until: Date | null;
  updated_at: Date;
}

const clone = <T>(v: T): T => structuredClone(v);
const pub = (s: MemSchedule): ReportScheduleRow => {
  const { lease_until: _l, updated_at: _u, ...rest } = s;
  return clone(rest);
};

/** PostgreSQL `timestamptz + interval '1 month'` in UTC: same day of the next month, clamped to its last day. */
export function addMonthUTC(d: Date): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const out = new Date(d);
  out.setUTCDate(1);
  out.setUTCFullYear(y + Math.floor(m / 12), m % 12, Math.min(d.getUTCDate(), last));
  return out;
}

type Audit = (e: Pick<AuditRow, "actor_id" | "action" | "target" | "meta_jsonb" | "at">) => unknown;

/** Mirrors exported_file_record / exported_files_due / exported_files_mark_deleted and delivery_cleanup. */
export function memoryExportedFiles(t: MemoryTables, audit: Audit): ExportedFilesRepo {
  const f = t.exportedFiles;
  return {
    async record(i) {
      if ([...f.values()].some((x) => x.object_key === i.objectKey)) throw new Error("exported_files_object_key_uq");
      if ((i.reportId === null) === (i.dataRequestId === null)) throw new Error("exported_files_owner");
      const id = randomUUID();
      const expires = new Date(i.now.getTime() + i.retentionDays * 86_400_000);
      f.set(id, {
        id, report_id: i.reportId, data_request_id: i.dataRequestId, object_key: i.objectKey, content_type: i.contentType, size_bytes: i.sizeBytes,
        contains_identity: i.containsIdentity, key_id: i.keyId, created_at: i.now, expires_at: expires, deleted_at: null,
      });
      if (i.containsIdentity) {
        audit({ actor_id: i.actorId, action: "export.create", target: `exported_file:${id}`, meta_jsonb: { report_id: i.reportId, data_request_id: i.dataRequestId, expires_at: expires.toISOString() }, at: i.now });
      }
      return id;
    },
    async due(now, limit) {
      return [...f.values()].filter((x) => !x.deleted_at && x.expires_at <= now).sort((a, b) => a.expires_at.getTime() - b.expires_at.getTime()).slice(0, limit).map(clone);
    },
    async markDeleted(ids, { actorId, now }) {
      let n = 0;
      for (const id of new Set(ids)) {
        const x = f.get(id);
        if (!x || x.deleted_at) continue;
        x.deleted_at = now;
        audit({
          actor_id: actorId, action: "export.delete", target: `exported_file:${id}`,
          meta_jsonb: { contains_identity: x.contains_identity, report_id: x.report_id, data_request_id: x.data_request_id, expired_at: x.expires_at.toISOString() }, at: now,
        });
        n++;
      }
      return n;
    },
    async list(q) {
      return [...f.values()]
        .filter((x) => (!q.reportId || x.report_id === q.reportId) && (!q.dataRequestId || x.data_request_id === q.dataRequestId))
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .map(clone);
    },
    async cleanupDelivery(now) {
      const at = now.getTime();
      let emails = 0, notifications = 0, schedules = 0;
      // As delivery_cleanup (0022): a row abandoned in `sending` for a day is failed, so it reaches the 7-day deletion.
      for (const e of t.emails.values()) {
        if (e.state === "sending" && (e.claimed_at ?? e.created_at).getTime() < at - 86_400_000) {
          e.state = "failed";
          e.last_error = "abandoned: claim lease expired";
        }
      }
      for (const [id, e] of t.emails) {
        if ((e.state === "sent" && e.sent_at && e.sent_at.getTime() < at - 7 * 86_400_000) || (e.state === "failed" && e.created_at.getTime() < at - 7 * 86_400_000)) {
          t.emails.delete(id);
          emails++;
        }
      }
      for (const [id, n] of t.notifications) {
        if (n.expires_at.getTime() <= at) {
          t.notifications.delete(id);
          for (const k of [...t.notificationReads.keys()]) if (k.startsWith(`${id}|`)) t.notificationReads.delete(k);
          notifications++;
        }
      }
      for (const [id, s] of t.reportSchedules) {
        if ((s.state === "done" || s.state === "failed") && s.updated_at.getTime() < at - 30 * 86_400_000) {
          t.reportSchedules.delete(id);
          schedules++;
        }
      }
      return { emails, notifications, schedules };
    },
  };
}

export function memoryReportSchedules(t: MemoryTables): ReportSchedulesRepo {
  const s = t.reportSchedules;
  return {
    async create(i) {
      if (i.format === "csv" && !i.kind) throw new Error("a csv schedule needs a report kind");
      if (i.cadence !== "on_close" && !i.firstRunAt) throw new Error(`a ${i.cadence} schedule needs firstRunAt`);
      if (i.recipients.length === 0) throw new Error("a schedule needs at least one recipient");
      const id = randomUUID();
      s.set(id, {
        id, event_id: i.eventId, format: i.format, kind: i.kind, include_identity: i.format === "xlsx" && i.includeIdentity,
        recipients: [...i.recipients], cadence: i.cadence, next_run_at: i.cadence === "on_close" ? null : i.firstRunAt, last_run_at: null,
        state: "active", failures: 0, last_error: null, created_by: i.createdBy, created_at: i.now, lease_until: null, updated_at: i.now,
      });
      return id;
    },
    async list(eventId) {
      return [...s.values()].filter((x) => x.event_id === eventId).sort((a, b) => b.created_at.getTime() - a.created_at.getTime()).map(pub);
    },
    async setState(id, state, now) {
      const x = s.get(id);
      if (!x || x.state === "done") return false;
      Object.assign(x, { state, failures: 0, lease_until: null, updated_at: now });
      return true;
    },
    async delete(id) {
      return s.delete(id);
    },
    async claimDue(now, { limit, leaseMinutes }) {
      const at = now.getTime();
      const due = [...s.values()]
        .map((x) => ({ x, closed: t.events.get(x.event_id)?.closed_at ?? null }))
        .filter(({ x, closed }) =>
          x.state === "active" && (!x.lease_until || x.lease_until.getTime() <= at) &&
          ((x.cadence !== "on_close" && x.next_run_at !== null && x.next_run_at.getTime() <= at) ||
            (x.cadence === "on_close" && x.last_run_at === null && closed !== null && closed.getTime() <= at)))
        .sort((a, b) => (a.x.next_run_at ?? a.closed!).getTime() - (b.x.next_run_at ?? b.closed!).getTime())
        .slice(0, limit);
      for (const { x } of due) x.lease_until = new Date(at + leaseMinutes * 60_000);
      return due.map(({ x }) => pub(x));
    },
    async finish(id, i) {
      const x = s.get(id);
      if (!x) throw new Error(`report schedule ${id} does not exist`);
      if (i.ok) {
        let nxt = x.next_run_at;
        if (x.cadence !== "on_close" && nxt) {
          while (nxt.getTime() <= i.now.getTime()) {
            nxt = x.cadence === "monthly" ? addMonthUTC(nxt) : new Date(nxt.getTime() + (x.cadence === "daily" ? 1 : 7) * 86_400_000);
          }
        }
        Object.assign(x, {
          last_run_at: i.now, failures: 0, last_error: null, lease_until: null, next_run_at: nxt,
          state: x.cadence === "on_close" ? "done" : x.state, updated_at: i.now,
        });
      } else {
        x.failures += 1;
        x.last_error = (i.error ?? "").slice(0, 500) || null;
        x.updated_at = i.now;
        if (x.failures >= 3) x.state = "failed";
      }
      return { state: x.state, next_run_at: x.next_run_at };
    },
  };
}
