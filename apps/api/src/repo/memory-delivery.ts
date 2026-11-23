/**
 * In-memory report schedules (and, later, the rest of report delivery), mirroring @synan/db
 * migration 0020 (report_schedule_claim / report_schedule_finish) step for step.
 */
import { randomUUID } from "node:crypto";
import type { MemoryTables } from "./memory.js";
import type { ReportScheduleRow, ReportSchedulesRepo } from "./types.js";

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
