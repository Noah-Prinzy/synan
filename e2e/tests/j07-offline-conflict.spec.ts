/**
 * Journey 7 (docs/07 §2.6): an offline conflict — the same band admitted at two gates while both were
 * offline (a pass-back), or one emailed single-use code used at two offline gates — raises exactly one
 * alert, and that alert names both scans.
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { adminApi, api, mailMark, uniq, waitForMail } from "../support/api.ts";
import { bindBand, closeWorld, createWorld, invite, registerGuest, type Gate, type World } from "../support/world.ts";
import { adminSignInSeeded, chooseConsoleEvent, phone, scannerManualEntry, scannerSignIn, verdict } from "../support/ui.ts";

let w: World;
test.beforeEach(async () => {
  w = await createWorld({ name: "j7" });
});
test.afterEach(async () => closeWorld(w));

async function scannerAt(ctx: BrowserContext, gate: Gate): Promise<Page> {
  const page = await ctx.newPage();
  await scannerSignIn(page, gate.staff.email, gate.staff.password, gate.label);
  await page.getByRole("link", { name: /^Queue/ }).click();
  await expect(page.getByRole("term").filter({ hasText: "Pass list" }).locator("xpath=following-sibling::dd[1]")).toHaveText(/\d+ s old/);
  await page.getByRole("link", { name: "Scan" }).click();
  return page;
}

test("J7: the same band admitted at two offline entrances raises one pass-back alert naming both scans", async ({ page, browser }) => {
  const admin = await adminApi();
  const guest = await registerGuest(w, { name: "Paz Back" });
  const uid = await bindBand(w, guest);

  const frontCtx = await phone(browser);
  const sideCtx = await phone(browser);
  const front = await scannerAt(frontCtx, w.gates.entrance);
  const side = await scannerAt(sideCtx, w.gates.side);

  await frontCtx.setOffline(true);
  await sideCtx.setOffline(true);
  await scannerManualEntry(front, uid);
  await expect(verdict(front)).toContainText("ADMITTED");
  await scannerManualEntry(side, uid);
  await expect(verdict(side)).toContainText("ADMITTED");

  const alertsNow = async () => (await admin.call<{ items: { id: string; kind: string; scan_ids: string[]; credential_id: string | null }[] }>("GET", `/breach-alerts?event_id=${w.eventId}&limit=100`)).items;
  expect(await alertsNow()).toHaveLength(0);

  await adminSignInSeeded(page);
  await chooseConsoleEvent(page, w.title);
  // The console's sections are menus in its top bar (D-37): open Live, then its Alerts page.
  const nav = page.getByRole("navigation", { name: "Admin" });
  await nav.getByRole("button", { name: "Live" }).click();
  await nav.getByRole("link", { name: "Alerts" }).click();

  await frontCtx.setOffline(false);
  await expect(front.getByRole("link", { name: /^Gate: Front Door/ })).not.toContainText("queued", { timeout: 20_000 });
  await sideCtx.setOffline(false);
  await expect(side.getByRole("link", { name: /^Gate: Side Door/ })).not.toContainText("queued", { timeout: 20_000 });

  await test.step("server: exactly one conflict alert, naming both scans", async () => {
    await expect.poll(async () => (await alertsNow()).length, { timeout: 15_000 }).toBeGreaterThan(0);
    const alerts = (await alertsNow()).filter((a) => a.kind.startsWith("offline_conflict"));
    expect(alerts, JSON.stringify(await alertsNow())).toHaveLength(1);
    expect(alerts[0]!.kind).toBe("offline_conflict_passback");
    expect(alerts[0]!.credential_id).toBe(guest.credentialId);
    const scans = (await admin.call<{ items: { id: string; checkpoint_id: string }[] }>("GET", `/scans?event_id=${w.eventId}&limit=100`)).items;
    expect(scans).toHaveLength(2);
    expect([...alerts[0]!.scan_ids].sort()).toEqual(scans.map((s) => s.id).sort());
    const detail = await admin.call<{ scans: { checkpoint_label: string }[] }>("GET", `/alerts/${alerts[0]!.id}`);
    expect(detail.scans.map((s) => s.checkpoint_label).sort()).toEqual(["Front Door", "Side Door"]);
  });

  await test.step("the console shows the one alert, live, and its detail names both gates", async () => {
    const main = page.getByRole("main");
    await expect(page.getByRole("radio", { name: "Open 1" })).toBeVisible({ timeout: 15_000 });
    const row = main.getByRole("button", { name: /^Offline conflict · pass-back , High, Open, at Side Door/ });
    await expect(row).toHaveCount(1);
    await row.click();
    const detail = page.getByRole("complementary", { name: "Offline conflict · pass-back" });
    await expect(detail.getByRole("heading", { name: /^Scans involved/ })).toBeVisible();
    const scans = detail.getByRole("listitem").filter({ hasText: "Device time" });
    await expect(scans).toHaveCount(2);
    await expect(scans.nth(0)).toContainText("Front Door");
    await expect(scans.nth(0)).toContainText("ADMITTED");
    await expect(scans.nth(1)).toContainText("Side Door");
    await expect(detail.getByRole("term").filter({ hasText: "Holder" }).locator("xpath=following-sibling::dd[1]")).toHaveText(guest.name);
    await expect(detail.getByRole("term").filter({ hasText: "State" }).locator("xpath=following-sibling::dd[1]")).toHaveText("Under review");
  });

  await test.step("each scanner lists the conflict found at its sync", async () => {
    await side.getByRole("link", { name: /^Queue/ }).click();
    await expect(side.getByRole("region", { name: "Conflicts found at the last sync" })).not.toContainText("None.");
  });
  await frontCtx.close();
  await sideCtx.close();
});

test("J7b: one emailed single-use code admitted at two offline entrances raises one pass-reuse alert naming both scans", async ({ browser }) => {
  const admin = await adminApi();
  const email = `${uniq("e2e-reuse")}@synan.dev`.toLowerCase();
  const token = await invite(w, email);
  const mark = await mailMark();
  await api("POST", "/invitations/rsvp", { body: { token, email, accept: true, full_name: "Remy Reuse", zone_presence_consent: false } });
  const passMail = await waitForMail({ to: email, tag: "pass.email_qr", after: mark });
  const code = /QR: (\S+)/.exec(passMail.text)?.[1];
  expect(code, passMail.text).toBeTruthy();

  const frontCtx = await phone(browser);
  const sideCtx = await phone(browser);
  const front = await scannerAt(frontCtx, w.gates.entrance);
  const side = await scannerAt(sideCtx, w.gates.side);
  await frontCtx.setOffline(true);
  await sideCtx.setOffline(true);
  await scannerManualEntry(front, code!);
  await expect(verdict(front)).toContainText("ADMITTED");
  await scannerManualEntry(side, code!);
  await expect(verdict(side), "the side door has not heard of the front door's use").toContainText("ADMITTED");

  const before = (await admin.call<{ items: { id: string }[] }>("GET", `/breach-alerts?event_id=${w.eventId}&limit=100`)).items.map((a) => a.id);
  await frontCtx.setOffline(false);
  await sideCtx.setOffline(false);
  await expect(front.getByRole("link", { name: /^Gate: Front Door/ })).not.toContainText("queued", { timeout: 20_000 });
  await expect(side.getByRole("link", { name: /^Gate: Side Door/ })).not.toContainText("queued", { timeout: 20_000 });

  const fresh = async () => (await admin.call<{ items: { id: string; kind: string; scan_ids: string[] }[] }>("GET", `/breach-alerts?event_id=${w.eventId}&limit=100`)).items.filter((a) => !before.includes(a.id));
  await expect.poll(async () => (await fresh()).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const conflicts = (await fresh()).filter((a) => a.kind.startsWith("offline_conflict"));
  expect(conflicts, JSON.stringify(await fresh())).toHaveLength(1);
  expect(conflicts[0]!.kind).toBe("offline_conflict_pass_reuse");
  const detail = await admin.call<{ scans: { checkpoint_label: string }[] }>("GET", `/alerts/${conflicts[0]!.id}`);
  expect(detail.scans.map((s) => s.checkpoint_label).sort()).toEqual(["Front Door", "Side Door"]);
  await frontCtx.close();
  await sideCtx.close();
});
