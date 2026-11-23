/**
 * Scheduled reports (01 §10). The job claims due schedules (leased, so concurrent workers never run
 * one twice), queues the export, builds the file, and emails each recipient a signed, short-lived
 * download link. The message carries no report data: only the link and its expiry. A run that fails
 * is retried when its lease lapses; three failures in a row make the schedule `failed`.
 *
 * A schedule that includes the attendee sheet is re-checked at every run: its recipients must still
 * be operator accounts, so a demoted or deleted account stops receiving identity.
 */
import type { AppContext } from "../app.js";
import type { ReportScheduleRow } from "../repo/types.js";

const FORMAT_NOUN = { xlsx: "event workbook", csv: "report (CSV)", pdf: "event summary (PDF)" } as const;
export const OPERATOR_ROLES = new Set(["admin", "organiser"]);

export class ReportScheduler {
  private running: Promise<number> | null = null;
  constructor(private readonly app: AppContext) {}

  private now() {
    return new Date(this.app.clock.now());
  }

  /** Recipients still allowed to receive this schedule's file. */
  async eligibleRecipients(s: Pick<ReportScheduleRow, "include_identity" | "recipients">): Promise<string[]> {
    if (!s.include_identity) return s.recipients;
    const out: string[] = [];
    for (const to of s.recipients) {
      const u = await this.app.repos.users.byEmail(to);
      if (u && OPERATOR_ROLES.has(u.role)) out.push(to);
    }
    return out;
  }

  /** Run every due schedule once. Concurrent calls share one run. */
  run(): Promise<number> {
    this.running ??= this.loop().finally(() => (this.running = null));
    return this.running;
  }

  private async loop(): Promise<number> {
    let n = 0;
    for (;;) {
      const due = await this.app.repos.reportSchedules.claimDue(this.now(), { limit: 10, leaseMinutes: 15 });
      if (!due.length) return n;
      for (const s of due) {
        await this.runOne(s);
        n++;
      }
    }
  }

  private async runOne(s: ReportScheduleRow) {
    const { repos, audit, reportExports } = this.app;
    try {
      const recipients = await this.eligibleRecipients(s);
      if (!recipients.length) throw new Error("no eligible recipients");
      const reportId = await repos.reports.request({
        eventId: s.event_id, kind: s.kind, format: s.format, includeIdentity: s.include_identity, requestedBy: s.created_by, params: { schedule_id: s.id },
      });
      await audit.append({
        actorId: null, action: "report.scheduled_export", target: `event:${s.event_id}`,
        meta: { schedule_id: s.id, report_id: reportId, format: s.format, kind: s.kind, include_identity: s.include_identity, recipients: recipients.length },
      });
      if (s.include_identity) await audit.append({ actorId: null, action: "report.export_identity", target: `event:${s.event_id}`, meta: { report_id: reportId, schedule_id: s.id } });
      const report = await reportExports.buildNow(s.event_id, reportId);
      if (report.state !== "ready") throw new Error(report.error ?? "export failed");
      const ttlS = this.app.config.reportEmailLinkTtlS;
      const url = reportExports.downloadUrl(report, ttlS)!;
      const expires = new Date(this.app.clock.now() + ttlS * 1000).toISOString();
      // The emails and the finished run are one unit of work: a run is recorded only with its emails queued.
      await repos.transaction(async (tx) => {
        for (const to of recipients) {
          await this.app.mail.send(
            {
              to, tag: "report.scheduled", subject: "Your scheduled report is ready",
              text: `A scheduled ${FORMAT_NOUN[s.format]} is ready to download.\n\n${url}\n\nThis link stops working at ${expires}. If you did not expect this message, ask an administrator to remove you from the schedule.\n`,
            },
            tx,
          );
        }
        await tx.repos.reportSchedules.finish(s.id, { ok: true, error: null, now: this.now() });
      });
    } catch (e) {
      // Errors carry no personal data (export failures and the messages above only).
      await repos.reportSchedules.finish(s.id, { ok: false, error: e instanceof Error ? e.message : "run failed", now: this.now() });
    }
  }
}
