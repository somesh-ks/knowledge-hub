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

    test("the page with the bar docked", async ({ lab, page }) => {
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

  test("the page fades in place instead of travelling, and no cover flies", async ({
    lab,
    page,
  }) => {
    await lab.open();
    await lab.play();
    await lab.openButton.tap();
    await lab.expanded();
    // Nothing travelled: the page is where layout put it, and opacity carried the change.
    await expect(lab.sheet).toHaveCSS("transform", "none");
    await expect(lab.sheet).toHaveCSS("opacity", "1");
    await expect(page.locator("[data-player-art]")).toHaveCSS("display", "none");
    // The page's own cover is the one on screen for as long as the page is.
    await expect(lab.sheet.locator(".player-cover-frame")).toHaveCSS("visibility", "visible");
    // The way back is the same fade, over the state duration.
    const started = Date.now();
    await page.keyboard.press("Escape");
    await lab.collapsed();
    expect(Date.now() - started).toBeLessThan(1_500);
    await expect(lab.sheet).toBeHidden();
    await expect(lab.openButton.locator(".player-cover-frame")).toHaveCSS("visibility", "visible");
  });

  test("under reduced motion a held pull changes opacity, never position", async ({
    lab,
    page,
  }) => {
    await lab.open();
    await lab.play();
    const box = await lab.dockSettled();
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const held = await lab.finger.drag(
      [0, 60, 120, 180, 240, 300].map((dy) => ({ x: start.x, y: start.y - dy })),
      30,
      { hold: true },
    );
    await expect(lab.surface).toHaveAttribute("data-state", "dragging");
    await expect(lab.sheet).toHaveCSS("transform", "none");
    const opacity = Number(
      await lab.sheet.evaluate((element) => getComputedStyle(element).opacity),
    );
    expect(opacity).toBeGreaterThan(0.1);
    expect(opacity).toBeLessThan(0.9);
    await expect(page.locator("[data-player-art]")).toHaveCSS("display", "none");
    await held.release();
    await lab.settled();
  });

  test("the bar's progress and the story chip still update", async ({ lab, page }) => {
    await lab.open();
    await lab.play();
    const before = await lab.progressOf();
    await page.waitForTimeout(1_000);
    expect(await lab.progressOf()).toBeGreaterThan(before);
    const chip = page.locator('[data-item-id="a1f3c9d2b401"] [data-play-item]');
    await expect(chip.locator("[data-chip-label]")).toHaveText("Playing");
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
