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
import { ArrowUpRight, FileSpreadsheet } from "lucide-react";
import { ActionButton, Button, Field, Select, buttonClass, cn } from "@synan/ui/components";
import { SignalShape, formatNumber } from "@synan/ui/data";
import { EXPORT_FORMAT_LABEL, REPORT_KIND_LABEL } from "@synan/contracts/copy";
import type { ReportKind } from "@synan/contracts/enums";
import type { ExportFormat, ReportRow } from "@synan/mock/command";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Notice,
  SectionHead,
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
    <div className="pb-8">
      <div className="grid grid-cols-12 border-b border-border">
        <section aria-labelledby="reports-export" className="col-span-12 min-w-0 xl:col-span-8">
          <SectionHead id="reports-export" title="Export" meta="exports ask for your second factor" />
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
            <div className="flex min-w-0 items-start gap-3">
              <FileSpreadsheet size={16} strokeWidth={1.5} aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <h3 className="text-15 font-medium">Excel workbook</h3>
                <p className="max-w-120 text-12 text-muted-foreground">
                  The whole event: a summary sheet, one sheet per report, and an attendee sheet for operators allowed to see
                  identity. Real number and date cells, frozen headers.
                </p>
              </div>
            </div>
            <ActionButton
              action={() => start("xlsx")}
              doneLabel="Queued"
              variant={tabPrimary ? "primary" : "quiet"}
              size="compact"
              disabled={workbookBusy}
            >
              Prepare workbook
            </ActionButton>
          </div>
          <div className="border-b border-border px-4 py-4 sm:px-6">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="CSV per report" className="w-full max-w-80">
                <Select
                  options={KINDS.map((k) => ({ value: k, label: REPORT_KIND_LABEL[k] }))}
                  value={kind}
                  onChange={setKind}
                />
              </Field>
              <ActionButton action={() => start("csv", kind)} doneLabel="Queued" variant="quiet" size="compact" className="ml-auto">
                Prepare CSV
              </ActionButton>
            </div>
            <p className="mt-1.5 text-12 text-muted-foreground">{REPORT_DETAIL[kind]}. For other tools.</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <div className="min-w-0">
              <h3 className="text-13 font-medium">PDF summary</h3>
              <p className="text-12 text-muted-foreground">The headline figures on one page, for people who will not open a spreadsheet.</p>
            </div>
            <ActionButton action={() => start("pdf")} doneLabel="Queued" variant="quiet" size="compact">
              Prepare PDF
            </ActionButton>
          </div>
          {noData ? (
            <Notice className="mx-4 mb-4 sm:mx-6">
              This event has not opened yet, so exports hold its registrations and nothing more. They fill in once people check in.
            </Notice>
          ) : null}
          {problem ? (
            <Notice tone="danger" className="mx-4 mb-4 sm:mx-6">
              {problem}
            </Notice>
          ) : null}
        </section>
        <aside aria-labelledby="reports-onscreen" className="col-span-12 min-w-0 border-t border-border xl:col-span-4 xl:border-t-0 xl:border-l">
          <SectionHead id="reports-onscreen" title="On screen" />
          <div className="px-4 py-3">
            <p className="text-13 text-muted-foreground">
              The event summary shows how the event went on one page: headline figures, attendance by tier, the occupancy curve,
              the busiest rooms and gates, and how fast alerts were handled.
            </p>
            <Link to={`/events/${event.id}/summary`} className={cn(buttonClass("secondary", "compact"), "mt-3")}>
              Open the event summary
              <ArrowUpRight size={14} strokeWidth={1.5} aria-hidden="true" />
            </Link>
          </div>
          <ul className="border-t border-border py-1">
            {KINDS.map((k) => (
              <li key={k} className="px-4 py-1.5 text-13">
                {REPORT_KIND_LABEL[k]}
                <span className="block text-12 text-muted-foreground">{REPORT_DETAIL[k]}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <section aria-labelledby="reports-jobs">
        <SectionHead
          id="reports-jobs"
          title="Prepared exports"
          meta={
            rows.length > 0 ? (
              <>
                <span className="font-mono tabular-nums">{formatNumber(rows.length)}</span> · links expire shortly after they are made
              </>
            ) : undefined
          }
        />
        {jobs.status === "loading" ? <LoadingState label="Loading exports…" rows={3} /> : null}
        {jobs.status === "error" ? <ErrorState title="Could not load the exports" error={jobs.error} onRetry={() => jobs.reload()} /> : null}
        {jobs.status === "ready" && rows.length === 0 ? (
          <EmptyState title="No reports generated yet">
            Prepare the workbook, a CSV or the PDF above. Each export runs in the background and appears here with a download
            link when it is ready; you can leave this page meanwhile.
          </EmptyState>
        ) : null}
        {jobs.status === "ready" && rows.length > 0 ? (
          <Table label="Prepared exports">
            <thead>
              <tr>
                <Th>Export</Th>
                <Th>Requested</Th>
                <Th className="w-64">State</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={rowClass}>
                  <Td className="whitespace-nowrap">{jobName(row)}</Td>
                  <Td className="font-mono text-12 whitespace-nowrap tabular-nums">{formatStamp(row.created_at, event.timezone)}</Td>
                  <Td>
                    <JobState row={row} />
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    {row.state === "failed" ? (
                      <Button variant="quiet" size="compact" onClick={() => void start(row.format, row.format === "csv" ? (row.kind ?? undefined) : undefined).catch(() => undefined)}>
                        Prepare again
                      </Button>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}
      </section>
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
        <span className="text-12">{row.state === "queued" ? "Queued" : "Preparing…"}</span>
        <span className="relative mt-1 block h-px w-full max-w-48 overflow-hidden bg-border">
          <span aria-hidden="true" className="animate-skeleton-sweep absolute inset-y-0 w-1/3 bg-foreground/60" />
        </span>
      </span>
    );
  }
  if (row.state === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-12 text-destructive">
        <SignalShape state="stop" /> Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-12">
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
