/**
 * Journey 6 (docs/07 §2.6): a scanner with no network admits from its signed allowlist, queues the
 * scans, comes back online and reconciles exactly once: the server holds as many scans as the device
 * made, no more and no fewer.
 */
import { expect, test } from "@playwright/test";
import { adminApi } from "../support/api.ts";
import { bindBand, closeWorld, createWorld, registerGuest, type World } from "../support/world.ts";
import { phone, scannerManualEntry, scannerSignIn, verdict } from "../support/ui.ts";

let w: World;
test.beforeEach(async () => {
  w = await createWorld({ name: "j6" });
});
test.afterEach(async () => closeWorld(w));

test("J6: offline admissions from the allowlist queue on the device and sync exactly once", async ({ browser }) => {
  const admin = await adminApi();
  const bands: string[] = [];
  for (const name of ["Olu One", "Ola Two", "Oki Three"]) bands.push(await bindBand(w, await registerGuest(w, { name })));
  const revokedGuest = await registerGuest(w, { name: "Rex Revoked" });
  const revokedBand = await bindBand(w, revokedGuest);
  await admin.call("POST", `/credentials/${revokedGuest.credentialId}/revoke`, { reason: "End-to-end: refused offline from the allowlist" });

  const ctx = await phone(browser);
  const page = await ctx.newPage();
  const posts: number[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/v1/scans")) posts.push((JSON.parse(r.postData() ?? "{}").scans ?? []).length);
  });
  await scannerSignIn(page, w.gates.entrance.staff.email, w.gates.entrance.staff.password, "Front Door");
  const status = page.getByRole("link", { name: /^Gate: Front Door/ });
  await expect(status).toContainText("Online");
  // The allowlist arrives with the gate: wait until the queue screen shows its age.
  await page.getByRole("link", { name: /^Queue/ }).click();
  await expect(page.getByRole("term").filter({ hasText: "Pass list" }).locator("xpath=following-sibling::dd[1]")).toHaveText(/\d+ s old/);
  await page.getByRole("link", { name: "Scan" }).click();

  await ctx.setOffline(true);
  await expect(status).toContainText("Offline");

  for (const [i, uid] of bands.entries()) {
    await scannerManualEntry(page, uid);
    await expect(verdict(page)).toContainText("ADMITTED");
    await expect(status).toContainText(`${i + 1} queued`);
  }
  await scannerManualEntry(page, revokedBand);
  await expect(verdict(page)).toContainText("REVOKED");

  // Every scan above was decided on the device and queued: three admissions and one refusal. Wait for
  // the queue screen to show them (it reads the device's queue, which can take a moment on a slow
  // runner), never read it once.
  const queued = bands.length + 1;
  await page.getByRole("link", { name: /^Queue/ }).click();
  const waiting = page.getByRole("term").filter({ hasText: "Waiting" }).locator("xpath=following-sibling::dd[1]");
  await expect(waiting).toHaveText(String(queued));
  const byResult = page.getByRole("list", { name: "Waiting, by result" });
  await expect(byResult.getByRole("listitem").filter({ hasText: "ADMITTED" })).toHaveText(/ADMITTED\s*3$/);
  await expect(byResult.getByRole("listitem").filter({ hasText: "REVOKED" })).toHaveText(/REVOKED\s*1$/);

  const serverScans = async () =>
    (await admin.call<{ items: { id: string; result: string }[] }>("GET", `/scans?event_id=${w.eventId}&checkpoint_id=${w.gates.entrance.id}&limit=100`)).items;
  expect(await serverScans(), "nothing reached the server while offline").toHaveLength(0);

  // Back online: wait on the real conditions, the device's queue drained and the server holding the
  // scans ("Online" shows only once nothing is waiting), with room for a slow headless runner.
  await ctx.setOffline(false);
  await expect(waiting).toHaveText("0", { timeout: 60_000 });
  await expect(status).toContainText("Online", { timeout: 30_000 });
  await expect.poll(async () => (await serverScans()).length, { message: "the server holds every queued scan", timeout: 30_000 }).toBe(queued);
  await expect(page.getByRole("region", { name: "Conflicts found at the last sync" })).toContainText("None. Every scan from this device matched");

  // A second outage and return sends nothing again.
  await ctx.setOffline(true);
  await expect(status).toContainText("Offline");
  await ctx.setOffline(false);
  await expect(status).toContainText("Online", { timeout: 30_000 });
  await expect(waiting).toHaveText("0");

  // The device's own list: every scan it made, each marked sent (waited for, not counted at once).
  await page.getByRole("link", { name: "Recent" }).click();
  const deviceScans = page.getByRole("main").getByRole("listitem");
  await expect(deviceScans).toHaveCount(queued);
  await expect(deviceScans.filter({ hasText: "Sent" })).toHaveCount(queued);

  const onServer = await serverScans();
  expect(onServer.length, "server scan count equals the device's, after a second outage too").toBe(queued);
  expect(new Set(onServer.map((s) => s.id)).size).toBe(onServer.length);
  expect(onServer.filter((s) => s.result === "admitted")).toHaveLength(3);
  expect(onServer.filter((s) => s.result === "revoked")).toHaveLength(1);
  await expect
    .poll(async () => (await admin.call<{ on_site: number }>("GET", `/events/${w.eventId}/summary?series_minutes=0`)).on_site, { timeout: 15_000 })
    .toBe(3);
  test.info().annotations.push({ type: "scan uploads", description: `POST /scans batches: ${JSON.stringify(posts)}` });
  await ctx.close();
});
