/**
 * D6.7 · Reports `/events/:id/reports` (docs/06 §2.3; docs/01 §10 P-14). Exports for this event
 * and their jobs. The Excel workbook for the whole event is the primary download; a CSV per
 * report and the PDF summary sit beside it. Export is an asynchronous job: a new job appears in
 * the list at once and shows its progress in place (queued, preparing, ready, failed); the list
 * is polled only while a job is in progress. The on-screen summary is D13c, linked from here.
 *
 * States: loading, error with retry, no reports yet, a job in progress, a job failed.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { ActionButton, Field, Select, buttonClass, cn } from "@synan/ui/components";
import { SignalShape } from "@synan/ui/data";
import { EXPORT_FORMAT_LABEL, REPORT_KIND_LABEL } from "@synan/contracts/copy";
import type { ReportKind } from "@synan/contracts/enums";
import type { ExportFormat, ReportRow } from "@synan/mock/command";
import {
  ErrorState,
  LoadingState,
  Notice,
  ROW_ACTION,
  SPLIT,
  SectionHead,
  TYPE,
  Table,
  Td,
  Th,
  errorCopy,
  formatStamp,
  rowClass,
  useDocumentTitle,
  useResource,
} from "../kit";
import { api } from "../live/backend";
import { useWorkspaceEvent } from "./parts/context";
import { HEAD_BLEED, RAIL_X } from "./parts/layout";
import { ExpiredState } from "../summary/downloads";

/** One export row: what it is on the left, its control on the right, on the page gutter. */
const EXPORT_ROW = "flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-b border-border px-4 py-5 sm:px-6 2xl:px-8";
/** The prepare buttons share one width, so they read as a column. */
const PREPARE = "min-w-40";

const KINDS = Object.keys(REPORT_KIND_LABEL) as ReportKind[];

const REPORT_DETAIL: Record<ReportKind, string> = {
  attendance: "Registered, checked in and no-shows, by tier",
  dwell_flow: "Time spent per zone and movement between zones, in aggregate",
  peak_occupancy: "Highest occupancy per room, and when",
  breach_compliance: "Alerts by kind and severity, time to acknowledge and resolve",
  gate_throughput: "Scans per gate over time, with the refusals broken down",
};

function pending(row: ReportRow): boolean {
  return row.state === "queued" || row.state === "running";
}

function jobName(row: ReportRow): string {
  if (row.format === "csv") return `CSV · ${row.kind ? REPORT_KIND_LABEL[row.kind] : "Report"}`;
  return EXPORT_FORMAT_LABEL[row.format];
}

