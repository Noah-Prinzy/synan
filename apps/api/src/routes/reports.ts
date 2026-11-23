/**
 * Slice 8 — reports (01 §10). Paginated JSON from aggregates only, so a report reads the same after
 * the post-event purge; export is an asynchronous CSV job (MFA, audited) delivered by a signed,
 * short-lived link served from /report-files/:id (not a JSON endpoint).
 */
import express, { type Express } from "express";
import { API_BASE_PATH } from "@synan/contracts/common";
import { ContractError } from "@synan/contracts/errors";
import { endpoints } from "@synan/contracts/rest";
import type { AppContext } from "../app.js";
import { mount } from "../http/route.js";
import { JOB } from "../jobs.js";
import { loadSummary, toSummaryDto } from "../domain/post-event.js";
import { CONTENT_TYPE } from "../domain/report-export.js";
import type { ReportRow } from "../repo/types.js";

const invalid = (path: string, message: string) => new ContractError("VALIDATION_FAILED", message, [{ path, message }]);
const offsetOf = (cursor: string | undefined) => {
  const n = cursor ? Number(cursor) : 0;
  if (!Number.isInteger(n) || n < 0) throw invalid("query.cursor", "invalid cursor");
  return n;
};

export function reportRoutes(x: Express, app: AppContext) {
  const dto = (r: ReportRow) => ({
    id: r.id, event_id: r.event_id, kind: r.kind, format: r.format, include_identity: r.include_identity, state: r.state, requested_by: r.requested_by ?? r.id, created_at: r.created_at.toISOString(),
    download_url: app.reportExports.downloadUrl(r),
  });
  const eventOr404 = async (id: string) => {
    const e = await app.repos.events.byId(id);
    if (!e) throw new ContractError("NOT_FOUND");
    return e;
  };

  mount(x, app, endpoints.listReports, async ({ query }) => {
    const offset = offsetOf(query.cursor);
    const rows = await app.repos.reports.list({ offset, limit: query.limit + 1 });
    return { items: rows.slice(0, query.limit).map(dto), next_cursor: rows.length > query.limit ? String(offset + query.limit) : null };
  });

  mount(x, app, endpoints.eventReports, async ({ params }) => {
    const e = await eventOr404(params.eventId);
    return { items: (await app.repos.reports.list({ eventId: e.id, offset: 0, limit: 200 })).map(dto) };
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
    return dto(row);
  });

  mount(x, app, endpoints.postEventSummary, async ({ params }) => {
    const e = await eventOr404(params.id);
    const s = toSummaryDto(await loadSummary(app, e.id));
    return { ...s, downloads: (await app.repos.reports.list({ eventId: e.id, offset: 0, limit: 50 })).map(dto) };
  });

  // The signed link itself is the authorisation: no bearer token (a browser download carries none).
  x.get(`${API_BASE_PATH}/report-files/:id`, async (req, res, next) => {
    try {
      const { key, exp, sig } = req.query as Record<string, string | undefined>;
      const ok = key && exp && sig ? app.reportExports.verify(req.params.id, key, exp, sig) : null;
      if (!ok) return void res.status(403).json({ error: { code: "FORBIDDEN", message: "This download link is invalid or has expired." } });
      const data = await app.reportExports.read(ok);
      if (!data) return void res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found." } });
      const ext = (ok.split(".").pop() ?? "csv") as keyof typeof CONTENT_TYPE;
      res.setHeader("Content-Type", CONTENT_TYPE[ext] ?? "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="report-${req.params.id}.${ext}"`);
      res.status(200).send(data);
    } catch (e) {
      next(e);
    }
  });
  void express;
}
