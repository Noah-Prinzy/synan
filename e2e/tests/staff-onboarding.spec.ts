/**
 * Staff onboarding (01 §3, 03 §3, 06 §2–§3): an invited staff member opens the emailed activation
 * link, which opens their role's own app, sets a password with its rules shown as they type, and
 * signs in — a console role goes on to authenticator set-up; gate staff to the gate list. Links
 * already sent to the Attendee Portal's /staff/activate still work. (The suite's fixtures still
 * activate staff through POST /auth/activate directly: these tests are the screens.)
 */
import { expect, test, type Page } from "@playwright/test";
import { adminApi, linkIn, mailMark, uniq, waitForMail } from "../support/api.ts";
import { APP_URLS, ORIGINS } from "../ports.ts";

const PASSWORD = "four unrelated words here";

async function inviteStaff(role: string, label: string) {
  const admin = await adminApi();
  const email = `${uniq(`e2e-${label}`)}@synan.dev`.toLowerCase();
  const mark = await mailMark();
  await admin.call("POST", "/staff", { email, role, display_name: `New ${label}` });
  const link = linkIn(await waitForMail({ to: email, tag: "staff.invite", after: mark }));
  return { email, link, token: new URL(link).hash.replace(/^#token=/, "") };
}

/** Type the password with its rules checked live, confirm it, and submit. */
async function setPassword(page: Page) {
  const rules = page.getByRole("list").filter({ hasText: "At least 12 characters" });
  const rule = (text: string) => rules.getByRole("listitem").filter({ hasText: text });
  const password = page.getByLabel("New password");
  await password.fill("too short");
  await expect(rules).toContainText("(9 so far)");
  await expect(rule("At least 12 characters")).toContainText("not yet");
  await password.fill(PASSWORD);
  await expect(rule("At least 12 characters")).toContainText("done");
  await page.getByLabel("Type it again").fill(`${PASSWORD}!`);
  await expect(rule("Both entries match")).toContainText("not yet");
  await page.getByLabel("Type it again").fill(PASSWORD);
  await expect(rule("Both entries match")).toContainText("done");
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Password set" })).toBeVisible();
}

test("a supervisor activates in the Admin Command, signs in, and is taken to authenticator set-up", async ({ page }) => {
  const { email, link } = await inviteStaff("supervisor", "newsup");
  expect(link.startsWith(`${APP_URLS.admin}activate#token=`), link).toBe(true);
  await page.goto(link);
  await expect(page.getByRole("heading", { level: 1, name: "Set your password" })).toBeVisible();
  expect(new URL(page.url()).hash, "the token leaves the address bar").toBe("");
  await expect(page.getByRole("main")).toContainText("Supervisor");
  await setPassword(page);

  await page.getByRole("button", { name: "Sign in" }).click();
  const form = page.getByRole("region", { name: "Sign in" });
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Password").fill(PASSWORD);
  await form.getByRole("button", { name: "Sign in" }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole("dialog").filter({ hasText: "Set up your authenticator" })).toBeVisible({ timeout: 10_000 });

  // The link worked once.
  await page.goto(link);
  await expect(page.getByRole("heading", { level: 1, name: "Link already used" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("ask an admin to send you a new invitation");
});

test("gate staff activate in the Gate Scanner and sign in to choose their gate", async ({ page }) => {
  const { email, link } = await inviteStaff("security_staff", "newgate");
  expect(link.startsWith(`${APP_URLS.scanner}activate#token=`), link).toBe(true);
  await page.goto(link);
  await expect(page.getByRole("heading", { level: 1, name: "Set your password" })).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  await setPassword(page);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Choose your gate" })).toBeVisible();
});

test("a link already sent to the Attendee Portal still works: it forwards to the console, and a gate link on to the scanner", async ({ page }) => {
  const clerk = await inviteStaff("desk_clerk", "oldclerk");
  await page.goto(`${ORIGINS.attendee}/staff/activate#token=${clerk.token}`);
  await expect(page).toHaveURL(new RegExp(`^${APP_URLS.admin}activate`));
  await expect(page.getByRole("heading", { level: 1, name: "Set your password" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Desk clerk");

  const gate = await inviteStaff("security_staff", "oldgate");
  await page.goto(`${ORIGINS.attendee}/staff/activate#token=${gate.token}`);
  await expect(page).toHaveURL(new RegExp(`^${APP_URLS.scanner}activate`));
  await expect(page.getByRole("heading", { level: 1, name: "Set your password" })).toBeVisible();
});

test("a link that is not ours says so and says what to do next", async ({ page }) => {
  await page.goto(`${APP_URLS.admin}activate#token=${["not", "a", "real", "activation", "link"].join("-")}`);
  await expect(page.getByRole("heading", { level: 1, name: "Link not valid" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("ask an admin to send you a new invitation");
  await page.goto(`${APP_URLS.admin}activate`);
  await expect(page.getByRole("heading", { level: 1, name: "Link not valid" })).toBeVisible();
});
