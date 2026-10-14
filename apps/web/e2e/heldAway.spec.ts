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
  await page.route("**/api/config", async (route: Route) => {
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

  test("a refused model choice is not shown as saved after a reload, nor on the index", async ({
    page,
  }) => {
    const sent = await mockConfig(page, [500]);
    await page.goto("/settings/model");
    const root = page.locator("[data-manage]");
    await expect(root).toHaveAttribute("data-loaded", "");
    const combo = page.getByRole("combobox", { name: "AI Model" });
    await combo.selectOption({ label: "Kimi K3" });
    await expect(toastText(page)).toHaveText("Saving failed.");
    expect(sent).toHaveLength(1);

    await page.reload();
    await expect(root).toHaveAttribute("data-loaded", "");
    await expect(combo).toHaveValue("zai-org/GLM-5.3");
    await expect(page.locator("[data-saved-note]")).toHaveCount(0);

    await page.goto("/settings");
    await expect(page.getByRole("link", { name: /^AI Model/ }).locator("[data-hint]")).toHaveText(
      "Nebius, GLM-5.3",
    );
  });

  test("a held change refused while Today is open is told there, and Daily keeps the old value", async ({
    page,
  }) => {
    await page.clock.install();
    const sent = await mockConfig(page, [202, 500]);
    await page.goto("/settings/daily");
    await expect(page.locator("[data-manage]")).toHaveAttribute("data-voices", "");
    await page.locator("#daily-hour").selectOption("9");
    await page.clock.runFor(2000);
    await expect(page.locator("[data-live]")).toHaveText("Saved.");
    // Inside the server's gap: the change waits, and the owner leaves for Today.
    await page.getByRole("radio", { name: "3 min" }).check();
    await page.clock.runFor(2000);
    await page.locator("nav").getByRole("link", { name: "Latest" }).first().click();
    await expect(page).toHaveURL(/\/$/);
    await page.clock.runFor(10_000);
    await expect.poll(() => sent.length).toBe(2);
    const told = page.getByRole("alert").filter({ hasText: "Your change to Daily was not saved." });
    await expect(told).toBeVisible();

    await page.goto("/settings/daily");
    await expect(page.locator("[data-manage]")).toHaveAttribute("data-voices", "");
    await expect(page.getByRole("radio", { name: "10 min" })).toBeChecked();
  });
});
