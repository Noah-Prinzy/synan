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
  await page.getByRole("button", { name: "Prepare workbook" }).click();
  await answerStepUp(page);
  await expect(page.getByRole("button", { name: /Queued/ }).or(page.getByText("Queued")).first()).toBeVisible();

  const admin = await loginAs((await ctl.seed()).emails.admin);
  const reports = async () => (await admin.call<{ items: { id: string; state: string; format: string; download_url: string | null }[] }>("GET", `/reports/${w.eventId}`)).items;
  await expect.poll(async () => (await reports()).length).toBe(1);
  await ctl.runJob("report.export");
  await expect.poll(async () => (await reports())[0]!.state, { timeout: 30_000 }).toBe("ready");
  const report = (await reports())[0]!;
  expect(report.format).toBe("xlsx");
  reportId = report.id;

  const table = page.getByRole("table", { name: "Prepared exports" });
  const link = table.getByRole("link", { name: /download/i });
  await expect(link).toBeVisible({ timeout: 30_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  const saved = test.info().outputPath("export.xlsx");
  await download.saveAs(saved);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);

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
    const after = (await (await loginAs((await ctl.seed()).emails.admin)).call<{ items: { id: string; state: string; download_url: string | null }[] }>("GET", `/reports/${w.eventId}`)).items.find((r) => r.id === report.id)!;
    test.info().annotations.push({ type: "report row after retention", description: JSON.stringify({ state: after.state, has_link: !!after.download_url }) });
    if (after.download_url) {
      const res = await fetch(after.download_url);
      expect(res.status, "a fresh link to a deleted export").toBe(404);
    }
  });
});

test("J9b: after retention the console no longer offers the deleted export for download", async ({ page }) => {
  test.fail(true, "DEFECT: after the retention job deletes an export, GET /reports/:eventId still answers it as state \"ready\" with a fresh signed download_url, so the console keeps a Download link that answers 404 (apps/api/src/routes/reports.ts dto → reportExports.downloadUrl does not consult the exported-files register).");
  expect(reportId, "J9 made the export").not.toBe("");
  const admin = await loginAs((await ctl.seed()).emails.admin);
  const row = (await admin.call<{ items: { id: string; state: string; download_url: string | null }[] }>("GET", `/reports/${w.eventId}`)).items.find((r) => r.id === reportId)!;
  expect.soft(row.download_url, "no download link for a deleted file").toBeNull();
  await adminSignInSeeded(page);
  await chooseConsoleEvent(page, w.title);
  await page.goto(`${APP_URLS.admin}events/${w.eventId}/reports`);
  const table = page.getByRole("table", { name: "Prepared exports" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("link", { name: /download/i }), "the console offers no download").toHaveCount(0);
});
