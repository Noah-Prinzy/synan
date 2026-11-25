/**
 * Downloads (D13c, D-21): the Excel workbook first, then a CSV per report and the PDF
 * summary. Export is an async job (P-14): starting one creates a report row, and the row
 * shows its progress in place — queued, preparing, ready — polled from GET /reports/:eventId.
 *
 * Export is a privileged action (03 §3): the API asks for the second factor, and the console
 * prompt (access/step-up.tsx) asks for the code and retries; the mock accepts without it.
 */
import { useEffect, useRef, useState } from "react";
import type { ReportKind } from "@synan/contracts/enums";
import type { PostEventSummary } from "@synan/contracts/rest";
import { buttonClass, cn } from "@synan/ui/components";
import { SignalShape, formatClock } from "@synan/ui/data";
import { GUTTER_X, ROW_ACTION, SectionHead } from "../kit";
import { api } from "../live/backend";
import { HEAD_BLEED } from "../workspace/parts/layout";
import { REPORT_LABEL } from "./copy";

type Row = PostEventSummary["downloads"][number];
type Format = Row["format"];

interface Item {
  key: string;
  format: Format;
  kind?: ReportKind;
  title: string;
  detail: string;
}

const ITEMS: Item[] = [
  { key: "xlsx", format: "xlsx", title: "Excel workbook", detail: "A summary sheet, one sheet per report, real number and date cells" },
  ...(Object.keys(REPORT_LABEL) as ReportKind[]).map((kind) => ({
    key: `csv:${kind}`,
    format: "csv" as const,
    kind,
    title: `CSV · ${REPORT_LABEL[kind]}`,
    detail: "For other tools",
  })),
  { key: "pdf", format: "pdf", title: "PDF summary", detail: "The headline figures on one page" },
];

function matches(item: Item, row: Row): boolean {
  if (row.format !== item.format) return false;
  return item.format !== "csv" || row.kind === item.kind;
}

export function Downloads({
  eventId,
  initial,
  provisional,
  timeZone,
}: {
  eventId: string;
  initial: Row[];
  provisional: boolean;
  timeZone: string;
}) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [starting, setStarting] = useState<string | null>(null);
  const pending = rows.some((r) => r.state === "queued" || r.state === "running");
  const timer = useRef<number | null>(null);

  useEffect(() => setRows(initial), [initial]);

  // Poll only while something is being prepared.
  useEffect(() => {
    if (!pending) return;
    timer.current = window.setInterval(() => {
      api.reports(eventId).then(setRows, () => undefined);
    }, 750);
    return () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    };
  }, [pending, eventId]);

  const start = async (item: Item) => {
    setStarting(item.key);
    try {
      const row = await api.exportReport(eventId, { format: item.format, kind: item.kind });
      setRows((current) => [row, ...current.filter((r) => r.id !== row.id)]);
    } finally {
      setStarting(null);
    }
  };

  return (
    <section aria-labelledby="sum-downloads" className="">
      <SectionHead
        id="sum-downloads"
        title="Downloads"
        meta={`${provisional ? "Exports of a live event hold the figures so far · " : ""}exports ask for your second factor`}
        className={HEAD_BLEED}
      />
      <ul>
        {ITEMS.map((item, index) => {
          const latest = rows.find((row) => matches(item, row));
          const primary = index === 0;
          return (
            <li
              key={item.key}
              className={cn(
                "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,1fr)_16rem_auto]",
                GUTTER_X,
                primary ? "py-5" : "min-h-12 py-2",
              )}
            >
              <span className="min-w-0">
                <span className={cn("block truncate", primary ? "text-15 font-medium" : "text-13")}>{item.title}</span>
                {primary ? <span className="mt-1 block text-12 text-muted-foreground">{item.detail}</span> : null}
              </span>
              <span className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:row-start-auto">
                <JobState row={latest} timeZone={timeZone} />
              </span>
              <button
                type="button"
                onClick={() => void start(item)}
                disabled={starting === item.key || latest?.state === "queued" || latest?.state === "running"}
                className={primary ? buttonClass("primary", "compact", "min-w-36 justify-self-end") : cn(ROW_ACTION, "-mr-2.5 justify-self-end")}
              >
                {latest?.state === "ready" ? "Prepare again" : primary ? "Prepare workbook" : "Prepare"}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function JobState({ row, timeZone }: { row: Row | undefined; timeZone: string }) {
  if (!row) return <span className="text-13 text-muted-foreground">Not prepared</span>;
  if (row.state === "queued" || row.state === "running") {
    return (
      <span role="status" className="block">
        <span className="text-13">{row.state === "queued" ? "Queued" : "Preparing…"}</span>
        <span className="relative mt-1 block h-px w-full max-w-48 overflow-hidden bg-surface-3">
          <span aria-hidden="true" className="animate-skeleton-sweep absolute inset-y-0 w-1/3 bg-foreground/60" />
        </span>
      </span>
    );
  }
  if (row.state === "failed") {
    return (
      <span className="flex items-center gap-2 text-13 text-destructive">
        <SignalShape state="stop" /> Failed — prepare again
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 text-13">
      <SignalShape state="ok" className="text-success" />
      {row.download_url ? (
        <a href={row.download_url} className="underline decoration-foreground/30 underline-offset-4 hover:decoration-brand">
          Download
        </a>
      ) : (
        <span title="The mock builds no file; the API returns a signed, short-lived link here.">Ready (mock: no file)</span>
      )}
      <span className="font-mono text-12 text-muted-foreground tabular-nums">{formatClock(row.created_at, timeZone, { seconds: false })}</span>
    </span>
  );
}
