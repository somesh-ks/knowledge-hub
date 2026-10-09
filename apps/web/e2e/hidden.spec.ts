import { expect, test } from "./fixtures";

const ROUTES = [
  "/",
  "/d/2026-10-07",
  "/e/ep-20261007-1930",
  "/library",
  "/create",
  "/settings",
  "/settings/topics",
  "/settings/sources",
  "/settings/daily",
];

/**
 * The hidden attribute is `display: none` at the lowest specificity there is, so any component rule
 * that sets `display` on the same element shows it again. Each stylesheet that sets `display` ends
 * with its own `[hidden]` rule for that reason; this is the check that none was forgotten.
 */
test.describe("the hidden attribute", () => {
  for (const route of ROUTES) {
    test(`hides everything that carries it on ${route}`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      const shown = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("[hidden]")]
          .filter((element) => getComputedStyle(element).display !== "none")
          .map((element) => `${element.tagName.toLowerCase()}.${element.className}`),
      );
      expect(shown).toEqual([]);
    });
  }
});
