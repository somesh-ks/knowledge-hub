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
});
