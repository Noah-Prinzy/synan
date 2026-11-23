/** Staff, reports, dashboard (02 §5). */
import { z } from "zod";
import { Email, Id, IsoDateTime, pageOf, PageQuery } from "../common.js";
import { ReportKind, ReportState, Role } from "../enums/index.js";
import { ADMIN_ONLY, endpoint, IdParam, OPERATORS } from "./endpoint.js";

export const StaffMember = z.object({
  id: Id,
  email: Email,
  role: Role,
  mfa_enrolled: z.boolean(),
});
export const StaffAssignment = z.object({
  id: Id,
  user_id: Id,
  checkpoint_id: Id,
  shift_start: IsoDateTime,
  shift_end: IsoDateTime,
});
export type StaffAssignment = z.infer<typeof StaffAssignment>;
export const CreateStaffAssignment = StaffAssignment.omit({ id: true });

export const EventReportRow = z.object({
  id: Id,
  event_id: Id,
  kind: ReportKind,
  state: ReportState,
  requested_by: Id,
  created_at: IsoDateTime,
  /** Signed short-lived link once state=ready. */
  download_url: z.url().nullable(),
});
export const ReportData = z.object({
  event_id: Id,
  kind: ReportKind,
  columns: z.array(z.string()),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
  next_cursor: z.string().nullable(),
});
export const ExportRequest = z.object({ format: z.enum(["csv", "pdf"]).default("csv") });

export const Dashboard = z.object({
  live_events: z.number().int(),
  on_site: z.number().int(),
  open_alerts: z.number().int(),
  gates_offline: z.number().int(),
  as_of: IsoDateTime,
});

export const staffEndpoints = {
  listStaff: endpoint({ method: "GET", path: "/staff", access: ADMIN_ONLY, query: PageQuery, response: pageOf(StaffMember) }),
  listAssignments: endpoint({ method: "GET", path: "/staff-assignments", access: OPERATORS, query: PageQuery.extend({ checkpoint_id: Id.optional(), user_id: Id.optional() }), response: pageOf(StaffAssignment) }),
  createAssignment: endpoint({ method: "POST", path: "/staff-assignments", access: ADMIN_ONLY, audited: true, body: CreateStaffAssignment, response: StaffAssignment, status: 201 }),
} as const;

export const reportEndpoints = {
  listReports: endpoint({ method: "GET", path: "/reports", access: OPERATORS, query: PageQuery, response: pageOf(EventReportRow) }),
  eventReports: endpoint({ method: "GET", path: "/reports/:eventId", access: OPERATORS, params: z.object({ eventId: Id }), response: z.object({ items: z.array(EventReportRow) }) }),
  reportData: endpoint({ method: "GET", path: "/reports/:eventId/:kind", access: OPERATORS, params: z.object({ eventId: Id, kind: ReportKind }), query: PageQuery, response: ReportData }),
  /** `:id` is the event id (02 §5 says `:id`; an export creates an event_reports row). */
  exportReport: endpoint({ method: "POST", path: "/reports/:id/export", access: OPERATORS, mfa: true, audited: true, params: IdParam, body: ExportRequest.extend({ kind: ReportKind }), response: EventReportRow, status: 202 }),
  dashboard: endpoint({ method: "GET", path: "/dashboard", access: OPERATORS, response: Dashboard }),
} as const;
