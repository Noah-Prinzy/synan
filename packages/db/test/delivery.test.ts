import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createCipher, ENVELOPE_RE, StaticKeyProvider } from "../src/crypto/index";
import { decryptFileBuffer, decryptFileStream, encryptFileBuffer, encryptFileStream } from "../src/crypto/files";
import {
  broadcastNotification,
  claimDueReportSchedules,
  claimEmail,
  cleanupDelivery,
  createReportSchedule,
  deleteReportSchedule,
  enqueueEmail,
  exportedFilesDue,
  finishEmail,
  finishReportSchedule,
  listExportedFiles,
  listNotifications,
  listReportSchedules,
  markExportedFilesDeleted,
  markNotificationsRead,
  notifyAttendee,
  recordExportedFile,
  setReportScheduleState,
} from "../src/delivery";
import { claimReport, requestReport } from "../src/jobs";
import { claimDataRequest, finishDataRequest, openDataRequest } from "../src/registration";
import * as s from "../src/schema/index";
import { insertUser, reencryptSecrets } from "../src/secrets";
import { attendeeWithCredential, devCipher, miniVenue, type MiniVenue } from "./fixtures";
import { createTestDb, q, rejects, type TestDb } from "./helpers";

let db: TestDb;
let v: MiniVenue;
let op: string;
const T = (d: string) => new Date(`2026-12-${d}Z`);
const DAY = 86_400_000;

beforeAll(async () => {
  db = await createTestDb();
  v = await miniVenue(db);
  op = await insertUser(db, devCipher, { email: "delivery.op@example.test", role: "organiser" });
});

describe("export formats on event_reports", () => {
  it("records the format: workbook by default, csv per report kind, pdf summary", async () => {
    const wb = await requestReport(db, { eventId: v.eventId, includeIdentity: true, requestedBy: op });
    const csv = await requestReport(db, { eventId: v.eventId, kind: "attendance" });
    const pdf = await requestReport(db, { eventId: v.eventId, format: "pdf", includeIdentity: true });
    const rows = await db.select().from(s.event_reports);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect([by[wb]!.format, by[wb]!.kind, by[wb]!.include_identity]).toEqual(["xlsx", null, true]);
    expect([by[csv]!.format, by[csv]!.kind, by[csv]!.include_identity]).toEqual(["csv", "attendance", false]);
    expect([by[pdf]!.format, by[pdf]!.kind, by[pdf]!.include_identity]).toEqual(["pdf", null, false]); // identity only in the workbook
    await expect(requestReport(db, { eventId: v.eventId, format: "csv" })).rejects.toThrow(/needs a report kind/);
    await rejects(q(db, `insert into event_reports (event_id, format) values ($1, 'csv')`, [v.eventId]), /event_reports_csv_kind/);
    const claimed = (await claimReport(db))!;
    expect(claimed.id).toBe(wb);
    expect([claimed.format, claimed.include_identity]).toEqual(["xlsx", true]);
  });
});

