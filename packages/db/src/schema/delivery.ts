/**
 * Report delivery and attendee messaging: report schedules, exported files, the email outbox and
 * attendee notifications. Personal data here (recipient addresses, email bodies) is held only as
 * encrypted envelopes; pg-boss job payloads carry ids, never addresses or tokens.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { event_reports } from "./analytics";
import { exportFormat, reportKind } from "./enums";
import { data_requests } from "./operations2";
import { users } from "./people";
import { attendees } from "./vault";
import { events } from "./venue";

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const ENVELOPE = "'^ev1\\.[A-Za-z0-9_-]{1,32}\\.[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]{22,}$'";

export const reportCadence = pgEnum("report_cadence", ["on_close", "daily", "weekly", "monthly"]);
export const reportScheduleState = pgEnum("report_schedule_state", ["active", "paused", "done", "failed"]);

/**
 * A report sent on a schedule or when the event closes (01 §10). `recipients_enc` is an encrypted
 * envelope of a JSON array of email addresses, bound to this row.
 */
export const report_schedules = pgTable(
  "report_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    event_id: uuid("event_id")
      .notNull()
      .references(() => events.id),
    format: exportFormat("format").notNull().default("xlsx"),
    /** Required for csv; null for the whole-event workbook and the PDF summary. */
    kind: reportKind("kind"),
    include_identity: boolean("include_identity").notNull().default(false),
    recipients_enc: text("recipients_enc").notNull(),
    cadence: reportCadence("cadence").notNull(),
    /** Next due time for daily/weekly/monthly; null for on_close (due once the event closes). */
    next_run_at: tstz("next_run_at"),
    last_run_at: tstz("last_run_at"),
    state: reportScheduleState("state").notNull().default("active"),
    /** Consecutive failed runs; three make the schedule `failed`. */
    failures: integer("failures").notNull().default(0),
    last_error: text("last_error"),
    /** While a worker holds it. */
    lease_until: tstz("lease_until"),
    created_by: uuid("created_by").references(() => users.id),
    created_at: tstz("created_at").notNull().defaultNow(),
    updated_at: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("report_schedules_event_idx").on(t.event_id),
    index("report_schedules_due_idx").on(t.next_run_at).where(sql`${t.state} = 'active'`),
    check("report_schedules_recipients_encrypted", sql.raw(`recipients_enc ~ ${ENVELOPE}`)),
    check("report_schedules_csv_kind", sql`${t.format} <> 'csv' OR ${t.kind} IS NOT NULL`),
    check("report_schedules_next_run", sql`${t.cadence} = 'on_close' OR ${t.next_run_at} IS NOT NULL OR ${t.state} <> 'active'`),
  ],
);

/**
 * Every exported file (report export or attendee data export), so a job can delete each one when
 * its retention ends (default 7 days) and the deletion is audited. `key_id` is the data key that
 * wrapped the file's own key (encryptFileStream).
 */
export const exported_files = pgTable(
  "exported_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    report_id: uuid("report_id").references(() => event_reports.id),
    data_request_id: uuid("data_request_id").references(() => data_requests.id),
    object_key: text("object_key").notNull(),
    content_type: text("content_type").notNull(),
    size_bytes: bigint("size_bytes", { mode: "number" }),
    contains_identity: boolean("contains_identity").notNull(),
    key_id: text("key_id"),
    created_at: tstz("created_at").notNull().defaultNow(),
    expires_at: tstz("expires_at").notNull(),
    deleted_at: tstz("deleted_at"),
  },
  (t) => [
    uniqueIndex("exported_files_object_key_uq").on(t.object_key),
    index("exported_files_due_idx").on(t.expires_at).where(sql`${t.deleted_at} IS NULL`),
    index("exported_files_report_idx").on(t.report_id),
    check("exported_files_owner", sql`num_nonnulls(${t.report_id}, ${t.data_request_id}) = 1`),
    check("exported_files_expiry_order", sql`${t.expires_at} > ${t.created_at}`),
  ],
);

export const emailState = pgEnum("email_state", ["queued", "sending", "sent", "failed"]);

/**
 * The email outbox: the pg-boss `email.send` job carries only `id`. Recipient and content
 * (including sign-in link tokens) are encrypted envelopes bound to this row, so they never sit in
 * plaintext in the job tables or their archive. Rows are deleted 7 days after sending.
 */
export const email_outbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Template name, e.g. "auth.link", "pass.issued". Never personal data. */
    template: text("template").notNull(),
    to_enc: text("to_enc").notNull(),
    /** Encrypted JSON: subject, text, html, template variables. */
    content_enc: text("content_enc").notNull(),
    state: emailState("state").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    last_error: text("last_error"),
    /** Provider message id, for bounce matching. */
    provider_id: text("provider_id"),
    created_at: tstz("created_at").notNull().defaultNow(),
    sent_at: tstz("sent_at"),
  },
  (t) => [
    index("email_outbox_state_idx").on(t.state, t.created_at),
    check("email_outbox_to_encrypted", sql.raw(`to_enc ~ ${ENVELOPE}`)),
    check("email_outbox_content_encrypted", sql.raw(`content_enc ~ ${ENVELOPE}`)),
  ],
);

export const notificationKind = pgEnum("notification_kind", ["pass", "session", "capacity", "event", "security"]);

/**
 * Attendee notifications (/me/notifications). Either personal (`attendee_id`) or a broadcast to an
 * event's registered attendees (`event_id`, optionally one tier). Text is generic: never movement,
 * location or another person's data. Deleted at `expires_at` (default: 30 days, or 7 days after
 * the event ends) and on erasure.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attendee_id: uuid("attendee_id").references(() => attendees.id),
    event_id: uuid("event_id").references(() => events.id),
    /** A broadcast limited to one tier (null: everyone registered). */
    audience_tier: text("audience_tier"),
    kind: notificationKind("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    created_at: tstz("created_at").notNull().defaultNow(),
    expires_at: tstz("expires_at").notNull(),
  },
  (t) => [
    index("notifications_attendee_idx").on(t.attendee_id, t.created_at),
    index("notifications_event_idx").on(t.event_id, t.created_at),
    index("notifications_expiry_idx").on(t.expires_at),
    check("notifications_audience", sql`${t.attendee_id} IS NOT NULL OR ${t.event_id} IS NOT NULL`),
    check("notifications_tier", sql`${t.audience_tier} IS NULL OR ${t.audience_tier} IN ('VIP','ORDINARY','PRIVATE_INVITE','PUBLIC')`),
    check("notifications_length", sql`length(${t.title}) <= 200 AND length(${t.body}) <= 2000`),
  ],
);

/** Read receipts (a broadcast is read per attendee). */
export const notification_reads = pgTable(
  "notification_reads",
  {
    notification_id: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    attendee_id: uuid("attendee_id")
      .notNull()
      .references(() => attendees.id),
    read_at: tstz("read_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "notification_reads_pk", columns: [t.notification_id, t.attendee_id] })],
);
