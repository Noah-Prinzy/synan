/**
 * Journey 5 (docs/07 §2.6): a pass revoked by an operator while it is open on the attendee's phone
 * flips live, with no reload.
 */
import { expect, test, type Page } from "@playwright/test";
import { adminApi, scanAt } from "../support/api.ts";
import { bindBand, closeWorld, createStaffWithMfa, createWorld, registerGuest, type World } from "../support/world.ts";
import { adminSignIn, answerStepUp, attendeeSignIn, chooseConsoleEvent, phone } from "../support/ui.ts";

let w: World;
test.beforeEach(async () => {
  w = await createWorld({ name: "j5" });
});
test.afterEach(async () => closeWorld(w));

const credentialState = async (credentialId: string) => {
  const admin = await adminApi();
  const r = await admin.call<{ items: { id: string; state: string }[] }>("GET", `/credentials?event_id=${w.eventId}&limit=200`);
  return r.items.find((c) => c.id === credentialId)?.state;
};

/** The pass card on the attendee's phone, and a guard that fails the test if the page reloads. */
async function openPass(phonePage: Page, email: string) {
  await attendeeSignIn(phonePage, email);
  const pass = phonePage.getByRole("article", { name: `Pass for ${w.title}` });
  await expect(pass).toBeVisible();
  const navigations: string[] = [];
  phonePage.on("framenavigated", (f) => f === phonePage.mainFrame() && navigations.push(f.url()));
  return { pass, navigations };
}

test("J5a: a supervisor revokes a pass under review in the console; the open pass flips to REVOKED", async ({ page, browser }) => {
  const guest = await registerGuest(w, { name: "Rhea View" });
  const uid = await bindBand(w, guest);
  const ctx = await phone(browser);
  const { pass, navigations } = await openPass(await ctx.newPage(), guest.email);
  await expect(pass).toContainText("READY");

  await test.step("two offline entrances admit the same band (a pass-back): the pass goes under review", async () => {
    const now = Date.now();
    const a = await scanAt(w.gates.entrance, w.eventId, { medium: "nfc", uid }, { offline: { atMs: now - 60_000 }, deviceId: "e2e-j5-front" });
    const b = await scanAt(w.gates.side, w.eventId, { medium: "nfc", uid }, { offline: { atMs: now - 30_000 }, deviceId: "e2e-j5-side" });
    expect(a.result).toBe("admitted");
    expect(b.alert_ids.length).toBeGreaterThan(0);
    expect(await credentialState(guest.credentialId)).toBe("suspended_review");
  });
  await expect(pass, "the open pass flips to UNDER REVIEW live").toContainText("UNDER REVIEW", { timeout: 15_000 });

  const sup = await createStaffWithMfa(w.admin, "supervisor", "sup-j5");
  await adminSignIn(page, sup.email, sup.password);
  await chooseConsoleEvent(page, w.title);
  // The console's sections are menus in its top bar (D-37): open People, then its Attendees page.
  const nav = page.getByRole("navigation", { name: "Admin" });
  await nav.getByRole("button", { name: "People" }).click();
  await nav.getByRole("link", { name: "Attendees" }).click();
  // The filter is a radio button whose state follows the URL: click until it reads checked.
  const underReview = page.getByRole("radio", { name: "Passes under review" });
  await expect(async () => {
    await underReview.click();
    await expect(underReview).toBeChecked({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: new RegExp(`^${guest.name}`) }).click();
  const sheet = page.getByRole("complementary", { name: guest.name });
  await sheet.getByLabel("Note for the audit log").fill("Pass-back between two offline doors; confirmed with the holder.");
  await sheet.getByRole("button", { name: "Revoke pass" }).click();
  await answerStepUp(page, sup.mfaSecret);
  await expect(sheet).toContainText(/Revoked/);

  await expect(pass).toContainText("REVOKED", { timeout: 15_000 });
  await expect(pass).toContainText("This pass was cancelled.");
  expect(navigations, "the pass screen never reloaded").toEqual([]);
  expect(await credentialState(guest.credentialId)).toBe("revoked");
  expect((await scanAt(w.gates.entrance, w.eventId, { medium: "nfc", uid })).result).toBe("revoked");
  await ctx.close();
});

test("J5b: an operator revokes an active pass; the open pass flips to REVOKED (console action disabled: revoked through the API)", async ({ browser }) => {
  // The console's own Revoke for an active pass (workspace attendee sheet) is disabled today
  // (docs/07 §1.5 item 10), so the operator's revoke is made through the endpoint the console would call.
  const guest = await registerGuest(w, { name: "Ivo Active" });
  const uid = await bindBand(w, guest);
  const ctx = await phone(browser);
  const { pass, navigations } = await openPass(await ctx.newPage(), guest.email);
  await expect(pass).toContainText("READY");

  const admin = await adminApi();
  await admin.call("POST", `/credentials/${guest.credentialId}/revoke`, { reason: "End-to-end: revoked while the pass is open" });

  await expect(pass).toContainText("REVOKED", { timeout: 15_000 });
  expect(navigations, "the pass screen never reloaded").toEqual([]);
  expect(await credentialState(guest.credentialId)).toBe("revoked");
  expect((await scanAt(w.gates.entrance, w.eventId, { medium: "nfc", uid })).result).toBe("revoked");
  await ctx.close();
});

test("J5c: a pass put under review by a gate conflict flips to UNDER REVIEW on the open pass", async ({ browser }) => {
  const guest = await registerGuest(w, { name: "Una Review" });
  const uid = await bindBand(w, guest);
  const ctx = await phone(browser);
  const phonePage = await ctx.newPage();
  const { pass } = await openPass(phonePage, guest.email);
  await expect(pass).toContainText("READY");
  const now = Date.now();
  await scanAt(w.gates.entrance, w.eventId, { medium: "nfc", uid }, { offline: { atMs: now - 60_000 }, deviceId: "e2e-j5c-front" });
  await scanAt(w.gates.side, w.eventId, { medium: "nfc", uid }, { offline: { atMs: now - 30_000 }, deviceId: "e2e-j5c-side" });
  expect(await credentialState(guest.credentialId)).toBe("suspended_review");
  await expect(pass, "the open pass flips live").toContainText("UNDER REVIEW", { timeout: 15_000 });
  // A reload shows the same state.
  await phonePage.reload();
  await expect(phonePage.getByRole("article", { name: `Pass for ${w.title}` }), "after a reload").toContainText("UNDER REVIEW");
  await ctx.close();
});
