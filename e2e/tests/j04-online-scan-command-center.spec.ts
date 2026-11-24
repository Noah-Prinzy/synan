/**
 * Journey 4 (docs/07 §2.6): an online scan at a gate admits, and the admin's Command Center updates —
 * the on-site count and the room on the map — without a reload.
 */
import { expect, test } from "@playwright/test";
import { closeWorld, createWorld, bindBand, currentPassCode, registerGuest, type World } from "../support/world.ts";
import { adminSignInSeeded, chooseConsoleEvent, phone, scannerManualEntry, scannerSignIn, verdict } from "../support/ui.ts";

let w: World;
test.beforeAll(async () => {
  w = await createWorld({ name: "j4" });
});
test.afterAll(async () => closeWorld(w));

test("J4: a QR admitted at the entrance and a band at the lounge door show on the Command Center live", async ({ page, browser }) => {
  const guest = await registerGuest(w, { tier: "VIP", name: "Vera Live" });
  const uid = await bindBand(w, guest);

  await adminSignInSeeded(page);
  await chooseConsoleEvent(page, w.title);
  await expect(page.getByRole("heading", { level: 1, name: `Command Center — ${w.title}` })).toBeVisible();
  const onSite = page.getByRole("term").filter({ hasText: "On site now" }).locator("xpath=following-sibling::dd[1]");
  await expect(onSite).toHaveText("0");
  const map = page.getByRole("region", { name: "Venue map" });
  await expect(map.getByRole("group", { name: /^Venue map/ }).getByRole("button", { name: /^Green Lounge,/ })).toHaveAccessibleName(/: 0 of 20[,.]/);
  const navigations: string[] = [];
  page.on("framenavigated", (f) => f === page.mainFrame() && navigations.push(f.url()));

  const gateCtx = await phone(browser);
  const gate = await gateCtx.newPage();
  await scannerSignIn(gate, w.gates.entrance.staff.email, w.gates.entrance.staff.password, "Front Door");
  await scannerManualEntry(gate, await currentPassCode(guest, w.eventId));
  await expect(verdict(gate)).toContainText("ADMITTED");

  await expect(onSite).toHaveText("1", { timeout: 15_000 });

  const doorCtx = await phone(browser);
  const door = await doorCtx.newPage();
  await scannerSignIn(door, w.gates.lounge.staff.email, w.gates.lounge.staff.password, "Lounge Door");
  await scannerManualEntry(door, uid);
  await expect(verdict(door)).toContainText("ADMITTED");

  // The map's room (a button named with its live count) and the rooms rail both follow the scan.
  const loungeOnMap = map.getByRole("group", { name: /^Venue map, 2 rooms/ }).getByRole("button", { name: /^Green Lounge,/ });
  await expect(loungeOnMap).toHaveAccessibleName(/: 1 of 20[,.]/, { timeout: 15_000 });
  await expect(map.getByRole("group", { name: /^Venue map/ }).getByRole("button", { name: /^Main Hall,/ })).toHaveAccessibleName(/: 0 of 100[,.]/);
  await expect(page.getByRole("region", { name: "Rooms" }).getByRole("button", { name: /^Green Lounge,/ })).toHaveAccessibleName(/: 1 of 20[,.]/);
  expect(navigations, "the Command Center never reloaded").toEqual([]);

  // Server: the scans and the counts behind what the screen shows.
  const scans = await w.admin.call<{ items: { result: string; checkpoint_id: string }[] }>("GET", `/scans?event_id=${w.eventId}&limit=50`);
  expect(scans.items.filter((s) => s.result === "admitted").map((s) => s.checkpoint_id).sort()).toEqual([w.gates.entrance.id, w.gates.lounge.id].sort());
  const summary = await w.admin.call<{ on_site: number; checked_in: number }>("GET", `/events/${w.eventId}/summary?series_minutes=0`);
  expect(summary).toMatchObject({ on_site: 1, checked_in: 1 });
  await gateCtx.close();
  await doorCtx.close();
});
