import { routeConfigServer } from "./configServer";
import { expect, test } from "./fixtures";

/**
 * The time zone prompt (scripts/zonePrompt.ts, D239): a device in another zone than the schedule's
 * is asked, never switched. The suite's device is in Stockholm (playwright.config.ts), the zone the
 * fixture build's schedule counts in, so no other test sees the prompt. /api/config is the site's
 * own handler (configServer.ts), so the switch is judged by the edit it produces.
 */

const TOAST = ".toast";
/** What the last check found, said on the root when it ends (scripts/zonePrompt.ts). */
const CHECKED = "data-zone-prompt";
const TOKYO = { timezoneId: "Asia/Tokyo" };

test.describe("time zone prompt", () => {
  test.use(TOKYO);

  test("offers the device's zone, saves it on Switch, and does not ask again after a reload", async ({
    page,
  }) => {
    const server = await routeConfigServer(page);
    await page.goto("/");
    const toast = page.locator(TOAST);
    await expect(toast).toContainText("You're in Tokyo");
    // Never silent: nothing is sent until Switch is pressed.
    expect(server.statuses).toHaveLength(0);

    await toast.getByRole("button", { name: "Switch timezone" }).click();
    await expect
      .poll(() => server.applied)
      .toEqual([{ op: "schedule.set", timezone: "Asia/Tokyo" }]);
    await expect(toast).toContainText("Switched to Tokyo");

    // The build still says Stockholm for a few minutes; the edit saved here is laid over it.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute(CHECKED, "agree");
    await expect(page.locator(`${TOAST}:popover-open`)).toHaveCount(0);
  });

  test("a dismissed offer stays away for that zone until the clocks agree again", async ({
    page,
    browser,
    baseURL,
  }) => {
    await page.goto("/");
    // Closed from the keyboard: on a phone the close button is hidden from the eye, not the page.
    await page.locator(TOAST).getByRole("button", { name: "Dismiss" }).focus();
    await page.keyboard.press("Enter");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute(CHECKED, "dismissed");
    await expect(page.locator(`${TOAST}:popover-open`)).toHaveCount(0);

    // Home again: the device and the schedule agree, which ends the dismissal.
    const state = await page.context().storageState();
    const home = await browser.newContext({
      baseURL,
      storageState: state,
      timezoneId: "Europe/Stockholm",
    });
    const homePage = await home.newPage();
    await homePage.goto("/");
    await expect(homePage.locator("html")).toHaveAttribute(CHECKED, "agree");
    await expect(homePage.locator(`${TOAST}:popover-open`)).toHaveCount(0);
    const afterHome = await home.storageState();
    await home.close();

    // A second trip to the same place asks again.
    const again = await browser.newContext({ baseURL, storageState: afterHome, ...TOKYO });
    const againPage = await again.newPage();
    await againPage.goto("/");
    await expect(againPage.locator(TOAST)).toContainText("You're in Tokyo");
    await again.close();
  });
});