export default function WorkspaceReports() {
  const { event, tabPrimary } = useWorkspaceEvent();
  useDocumentTitle(`Reports · ${event.title || "Untitled event"}`);
  const jobs = useResource(() => api.reports(event.id), [event.id]);
  const [kind, setKind] = useState<ReportKind>("attendance");
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState("");

  const rows = jobs.status === "ready" ? jobs.data : [];
  const inProgress = rows.some(pending);
  const { reload } = jobs;

  // Poll only while something is being prepared; stop as soon as nothing is.
  useEffect(() => {
    if (!inProgress) return;
    const timer = window.setInterval(() => reload(true), 1000);
    return () => window.clearInterval(timer);
  }, [inProgress, reload]);

  // Say when a job finishes, for screen readers.
  const readyCount = rows.filter((r) => r.state === "ready").length;
  const [seenReady, setSeenReady] = useState<number | null>(null);
  useEffect(() => {
    if (jobs.status !== "ready") return;
    if (seenReady !== null && readyCount > seenReady) setSaid("An export is ready to download.");
    setSeenReady(readyCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyCount, jobs.status]);

  const start = async (format: ExportFormat, reportKind?: ReportKind) => {
    setProblem(null);
    try {
      const row = await api.exportReport(event.id, { format, kind: reportKind });
      jobs.set((current) => [row, ...current.filter((r) => r.id !== row.id)]);
      setSaid(`${jobName(row)} queued.`);
    } catch (error) {
      const copy = errorCopy(error);
      setProblem(`${copy.title}. ${copy.message}`);
      throw error;
    }
  };

  const noData = event.state === "draft" || event.state === "published";
  const workbookBusy = rows.some((r) => r.format === "xlsx" && pending(r));

  return (
    <div className="pb-10">
      <div className={SPLIT}>
        <div className="min-w-0">
        <section aria-labelledby="reports-export">
          <SectionHead id="reports-export" title="Export" meta="exports ask for your second factor" className={HEAD_BLEED} />
          <div className={EXPORT_ROW}>
            <div className="min-w-0 flex-1 basis-80">
              <h3 className="text-15 font-medium">Excel workbook</h3>
              <p className="mt-1 max-w-[60ch] text-12 leading-relaxed text-muted-foreground">
                The whole event: a summary sheet, one sheet per report, and an attendee sheet for operators allowed to see
                identity. Real number and date cells, frozen headers.
              </p>
            </div>
            <ActionButton
              action={() => start("xlsx")}
              doneLabel="Queued"
              variant={tabPrimary ? "primary" : "quiet"}
              size="compact"
              disabled={workbookBusy}
              className={PREPARE}
            >
              Prepare workbook
            </ActionButton>
          </div>
          <div className={EXPORT_ROW}>
            <div className="min-w-0 flex-1 basis-80">
              <Field label={<span className="text-13 font-medium text-foreground">CSV per report</span>} className="max-w-80">
                <Select
                  options={KINDS.map((k) => ({ value: k, label: REPORT_KIND_LABEL[k] }))}
                  value={kind}
                  onChange={setKind}
                />
              </Field>
              <p className="mt-2 text-12 text-muted-foreground">{REPORT_DETAIL[kind]}. For other tools.</p>
            </div>
            <ActionButton action={() => start("csv", kind)} doneLabel="Queued" variant="quiet" size="compact" className={PREPARE}>
              Prepare CSV
            </ActionButton>
          </div>
          <div className={EXPORT_ROW}>
            <div className="min-w-0 flex-1 basis-80">
              <h3 className="text-13 font-medium">PDF summary</h3>
              <p className="mt-1 text-12 text-muted-foreground">The headline figures on one page, for people who will not open a spreadsheet.</p>
            </div>
            <ActionButton action={() => start("pdf")} doneLabel="Queued" variant="quiet" size="compact" className={PREPARE}>
              Prepare PDF
            </ActionButton>
          </div>
          {noData || problem ? (
            <div className="flex flex-col gap-3 px-4 py-4 sm:px-6 2xl:px-8">
              {noData ? (
                <Notice>
                  This event has not opened yet, so exports hold its registrations and nothing more. They fill in once people check in.
                </Notice>
              ) : null}
              {problem ? <Notice tone="danger">{problem}</Notice> : null}
            </div>
          ) : null}
        </section>

        <section aria-labelledby="reports-jobs" className="mt-8 border-t border-border">
          <SectionHead
            id="reports-jobs"
            title="Prepared exports"
            className={HEAD_BLEED}
            meta={rows.length > 0 ? "links expire shortly after they are made" : undefined}
          />
          {jobs.status === "loading" ? <LoadingState label="Loading exports…" rows={3} /> : null}
          {jobs.status === "error" ? <ErrorState title="Could not load the exports" error={jobs.error} onRetry={() => jobs.reload()} /> : null}
          {jobs.status === "ready" && rows.length === 0 ? (
            <p className="max-w-[68ch] px-4 py-6 text-13 leading-relaxed text-muted-foreground sm:px-6 2xl:px-8">
              <span className="text-foreground">Nothing prepared yet.</span> Each export runs in the background and appears here with
              a download link when it is ready; you can leave this page meanwhile.
            </p>
          ) : null}
          {jobs.status === "ready" && rows.length > 0 ? (
            <Table label="Prepared exports">
              <thead>
                <tr>
                  <Th>Export</Th>
                  <Th fit>Requested</Th>
                  <Th className="w-56">State</Th>
                  <Th fit>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={rowClass}>
                    <Td className="max-w-64 truncate">{jobName(row)}</Td>
                    <Td fit className={TYPE.value}>{formatStamp(row.created_at, event.timezone)}</Td>
                    <Td>
                      <JobState row={row} />
                    </Td>
                    <Td fit className="text-right">
                      {row.state === "failed" || row.expired_at ? (
                        <button
                          type="button"
                          className={cn(ROW_ACTION, "-mr-2.5")}
                          onClick={() => void start(row.format, row.format === "csv" ? (row.kind ?? undefined) : undefined).catch(() => undefined)}
                        >
                          Prepare again
                        </button>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : null}
        </section>
        </div>
        <aside aria-labelledby="reports-onscreen" className="min-w-0 border-t border-border lg:border-t-0 lg:border-l">
          <SectionHead id="reports-onscreen" title="On screen" />
          <div className={cn("py-4", RAIL_X)}>
            <p className="text-13 leading-relaxed text-muted-foreground">
              The event summary shows how the event went on one page: headline figures, attendance by tier, the occupancy curve,
              the busiest rooms and gates, and how fast alerts were handled.
            </p>
            <Link to={`/events/${event.id}/summary`} className={cn(buttonClass("secondary", "compact"), "mt-4")}>
              Open the event summary
              <ArrowUpRight size={16} strokeWidth={1.5} aria-hidden="true" />
            </Link>
          </div>
          <h3 className={cn("border-t border-border pt-4 pb-1 text-12 text-muted-foreground", RAIL_X)}>What each report holds</h3>
          <ul className="pb-3">
            {KINDS.map((k) => (
              <li key={k} className={cn("py-2 text-13", RAIL_X)}>
                {REPORT_KIND_LABEL[k]}
                <span className="block text-12 text-muted-foreground">{REPORT_DETAIL[k]}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {said}
      </p>
    </div>
  );
}

function JobState({ row }: { row: ReportRow }) {
  if (pending(row)) {
    return (
      <span className="block">
        <span className="text-13">{row.state === "queued" ? "Queued" : "Preparing…"}</span>
        <span className="relative mt-1 block h-px w-full max-w-48 overflow-hidden bg-border">
          <span aria-hidden="true" className="animate-skeleton-sweep absolute inset-y-0 w-1/3 bg-foreground/60" />
        </span>
      </span>
    );
  }
  if (row.state === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-13 text-destructive">
        <SignalShape state="stop" /> Failed
      </span>
    );
  }
  // Retention deleted the file (03 §6): nothing to download, and nothing pretends otherwise.
  if (row.expired_at) return <ExpiredState />;
  return (
    <span className="inline-flex items-center gap-1.5 text-13">
      <SignalShape state="ok" className="text-success" />
      {row.download_url ? (
        <a href={row.download_url} className="underline decoration-border underline-offset-4 hover:decoration-brand">
          Download
        </a>
      ) : (
        <span title="The mock builds no file; the API returns a signed, short-lived link here.">Ready (mock: no file)</span>
      )}
    </span>
  );
}
