/**
 * Journey 3 (docs/07 §2.6): an invitation is answered exactly once — accept; the same link reused is
 * refused; and the decline path.
 */
import { expect, test } from "@playwright/test";
import { apiRaw, linkIn, uniq, waitForMail } from "../support/api.ts";
import { closeWorld, createWorld, invite, type World } from "../support/world.ts";
import { phone } from "../support/ui.ts";

let w: World;
test.beforeEach(async () => {
  w = await createWorld({ name: "j3" });
});
test.afterEach(async () => closeWorld(w));

const registrationsOf = async (email: string) => {
  const regs = await w.admin.call<{ items: Record<string, unknown>[] }>("GET", `/events/${w.eventId}/registrations?limit=200`);
  return regs.items.filter((r) => JSON.stringify(r).includes(email));
};

test("J3a: accept once; the same link is refused afterwards, on any device", async ({ page, browser }) => {
  const email = `${uniq("e2e-invitee")}@synan.dev`.toLowerCase();
  const token = await invite(w, email);
  const mail = await waitForMail({ to: email, tag: "invitation" });

  await page.goto(linkIn(mail));
  await expect(page.getByRole("heading", { level: 1, name: w.title })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Will you join us?" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("Step 2 of 2")).toBeVisible();
  await page.getByLabel(/name/i).first().fill("Grace Hopper");
  await page.getByRole("button", { name: /accept|confirm|send|join/i }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "You're in." })).toBeVisible();

  await test.step("server: one confirmed registration, invitation spent, pass emailed", async () => {
    const regs = await registrationsOf(email);
    expect(regs).toHaveLength(1);
    expect(regs[0]!.state).toBe("confirmed");
    await waitForMail({ to: email, tag: "pass.email_qr" });
    const again = await apiRaw<{ error: { code: string } }>("POST", "/invitations/rsvp", { body: { token, email, accept: true, full_name: "Grace Hopper", zone_presence_consent: false } });
    expect(again.body.error.code, JSON.stringify(again.body)).toBe("LINK_INVALID");
  });

  await test.step("the link opened again, on another device, is refused", async () => {
    const ctx = await phone(browser);
    const second = await ctx.newPage();
    await second.goto(linkIn(mail));
    await expect(second.getByRole("heading", { level: 1, name: "This invitation link no longer works." })).toBeVisible();
    await expect(second.getByRole("button", { name: "Accept" })).toHaveCount(0);
    await ctx.close();
    expect(await registrationsOf(email)).toHaveLength(1);
  });
});

test("J3b: decline; nothing is registered and the link is spent", async ({ page, browser }) => {
  const email = `${uniq("e2e-decliner")}@synan.dev`.toLowerCase();
  const token = await invite(w, email);
  const mail = await waitForMail({ to: email, tag: "invitation" });

  await page.goto(linkIn(mail));
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Decline" }).click();
  const confirm = page.getByRole("button", { name: /decline/i });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(page.getByRole("heading", { level: 1, name: "Thanks for letting us know." })).toBeVisible();

  expect(await registrationsOf(email)).toHaveLength(0);
  const again = await apiRaw<{ error: { code: string } }>("POST", "/invitations/read", { body: { token } });
  expect(again.body.error.code).toBe("LINK_INVALID");
  // This device remembers the reply; another one is told the link no longer works.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "You've already replied." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept" })).toHaveCount(0);
  const ctx = await phone(browser);
  const second = await ctx.newPage();
  await second.goto(linkIn(mail));
  await expect(second.getByRole("heading", { level: 1, name: "This invitation link no longer works." })).toBeVisible();
  await expect(second.getByRole("button", { name: "Accept" })).toHaveCount(0);
  await ctx.close();
});
