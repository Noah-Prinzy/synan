/**
 * Journey 2 (docs/07 §2.6): an attendee registers, signs in from the emailed link on a second device,
 * and sees the pass with a rotating code.
 */
import { expect, test } from "@playwright/test";
import { ORIGINS } from "../ports.ts";
import { apiRaw, linkIn, mailMark, scanAt, uniq, waitForMail } from "../support/api.ts";
import { closeWorld, createWorld, type World } from "../support/world.ts";
import { phone } from "../support/ui.ts";

let w: World;
test.beforeAll(async () => {
  w = await createWorld({ name: "j2" });
});
test.afterAll(async () => closeWorld(w));

test("J2: register on one device, open the link on another, see the pass and its code rotate", async ({ page, browser }) => {
  const email = `${uniq("e2e-ada")}@synan.dev`.toLowerCase();
  const name = "Ada Lovelace";

  await test.step("A3: register on the laptop", async () => {
    await page.goto(`${ORIGINS.attendee}/events/${w.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: w.title })).toBeVisible();
    await page.getByRole("link", { name: "Register" }).click();
    await page.getByLabel("Full name").fill(name);
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "A few questions" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Check and send" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Your details" })).toContainText(email);
  });

  const mark = await mailMark();
  await page.getByRole("button", { name: "Send my pass" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "You're in." })).toBeVisible();
  await expect(page.getByRole("region", { name: "Your pass is on its way." })).toContainText(email);

  const mail = await waitForMail({ to: email, tag: "auth.link", after: mark });
  expect(mail.text).toContain(`confirms your registration for ${w.title}`);

  await test.step("server: the registration waits for the link (nothing confirmed yet)", async () => {
    const regs = await w.admin.call<{ items: { email?: string | null; full_name?: string | null }[] }>("GET", `/events/${w.eventId}/registrations?limit=200`);
    expect(JSON.stringify(regs.items)).not.toContain(email);
  });

  const other = await phone(browser);
  const phonePage = await other.newPage();
  // The browser's clock runs from now; fast-forwarding it shows the next code without waiting a minute.
  await phonePage.clock.install();
  const codes = phonePage.waitForResponse((r) => r.url().includes("/api/v1/me/credential/codes") && r.ok());

  await test.step("A9: the link signs the phone in and opens the pass", async () => {
    await phonePage.goto(linkIn(mail));
    await expect(phonePage.getByRole("heading", { level: 1, name: "You're in" })).toBeVisible();
    await expect(phonePage).toHaveURL(`${ORIGINS.attendee}/pass`);
  });

  const pass = phonePage.getByRole("article", { name: `Pass for ${w.title}` });
  await expect(pass).toContainText(name);
  await expect(pass).toContainText("Ordinary");
  await expect(pass).toContainText("NOT YET BOUND");
  const qr = pass.getByRole("img", { name: `Arrival code for ${name}` });
  await expect(qr).toBeVisible();

  const batch = (await (await codes).json()) as { codes: { code: string; not_before: string; expires_at: string }[]; rotate_every_s: number };
  expect(batch.codes.length).toBeGreaterThan(1);
  expect(new Set(batch.codes.map((c) => c.code)).size).toBe(batch.codes.length);

  await test.step("the code rotates", async () => {
    const first = await qr.innerHTML();
    await phonePage.clock.fastForward(batch.rotate_every_s * 1000 + 1_000);
    await expect.poll(async () => (await pass.getByRole("img", { name: `Arrival code for ${name}` }).innerHTML()) !== first, { timeout: 10_000 }).toBe(true);
    await expect(pass.getByRole("img", { name: `Arrival code for ${name}` })).toBeVisible();
  });

  await test.step("server: the registration is confirmed and the code shown is a live pass at the gate", async () => {
    const regs = await w.admin.call<{ items: { state?: string; email?: string | null; full_name?: string | null }[] }>("GET", `/events/${w.eventId}/registrations?limit=200`);
    const mine = regs.items.find((r) => JSON.stringify(r).includes(email));
    expect(mine, JSON.stringify(regs.items)).toBeTruthy();
    expect(mine!.state).toBe("confirmed");
    const now = Date.now();
    const current = batch.codes.find((c) => Date.parse(c.not_before) <= now && Date.parse(c.expires_at) > now);
    expect(current, "a code valid now").toBeTruthy();
    const outcome = await scanAt(w.gates.entrance, w.eventId, { medium: "qr", data: current!.code });
    expect(["admitted", "wristband_required"]).toContain(outcome.result);
    expect(outcome.tier).toBe("ORDINARY");
  });

  await test.step("the laptop is not signed in: the link worked on the phone only", async () => {
    await page.goto(`${ORIGINS.attendee}/pass`);
    await expect(page).toHaveURL(/\/sign-in/);
  });
  // The emailed link works once.
  const reuse = await apiRaw<{ error: { code: string } }>("POST", "/auth/verify", { body: { token: decodeURIComponent(new URL(linkIn(mail)).hash.match(/token=([^&]+)/)![1]!) } });
  expect(reuse.status).toBeGreaterThanOrEqual(400);
  expect(reuse.body.error.code).toMatch(/^LINK_(INVALID|EXPIRED)$/);
  await other.close();
});
