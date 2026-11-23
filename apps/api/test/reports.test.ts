/** Slice 8: reports from aggregates, identical across the purge; CSV export by signed short-lived link. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenPair } from "@synan/contracts/rest";
import { strFromU8, unzipSync } from "fflate";
import { MemoryStorage } from "../src/lib/storage.js";
import { band, errCode, mfaCode, postScans, scan, startHarness, type Harness } from "./helpers.js";

type Data = { section: string; total: number; columns: string[]; rows: (string | number | null)[][]; next_cursor: string | null };
const KINDS: [string, string][] = [
  ["attendance", "by_tier"], ["attendance", "arrivals"], ["dwell_flow", "flow"], ["dwell_flow", "dwell"],
  ["peak_occupancy", "peaks"], ["breach_compliance", "alerts"], ["gate_throughput", "throughput"],
];

const storage = new MemoryStorage();
let h: Harness;
let organiser: string;
let adminMfa: string;
beforeAll(async () => {
  h = await startHarness({ storage });
  organiser = (await h.login(h.seed.emails.organiser)).access_token;
  const admin = (await h.login(h.seed.emails.admin)).access_token;
  adminMfa = (await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: admin, body: { code: mfaCode(h) } })).body.access_token;
  const a = h.seed.attendees;
  for (const u of [a.vip.uid, a.ordinary.uid, a.publicTier.uid]) await postScans(h, [scan(h, h.seed.checkpoints.mainIn, band(u))]);
  await postScans(h, [scan(h, h.seed.checkpoints.vip, band(a.ordinary.uid))]); // denied_room → alert
  await postScans(h, [scan(h, h.seed.checkpoints.auditorium, band(a.vip.uid), { direction: "in" })]);
});
afterAll(async () => h.close());

const get = (kind: string, qs = "", eventId = h.seed.eventId) => h.call<Data>("GET", `/reports/${eventId}/${kind}${qs}`, { token: organiser });
async function everything() {
  const out: Record<string, Data["rows"]> = {};
  for (const [kind, section] of KINDS) {
    const rows: Data["rows"] = [];
    let cursor: string | null = null;
    do {
      const r: { body: Data } = await get(kind, `?section=${section}&limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      rows.push(...r.body.rows);
      cursor = r.body.next_cursor;
    } while (cursor);
    out[`${kind}/${section}`] = rows;
  }
  return out;
}

describe("slice 8 · reports", () => {
  it("attendance by tier, from registrations; operators only", async () => {
    expect((await h.call("GET", `/reports/${h.seed.eventId}/attendance`, { token: await h.gateToken(h.seed.checkpoints.mainIn) })).status).toBe(403);
    const r = await get("attendance");
    expect(r.status).toBe(200);
    expect(r.body.section).toBe("by_tier");
    expect(r.body.columns).toEqual(["tier", "registered", "pending", "cancelled", "checked_in", "no_shows"]);
    const vip = r.body.rows.find((x) => x[0] === "VIP")!;
    expect(vip[4]).toBe(1);
    expect(r.body.rows).toHaveLength(4);
  });

  it("gate throughput and breach figures; pages follow the cursor; bad cursors and sections are refused", async () => {
    const t = await get("gate_throughput", "?limit=1");
    expect(t.body.total).toBeGreaterThan(1);
    expect(t.body.next_cursor).not.toBeNull();
    const next = await get("gate_throughput", `?limit=1&cursor=${t.body.next_cursor}`);
    expect(next.body.rows[0]).not.toEqual(t.body.rows[0]);
    const b = await get("breach_compliance");
    const total = b.body.rows.at(-1)!;
    expect(total[0]).toBeNull(); // the total row
    expect(Number(total[2])).toBeGreaterThanOrEqual(1);
    expect(errCode((await get("gate_throughput", "?cursor=nonsense")).body)).toBe("VALIDATION_FAILED");
    expect(errCode((await get("attendance", "?section=peaks")).body)).toBe("VALIDATION_FAILED");
  });

  it("export: MFA, audited, asynchronous CSV, signed short-lived link that cannot be altered", async () => {
    expect(errCode((await h.call("POST", `/reports/${h.seed.eventId}/export`, { token: organiser, body: { kind: "attendance" } })).body)).toBe("MFA_REQUIRED");
    const r = await h.call<{ id: string; state: string }>("POST", `/reports/${h.seed.eventId}/export`, { token: adminMfa, body: { kind: "attendance", format: "csv" } });
    expect(r.status).toBe(202);
    await h.app.ctx.reportExports.drain();
    const list = await h.call<{ items: { id: string; state: string; download_url: string | null }[] }>("GET", `/reports/${h.seed.eventId}`, { token: organiser });
    const row = list.body.items.find((x) => x.id === r.body.id)!;
    expect(row.state).toBe("ready");
    const url = new URL(row.download_url!);
    const local = `${h.base}${url.pathname}${url.search}`;
    const csv = await fetch(local);
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const text = await csv.text();
    expect(text).toContain("section,tier,registered");
    expect(text).toContain("arrivals");
    const forged = new URL(local);
    forged.searchParams.set("key", `reports/${h.seed.eventId}/other.csv`);
    expect((await fetch(forged)).status).toBe(403);
    h.clock.advance(11 * 60_000);
    expect((await fetch(local)).status).toBe(403);
    expect((await h.app.ctx.repos.audit.all()).map((a) => a.action)).toContain("report.export");
    const all = await h.call<{ items: unknown[] }>("GET", "/reports", { token: await (async () => (await h.login(h.seed.emails.organiser)).access_token)() });
    expect(all.body.items.length).toBeGreaterThanOrEqual(1);
  });

  it("the summary, every report and the workbook are identical before and after the post-event purge; the workbook is typed and injection-safe", async () => {
    organiser = (await h.login(h.seed.emails.organiser)).access_token;
    // A name crafted as a spreadsheet formula must reach the workbook as plain text.
    await h.call("PATCH", `/users/${h.seed.attendees.ordinary.id}/profile`, { token: organiser, body: { full_name: '=HYPERLINK("http://evil","x")' } });
    expect((await h.call("POST", `/events/${h.seed.eventId}/state`, { token: organiser, body: { state: "closed" } })).status).toBe(200);
    await h.app.ctx.repos.reports.rebuildRollups(h.seed.eventId);
    const capture = async () => {
      organiser = (await h.login(h.seed.emails.organiser)).access_token;
      h.clock.advance(31_000);
      const admin = (await h.login(h.seed.emails.admin)).access_token;
      adminMfa = (await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: admin, body: { code: mfaCode(h) } })).body.access_token;
      const summary = (await h.call<Record<string, unknown> & { purge: { purged_at: string | null }; provisional: boolean }>("GET", `/events/${h.seed.eventId}/post-event-summary`, { token: organiser })).body;
      const data = await everything();
      const r = await h.call<{ id: string; format: string }>("POST", `/reports/${h.seed.eventId}/export`, { token: adminMfa, body: { include_attendees: true } });
      expect(r.body.format).toBe("xlsx");
      await h.app.ctx.reportExports.drain();
      const row = (await h.call<{ items: { id: string; download_url: string | null }[] }>("GET", `/reports/${h.seed.eventId}`, { token: organiser })).body.items.find((x) => x.id === r.body.id)!;
      const u = new URL(row.download_url!);
      const file = await fetch(`${h.base}${u.pathname}${u.search}`);
      expect(file.headers.get("content-type")).toContain("spreadsheetml");
      const wbBytes = new Uint8Array(await file.arrayBuffer());
      const p = await h.call<{ id: string }>("POST", `/reports/${h.seed.eventId}/export`, { token: adminMfa, body: { format: "pdf" } });
      await h.app.ctx.reportExports.drain();
      const prow = (await h.call<{ items: { id: string; download_url: string | null }[] }>("GET", `/reports/${h.seed.eventId}`, { token: organiser })).body.items.find((x) => x.id === p.body.id)!;
      const pu = new URL(prow.download_url!);
      const pdfRes = await fetch(`${h.base}${pu.pathname}${pu.search}`);
      expect(pdfRes.headers.get("content-type")).toBe("application/pdf");
      const pdf = Buffer.from(await pdfRes.arrayBuffer()).toString("latin1");
      return { summary, data, wb: parseWorkbook(wbBytes), pdf };
    };
    const before = await capture();
    expect(before.summary.provisional).toBe(false);
    expect(before.data["peak_occupancy/peaks"]!.some((r) => Number(r[4]) > 0)).toBe(true);
    await h.app.ctx.repos.reports.purge(h.seed.eventId, h.seed.users.admin);
    expect(await h.app.ctx.repos.scans.forEvent(h.seed.eventId)).toHaveLength(0);
    const after = await capture();
    expect(after.summary.purge.purged_at).not.toBeNull();
    const strip = (s: Record<string, unknown>) => ({ ...s, as_of: null, purge: null, downloads: null, frozen: null, frozen_at: null, rollups_rebuilt_at: null });
    expect(strip(after.summary)).toEqual(strip(before.summary));
    expect(after.data).toEqual(before.data);
    expect(after.wb).toEqual(before.wb);
    // The PDF summary: a real PDF, the same text before and after except the purge line, no data link.
    const text = (pdf: string) => [...pdf.matchAll(/\((.*?)\) Tj/g)].map((m) => m[1]!).filter((x) => !x.startsWith("Individual scan records"));
    expect(before.pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(text(before.pdf)).toContain("Attendance by tier");
    expect(text(after.pdf)).toEqual(text(before.pdf));
    expect(after.pdf).toContain("Individual scan records for this event were deleted");
    // Encrypted at rest: no stored object is a readable workbook, PDF or CSV.
    // Per-file keys in framed AES-GCM (@synan/db EVF1), each file registered with the key that wrapped it.
    for (const obj of storage.objects.values()) expect(obj.subarray(0, 4).toString("ascii")).toBe("EVF1");
    const registered = new Map((await Promise.all((await h.app.ctx.repos.reports.list({ eventId: h.seed.eventId, offset: 0, limit: 100 })).map((r) => h.app.ctx.repos.exportedFiles.list({ reportId: r.id })))).flat().map((f) => [f.object_key, f]));
    for (const key of storage.objects.keys()) expect(registered.get(key)?.key_id).toBeTruthy();
    expect([...registered.values()].some((f) => f.contains_identity)).toBe(true);
    expect((await h.app.ctx.repos.audit.all()).map((a) => a.action)).toContain("export.create");
    // Retention: a file whose deletion fails stays due; the rest are deleted, then marked and audited.
    const failing = [...storage.objects.keys()][0]!;
    const realDelete = storage.delete.bind(storage);
    storage.delete = async (k: string) => (k === failing ? Promise.reject(new Error("store unavailable")) : realDelete(k));
    h.clock.advance(8 * 86_400_000);
    await h.app.ctx.jobs.runNow("delivery.cleanup");
    expect([...storage.objects.keys()]).toEqual([failing]);
    expect((await h.app.ctx.repos.exportedFiles.due(new Date(h.clock.now()), 10)).map((f) => f.object_key)).toEqual([failing]);
    storage.delete = realDelete;
    await h.app.ctx.jobs.runNow("delivery.cleanup");
    expect(storage.objects.size).toBe(0);
    expect(await h.app.ctx.repos.exportedFiles.due(new Date(h.clock.now()), 10)).toEqual([]);
    expect((await h.app.ctx.repos.audit.all()).map((a) => a.action)).toContain("export.delete");

    // Sheets, typed cells, totals, and the formula-injection guard.
    expect(Object.keys(before.wb)).toEqual(["Summary", "Attendance", "Arrivals", "On site", "Dwell", "Flow", "Peak occupancy", "Alerts", "Alert log", "Gate throughput", "Attendees"]);
    const att = before.wb.Attendance!;
    expect(att[0]!.map((c) => c?.v)).toEqual(["Tier", "Registered", "Pending", "Cancelled", "Checked in", "No-shows"]);
    expect(att[1]![1]!.t).toBe("n");
    expect(att.at(-1)![0]!.v).toBe("Total");
    expect(before.wb.Arrivals![1]![0]!.t).toBe("date");
    expect(before.wb.Attendees![0]!.map((c) => c?.v)).toContain("Email");
    const evil = before.wb.Attendees!.find((r) => String(r[1]?.v).startsWith("=HYPERLINK"))!;
    expect(evil[1]!.t).toBe("text");
    expect(evil[1]!.formula).toBe(false);
    expect((await h.app.ctx.repos.audit.all()).map((a) => a.action)).toContain("report.export_identity");
  });
});

type Cell = { v: string | number; t: "n" | "date" | "text" | "bool"; formula: boolean } | undefined;
type Workbook = Record<string, Cell[][]>;
/** Opens an .xlsx and reads every sheet back as typed cells. */
function parseWorkbook(bytes: Uint8Array): Workbook {
  const files = unzipSync(bytes);
  const text = (p: string) => strFromU8(files[p]!);
  const names = [...text("xl/workbook.xml").matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]!.replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  const out: Workbook = {};
  names.forEach((name, i) => {
    const rows: Cell[][] = [];
    for (const row of text(`xl/worksheets/sheet${i + 1}.xml`).matchAll(/<row r="\d+">(.*?)<\/row>/g)) {
      const cells: Cell[] = [];
      for (const c of row[1]!.matchAll(/<c r="([A-Z]+)\d+"([^>]*)>(.*?)<\/c>/g)) {
        const col = [...c[1]!].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const attrs = c[2]!;
        const formula = c[3]!.includes("<f>") || c[3]!.includes("<f ");
        if (attrs.includes('t="inlineStr"')) {
          const t = /<t[^>]*>(.*?)<\/t>/.exec(c[3]!)![1]!.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
          cells[col] = { v: t, t: "text", formula };
        } else {
          const v = Number(/<v>(.*?)<\/v>/.exec(c[3]!)![1]);
          cells[col] = { v, t: attrs.includes('t="b"') ? "bool" : attrs.includes('s="2"') ? "date" : "n", formula };
        }
      }
      rows.push(cells);
    }
    out[name] = rows;
  });
  return out;
}
