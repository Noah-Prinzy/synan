/**
 * Role guards (D-23): each role lands on its own page and is refused elsewhere — in the browser, and
 * by the server for the same thing done through the API.
 */
import { expect, test, type Page } from "@playwright/test";
import { apiRaw, ctl, loginAs, type Caller } from "../support/api.ts";
import { assign, closeWorld, createStaff, createWorld, registerGuest, signIn, type World } from "../support/world.ts";
import { adminSignIn, attendeeSignIn, phone } from "../support/ui.ts";
import { APP_URLS } from "../ports.ts";

let w: World;
test.beforeAll(async () => {
  w = await createWorld({ name: "j11" });
});
test.afterAll(async () => closeWorld(w));

const refusedHere = async (page: Page, path: string) => {
  await page.goto(`${APP_URLS.admin}${path}`);
  await expect(page.getByRole("heading", { level: 1, name: "This screen is not part of your console" })).toBeVisible();
};
const status = async (c: Caller, method: string, path: string, body?: unknown) => (await c.raw(method, path, body)).status;

test("admin: lands on the Command Center and may open every screen", async ({ page }) => {
  const seed = await ctl.seed();
  await adminSignIn(page, seed.emails.admin, seed.password);
  await expect(page.getByRole("heading", { level: 1, name: /^Command Center — / })).toBeVisible();
  for (const [path, heading] of [["venues", "Venues"], ["staff", /Staff/], ["desk", "Wristband desk"], ["alerts", "Security alerts"]] as const) {
    await page.goto(`${APP_URLS.admin}${path}`);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
  const admin = await loginAs(seed.emails.admin);
  expect(await status(admin, "GET", "/staff")).toBe(200);
});

test("organiser: lands on the Command Center; refused venues and staff", async ({ page }) => {
  const seed = await ctl.seed();
  await adminSignIn(page, seed.emails.organiser, seed.password);
  await expect(page.getByRole("heading", { level: 1, name: /^Command Center — / })).toBeVisible();
  await page.goto(`${APP_URLS.admin}events`);
  await expect(page.getByRole("heading", { level: 1, name: "Events" })).toBeVisible();
  await refusedHere(page, "venues");
  await refusedHere(page, "staff");
  const organiser = await loginAs(seed.emails.organiser);
  expect(await status(organiser, "GET", "/staff")).toBe(403);
  expect(await status(organiser, "POST", "/venues", { name: "Not mine", timezone: "Africa/Kampala" })).toBe(403);
  expect(await status(organiser, "GET", `/events/${w.eventId}/admin`)).toBe(200);
});

test("supervisor: lands on the Command Center; refused events and the desk", async ({ page }) => {
  const sup = await createStaff(w.admin, "supervisor", "sup-j11");
  await adminSignIn(page, sup.email, sup.password);
  await expect(page.getByRole("heading", { level: 1, name: /^Command Center — / })).toBeVisible();
  await page.goto(`${APP_URLS.admin}alerts`);
  await expect(page.getByRole("heading", { level: 1, name: "Security alerts" })).toBeVisible();
  await refusedHere(page, "events");
  await refusedHere(page, "desk");
  const c = await signIn(sup.email, sup.password);
  expect(await status(c, "GET", "/admin/events")).toBe(403);
  expect(await status(c, "GET", `/events/${w.eventId}/admin`)).toBe(403);
  expect(await status(c, "GET", "/dashboard")).toBe(200);
});

test("desk clerk: lands on the wristband desk (also from the console's home); refused alerts and the access log", async ({ page }) => {
  const clerk = await createStaff(w.admin, "desk_clerk", "clerk-j11");
  await assign(w.admin, clerk.id, w.gates.entrance.id, w.eventId);
  await adminSignIn(page, clerk.email, clerk.password);
  await expect(page).toHaveURL(/\/admin\/desk$/);
  await expect(page.getByRole("heading", { level: 1, name: "Wristband desk" })).toBeVisible();
  await refusedHere(page, "alerts");
  await refusedHere(page, "access-log");
  await page.goto(APP_URLS.admin);
  await expect(page).toHaveURL(/\/admin\/desk$/);
  const c = await signIn(clerk.email, clerk.password);
  expect(await status(c, "GET", "/dashboard")).toBe(403);
  expect(await status(c, "GET", `/breach-alerts?event_id=${w.eventId}`)).toBe(403);
});

test("gate staff: the console sends them to the Gate Scanner, which works", async ({ page, browser }) => {
  const g = w.gates.entrance.staff;
  await adminSignIn(page, g.email, g.password);
  await expect(page.getByRole("heading", { level: 1, name: "This account uses the Gate Scanner" })).toBeVisible();
  const ctx = await phone(browser);
  const scanner = await ctx.newPage();
  await scanner.goto(APP_URLS.scanner);
  await scanner.getByLabel("Email").fill(g.email);
  await scanner.getByLabel("Password").fill(g.password);
  await scanner.getByRole("button", { name: "Sign in" }).click();
  await expect(scanner.getByRole("heading", { level: 1, name: "Choose your gate" })).toBeVisible();
  await expect(scanner.getByRole("button", { name: /^Front Door/ })).toBeVisible();
  await expect(scanner.getByRole("button", { name: /^Lounge Door/ }), "only their own gates").toHaveCount(0);
  await ctx.close();
  const c = await signIn(g.email, g.password);
  expect(await status(c, "GET", "/admin/events")).toBe(403);
  expect(await status(c, "GET", "/dashboard")).toBe(403);
});

test("attendee: lands on their pass; operator screens and endpoints refuse them", async ({ page }) => {
  const guest = await registerGuest(w, { name: "Ali Attendee" });
  await attendeeSignIn(page, guest.email);
  await expect(page.getByRole("article", { name: `Pass for ${w.title}` })).toBeVisible();
  expect(await status(guest.me, "GET", "/dashboard")).toBe(403);
  expect(await status(guest.me, "GET", `/credentials?event_id=${w.eventId}`)).toBe(403);
  expect(await status(guest.me, "POST", "/scans", { event_id: w.eventId, device_id: "x", scans: [] })).toBe(403);
  // No password: the console's sign-in refuses the address.
  const r = await apiRaw("POST", "/auth/login", { body: { email: guest.email, password: "not-a-password-1" } });
  expect(r.status).toBe(401);
  await page.goto(APP_URLS.admin);
  const form = page.getByRole("region", { name: "Sign in" });
  await form.getByLabel("Email").fill(guest.email);
  await form.getByLabel("Password").fill("not-a-password-1");
  await form.getByRole("button", { name: "Sign in" }).click();
  await expect(form.getByRole("status")).not.toBeEmpty();
  await expect(form).toBeVisible();
});
