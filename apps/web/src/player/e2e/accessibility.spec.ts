import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./lab";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function violations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.target.join(" ")),
  }));
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`axe, WCAG 2.2 AA, ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test("the page with the mini player", async ({ lab, page }) => {
      await lab.open();
      await lab.play();
      expect(await violations(page)).toEqual([]);
    });

    test("the expanded player", async ({ lab, page }) => {
      await lab.open();
      await lab.play();
      await lab.openPlayer();
      expect(await violations(page)).toEqual([]);
    });

    test("the expanded player while scrubbing and when it has ended", async ({ lab, page }) => {
      await lab.open();
      await lab.play();
      await lab.openPlayer();
      await page.getByRole("slider", { name: "Playback position" }).focus();
      await page.keyboard.press("End");
      await expect(page.getByRole("heading", { name: "Up next" })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test("the Generate sheet, idle and with an error", async ({ lab, page }) => {
      await lab.open();
      await page.locator('[data-open-sheet="generate"]').tap();
      const dialog = page.getByRole("dialog", { name: "Generate a new briefing" });
      await expect(dialog).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await dialog.getByRole("button", { name: "Generate briefing" }).tap();
      await expect(dialog.getByRole("alert")).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test("the Generate sheet while a run goes and when it fails", async ({ lab, page }) => {
      await page.route("**/api/generate", (route) =>
        route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({ run_id: 5, started_at: "now" }),
        }),
      );
      await page.route("**/api/status**", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            run_id: 5,
            state: "completed",
            step: "writing",
            outcome: "failed",
            run_url: "https://example.test/run/5",
          }),
        }),
      );
      await lab.open();
      await page.locator('[data-open-sheet="generate"]').tap();
      const dialog = page.getByRole("dialog", { name: "Generate a new briefing" });
      await dialog.getByLabel("Passphrase").fill("secret");
      await dialog.getByRole("button", { name: "Generate briefing" }).tap();
      await expect(dialog.getByRole("list", { name: "Progress" })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await expect(dialog.getByText("The run failed while writing")).toBeVisible({
        timeout: 10_000,
      });
      expect(await violations(page)).toEqual([]);
    });

    test("the Settings sheet", async ({ lab, page }) => {
      await lab.open();
      await page.locator('[data-open-sheet="settings"]').tap();
      await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  });
}

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the sheet fades in place instead of sliding, and the cover does not morph", async ({
    lab,
    page,
  }) => {
    await lab.open();
    await lab.play();
    await page.locator(".mini-open").tap();
    await expect(page.locator("html")).toHaveAttribute("data-player", "open");
    await lab.settled();
    const rest = await page.locator(".player-panel").evaluate((panel) => ({
      transform: (panel as HTMLElement).style.transform,
      opacity: (panel as HTMLElement).style.opacity,
    }));
    expect(rest.transform).toBe("none");
    expect(Number(rest.opacity)).toBe(1);
    const cover = await page
      .locator(".player-cover-frame[data-size=player]")
      .evaluate((element) => (element as HTMLElement).style.transform);
    expect(cover).toBe("");
  });

  test("the rail and the scrubber still update", async ({ lab, page }) => {
    await lab.open();
    await lab.play();
    const before = await lab.progressOf();
    await page.waitForTimeout(1_000);
    expect(await lab.progressOf()).toBeGreaterThan(before);
  });

  test("movement tokens collapse while fades keep their timing", async ({ lab, page }) => {
    await lab.open();
    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        sheetIn: style.getPropertyValue("--duration-sheet-in").trim(),
        state: style.getPropertyValue("--duration-state").trim(),
      };
    });
    expect(tokens.sheetIn).toBe("0.01ms");
    expect(tokens.state).toBe("200ms");
  });
});