describe("report schedules", () => {
  it("stores recipients encrypted and bound to the row, and lists them decrypted", async () => {
    const id = await createReportSchedule(db, devCipher, {
      eventId: v.eventId, recipients: ["a@example.test", "b@example.test"], cadence: "daily", firstRunAt: T("01T19:00:00"), createdBy: op, now: T("01T08:00:00"),
    });
    const [row] = await db.select().from(s.report_schedules).where(eq(s.report_schedules.id, id));
    expect(row!.recipients_enc).toMatch(ENVELOPE_RE);
    expect(row!.recipients_enc).not.toContain("example.test");
    expect([row!.format, row!.kind, row!.created_at]).toEqual(["xlsx", null, T("01T08:00:00")]);
    const listed = (await listReportSchedules(db, devCipher, { eventId: v.eventId })).find((x) => x.id === id)!;
    expect(listed).toMatchObject({ recipients: ["a@example.test", "b@example.test"], cadence: "daily", state: "active", created_by: op });
    // An envelope moved to another row does not decrypt.
    const other = await createReportSchedule(db, devCipher, { eventId: v.eventId, kind: "gate_throughput", recipients: ["c@example.test"], cadence: "weekly", firstRunAt: T("08T09:00:00") });
    await q(db, `update report_schedules set recipients_enc = $1 where id = $2`, [row!.recipients_enc, other]);
    await expect(listReportSchedules(db, devCipher, { eventId: v.eventId })).rejects.toThrow();
    await deleteReportSchedule(db, other);
    await rejects(q(db, `update report_schedules set recipients_enc = '["x@example.test"]' where id = $1`, [id]), /report_schedules_recipients_encrypted/);
    await expect(createReportSchedule(db, devCipher, { eventId: v.eventId, format: "csv", recipients: ["a@example.test"], cadence: "on_close" })).rejects.toThrow(/needs a report kind/);
    await expect(createReportSchedule(db, devCipher, { eventId: v.eventId, recipients: ["a@example.test"], cadence: "weekly" })).rejects.toThrow(/needs firstRunAt/);
    await expect(createReportSchedule(db, devCipher, { eventId: v.eventId, recipients: [], cadence: "on_close" })).rejects.toThrow(/at least one recipient/);
    await deleteReportSchedule(db, id);
  });

  it("claims due schedules under a lease, advances on success, fails after three errors", async () => {
    const daily = await createReportSchedule(db, devCipher, { eventId: v.eventId, recipients: ["d@example.test"], cadence: "daily", firstRunAt: T("02T07:00:00") });
    const paused = await createReportSchedule(db, devCipher, { eventId: v.eventId, recipients: ["p@example.test"], cadence: "daily", firstRunAt: T("02T07:00:00") });
    expect(await setReportScheduleState(db, paused, "paused")).toBe(true);

    expect(await claimDueReportSchedules(db, devCipher, { now: T("02T06:59:00") })).toEqual([]);
    const got = await claimDueReportSchedules(db, devCipher, { now: T("02T07:00:00") });
    expect(got.map((x) => [x.id, x.recipients])).toEqual([[daily, ["d@example.test"]]]);
    expect(await claimDueReportSchedules(db, devCipher, { now: T("02T07:05:00") })).toEqual([]); // leased
    // Success three days late: missed runs are skipped, not replayed.
    expect(await finishReportSchedule(db, daily, { ok: true, now: T("05T08:00:00") })).toEqual({ state: "active", next_run_at: T("06T07:00:00") });

    // A worker that dies: the lease lapses and another worker takes it.
    expect((await claimDueReportSchedules(db, devCipher, { now: T("06T07:00:00") })).map((x) => x.id)).toEqual([daily]);
    expect((await claimDueReportSchedules(db, devCipher, { now: T("06T07:16:00") })).map((x) => x.id)).toEqual([daily]);
    for (const [n, state] of [[1, "active"], [2, "active"], [3, "failed"]] as const) {
      const r = await finishReportSchedule(db, daily, { ok: false, error: `smtp down ${n}`, now: T("06T07:20:00") });
      expect(r.state).toBe(state);
    }
    expect(await claimDueReportSchedules(db, devCipher, { now: T("07T09:00:00"), leaseMinutes: 1 })).toEqual([]);
    const [f] = (await listReportSchedules(db, devCipher)).filter((x) => x.id === daily);
    expect([f!.failures, f!.last_error]).toEqual([3, "smtp down 3"]);
    expect(await setReportScheduleState(db, daily, "active", T("07T09:00:00"))).toBe(true);
    expect((await claimDueReportSchedules(db, devCipher, { now: T("07T09:00:00") })).map((x) => x.id)).toEqual([daily]);
    await deleteReportSchedule(db, daily);
    await deleteReportSchedule(db, paused);
  });

  it("runs an on_close schedule once when the event closes; monthly steps by calendar month", async () => {
    const e = await miniVenue(db);
    const once = await createReportSchedule(db, devCipher, { eventId: e.eventId, format: "pdf", recipients: ["sponsor@example.test"], cadence: "on_close" });
    expect(await claimDueReportSchedules(db, devCipher, { now: T("02T00:00:00") })).toEqual([]);
    await q(db, `update events set state = 'closed' where id = $1`, [e.eventId]);
    await q(db, `update events set closed_at = $2 where id = $1`, [e.eventId, T("01T18:30:00")]);
    const [c] = await claimDueReportSchedules(db, devCipher, { now: T("01T18:31:00") });
    expect([c!.id, c!.format, c!.recipients]).toEqual([once, "pdf", ["sponsor@example.test"]]);
    expect(await finishReportSchedule(db, once, { ok: true, now: T("01T18:35:00") })).toEqual({ state: "done", next_run_at: null });
    expect(await claimDueReportSchedules(db, devCipher, { now: T("09T00:00:00") })).toEqual([]);
    expect(await setReportScheduleState(db, once, "paused")).toBe(false); // done stays done

    const monthly = await createReportSchedule(db, devCipher, { eventId: e.eventId, recipients: ["m@example.test"], cadence: "monthly", firstRunAt: T("15T09:00:00") });
    await claimDueReportSchedules(db, devCipher, { now: T("15T09:00:00") });
    expect((await finishReportSchedule(db, monthly, { ok: true, now: T("15T09:01:00") })).next_run_at).toEqual(new Date("2027-01-15T09:00:00Z"));
  });
});

