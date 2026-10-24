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

  test("offline shows the cut signal, and back online the connected one", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "onLine", {
        configurable: true,
        get: () => false,
      });
    });
    await page.goto("/offline");
    const root = page.locator("#main .empty");
    await expect(root.getByRole("heading", { level: 1 })).toHaveText("You are offline");
    await expect(root).toHaveAttribute("data-state", "offline");
    await expectPattern(page, root, 1, "offline");
    await expect(root.locator('.empty-art[data-art="online"]')).toBeHidden();
    // The connection returns: the words, the button and the scene change together.
    await page.evaluate(() => {
      Object.defineProperty(Navigator.prototype, "onLine", { configurable: true, get: () => true });
      window.dispatchEvent(new Event("online"));
    });
    await expect(root.getByRole("heading", { level: 1 })).toHaveText("You are back online");
    await expect(root).toHaveAttribute("data-state", "online");
    await expect(root.locator('.empty-art[data-art="online"]')).toBeVisible();
    await expect(root.locator('.empty-art[data-art="offline"]')).toBeHidden();
    await expect(root.getByRole("link", { name: "Reload" })).toBeVisible();
  });

  test.describe("a stand-in that cannot reach the site", () => {
    // The page asks the site itself, and the browser logs the request that fails.
    test.use({ allowNetworkErrors: true });

    test("a page standing in for an address that cannot be fetched does not say back online", async ({
      page,
      context,
    }) => {
      // The browser says it is online, as with a weak signal or a captive portal, but nothing answers.
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
      });
      await page.goto("/");
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.reload();
      // The idle islands' stylesheets are preloaded after load; cut off mid-preload they throw
      // "Unable to preload CSS", which is not what this test is about.
      await page.waitForLoadState("networkidle");
      await context.setOffline(true);
      await page.goto("/d/2026-10-05");
      const root = page.locator("#main .empty");
      await expect(root.getByRole("heading", { level: 1 })).toHaveText("You are offline");
      await page.waitForTimeout(1_000);
      await expect(root.getByRole("heading", { level: 1 })).toHaveText("You are offline");
      await expect(root).toHaveAttribute("data-state", "offline");
      await expect(root.getByRole("link", { name: "Try again" })).toBeVisible();
    });
  });
});
