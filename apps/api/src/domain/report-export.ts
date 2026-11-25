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
import type { EncryptedStorage } from "../lib/storage.js";
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
    private readonly storage: EncryptedStorage,
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

  /** The decrypted file as a stream (constant memory), or null when gone. */
  async open(key: string) {
    return this.storage.openRead(key);
  }

  /**
   * From the register of exported files (03 §6): for each of these reports whose file is no longer
   * available, when it stopped being so — deleted by the retention job (its `deleted_at`), or past its
   * retention and not yet deleted (its `expires_at`: it is not offered past the promised period).
   * A report with a file still kept is absent from the map; so is one with no registered file.
   */
  async expiredAt(reportIds: readonly string[]): Promise<Map<string, Date>> {
    const out = new Map<string, Date>();
    if (reportIds.length === 0) return out;
    const now = this.clock.now();
    const byReport = new Map<string, { kept: boolean; gone: number }>();
    for (const f of await this.repos.exportedFiles.list({ reportIds })) {
      if (!f.report_id) continue;
      const s = byReport.get(f.report_id) ?? { kept: false, gone: 0 };
      if (!f.deleted_at && f.expires_at.getTime() > now) s.kept = true;
      else s.gone = Math.max(s.gone, (f.deleted_at ?? f.expires_at).getTime());
      byReport.set(f.report_id, s);
    }
    for (const [id, s] of byReport) if (!s.kept) out.set(id, new Date(s.gone));
    return out;
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
        const stored = await this.storage.put(key, data, CONTENT_TYPE[job.format]);
        // Registered before it is offered, so retention always finds it (a file with identity is audited here).
        await this.repos.exportedFiles.record({
          reportId: job.id, dataRequestId: null, objectKey: key, contentType: CONTENT_TYPE[job.format], sizeBytes: stored.sizeBytes,
          containsIdentity: job.include_identity, keyId: stored.keyId, retentionDays: this.config.exportRetentionDays, actorId: job.requested_by,
          now: new Date(this.clock.now()),
        });
        await this.repos.reports.complete(job.id, key, new Date(this.clock.now()));
      } catch (e) {
        await this.repos.reports.fail(job.id, e instanceof Error ? e.message : "export failed", new Date(this.clock.now()));
      }
    }
  }

  /**
   * Retention (03 §6) from the register of exported files: each due object is deleted first, then
   * marked deleted (audited `export.delete` in the same step). An object whose deletion fails stays
   * due and is retried on the next run. Returns how many were deleted.
   */
  async deleteExpired(): Promise<number> {
    let n = 0;
    for (;;) {
      const now = new Date(this.clock.now());
      const due = await this.repos.exportedFiles.due(now, 100);
      if (!due.length) return n;
      const done: string[] = [];
      for (const f of due) {
        try {
          await this.storage.delete(f.object_key);
          done.push(f.id);
        } catch (e) {
          console.error(`[exports] retention could not delete exported_file:${f.id}: ${e instanceof Error ? e.message.slice(0, 120) : "error"}`);
        }
      }
      n += await this.repos.exportedFiles.markDeleted(done, { actorId: null, now });
      if (done.length < due.length) return n; // the failures stay due; try again on the next run
    }
  }
}
