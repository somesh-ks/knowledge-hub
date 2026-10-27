import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * A settings change the server refused, seen from where the owner is next: a reload of its page, the
 * Settings index, or Today. None of them may show it as saved, and a change refused while no settings
 * page is open is still told.
 */

/** Answers /api/config in order, then 202. */
async function mockConfig(page: Page, answers: number[]): Promise<unknown[]> {
  const sent: unknown[] = [];
  await page.route(/\/api\/config(\?|$)/, async (route: Route) => {
    sent.push(route.request().postDataJSON());
    const status = answers.shift() ?? 202;
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(status === 202 ? { status, run_id: 1 } : { status }),
    });
  });
  return sent;
}

const toastText = (page: Page) => page.locator("[data-bar] [data-bar-text]");

test.describe("a refused settings change", () => {
  // The refusals are on purpose, which the browser logs.
  test.use({ allowNetworkErrors: true });

  test("a held change refused while Today is open is told there, and Daily keeps the old value", async ({
    page,
  }) => {
    await page.clock.install();
    const sent = await mockConfig(page, [202, 500]);
    await page.goto("/settings/daily");
    await expect(page.locator("[data-manage]")).toHaveAttribute("data-voices", "");
    await page.locator("#daily-hour").selectOption("9");
    await page.clock.runFor(2000);
    await expect(page.locator("[data-live]")).toHaveText("Settings saved");
    // Inside the server's gap: the change waits, and the owner leaves for Today.
    await page.locator("#daily-length").selectOption("3");
    await page.clock.runFor(2000);
    await page.locator("nav").getByRole("link", { name: "Latest" }).first().click();
    await expect(page).toHaveURL(/\/$/);
    await page.clock.runFor(10_000);
    await expect.poll(() => sent.length).toBe(2);
    const told = page
      .getByRole("alert")
      .filter({ hasText: "Your change to Daily Podcast was not saved." });
    await expect(told).toBeVisible();

    await page.goto("/settings/daily");
    await expect(page.locator("[data-manage]")).toHaveAttribute("data-voices", "");
    await expect(page.locator("#daily-length")).toHaveValue("10");
  });
});
