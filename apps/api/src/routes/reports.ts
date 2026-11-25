/**
 * Slice 8 — reports (01 §10). Paginated JSON from aggregates only, so a report reads the same after
 * the post-event purge; export is an asynchronous CSV job (MFA, audited) delivered by a signed,
 * short-lived link served from /report-files/:id (not a JSON endpoint).
 */
import { describeError } from "@synan/db";
import express, { type Express } from "express";
import { API_BASE_PATH } from "@synan/contracts/common";
import { ContractError, ERROR_COPY } from "@synan/contracts/errors";
import { endpoints } from "@synan/contracts/rest";
import type { AppContext } from "../app.js";
import { mount } from "../http/route.js";
import { JOB } from "../jobs.js";
import { loadSummary, toSummaryDto } from "../domain/post-event.js";
import { CONTENT_TYPE } from "../domain/report-export.js";
import type { ReportRow, ReportScheduleRow } from "../repo/types.js";

const invalid = (path: string, message: string) => new ContractError("VALIDATION_FAILED", message, [{ path, message }]);
const offsetOf = (cursor: string | undefined) => {
  const n = cursor ? Number(cursor) : 0;
  if (!Number.isInteger(n) || n < 0) throw invalid("query.cursor", "invalid cursor");
  return n;
};

export function reportRoutes(x: Express, app: AppContext) {
  /**
   * Report rows as the contract has them. Whether a ready export can still be downloaded comes from
   * the register of exported files: one whose file expired or was deleted shows `expired_at` and no link.
   */
  const dtos = async (rows: ReportRow[]) => {
    const expired = await app.reportExports.expiredAt(rows.filter((r) => r.state === "ready").map((r) => r.id));
    return rows.map((r) => {
      const gone = expired.get(r.id) ?? null;
      return {
        id: r.id, event_id: r.event_id, kind: r.kind, format: r.format, include_identity: r.include_identity, state: r.state, requested_by: r.requested_by ?? r.id, created_at: r.created_at.toISOString(),
        download_url: gone ? null : app.reportExports.downloadUrl(r),
        expired_at: gone?.toISOString() ?? null,
      };
    });
  };
  const eventOr404 = async (id: string) => {
    const e = await app.repos.events.byId(id);
    if (!e) throw new ContractError("NOT_FOUND");
    return e;
  };

  mount(x, app, endpoints.listReports, async ({ query }) => {
    const offset = offsetOf(query.cursor);
    const rows = await app.repos.reports.list({ offset, limit: query.limit + 1 });
    return { items: await dtos(rows.slice(0, query.limit)), next_cursor: rows.length > query.limit ? String(offset + query.limit) : null };
  });

  mount(x, app, endpoints.eventReports, async ({ params }) => {
    const e = await eventOr404(params.eventId);
    return { items: await dtos(await app.repos.reports.list({ eventId: e.id, offset: 0, limit: 200 })) };
  });

  mount(x, app, endpoints.reportData, async ({ params, query }) => {
    const e = await eventOr404(params.eventId);
    try {
      const p = await app.repos.reports.run(params.kind, e.id, { section: query.section, cursor: query.cursor ?? null, limit: query.limit });
      return { event_id: e.id, kind: params.kind, section: p.section, total: p.total, columns: p.columns, rows: p.rows, next_cursor: p.next_cursor };
    } catch (err) {
      const m = err instanceof Error ? err.message : "";
      if (m === "invalid report cursor") throw invalid("query.cursor", "invalid cursor");
      if (m === "invalid report section") throw invalid("query.section", "not a section of this report");
      throw err;
    }
  });

  mount(x, app, endpoints.exportReport, async ({ params, body, ctx }) => {
    const e = await eventOr404(params.id);
    if (body.format === "csv" && !body.kind) throw invalid("body.kind", "a CSV is one report: name its kind");
    if (body.include_attendees && body.format !== "xlsx") throw invalid("body.include_attendees", "only the workbook carries the attendee sheet");
    // The workbook and the PDF cover the whole event (no kind); a CSV is one report.
    const kind = body.format === "csv" ? body.kind! : null;
    const id = await app.repos.reports.request({ eventId: e.id, kind, format: body.format, includeIdentity: body.include_attendees, requestedBy: ctx!.sub, params: {} });
    await app.audit.append({ actorId: ctx!.sub, action: "report.export", target: `event:${e.id}`, meta: { report_id: id, kind, format: body.format } });
    // Identity leaves the system in this file: recorded separately (03 §7).
    if (body.include_attendees) await app.audit.append({ actorId: ctx!.sub, action: "report.export_identity", target: `event:${e.id}`, meta: { report_id: id } });
    app.jobs.kick(JOB.reportExport);
    const row = (await app.repos.reports.list({ eventId: e.id, offset: 0, limit: 50 })).find((r) => r.id === id)!;
    return (await dtos([row]))[0]!;
  });

  /* ---- scheduled reports (01 §10) ---- */
  const scheduleDto = (s: ReportScheduleRow) => ({
    id: s.id, event_id: s.event_id, format: s.format, kind: s.kind, include_identity: s.include_identity, recipients: s.recipients,
    cadence: s.cadence, next_run_at: s.next_run_at?.toISOString() ?? null, last_run_at: s.last_run_at?.toISOString() ?? null,
    state: s.state, failures: s.failures, created_by: s.created_by, created_at: s.created_at.toISOString(),
  });
  const scheduleOr404 = async (eventId: string, scheduleId: string) => {
    const s = (await app.repos.reportSchedules.list(eventId)).find((r) => r.id === scheduleId);
    if (!s) throw new ContractError("NOT_FOUND");
    return s;
  };

  mount(x, app, endpoints.listReportSchedules, async ({ params }) => {
    const e = await eventOr404(params.id);
    return { items: (await app.repos.reportSchedules.list(e.id)).map(scheduleDto) };
  });

  mount(x, app, endpoints.createReportSchedule, async ({ params, body, ctx }) => {
    const e = await eventOr404(params.id);
    if (e.state === "archived") throw new ContractError("CONFLICT", "An archived event cannot have report schedules.");
    if (body.format === "csv" && !body.kind) throw invalid("body.kind", "a CSV is one report: name its kind");
    if (body.format !== "csv" && body.kind) throw invalid("body.kind", "only a CSV names a report kind");
    if (body.include_attendees && body.format !== "xlsx") throw invalid("body.include_attendees", "only the workbook carries the attendee sheet");
    const now = app.clock.now();
    let firstRunAt: Date | null = null;
    if (body.cadence === "on_close") {
      if (body.first_run_at) throw invalid("body.first_run_at", "an on_close schedule runs when the event closes");
    } else {
      // Server time is the authority: a time in the past means "now"; at most a year ahead.
      const t = body.first_run_at ? Date.parse(body.first_run_at) : now;
      if (t > now + 366 * 86_400_000) throw invalid("body.first_run_at", "at most a year ahead");
      firstRunAt = new Date(Math.max(t, now));
    }
    const recipients = [...new Set(body.recipients.map((r) => r.trim().toLowerCase()))];
    if (body.include_attendees) {
      const eligible = new Set(await app.reportSchedules.eligibleRecipients({ include_identity: true, recipients }));
      const issues = recipients.flatMap((r, i) => (eligible.has(r) ? [] : [{ path: `body.recipients.${i}`, message: "the attendee sheet goes only to operator accounts" }]));
      if (issues.length) throw new ContractError("VALIDATION_FAILED", issues[0]!.message, issues);
    }
    const id = await app.repos.reportSchedules.create({
      eventId: e.id, format: body.format, kind: body.format === "csv" ? body.kind! : null, includeIdentity: body.include_attendees, recipients,
      cadence: body.cadence, firstRunAt, createdBy: ctx!.sub, now: new Date(now),
    });
    // Recipients are personal data: the audit records how many, not who.
    await app.audit.append({
      actorId: ctx!.sub, action: "report_schedule.create", target: `event:${e.id}`,
      meta: { schedule_id: id, cadence: body.cadence, format: body.format, kind: body.kind ?? null, include_identity: body.include_attendees, recipients: recipients.length },
    });
    if (body.cadence === "on_close" && e.closed_at) app.jobs.kick(JOB.scheduledReport);
    return scheduleDto(await scheduleOr404(e.id, id));
  });

  mount(x, app, endpoints.setReportScheduleState, async ({ params, body, ctx }) => {
    const e = await eventOr404(params.id);
    const s = await scheduleOr404(e.id, params.scheduleId);
    if (body.state === "active" && s.include_identity && !app.auth.isMfaFresh(ctx!)) throw new ContractError("MFA_REQUIRED");
    if (!(await app.repos.reportSchedules.setState(s.id, body.state, new Date(app.clock.now())))) {
      throw new ContractError("CONFLICT", "This schedule has finished and cannot be paused or resumed.");
    }
    await app.audit.append({ actorId: ctx!.sub, action: body.state === "active" ? "report_schedule.resume" : "report_schedule.pause", target: `event:${e.id}`, meta: { schedule_id: s.id, from: s.state } });
    return scheduleDto(await scheduleOr404(e.id, s.id));
  });

  mount(x, app, endpoints.deleteReportSchedule, async ({ params, ctx }) => {
    const e = await eventOr404(params.id);
    const s = await scheduleOr404(e.id, params.scheduleId);
    if (!(await app.repos.reportSchedules.delete(s.id))) throw new ContractError("NOT_FOUND");
    await app.audit.append({ actorId: ctx!.sub, action: "report_schedule.delete", target: `event:${e.id}`, meta: { schedule_id: s.id, cadence: s.cadence } });
    return { ok: true as const };
  });

  mount(x, app, endpoints.postEventSummary, async ({ params }) => {
    const e = await eventOr404(params.id);
    const s = toSummaryDto(await loadSummary(app, e.id));
    return { ...s, downloads: await dtos(await app.repos.reports.list({ eventId: e.id, offset: 0, limit: 50 })) };
  });

  // The signed link itself is the authorisation: no bearer token (a browser download carries none).
  x.get(`${API_BASE_PATH}/report-files/:id`, async (req, res, next) => {
    try {
      const { key, exp, sig } = req.query as Record<string, string | undefined>;
      const ok = key && exp && sig ? app.reportExports.verify(req.params.id, key, exp, sig) : null;
      if (!ok) return void res.status(403).json({ error: { code: "FORBIDDEN", message: "This download link is invalid or has expired." } });
      // A genuine link to a file the register says is gone (retention ran out or deleted it): say so, typed.
      if ((await app.reportExports.expiredAt([req.params.id])).has(req.params.id)) {
        return void res.status(ERROR_COPY.EXPORT_EXPIRED.status).json({ error: { code: "EXPORT_EXPIRED", message: ERROR_COPY.EXPORT_EXPIRED.message } });
      }
      const stream = await app.reportExports.open(ok);
      if (!stream) return void res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found." } });
      const ext = (ok.split(".").pop() ?? "csv") as keyof typeof CONTENT_TYPE;
      res.setHeader("Content-Type", CONTENT_TYPE[ext] ?? "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="report-${req.params.id}.${ext}"`);
      res.status(200);
      // Decrypted as it is sent (constant memory). A file that fails authentication aborts the response.
      stream.on("error", (e: Error) => {
        console.error(`[reports] download of report:${req.params.id} failed: ${describeError(e)}`);
        res.destroy();
      });
      stream.pipe(res);
    } catch (e) {
      next(e);
    }
  });
  void express;
}
