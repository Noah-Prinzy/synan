/**
 * Journey 8 (docs/07 §2.6): a band bound at the wristband desk by a desk clerk admits on a tap at an
 * interior gate. There is no NFC hardware in the test: the band number is typed, as a USB reader or
 * the "123" sheet would type it.
 */
import { expect, test } from "@playwright/test";
import { assign, closeWorld, createStaff, createWorld, registerGuest, stockBands, type World } from "../support/world.ts";
import { adminSignIn, phone, scannerManualEntry, scannerSignIn, verdict } from "../support/ui.ts";

let w: World;
test.beforeAll(async () => {
  w = await createWorld({ name: "j8" });
});
test.afterAll(async () => closeWorld(w));

test("J8: a desk clerk binds a band from stock; the band opens the lounge door on a tap", async ({ page, browser }) => {
  const guest = await registerGuest(w, { tier: "VIP", name: "Dana Desk" });
  const [uid] = await stockBands(w.admin, 1);
  const clerk = await createStaff(w.admin, "desk_clerk", "clerk-j8");
  await assign(w.admin, clerk.id, w.gates.entrance.id, w.eventId);

  const bandsOf = async () =>
    ((await w.admin.call<{ items: { id: string; carriers: { kind: string; state: string; identifier_hint: string | null }[] }[] }>("GET", `/credentials?event_id=${w.eventId}&limit=200`)).items
      .find((c) => c.id === guest.credentialId)?.carriers ?? []).filter((c) => c.kind === "nfc");

  await adminSignIn(page, clerk.email, clerk.password);
  await expect(page).toHaveURL(/\/admin\/desk$/);
  await expect(page.getByRole("heading", { level: 1, name: "Wristband desk" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(w.title);

  await page.getByRole("combobox", { name: "Find an attendee" }).fill(guest.name);
  await page.getByRole("option", { name: new RegExp(`^${guest.name}`) }).click();
  const card = page.getByRole("article", { name: guest.name });
  await expect(card.getByRole("term").filter({ hasText: "Band" }).locator("xpath=following-sibling::dd[1]")).toHaveText("No band yet");
  const bind = card.getByRole("region", { name: "Bind a band" });
  await bind.getByRole("textbox", { name: "Band number" }).fill(uid!);
  await bind.getByRole("textbox", { name: "Band number" }).press("Enter");
  await expect(card.getByRole("term").filter({ hasText: "Band" }).locator("xpath=following-sibling::dd[1]")).toContainText(uid!.slice(-4), { timeout: 15_000 });

  await test.step("server: the band is bound to this pass", async () => {
    const bands = await bandsOf();
    expect(bands).toHaveLength(1);
    expect(bands[0]!.state).toBe("bound");
    expect(bands[0]!.identifier_hint).toContain(uid!.slice(-4));
  });

  const ctx = await phone(browser);
  const door = await ctx.newPage();
  await scannerSignIn(door, w.gates.lounge.staff.email, w.gates.lounge.staff.password, "Lounge Door");
  await scannerManualEntry(door, uid!);
  await expect(verdict(door)).toContainText("ADMITTED");
  await expect(verdict(door)).toContainText("VIP");

  const scans = (await w.admin.call<{ items: { result: string; checkpoint_id: string; carrier_kind?: string }[] }>("GET", `/scans?event_id=${w.eventId}&limit=50`)).items;
  expect(scans).toHaveLength(1);
  expect(scans[0]).toMatchObject({ result: "admitted", checkpoint_id: w.gates.lounge.id });
  expect((await bandsOf())[0]!.state, "the band is in use after its first tap").toBe("active");
  await ctx.close();
});
