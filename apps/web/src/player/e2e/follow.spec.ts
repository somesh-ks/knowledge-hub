import { expect, test } from "./lab";

test.describe("the page follows the narration", () => {
  test("scrolls the current item into view when the reader has not scrolled", async ({
    lab,
    page,
  }) => {
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    for (let press = 0; press < 4; press += 1) {
      await page.getByRole("button", { name: "Next story" }).tap();
    }
    await page.keyboard.press("Escape");
    await expect(page.locator("html")).toHaveAttribute("data-player", "closed", { timeout: 4_000 });
    const target = page.locator('[data-item-id="e5b7a3d6f845"]');
    await expect(target).toHaveAttribute("data-state", "current");
    await expect
      .poll(async () => {
        const box = await target.boundingBox();
        return box ? box.y > 0 && box.y < 844 : false;
      })
      .toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(600);
  });

  test("stays out of the way for four seconds after the reader scrolls", async ({ lab, page }) => {
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    await page.keyboard.press("Escape");
    await expect(page.locator("html")).toHaveAttribute("data-player", "closed", { timeout: 4_000 });
    await page.mouse.wheel(0, 5);
    await page.waitForTimeout(100);
    const before = await page.evaluate(() => window.scrollY);
    // An item change while the reader is scrolling does not pull the page away.
    await lab.dock.getByRole("button", { name: "Next story" }).tap();
    await page.waitForTimeout(900);
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThan(5);
  });

  test("an explicit tap on an item makes the page follow again", async ({ lab, page }) => {
    await lab.open();
    await lab.play();
    await page.mouse.wheel(0, 5);
    const third = page.locator('[data-item-id="c3f5e1b4d623"] [data-play-item]');
    await third.scrollIntoViewIfNeeded();
    await third.tap();
    await expect(page.locator('[data-item-id="c3f5e1b4d623"]')).toHaveAttribute(
      "data-state",
      "current",
    );
  });
});
