import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, ROUTES, test } from "./fixtures";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact}): ${violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(" "))
        .join(", ")}`,
  );
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`axe, ${scheme} scheme`, () => {
    for (const route of ROUTES) {
      test(`${route.name} has no WCAG 2.2 AA violations`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(route.path);
        await page.evaluate(() => document.fonts.ready);
        expect(await violations(page)).toEqual([]);
      });
    }
  });
}

test.describe("axe, explicit theme override", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`home with the ${theme} theme chosen against the system`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme === "light" ? "dark" : "light" });
      await page.addInitScript((value) => localStorage.setItem("dispatch-theme", value), theme);
      await page.goto("/");
      expect(await violations(page)).toEqual([]);
    });
  }
});

test.describe("axe, banners and live states", () => {
  test("the stale banner has no violations", async ({ page }) => {
    // Eleven days after the newest fixture digest, so the home page shows the stale banner.
    await page.clock.setFixedTime(new Date("2026-10-18T09:00:00+02:00"));
    await page.goto("/");
    const banner = page.locator('[data-banner="stale"]');
    await expect(banner).toBeVisible();
    await expect(banner.locator(".banner-title")).toHaveText("This briefing is 11 days old");
    expect(await violations(page)).toEqual([]);
  });

  test("the offline banner has no violations", async ({ page, context }) => {
    await page.goto("/");
    // Let the islands finish hydrating before the network goes away.
    await page.waitForLoadState("networkidle");
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    const banner = page.locator('[data-banner="offline"]');
    await expect(banner).toBeVisible();
    await expect(page.locator(".cta")).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator(".cta-label")).toHaveText("Audio needs a connection");
    expect(await violations(page)).toEqual([]);
    await context.setOffline(false);
  });

  test("reader state written by the player has no violations", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const root = document.documentElement;
      root.dataset.playerState = "playing";
      root.dataset.mini = "visible";
      document.querySelector(".briefing")?.setAttribute("data-live", "");
      const items = document.querySelectorAll<HTMLElement>(".item");
      items[0]?.setAttribute("data-state", "played");
      items[1]?.setAttribute("data-state", "current");
      document.querySelector(".chapter")?.setAttribute("data-state", "current");
      document
        .querySelector<HTMLElement>(".rail-fill")
        ?.style.setProperty("--player-progress", "0.2");
      items[1]?.querySelector<HTMLElement>(".item-play")?.setAttribute("data-current", "true");
    });
    expect(await violations(page)).toEqual([]);
  });
});
