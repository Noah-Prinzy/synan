/**
 * Journey 9 (docs/07 §2.6): a report export is requested with the second factor, downloads, opens as
 * a valid workbook, and is deleted after its retention (7 days; the server clock is moved forward and
 * the retention job run, as the API's own tests do).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { ctl, loginAs, resetAdminCache } from "../support/api.ts";
import { closeWorld, createWorld, registerGuest, type World } from "../support/world.ts";
import { adminSignInSeeded, answerStepUp, chooseConsoleEvent } from "../support/ui.ts";
import { APP_URLS } from "../ports.ts";

const DAY = 86_400_000;
const storage = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.stack/reports");
const filesFor = (id: string): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.includes(id)) out.push(p);
    }
  };
  walk(storage);
  return out;
};

test.describe.configure({ mode: "serial" });

let w: World;
let reportId = "";
test.beforeAll(async () => {
  w = await createWorld({ name: "j9" });
  await registerGuest(w, { name: "Rita Report" });
});
test.afterAll(async () => {
  await ctl.setClockOffset(0);
  resetAdminCache();
  await closeWorld(w);
});

test("J9: export a workbook with the second factor, open it, and see it deleted after retention", async ({ page }) => {
  await adminSignInSeeded(page);
  await chooseConsoleEvent(page, w.title);
  await page.goto(`${APP_URLS.admin}events/${w.eventId}/reports`);
  await expect(page.getByRole("heading", { name: "Export", exact: true })).toBeVisible();
  const admin = await loginAs((await ctl.seed()).emails.admin);
  const all = async () => (await admin.call<{ items: { id: string; state: string; format: string; download_url: string | null }[] }>("GET", `/reports/${w.eventId}`)).items;
  const before = new Set((await all()).map((r) => r.id));
  const mine = async () => (await all()).filter((r) => !before.has(r.id));

  await page.getByRole("button", { name: "Prepare workbook" }).click();
  await answerStepUp(page);
  await expect(page.getByRole("button", { name: /Queued/ }).or(page.getByText("Queued")).first()).toBeVisible();

  await expect.poll(async () => (await mine()).length, { message: "one export requested" }).toBe(1);
  await ctl.runJob("report.export");
  await expect.poll(async () => (await mine())[0]!.state, { timeout: 30_000 }).toBe("ready");
  const report = (await mine())[0]!;
  expect(report.format).toBe("xlsx");
  reportId = report.id;

  const table = page.getByRole("table", { name: "Prepared exports" });
  const row = table.getByRole("row").filter({ has: page.getByRole("link", { name: /download/i }) });
  await expect(row).toHaveCount(before.size + 1, { timeout: 30_000 });
  const link = row.first().getByRole("link", { name: /download/i });
  await expect(link).toBeVisible({ timeout: 30_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  const saved = test.info().outputPath("export.xlsx");
  await download.saveAs(saved);
  expect(download.suggestedFilename(), "the file downloaded is this export").toBe(`report-${report.id}.xlsx`);

  await test.step("the file is a valid workbook", async () => {
    const zip = unzipSync(new Uint8Array(readFileSync(saved)));
    expect(Object.keys(zip)).toEqual(expect.arrayContaining(["[Content_Types].xml", "xl/workbook.xml", "_rels/.rels"]));
    const workbook = strFromU8(zip["xl/workbook.xml"]!);
    const sheets = [...workbook.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1]);
    expect(sheets.length).toBeGreaterThan(1);
    const sheetFiles = Object.keys(zip).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    expect(sheetFiles.length).toBe(sheets.length);
    for (const f of sheetFiles) expect(strFromU8(zip[f]!)).toContain("<sheetData");
    test.info().annotations.push({ type: "sheets", description: sheets.join(", ") });
  });

  expect(filesFor(report.id), "the export is stored (encrypted) on the server").toHaveLength(1);

  await test.step("after 7 days the retention job deletes it", async () => {
    await ctl.setClockOffset(6 * DAY);
    await ctl.runJob("delivery.cleanup");
    expect(filesFor(report.id), "kept for the whole 7 days").toHaveLength(1);
    await ctl.setClockOffset(7 * DAY + 3_600_000);
    await ctl.runJob("delivery.cleanup");
    expect(filesFor(report.id)).toHaveLength(0);
    await ctl.setClockOffset(0);
    resetAdminCache();
  });

  await test.step("server: the deleted export cannot be downloaded any more", async () => {
    const after = (await (await loginAs((await ctl.seed()).emails.admin)).call<{ items: { id: string; state: string; download_url: string | null; expired_at?: string | null }[] }>("GET", `/reports/${w.eventId}`)).items.find((r) => r.id === report.id)!;
    test.info().annotations.push({ type: "report row after retention", description: JSON.stringify({ state: after.state, has_link: !!after.download_url, expired_at: after.expired_at }) });
    expect(after.download_url, "no link to a deleted file").toBeNull();
    expect(after.expired_at, "the row says when the file went").toBeTruthy();
  });
});

test("J9b: after retention the console no longer offers the deleted export for download", async ({ page }) => {
  expect(reportId, "J9 made the export").not.toBe("");
  const admin = await loginAs((await ctl.seed()).emails.admin);
  const row = (await admin.call<{ items: { id: string; state: string; download_url: string | null }[] }>("GET", `/reports/${w.eventId}`)).items.find((r) => r.id === reportId)!;
  expect(row.download_url, "no download link for a deleted file").toBeNull();
  await adminSignInSeeded(page);
  await chooseConsoleEvent(page, w.title);
  await page.goto(`${APP_URLS.admin}events/${w.eventId}/reports`);
  const table = page.getByRole("table", { name: "Prepared exports" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("link", { name: /download/i }), "the console offers no download").toHaveCount(0);
  await expect(table.getByRole("row").filter({ hasText: "Expired" }), "the deleted export reads expired").toHaveCount(1);
});
