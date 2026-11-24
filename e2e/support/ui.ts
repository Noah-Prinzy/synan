/**
 * Driving the three apps the way their users do: sign-in screens, the second-factor prompt, the
 * attendee's emailed link, the scanner's gate choice and manual entry, and the network switch.
 */
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { APP_URLS, ORIGINS } from "../ports.ts";
import { ctl, linkIn, mailMark, waitForMail } from "./api.ts";

/* ---------- Admin Command ---------- */

/** Sign in to Admin Command with email and password (the second factor is asked only on step-up). */
export async function adminSignIn(page: Page, email: string, password: string) {
  await page.goto(APP_URLS.admin);
  const form = page.getByRole("region", { name: "Sign in" });
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Password").fill(password);
  await form.getByRole("button", { name: "Sign in" }).click();
  await expect(form).toBeHidden();
}

/** The seeded admin. */
export async function adminSignInSeeded(page: Page) {
  const seed = await ctl.seed();
  await adminSignIn(page, seed.emails.admin, seed.password);
}

/** Answer the second-factor prompt with a fresh code from the seeded admin's authenticator. */
export async function answerStepUp(page: Page, secret?: string) {
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("textbox") });
  await expect(dialog).toBeVisible();
  const code = await ctl.totp(secret);
  const box = dialog.getByRole("textbox").first();
  await box.click();
  await page.keyboard.type(code);
  // Some prompts submit on the sixth digit; others need the button.
  const confirm = dialog.getByRole("button", { name: /verify|confirm|continue/i });
  if (await confirm.isVisible().catch(() => false)) await confirm.click().catch(() => undefined);
  await expect(dialog).toBeHidden();
}

/** Pick the event the console works on (the top bar's event switcher). */
export async function chooseConsoleEvent(page: Page, title: string) {
  const switcher = page.getByRole("button", { name: /^Event: .*Change event$/ });
  if ((await switcher.getAttribute("aria-label"))?.includes(title) || (await switcher.textContent())?.includes(title)) return;
  await switcher.click();
  await page.getByRole("option", { name: new RegExp(escapeRe(title)) }).or(page.getByRole("menuitemradio", { name: new RegExp(escapeRe(title)) })).or(page.getByRole("button", { name: new RegExp(escapeRe(title)) })).first().click();
  await expect(page.getByRole("button", { name: /^Event: .*Change event$/ })).toContainText(title);
}

/* ---------- Attendee Portal ---------- */

/** Open the newest sign-in link emailed to `email` in this page (any device). */
export async function openEmailedLink(page: Page, email: string, after = 0, tag = "auth.link") {
  const mail = await waitForMail({ to: email, tag, after });
  await page.goto(linkIn(mail));
  return mail;
}

/** Sign an existing attendee in from the A9 screen and the emailed link. Lands on the pass. */
export async function attendeeSignIn(page: Page, email: string) {
  await page.goto(`${ORIGINS.attendee}/sign-in?next=%2Fpass`);
  const mark = await mailMark();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: /send|sign in|email me/i }).first().click();
  await openEmailedLink(page, email, mark);
  await expect(page).toHaveURL(/\/pass$/, { timeout: 15_000 });
}

/** A phone-sized context: "another device" in the journeys. */
export async function phone(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block", locale: "en-GB", timezoneId: "Africa/Kampala" });
}

/* ---------- Gate Scanner ---------- */

/** Sign in to the Gate Scanner and choose the gate (its label, as on the gate list). */
export async function scannerSignIn(page: Page, email: string, password: string, gateLabel: string) {
  await page.goto(APP_URLS.scanner);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: new RegExp(`^${escapeRe(gateLabel)}`) }).click();
  await expect(page.getByRole("link", { name: new RegExp(`^Gate: ${escapeRe(gateLabel)}`) })).toBeVisible();
}

/** Type a wristband number or a pass code into the scanner's "123" sheet and check it. */
export async function scannerManualEntry(page: Page, value: string) {
  await page.getByRole("button", { name: /Type a number/ }).click();
  const sheet = page.getByRole("dialog", { name: "Type a wristband number" });
  await sheet.getByRole("textbox").fill(value);
  await sheet.getByRole("button", { name: "Check" }).click();
  await expect(sheet).toBeHidden();
}

/** The verdict region of the scan screen. */
export const verdict = (page: Page) => page.getByRole("region", { name: "Verdict" });

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
