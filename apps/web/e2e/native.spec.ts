import { expect, test } from "./fixtures";

/**
 * Behaviour that makes the phone layout feel like a native app: the floating Create button only
 * where making an episode is the next thing to do, and the tab bar's press on the current tab.
 */

test.describe("the floating Create button", () => {
  test("shows on Today and the Library, and on no other page", async ({ page }, info) => {
    test.skip(info.project.name === "desktop", "the floating button is for phones");
    for (const path of ["/", "/library"]) {
      await page.goto(path);
      await expect(page.locator(".create-fab"), path).toBeVisible();
    }
    for (const path of [
      "/settings",
      "/settings/daily",
      "/settings/topics",
      "/d/2026-10-05",
      "/e/ep-20261007-1930",
      "/create",
    ]) {
      await page.goto(path);
      await expect(page.locator(".create-fab"), path).toHaveCount(0);
    }
  });

  test("the side column keeps Create Podcast on every page", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "the side column is for wide screens");
    for (const path of ["/", "/settings/daily", "/e/ep-20261007-1930"]) {
      await page.goto(path);
      await expect(page.locator(".app-nav-create"), path).toBeVisible();
    }
  });
});

test.describe("the tab bar", () => {
  test("pressing the destination you are on takes you to its top, without loading it again", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, 1200));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(600);
    // A mark on the window: a new page load would drop it.
    await page.evaluate(() => {
      (window as unknown as { kept?: boolean }).kept = true;
    });
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Today", exact: true })
      .click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);
  });

  test("from a page below a destination, its tab still goes there", async ({ page }) => {
    await page.goto("/e/ep-20261007-1930");
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Library", exact: true })
      .click();
    await expect(page).toHaveURL(/\/library$/);
  });
});
