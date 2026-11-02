import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * The empty states the fixture build can reach: not found, offline and back online, and the
 * Library's zero results. Each is a spot illustration, a heading, one line and one way on.
 * Today and the Library with nothing in them are covered by src/components/emptyArt.test.ts.
 */

async function expectPattern(page: Page, root: Locator, level: 1 | 2, art: string): Promise<void> {
  const svg = root.locator(`.empty-art[data-art="${art}"]`);
  await expect(svg).toBeVisible();
  await expect(svg).toHaveAttribute("aria-hidden", "true");
  await expect(svg).toHaveAttribute("focusable", "false");
  const width = (await svg.boundingBox())?.width ?? 0;
  expect(width).toBeGreaterThanOrEqual(160);
  expect(width).toBeLessThanOrEqual(320);
  const heading = root.getByRole("heading", { level });
  await expect(heading).toBeVisible();
  const action = root.locator(".empty-actions > :is(a, button)").first();
  await expect(action).toBeVisible();
  const height = (await action.boundingBox())?.height ?? 0;
  expect(height).toBeGreaterThanOrEqual(44);
  await action.focus();
  await expect(action).toBeFocused();
  // The art follows the theme's tokens: its hero plane is another colour in dark.
  const fill = () =>
    svg
      .locator(":is(.art-hero, .art-slot)")
      .first()
      .evaluate((node) => getComputedStyle(node).fill);
  await page.emulateMedia({ colorScheme: "light" });
  const light = await fill();
  await page.emulateMedia({ colorScheme: "dark" });
  const dark = await fill();
  await page.emulateMedia({ colorScheme: "light" });
  expect(light).not.toBe(dark);
}

test.describe("empty states", () => {
  test("not found draws its scene under the page's own title", async ({ page }) => {
    await page.goto("/no/such/page");
    const root = page.locator("#main .empty");
    await expectPattern(page, root, 1, "notfound");
    await expect(root.getByRole("heading", { level: 1 })).toHaveAttribute("id", "page-title");
    await expect(root.getByRole("link", { name: "Go to Latest" })).toHaveAttribute("href", "/");
  });

  test.describe("the stand-in for a page never opened", () => {
    // The browser logs the requests that fail while offline.
    test.use({ allowNetworkErrors: true });

    // Bug (owner, 2026-11-02): a page not saved on the device replaced the strip with its own
    // "You are offline" page and lost the route. The strip is the one offline notice (D330); the
    // stand-in says only that this page is not here, at the address that was asked for.
    test("keeps the address, the strip and the tabs, and says the page is not saved", async ({
      page,
      context,
    }) => {
      await page.goto("/");
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.reload();
      await page.waitForLoadState("networkidle");
      await context.setOffline(true);
      await page.goto("/d/2026-10-04-weekly");
      const root = page.locator("#main .empty");
      await expect(root.getByRole("heading", { level: 1 })).toHaveText("Not saved on this device");
      await expectPattern(page, root, 1, "offline");
      await expect(page).toHaveURL(/\/d\/2026-10-04-weekly$/);
      // One notice about the connection, and the app's own tabs still there with the right one marked.
      await expect(page.locator('[data-banner="offline"]')).toHaveCount(1);
      await expect(page.locator("#main").getByText(/offline/i)).toHaveCount(0);
      await expect(page.locator('.app-nav a[href="/library"]')).toHaveAttribute(
        "aria-current",
        "page",
      );
    });
  });
});
