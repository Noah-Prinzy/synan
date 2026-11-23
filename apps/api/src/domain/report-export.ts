/**
 * Report export (01 §10, D-21): an asynchronous job writes the whole-event workbook (.xlsx), one
 * report as CSV, or the one-page PDF summary to encrypted storage, and the row becomes `ready`.
 *
 * Downloads use a signed, short-lived link: HMAC over (report id, object key, expiry). The link key
 * is derived from the database package's keyed-digest key, so links survive a restart within their
 * lifetime and cannot be forged, altered to another object, or used after they expire. Files are
 * deleted by the retention job (default 7 days). CSV cells are neutralised against formula injection.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { API_BASE_PATH } from "@synan/contracts/common";
import type { Cipher } from "@synan/db";
import type { AppContext } from "../app.js";
import type { Config } from "../config.js";
import type { Clock } from "../lib/clock.js";
import type { ObjectStorage } from "../lib/storage.js";
import { REPORT_SECTION_NAMES, type ReportCell, type ReportRow, type Repos } from "../repo/types.js";
import { buildSummaryPdf, buildWorkbook } from "./workbook.js";

function csvCell(v: ReportCell): string {
  if (v === null) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CONTENT_TYPE = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  pdf: "application/pdf",
} as const;

export class ReportExporter {
  private readonly key: Buffer;
  private draining: Promise<void> | null = null;
  /** Set by the app after construction (workbook and summary read through the app). */
  app: AppContext | null = null;

  constructor(
    private readonly repos: Repos,
    private readonly storage: ObjectStorage,
    private readonly config: Config,
    private readonly clock: Clock,
    cipher: Cipher,
  ) {
    // Stable across restarts and instances; secret because it is keyed by the blind-index key.
    this.key = Buffer.from(cipher.keyedDigest("report_link_key", "v1"), "base64url");
  }

  private mac(id: string, key: string, exp: number) {
    return createHmac("sha256", this.key).update(`${id}\n${key}\n${exp}`).digest("base64url");
  }

  /** A signed link valid for `ttlS` (default `reportLinkTtlS`); null unless the report is ready. */
  downloadUrl(r: { id: string; state: string; object_key: string | null }, ttlS = this.config.reportLinkTtlS): string | null {
    if (r.state !== "ready" || !r.object_key) return null;
    const exp = Math.floor(this.clock.now() / 1000) + ttlS;
    const q = new URLSearchParams({ key: r.object_key, exp: String(exp), sig: this.mac(r.id, r.object_key, exp) });
    return `${this.config.publicApiOrigin}${API_BASE_PATH}/report-files/${r.id}?${q}`;
  }

  /** The object key if the link is genuine and unexpired, else null. */
  verify(id: string, key: string, exp: string, sig: string): string | null {
    const e = Number(exp);
    if (!Number.isInteger(e) || e * 1000 <= this.clock.now()) return null;
    const want = Buffer.from(this.mac(id, key, e));
    const got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got) ? key : null;
  }

  async read(key: string) {
    return this.storage.get(key);
  }

  /** Run every queued export once. Concurrent calls share one run. */
  drain(): Promise<void> {
    this.draining ??= this.run().finally(() => (this.draining = null));
    return this.draining;
  }

  /**
   * Builds queued exports until this one is no longer queued (another worker may hold it running),
   * and returns its row.
   */
  async buildNow(eventId: string, reportId: string): Promise<ReportRow> {
    const find = async () => (await this.repos.reports.list({ eventId, offset: 0, limit: 50 })).find((r) => r.id === reportId);
    for (let i = 0; i < 3; i++) {
      await this.drain();
      const r = await find();
      if (!r) throw new Error("report missing");
      if (r.state !== "queued") return r;
    }
    return (await find())!;
  }

  private async csv(job: ReportRow): Promise<Buffer> {
    const lines: string[] = [];
    for (const section of REPORT_SECTION_NAMES[job.kind!]) {
      let cursor: string | null = null;
      let header = false;
      do {
        const page = await this.repos.reports.run(job.kind!, job.event_id, { section, cursor, limit: 1000 });
        if (!header) {
          lines.push(["section", ...page.columns].map(csvCell).join(","));
          header = true;
        }
        for (const row of page.rows) lines.push([section, ...row].map(csvCell).join(","));
        cursor = page.next_cursor;
      } while (cursor);
    }
    return Buffer.from(lines.join("\r\n") + "\r\n", "utf8");
  }

  private async run() {
    for (;;) {
      const job = await this.repos.reports.claim(new Date(this.clock.now()));
      if (!job) return;
      try {
        const data = job.format === "xlsx" ? await buildWorkbook(this.app!, job) : job.format === "pdf" ? await buildSummaryPdf(this.app!, job) : await this.csv(job);
        const key = `reports/${job.event_id}/${job.id}.${job.format}`;
        await this.storage.put(key, data, CONTENT_TYPE[job.format]);
        await this.repos.reports.complete(job.id, key, new Date(this.clock.now()));
      } catch (e) {
        await this.repos.reports.fail(job.id, e instanceof Error ? e.message : "export failed", new Date(this.clock.now()));
      }
    }
  }

  /** Retention: delete stored export files (reports and data exports) older than the retention period. Audited. */
  async deleteExpired(): Promise<number> {
    const cutoff = this.clock.now() - this.config.exportRetentionDays * 86_400_000;
    let n = 0;
    for (let offset = 0; ; offset += 500) {
      const rows = await this.repos.reports.list({ offset, limit: 500 });
      for (const r of rows) {
        if (r.state !== "ready" || !r.object_key || !r.completed_at || r.completed_at.getTime() > cutoff) continue;
        if (!(await this.storage.get(r.object_key))) continue;
        await this.storage.delete(r.object_key);
        await this.app!.audit.append({ actorId: null, action: "report.file_delete", target: `report:${r.id}`, meta: { format: r.format, reason: "retention" } });
        n++;
      }
      if (rows.length < 500) break;
    }
    for (let offset = 0; ; offset += 500) {
      const rows = await this.repos.dataRequests.list({ state: "completed", kind: "export", offset, limit: 500 });
      for (const r of rows) {
        if (!r.object_key || !r.completed_at || r.completed_at.getTime() > cutoff) continue;
        if (!(await this.storage.get(r.object_key))) continue;
        await this.storage.delete(r.object_key);
        await this.app!.audit.append({ actorId: null, action: "data_export.file_delete", target: `data_request:${r.id}`, meta: { reason: "retention" } });
        n++;
      }
      if (rows.length < 500) break;
    }
    return n;
  }
}
