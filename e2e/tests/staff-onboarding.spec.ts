/**
 * Staff onboarding, met on the way to the role journeys: an invited staff member opens the emailed
 * activation link and sets a password. The suite's fixtures activate staff through POST /auth/activate
 * because no screen does it today.
 */
import { expect, test } from "@playwright/test";
import { adminApi, linkIn, mailMark, uniq, waitForMail } from "../support/api.ts";

test("an invited staff member sets a password from the emailed link", async ({ page }) => {
  test.fail(true, "DEFECT: the staff invitation links to the Attendee Portal at /staff/activate (apps/api/src/routes/staff.ts builds it on ATTENDEE_APP_ORIGIN), and no app has that route: the portal shows its not-found page. Invited supervisors, desk clerks and gate staff cannot activate their accounts without help.");
  const admin = await adminApi();
  const email = `${uniq("e2e-newstaff")}@synan.dev`.toLowerCase();
  const mark = await mailMark();
  await admin.call("POST", "/staff", { email, role: "supervisor", display_name: "New Supervisor" });
  const mail = await waitForMail({ to: email, tag: "staff.invite", after: mark });
  await page.goto(linkIn(mail));
  await expect(page.getByLabel(/password/i).first(), "a screen to set the password").toBeVisible({ timeout: 5_000 });
});
