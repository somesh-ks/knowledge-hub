import { expect, test } from "./fixtures";

const ROUTES = [
  "/",
  "/d/2026-10-07",
  "/e/ep-20261007-1930",
  "/library",
  "/create",
  "/settings",
  "/settings/daily",
  "/settings/weekly",
  "/settings/model",
  "/settings/topics",
  "/settings/topics/audio_interfaces",
  "/settings/topics/other",
];

/**
 * The hidden attribute is `display: none` at the lowest specificity there is, so any component rule
 * that sets `display` on the same element shows it again. Each stylesheet that sets `display` ends
 * with its own `[hidden]` rule for that reason; this is the check that none was forgotten.
 */
test("the hidden attribute hides everything that carries it, on every page", {
  tag: "@both",
}, async ({ page }) => {
  for (const route of ROUTES) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    const shown = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("[hidden]")]
        .filter((element) => getComputedStyle(element).display !== "none")
        .map((element) => `${element.tagName.toLowerCase()}.${element.className}`),
    );
    expect(shown, route).toEqual([]);
  }
});
