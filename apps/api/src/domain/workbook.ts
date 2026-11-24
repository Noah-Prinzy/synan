/**
 * The event workbook (D-21) and the one-page PDF summary.
 *
 * Workbook: @synan/db's withWorkbookData (or its in-memory mirror) yields eleven sheets in one
 * snapshot; each chunk is written straight into the streaming .xlsx writer inside the callback, and
 * nothing slow (storage) happens until the callback has returned. Typed cells, frozen header row,
 * widths, a totals row where columns sum. Text is always written as text (lib/xlsx.ts).
 *
 * PDF: built from the same summary data with lib/pdf.ts; no timestamp of generation is printed, so
 * the document reads the same before and after the purge except for the purge line itself.
 */
import type { AppContext } from "../app.js";
import { PdfDocument } from "../lib/pdf.js";
import { XlsxWriter, type XCell } from "../lib/xlsx.js";
import type { DbPostEventSummary, ReportRow } from "../repo/types.js";
import { loadSummary } from "./post-event.js";

export async function buildWorkbook(app: AppContext, job: ReportRow): Promise<Buffer> {
  const w = new XlsxWriter();
  await app.repos.reports.workbook(job.event_id, { includeIdentity: job.include_identity, now: new Date(app.clock.now()) }, async (wb) => {
    for (const sheet of wb.sheets) {
      const widths = sheet.columns.map((c) => (c.type === "datetime" ? 18 : c.type === "text" ? Math.max(14, Math.min(40, c.header.length + 6)) : Math.max(10, c.header.length + 2)));
      w.sheet(sheet.name, sheet.columns.map((c) => c.header), widths);
      const sums = sheet.columns.map(() => 0);
      let any = false;
      for await (const chunk of sheet.rows()) {
        for (const row of chunk) {
          any = true;
          w.row(row.map((v, i) => {
            const c = sheet.columns[i]!;
            if (v === null || v === undefined) return null;
            if (c.type === "number") {
              const n = Number(v);
              if (c.total === "sum") sums[i]! += n;
              return n;
            }
            if (c.type === "datetime") return v instanceof Date ? v : new Date(String(v));
            if (c.type === "boolean") return Boolean(v);
            return String(v);
          }) as XCell[]);
        }
      }
      if (any && sheet.columns.some((c) => c.total === "sum")) {
        w.row(sheet.columns.map((c, i) => (i === 0 ? "Total" : c.total === "sum" ? sums[i]! : null)), 3);
      }
    }
  });
  return w.finish(); // after the snapshot is released
}

const when = (d: Date | null, tz: string) => (d ? `${d.toISOString().slice(0, 16).replace("T", " ")} UTC` : "-") + (tz ? "" : "");

export function summaryPdf(s: DbPostEventSummary): Buffer {
  const doc = new PdfDocument();
  const p = doc.page();
  const h = s.headline;
  let y = 56;
  p.text(48, y, s.event.title, 18, true);
  y += 20;
  const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? "date not set";
  p.text(48, y, `${day(s.event.starts_at)} to ${day(s.event.ends_at)} (${s.event.timezone})${s.provisional ? "   PROVISIONAL" : ""}`, 9);
  y += 30;
  const cells: [string, string][] = [
    ["Registered", String(h.registered)], ["Checked in", String(h.checked_in)], ["No-shows", String(h.no_shows)],
    ["Peak on site", `${h.peak_on_site}`], ["Rooms at capacity", String(h.rooms_at_capacity)], ["Alerts raised", String(h.alerts_total)],
  ];
  cells.forEach(([k, v], i) => {
    const x = 48 + (i % 3) * 170;
    const yy = y + Math.floor(i / 3) * 42;
    p.text(x, yy, k, 8);
    p.text(x, yy + 18, v, 16, true);
  });
  y += 96;
  p.text(48, y, `Peak on site at ${when(h.peak_on_site_at, "")}`, 8);

  y += 28;
  p.text(48, y, "Attendance by tier", 11, true);
  y += 16;
  const maxReg = Math.max(1, ...s.attendance_by_tier.map((t) => t.registered));
  for (const t of s.attendance_by_tier) {
    p.text(48, y, t.tier, 9);
    p.rect(150, y - 8, (260 * t.registered) / maxReg, 8, 0.85);
    p.rect(150, y - 8, (260 * t.checked_in) / maxReg, 8, 0.45);
    p.text(420, y, `${t.checked_in} of ${t.registered} checked in, ${t.no_shows} no-shows`, 8);
    y += 14;
  }

  y += 18;
  p.text(48, y, "On site (5-minute buckets)", 11, true);
  y += 10;
  const pts = s.onsite_curve.points;
  const chart = { x: 48, y, w: 500, h: 110 };
  p.line([[chart.x, chart.y + chart.h], [chart.x + chart.w, chart.y + chart.h]], 0.5);
  if (pts.length) {
    const t0 = pts[0]!.t.getTime();
    const t1 = Math.max(t0 + 1, pts.at(-1)!.t.getTime());
    const max = Math.max(1, ...pts.map((q) => q.on_site));
    p.line(pts.map((q) => [chart.x + ((q.t.getTime() - t0) / (t1 - t0)) * chart.w, chart.y + chart.h - (q.on_site / max) * chart.h]), 1.2);
    p.text(chart.x + chart.w - 90, chart.y + 8, `peak ${max}`, 8);
  } else {
    p.text(chart.x + 8, chart.y + 60, "No occupancy recorded.", 9);
  }
  y += chart.h + 30;

  const table = (title: string, rowsIn: string[][], x: number) => {
    let yy = y;
    p.text(x, yy, title, 11, true);
    yy += 16;
    for (const r of rowsIn) {
      p.text(x, yy, r[0]!.slice(0, 32), 9);
      p.text(x + 170, yy, r[1]!, 9);
      yy += 13;
    }
    return yy;
  };
  const a = table("Busiest rooms", s.busiest_rooms.map((r) => [r.name, `${r.peak} / ${r.capacity}`]), 48);
  const b = table("Busiest gates", s.busiest_gates.map((g) => [g.label, `${g.scans} scans, ${g.denied} refused`]), 310);
  y = Math.max(a, b) + 18;
  p.text(48, y, "Alerts", 11, true);
  y += 16;
  const sev = h.alerts_by_severity;
  p.text(48, y, `Critical ${sev.critical}   High ${sev.high}   Medium ${sev.medium}   Low ${sev.low}`, 9);
  y += 14;
  p.text(48, y, `Median time to acknowledge: ${h.ack_median_s ?? "-"} s   Median time to resolve: ${h.resolve_median_s ?? "-"} s`, 9);
  y += 26;
  p.text(48, y, s.purge.purged_at ? `Individual scan records for this event were deleted on ${s.purge.purged_at.toISOString().slice(0, 10)}.` : "Individual scan records are still held.", 8);
  return doc.toBuffer(s.event.title);
}

export async function buildSummaryPdf(app: AppContext, job: ReportRow): Promise<Buffer> {
  return summaryPdf(await loadSummary(app, job.event_id));
}
