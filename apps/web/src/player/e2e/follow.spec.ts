import { expect, test } from "./helpers";

test("the page follows the voice: the story being read is brought into view", async ({
  player,
  page,
}) => {
  await player.open();
  await player.play();
  await player.openPlayer();
  for (let press = 0; press < 6; press += 1) {
    await player.finger.press(player.dialog.getByRole("button", { name: "Next story" }));
  }
  await page.keyboard.press("Escape");
  await player.collapsed();
  // The reader has not scrolled, so the page went to the story the voice is on.
  const current = page.locator("[data-item-id][data-state='current']");
  await expect(current).toHaveCount(1);
  await expect(current).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});
