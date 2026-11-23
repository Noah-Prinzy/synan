/** Exported files: @synan/db's streaming file format at rest, and the retention register on both backends. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAppCipher } from "../src/app.js";
import { EncryptedStorage, MemoryStorage } from "../src/lib/storage.js";
import { startHarness, type Harness } from "./helpers.js";

const text = async (s: NodeJS.ReadableStream | null) => {
  const parts: Buffer[] = [];
  for await (const c of s!) parts.push(Buffer.from(c as Buffer));
  return Buffer.concat(parts).toString("utf8");
};

describe("EncryptedStorage", () => {
  it("per-file keys in authenticated frames: streams back, refuses a copy under another key and a truncation, still reads the legacy envelope", async () => {
    const cipher = await createAppCipher({});
    const inner = new MemoryStorage();
    const s = new EncryptedStorage(inner, cipher);
    const big = "x".repeat(200_000) + "end";
    const r = await s.put("reports/e/1.csv", Buffer.from(big), "text/csv");
    expect(r.keyId).toBe(cipher.activeDataKeyId);
    const raw = inner.objects.get("reports/e/1.csv")!;
    expect(raw.subarray(0, 4).toString("ascii")).toBe("EVF1");
    expect(raw.includes(Buffer.from("xxxxxxxx"))).toBe(false);
    expect(await text(await s.openRead("reports/e/1.csv"))).toBe(big);
    expect((await s.get("reports/e/1.csv"))!.toString("utf8")).toBe(big);
    // The wrapped file key is bound to the object key: a copy elsewhere does not open.
    inner.objects.set("reports/e/2.csv", raw);
    await expect(s.get("reports/e/2.csv")).rejects.toThrow();
    // Dropping the last frame is detected.
    inner.objects.set("reports/e/1.csv", raw.subarray(0, raw.length - 40));
    await expect(text(await s.openRead("reports/e/1.csv"))).rejects.toThrow();
    // Objects written before the change (whole-object envelope) are still readable until retention removes them.
    inner.objects.set("old/1.json", Buffer.from(cipher.encrypt(Buffer.from("legacy").toString("base64"), { table: "object_storage", column: "data", rowId: "old/1.json" }), "utf8"));
    expect((await s.get("old/1.json"))!.toString("utf8")).toBe("legacy");
    expect(await text(await s.openRead("old/1.json"))).toBe("legacy");
    expect(await s.openRead("missing")).toBeNull();
  });
});

describe("exported files register", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ storage: new MemoryStorage() });
  });
  afterAll(async () => h.close());

  it("records with the wrapping key; identity files are audited at creation; due → deleted once, audited", async () => {
    const { repos } = h.app.ctx;
    const now = new Date(h.clock.now());
    const reportId = await repos.reports.request({ eventId: h.seed.eventId, kind: null, format: "pdf", includeIdentity: false, requestedBy: null, params: {} });
    const plain = await repos.exportedFiles.record({ reportId, dataRequestId: null, objectKey: `reports/x/${reportId}.pdf`, contentType: "application/pdf", sizeBytes: 10, containsIdentity: false, keyId: "k1", retentionDays: 7, actorId: null, now });
    const dr = await repos.dataRequests.open(h.seed.attendees.vip.id, "export", now);
    const ident = await repos.exportedFiles.record({ reportId: null, dataRequestId: dr.request_id, objectKey: `data-exports/x/${dr.request_id}.json`, contentType: "application/json", sizeBytes: 20, containsIdentity: true, keyId: "k1", retentionDays: 1, actorId: null, now });
    const audit = async () => (await repos.audit.all()).filter((a) => a.target === `exported_file:${ident}` || a.target === `exported_file:${plain}`).map((a) => `${a.action}:${a.target.slice(-36)}`);
    expect(await audit()).toEqual([`export.create:${ident}`]);
    expect((await repos.exportedFiles.list({ reportId }))[0]).toMatchObject({ id: plain, key_id: "k1", contains_identity: false, deleted_at: null });
    expect(await repos.exportedFiles.due(now, 10)).toEqual([]);
    const later = new Date(now.getTime() + 2 * 86_400_000);
    expect((await repos.exportedFiles.due(later, 10)).map((f) => f.id)).toEqual([ident]);
    expect(await repos.exportedFiles.markDeleted([ident, ident], { actorId: null, now: later })).toBe(1);
    expect(await repos.exportedFiles.markDeleted([ident], { actorId: null, now: later })).toBe(0);
    expect(await repos.exportedFiles.due(later, 10)).toEqual([]);
    expect(await audit()).toEqual([`export.create:${ident}`, `export.delete:${ident}`]);
  });

  it("an attendee data export is stored encrypted and registered as containing identity", async () => {
    const { repos } = h.app.ctx;
    const dr = (await repos.dataRequests.forAttendee(h.seed.attendees.vip.id))[0]!;
    await h.app.ctx.jobs.runNow("data_request.process");
    const files = await repos.exportedFiles.list({ dataRequestId: dr.id });
    const built = files.find((f) => f.object_key === `data-exports/${h.seed.attendees.vip.id}/${dr.id}.json`)!;
    expect(built).toMatchObject({ contains_identity: true, key_id: (await createAppCipher({})).activeDataKeyId, deleted_at: null });
  });
});
