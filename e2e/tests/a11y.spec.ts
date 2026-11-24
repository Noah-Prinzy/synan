/**
 * Accessibility smoke check (axe-core, WCAG 2.1 A and AA rules) on the main screens of the three apps,
 * in real-API mode with real data. Every violation is attached to the test and written to
 * .results/a11y/<screen>.json; a screen fails only on serious or critical ones.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { linkIn, waitForMail } from "../support/api.ts";
import { assign, bindBand, closeWorld, createStaff, createWorld, invite, registerGuest, type Guest, type World } from "../support/world.ts";
import { adminSignIn, adminSignInSeeded, attendeeSignIn, chooseConsoleEvent, scannerManualEntry, scannerSignIn } from "../support/ui.ts";
import { APP_URLS, ORIGINS } from "../ports.ts";

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.results/a11y");

let w: World;
let guest: Guest;
let band = "";
test.beforeAll(async () => {
  w = await createWorld({ name: "a11y" });
  guest = await registerGuest(w, { tier: "VIP", name: "Axe Person" });
  band = await bindBand(w, guest);
});
test.afterAll(async () => closeWorld(w));

async function check(page: Page, screen: string) {
  // Let entrance animations settle so colour checks read the final colours.
  await page.waitForTimeout(800);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const found = result.violations.map((v) => ({
    rule: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
    targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
    html: v.nodes.slice(0, 5).map((n) => n.html.slice(0, 200)),
  }));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, `${screen.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`), JSON.stringify({ screen, url: page.url(), violations: found }, null, 2));
  await test.info().attach(`axe ${screen}`, { body: JSON.stringify(found, null, 2), contentType: "application/json" });
  for (const v of found) test.info().annotations.push({ type: `axe ${v.impact}`, description: `${v.rule} ×${v.nodes}: ${v.help}` });
  const blocking = found.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking, `serious or critical violations on ${screen}`).toEqual([]);
}

test.describe("Attendee Portal @a11y", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("A1 Discover", async ({ page }) => {
    await page.goto(ORIGINS.attendee);
    await expect(page.getByRole("link", { name: new RegExp(w.title) }).first()).toBeVisible();
    await check(page, "A1 Discover");
  });
  test("A2 Event detail", async ({ page }) => {
    await page.goto(`${ORIGINS.attendee}/events/${w.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: w.title })).toBeVisible();
    await check(page, "A2 Event detail");
  });
  test("A3 Registration", async ({ page }) => {
    await page.goto(`${ORIGINS.attendee}/events/${w.slug}/register`);
    await expect(page.getByLabel("Full name")).toBeVisible();
    await check(page, "A3 Registration");
  });
  test("A9 Sign in", async ({ page }) => {
    await page.goto(`${ORIGINS.attendee}/sign-in`);
    await expect(page.getByLabel("Email")).toBeVisible();
    await check(page, "A9 Sign in");
  });
  test("A4 My pass", async ({ page }) => {
    await attendeeSignIn(page, guest.email);
    await expect(page.getByRole("article", { name: `Pass for ${w.title}` })).toBeVisible();
    await check(page, "A4 My pass");
  });
  test("A10 Invitation", async ({ page }) => {
    const email = `e2e-axe-${Date.now()}@synan.dev`;
    await invite(w, email);
    await page.goto(linkIn(await waitForMail({ to: email, tag: "invitation" })));
    await expect(page.getByRole("heading", { name: "Will you join us?" })).toBeVisible();
    await check(page, "A10 Invitation");
  });
});

test.describe("Admin Command @a11y", () => {
  test("Sign in", async ({ page }) => {
    await page.goto(APP_URLS.admin);
    await expect(page.getByRole("region", { name: "Sign in" })).toBeVisible();
    await check(page, "Admin sign in");
  });
  test("D1 Command Center, D10 Alerts, D12 Gate health, D9 Access log, D4 Events, D6 Reports", async ({ page }) => {
    await adminSignInSeeded(page);
    await chooseConsoleEvent(page, w.title);
    await expect(page.getByRole("heading", { level: 1, name: /^Command Center/ })).toBeVisible();
    const failed: string[] = [];
    await test.step("D1 Command Center", () => check(page, "D1 Command Center")).catch((e) => failed.push(`D1 Command Center: ${String(e).slice(0, 200)}`));
    for (const [p, heading, name] of [
      ["alerts", "Security alerts", "D10 Alerts"],
      ["gates", /Gate/, "D12 Gate health"],
      ["access-log", /Access log/, "D9 Access log"],
      ["events", "Events", "D4 Events"],
      [`events/${w.eventId}/reports`, /./, "D6 Event reports"],
    ] as const) {
      await page.goto(`${APP_URLS.admin}${p}`);
      await expect(page.getByRole("heading", { level: 1, name: heading }).first()).toBeVisible();
      await test.step(name, () => check(page, name)).catch((e) => failed.push(`${name}: ${String(e).slice(0, 200)}`));
    }
    expect(failed, "screens with serious or critical violations").toEqual([]);
  });
  test("D8 Wristband desk (desk clerk)", async ({ page }) => {
    const clerk = await createStaff(w.admin, "desk_clerk", "clerk-axe");
    await assign(w.admin, clerk.id, w.gates.entrance.id, w.eventId);
    await adminSignIn(page, clerk.email, clerk.password);
    await page.getByRole("combobox", { name: "Find an attendee" }).fill(guest.name);
    await page.getByRole("option", { name: new RegExp(`^${guest.name}`) }).click();
    await expect(page.getByRole("article", { name: guest.name })).toBeVisible();
    await check(page, "D8 Wristband desk");
  });
});

test.describe("Gate Scanner @a11y", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("S1 Sign in, S2 Scan with a verdict, Queue, Recent", async ({ page }) => {
    await page.goto(APP_URLS.scanner);
    await expect(page.getByLabel("Email")).toBeVisible();
    const results: string[] = [];
    const run = async (name: string) => test.step(name, () => check(page, name)).catch((e) => results.push(`${name}: ${String(e).slice(0, 200)}`));
    await run("S1 Scanner sign in");
    await scannerSignIn(page, w.gates.lounge.staff.email, w.gates.lounge.staff.password, "Lounge Door");
    await run("S2 Scan, ready");
    await scannerManualEntry(page, band);
    await expect(page.getByRole("region", { name: "Verdict" })).toContainText("ADMITTED");
    await run("S2 Scan, verdict");
    await page.getByRole("link", { name: /^Queue/ }).click();
    await run("S4 Queue");
    await page.getByRole("link", { name: "Recent" }).click();
    await run("S3 Recent");
    expect(results, "screens with serious or critical violations").toEqual([]);
  });
});
