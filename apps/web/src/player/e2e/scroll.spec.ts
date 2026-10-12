import type { Page } from "@playwright/test";
import { center, expect, line, type Point, test } from "./helpers";

const scrollY = (page: Page): Promise<number> => page.evaluate(() => Math.round(window.scrollY));

test.describe("the page behind the open player stays where it was", () => {
  test("dragging on the transport row and at the list's edges never scrolls the page behind", async ({
    player,
    page,
    finger,
    browserName,
  }) => {
    test.skip(
      browserName === "webkit",
      "Playwright's mobile WebKit rejects mouse.wheel and has no touch scroll to stand in for it",
    );
    await player.open();
    await player.play();
    // Paused, so the reader's own follow-the-narration scroll has nothing to react to.
    await finger.press(player.cta);
    await expect(player.root).toHaveAttribute("data-player-state", "paused");
    await page.evaluate(() => window.scrollTo({ top: 320, behavior: "instant" }));
    const before = await scrollY(page);
    expect(before).toBeGreaterThan(100);
    await player.dockSettled();
    await player.openPlayer();

    /** A vertical drag where there is touch; a wheel turn over the same spot otherwise. */
    const pan = async (from: Point, dy: number): Promise<void> => {
      if (finger.touch && browserName === "chromium") {
        await finger.drag(line(from, { x: from.x, y: from.y + dy }, 8), 16);
      } else {
        await page.mouse.move(from.x, from.y);
        await page.mouse.wheel(0, -dy);
      }
      await page.waitForTimeout(250);
    };

    const transport = player.dialog.locator(".transport");
    await transport.scrollIntoViewIfNeeded();
    const row = center(await player.boxOf(transport));
    await pan(row, 200);
    await pan(row, -200);
    expect(await scrollY(page)).toBe(before);
    await player.expanded();

    // The far end of the list: pulling further has nowhere to go, and must not move the page.
    const lastRow = player.dialog.getByRole("list").last().getByRole("button").last();
    await lastRow.scrollIntoViewIfNeeded();
    await pan(center(await player.boxOf(lastRow)), -260);
    await pan(center(await player.boxOf(lastRow)), -260);
    expect(await scrollY(page)).toBe(before);

    // And the near end: back at the top, a pull down on the controls goes nowhere either.
    await transport.scrollIntoViewIfNeeded();
    await pan(center(await player.boxOf(transport)), 260);
    expect(await scrollY(page)).toBe(before);
    await player.expanded();

    await page.keyboard.press("Escape");
    await player.collapsed();
    expect(await scrollY(page)).toBe(before);
  });

  test("the root is locked only while the player is open", async ({ player, page }) => {
    await player.open();
    await player.play();
    const overflow = (): Promise<string> =>
      page.evaluate(() => getComputedStyle(document.documentElement).overflowY);
    expect(await overflow()).not.toBe("hidden");
    await player.openPlayer();
    expect(await overflow()).toBe("hidden");
    await page.keyboard.press("Escape");
    await player.collapsed();
    expect(await overflow()).not.toBe("hidden");
  });
});