describe("exported files", () => {
  it("records files with a retention period, audits identity, and deletes them auditably when due", async () => {
    const rep = await requestReport(db, { eventId: v.eventId, includeIdentity: true });
    const att = await attendeeWithCredential(db, v.eventId);
    const { request_id } = await openDataRequest(db, att.attendeeId, "export", T("01T10:00:00"));
    const before = (await q<{ n: number }>(db, `select count(*)::int n from audit_log where action like 'export.%'`))[0]!.n;

    const wb = await recordExportedFile(db, {
      reportId: rep, objectKey: `reports/${rep}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 48_213, containsIdentity: true, keyId: devCipher.activeDataKeyId, actorId: op, now: T("01T10:00:00"),
    });
    const agg = await recordExportedFile(db, { reportId: rep, objectKey: `reports/${rep}-summary.pdf`, contentType: "application/pdf", containsIdentity: false, now: T("01T10:00:00") });
    const mine = await recordExportedFile(db, {
      dataRequestId: request_id, objectKey: `data-exports/${request_id}.zip`, contentType: "application/zip", containsIdentity: true, retentionDays: 2, now: T("01T10:00:00"),
    });
    const [row] = (await listExportedFiles(db, { reportId: rep })).filter((f) => f.id === wb);
    expect([row!.expires_at, row!.size_bytes, row!.key_id, row!.deleted_at]).toEqual([T("08T10:00:00"), 48_213, devCipher.activeDataKeyId, null]);
    expect((await listExportedFiles(db, { dataRequestId: request_id })).map((f) => f.id)).toEqual([mine]);

    const created = await q<{ target: string; actor_id: string | null }>(db, `select target, actor_id from audit_log where action = 'export.create' order by id`);
    expect(created.slice(-2).map((x) => x.target)).toEqual([`exported_file:${wb}`, `exported_file:${mine}`]); // not the aggregate pdf
    expect(created.at(-2)!.actor_id).toBe(op);

    await rejects(recordExportedFile(db, { reportId: rep, dataRequestId: request_id, objectKey: "x", contentType: "x", containsIdentity: false }), /exported_files_owner/);
    await rejects(recordExportedFile(db, { objectKey: "y", contentType: "x", containsIdentity: false }), /exported_files_owner/);
    await rejects(recordExportedFile(db, { reportId: rep, objectKey: `reports/${rep}.xlsx`, contentType: "x", containsIdentity: false }), /exported_files_object_key_uq/);

    expect((await exportedFilesDue(db, { now: T("03T09:59:00") })).map((f) => f.id)).toEqual([]);
    expect((await exportedFilesDue(db, { now: T("03T10:00:00") })).map((f) => f.id)).toEqual([mine]);
    const due = await exportedFilesDue(db, { now: T("08T10:00:00") });
    expect(due.map((f) => f.id).sort()).toEqual([wb, agg, mine].sort());
    expect(due.find((f) => f.id === wb)!.object_key).toBe(`reports/${rep}.xlsx`);
    // The job deletes the objects, then marks them; marking twice changes nothing.
    expect(await markExportedFilesDeleted(db, due.map((f) => f.id), { now: T("08T10:05:00") })).toBe(3);
    expect(await markExportedFilesDeleted(db, [wb], { now: T("08T10:06:00") })).toBe(0);
    expect(await exportedFilesDue(db, { now: T("20T00:00:00") })).toEqual([]);
    const deleted = await q<{ target: string; meta_jsonb: { contains_identity: boolean } }>(db, `select target, meta_jsonb from audit_log where action = 'export.delete'`);
    expect(deleted.map((x) => x.target).sort()).toEqual([wb, agg, mine].map((x) => `exported_file:${x}`).sort());
    expect(deleted.find((x) => x.target === `exported_file:${agg}`)!.meta_jsonb.contains_identity).toBe(false);
    const after = (await q<{ n: number }>(db, `select count(*)::int n from audit_log where action like 'export.%'`))[0]!.n;
    expect(after - before).toBe(5);
    expect(await q(db, `select * from audit_verify()`)).toEqual([]);
  });
});

describe("email outbox", () => {
  it("keeps recipient and content encrypted; a job carrying only the id sends once, with retries", async () => {
    const id = await enqueueEmail(db, devCipher, {
      template: "auth.link", to: "Attendee@Example.test", content: { subject: "Your sign-in link", text: "https://x.test/#t=SECRET-TOKEN" }, now: T("01T09:00:00"),
    });
    const raw = (await q<Record<string, string>>(db, `select to_enc, content_enc from email_outbox where id = $1`, [id]))[0]!;
    expect(raw.to_enc).toMatch(ENVELOPE_RE);
    expect(JSON.stringify(raw)).not.toMatch(/Example\.test|SECRET-TOKEN/);
    await rejects(q(db, `update email_outbox set to_enc = 'a@example.test' where id = $1`, [id]), /email_outbox_to_encrypted/);

    const m = (await claimEmail(db, devCipher, id, { now: T("01T09:00:01") }))!;
    expect(m).toEqual({ id, template: "auth.link", to: "Attendee@Example.test", content: { subject: "Your sign-in link", text: "https://x.test/#t=SECRET-TOKEN" }, attempts: 1 });
    expect(await claimEmail(db, devCipher, id)).toBeNull(); // in flight: a duplicate job does nothing
    expect(await finishEmail(db, id, { ok: false, error: "421 try later" })).toBe("failed");
    expect((await claimEmail(db, devCipher, id, { maxAttempts: 2 }))!.attempts).toBe(2);
    expect(await finishEmail(db, id, { ok: false, error: "421 again" })).toBe("failed");
    expect(await claimEmail(db, devCipher, id, { maxAttempts: 2 })).toBeNull(); // out of attempts
    expect((await claimEmail(db, devCipher, id, { maxAttempts: 3 }))!.attempts).toBe(3);
    expect(await finishEmail(db, id, { ok: true, providerId: "msg-1", now: T("01T09:10:00") })).toBe("sent");
    expect(await claimEmail(db, devCipher, id, { maxAttempts: 10 })).toBeNull(); // sent: never again
    expect(await finishEmail(db, id, { ok: true })).toBeNull();
    const [row] = await db.select().from(s.email_outbox).where(eq(s.email_outbox.id, id));
    expect([row!.state, row!.provider_id, row!.sent_at, row!.last_error]).toEqual(["sent", "msg-1", T("01T09:10:00"), null]);
  });
});

describe("notifications", () => {
  it("delivers personal and tier broadcasts to registered attendees only, with per-attendee read state", async () => {
    const e = await miniVenue(db);
    const vip = await attendeeWithCredential(db, e.eventId, "VIP");
    const ord = await attendeeWithCredential(db, e.eventId, "ORDINARY");
    const stranger = await attendeeWithCredential(db, v.eventId, "VIP"); // another event

    const all = await broadcastNotification(db, { eventId: e.eventId, kind: "event", title: "Doors open", body: "Doors open at 09:00.", now: T("01T08:00:00") });
    const vipOnly = await broadcastNotification(db, { eventId: e.eventId, tier: "VIP", kind: "session", title: "VIP lounge", body: "The lounge is open.", now: T("01T08:10:00") });
    const pass = await notifyAttendee(db, { attendeeId: ord.attendeeId, eventId: e.eventId, kind: "pass", title: "Pass ready", body: "Your pass is ready.", now: T("01T08:20:00") });
    const [b] = await db.select().from(s.notifications).where(eq(s.notifications.id, all));
    expect(b!.expires_at).toEqual(T("08T18:00:00")); // event end + 7 days
    const [p] = await db.select().from(s.notifications).where(eq(s.notifications.id, pass));
    expect(p!.expires_at).toEqual(T("31T08:20:00")); // 30 days

    const now = T("01T09:00:00");
    expect((await listNotifications(db, vip.attendeeId, { now })).map((n) => n.id)).toEqual([vipOnly, all]);
    expect((await listNotifications(db, ord.attendeeId, { now })).map((n) => n.id)).toEqual([pass, all]);
    expect(await listNotifications(db, stranger.attendeeId, { now })).toEqual([]);

    expect(await markNotificationsRead(db, ord.attendeeId, [all, pass, vipOnly], now)).toBe(2); // vipOnly is not theirs
    expect(await markNotificationsRead(db, ord.attendeeId, [all], now)).toBe(0);
    expect((await listNotifications(db, ord.attendeeId, { now })).map((n) => [n.title, n.read])).toEqual([["Pass ready", true], ["Doors open", true]]);
    expect((await listNotifications(db, vip.attendeeId, { now })).every((n) => !n.read)).toBe(true); // read state is per attendee
    const [first] = await listNotifications(db, ord.attendeeId, { now });
    expect(first).toEqual({ id: pass, kind: "pass", at: T("01T08:20:00"), title: "Pass ready", body: "Your pass is ready.", read: true });

    // A cancelled registration no longer sees event broadcasts.
    await q(db, `update registrations set state = 'cancelled' where id = $1`, [vip.registrationId]);
    expect(await listNotifications(db, vip.attendeeId, { now })).toEqual([]);
    expect((await listNotifications(db, ord.attendeeId, { now: T("09T00:00:00") })).map((n) => n.id)).toEqual([pass]); // broadcast expired

    await rejects(q(db, `insert into notifications (kind, title, body, expires_at) values ('event', 't', 'b', now())`), /notifications_audience/);
    await rejects(q(db, `insert into notifications (event_id, audience_tier, kind, title, body, expires_at) values ($1, 'GOLD', 'event', 't', 'b', now())`, [e.eventId]), /notifications_tier/);
  });

  it("erasure removes the attendee's notifications and read receipts", async () => {
    const e = await miniVenue(db);
    const a = await attendeeWithCredential(db, e.eventId);
    const bc = await broadcastNotification(db, { eventId: e.eventId, kind: "capacity", title: "Hall busy", body: "Hall 2 is near capacity." });
    await notifyAttendee(db, { attendeeId: a.attendeeId, kind: "security", title: "New sign-in", body: "Your account was signed in on a new device." });
    await markNotificationsRead(db, a.attendeeId, [bc]);
    const { request_id } = await openDataRequest(db, a.attendeeId, "erasure");
    await claimDataRequest(db, { kind: "erasure" });
    expect(await finishDataRequest(db, request_id, { state: "completed" })).toBe("completed");
    expect(await q(db, `select 1 from notifications where attendee_id = $1`, [a.attendeeId])).toEqual([]);
    expect(await q(db, `select 1 from notification_reads where attendee_id = $1`, [a.attendeeId])).toEqual([]);
    expect(await q(db, `select 1 from notifications where id = $1`, [bc])).toHaveLength(1); // the broadcast stays for others
  });
});

describe("delivery cleanup", () => {
  it("deletes sent and failed email after 7 days, expired notifications, finished schedules after 30 days", async () => {
    const fresh = await createTestDb();
    const e = await miniVenue(fresh);
    const a = await attendeeWithCredential(fresh, e.eventId);
    const sent = await enqueueEmail(fresh, devCipher, { template: "t", to: "s@example.test", content: { subject: "s", text: "t" }, now: T("01T00:00:00") });
    await claimEmail(fresh, devCipher, sent);
    await finishEmail(fresh, sent, { ok: true, now: T("01T00:00:00") });
    const queued = await enqueueEmail(fresh, devCipher, { template: "t", to: "q@example.test", content: { subject: "s", text: "t" }, now: T("01T00:00:00") });
    await notifyAttendee(fresh, { attendeeId: a.attendeeId, kind: "pass", title: "t", body: "b", ttlDays: 1, now: T("01T00:00:00") });
    const keep = await notifyAttendee(fresh, { attendeeId: a.attendeeId, kind: "pass", title: "t", body: "b", ttlDays: 60, now: T("01T00:00:00") });
    const done = await createReportSchedule(fresh, devCipher, { eventId: e.eventId, recipients: ["x@example.test"], cadence: "daily", firstRunAt: T("01T00:00:00") });
    await finishReportSchedule(fresh, done, { ok: false, now: T("01T00:00:00") });
    await finishReportSchedule(fresh, done, { ok: false, now: T("01T00:00:00") });
    await finishReportSchedule(fresh, done, { ok: false, now: T("01T00:00:00") });

    expect(await cleanupDelivery(fresh, T("05T00:00:00"))).toEqual({ emails: 0, notifications: 1, schedules: 0 });
    expect(await cleanupDelivery(fresh, new Date(T("31T00:00:00").getTime() + DAY))).toEqual({ emails: 1, notifications: 0, schedules: 1 });
    expect((await fresh.select({ id: s.email_outbox.id }).from(s.email_outbox)).map((x) => x.id)).toEqual([queued]); // unsent stays
    expect((await fresh.select({ id: s.notifications.id }).from(s.notifications)).map((x) => x.id)).toEqual([keep]);
    await fresh.$client.close();
  });
});

describe("key rotation", () => {
  it("re-encrypts schedule recipients and outbox rows under the new data key", async () => {
    const fresh = await createTestDb();
    const e = await miniVenue(fresh);
    const k1 = randomBytes(32);
    const k2 = randomBytes(32);
    const bi = randomBytes(32);
    const c1 = await createCipher(new StaticKeyProvider({ data: { k1 }, blindIndex: { b1: bi } }));
    const c2 = await createCipher(new StaticKeyProvider({ data: { k1, k2 }, blindIndex: { b1: bi }, activeData: "k2" }));
    const sched = await createReportSchedule(fresh, c1, { eventId: e.eventId, recipients: ["r@example.test"], cadence: "on_close" });
    const mail = await enqueueEmail(fresh, c1, { template: "t", to: "to@example.test", content: { subject: "s", text: "x" } });
    const summary = await reencryptSecrets({ db: fresh, cipher: c2 });
    expect(summary["report_schedules.recipients_enc"]!.updated).toBe(1);
    expect(summary["email_outbox.to_enc"]!.updated).toBe(1);
    expect(summary["email_outbox.content_enc"]!.updated).toBe(1);
    const raw = (await q<{ recipients_enc: string }>(fresh, `select recipients_enc from report_schedules where id = $1`, [sched]))[0]!;
    expect(raw.recipients_enc.startsWith("ev1.k2.")).toBe(true);
    const c2only = await createCipher(new StaticKeyProvider({ data: { k2 }, blindIndex: { b1: bi } }));
    expect((await listReportSchedules(fresh, c2only))[0]!.recipients).toEqual(["r@example.test"]);
    expect((await claimEmail(fresh, c2only, mail))!.to).toBe("to@example.test");
    await fresh.$client.close();
  });
});

describe("file encryption at rest", () => {
  const collect = async (r: NodeJS.ReadableStream) => {
    const parts: Buffer[] = [];
    for await (const c of r) parts.push(c as Buffer);
    return Buffer.concat(parts);
  };

  it("round-trips in chunks, streaming, for empty, exact and ragged sizes", async () => {
    for (const size of [0, 1, 1000, 2000, 10_001]) {
      const data = randomBytes(size);
      const { bytes, keyId } = await encryptFileBuffer(devCipher, data, { objectKey: "k/a.xlsx", chunkSize: 1000 });
      expect(keyId).toBe(devCipher.activeDataKeyId);
      expect(bytes.subarray(0, 4).toString()).toBe("EVF1");
      expect((await decryptFileBuffer(devCipher, bytes, { objectKey: "k/a.xlsx" })).equals(data)).toBe(true);
    }
    // A real stream pipeline, fed in odd-sized pieces.
    const data = randomBytes(300_000);
    const pieces = Array.from({ length: 77 }, (_, i) => data.subarray(i * 3900, (i + 1) * 3900));
    const enc = encryptFileStream(devCipher, { objectKey: "k/b.csv" });
    const encrypted: Buffer[] = [];
    await pipeline(Readable.from(pieces), enc, async function* (src) {
      for await (const c of src) encrypted.push(c as Buffer);
    });
    const all = Buffer.concat(encrypted);
    expect(all.includes(data.subarray(0, 64))).toBe(false);
    const dec = decryptFileStream(devCipher, { objectKey: "k/b.csv" });
    const out = collect(dec);
    for (let i = 0; i < all.length; i += 5000) dec.write(all.subarray(i, i + 5000));
    dec.end();
    expect((await out).equals(data)).toBe(true);
  });

  it("rejects another object key, truncation at a frame boundary, tampering and reordering", async () => {
    const data = randomBytes(3500);
    const { bytes } = await encryptFileBuffer(devCipher, data, { objectKey: "k/c.pdf", chunkSize: 1000 });
    const fail = (b: Buffer, key = "k/c.pdf") => expect(decryptFileBuffer(devCipher, b, { objectKey: key })).rejects.toThrow();
    await fail(bytes, "k/other.pdf");
    const headerEnd = 8 + bytes.readUInt32BE(4);
    const frame = 4 + 1000 + 16;
    await fail(bytes.subarray(0, headerEnd + 3 * frame)); // last frame dropped cleanly
    await fail(bytes.subarray(0, bytes.length - 1));
    const flipped = Buffer.from(bytes);
    flipped[headerEnd + 10] = flipped[headerEnd + 10]! ^ 1;
    await fail(flipped);
    const swapped = Buffer.concat([bytes.subarray(0, headerEnd), bytes.subarray(headerEnd + frame, headerEnd + 2 * frame), bytes.subarray(headerEnd, headerEnd + frame), bytes.subarray(headerEnd + 2 * frame)]);
    await fail(swapped);
    await expect(decryptFileBuffer(devCipher, Buffer.from("PK\u0003\u0004 not encrypted"), { objectKey: "k/c.pdf" })).rejects.toThrow(/not an encrypted export file/);
  });

  it("still decrypts after the data key rotates, while the old key is kept", async () => {
    const k1 = randomBytes(32);
    const k2 = randomBytes(32);
    const bi = { b1: randomBytes(32) };
    const c1 = await createCipher(new StaticKeyProvider({ data: { k1 }, blindIndex: bi }));
    const c2 = await createCipher(new StaticKeyProvider({ data: { k1, k2 }, blindIndex: bi, activeData: "k2" }));
    const { bytes, keyId } = await encryptFileBuffer(c1, Buffer.from("tier,count\nVIP,3\n"), { objectKey: "k/d.csv" });
    expect(keyId).toBe("k1");
    expect((await decryptFileBuffer(c2, bytes, { objectKey: "k/d.csv" })).toString()).toBe("tier,count\nVIP,3\n");
    const c2only = await createCipher(new StaticKeyProvider({ data: { k2 }, blindIndex: bi }));
    await expect(decryptFileBuffer(c2only, bytes, { objectKey: "k/d.csv" })).rejects.toThrow();
  });
});
