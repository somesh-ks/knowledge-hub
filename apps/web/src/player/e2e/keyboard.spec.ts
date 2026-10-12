import { expect, test } from "./helpers";

test.describe("keyboard operation of the player", () => {
  test("the scrubber: arrows seek 5 s and 15 with Shift, the page keys move by story, Home and End", async ({
    player,
    audio,
    page,
  }) => {
    await player.open();
    await player.play();
    await player.openPlayer();
    await player.dialog.getByRole("button", { name: "Pause", exact: true }).press("Enter");
    await expect(player.root).toHaveAttribute("data-player-state", "paused");
    const time = async (): Promise<number> => (await audio.read())?.currentTime ?? 0;
    await player.pageScrubber.focus();
    const start = await time();
    await page.keyboard.press("ArrowRight");
    await expect.poll(time).toBeCloseTo(start + 5, 0);
    await page.keyboard.press("Shift+ArrowRight");
    await expect.poll(time).toBeCloseTo(start + 20, 0);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(time).toBeCloseTo(start + 15, 0);
    const stories = await player.stories();
    const now = await time();
    const next = stories.find((story) => story.start > now)?.start ?? -1;
    await page.keyboard.press("PageDown");
    await expect.poll(time).toBeCloseTo(next, 0);
    await page.keyboard.press("PageUp");
    await expect.poll(time).toBeLessThan(next - 1);
    // Playing again, End runs it out.
    await page.keyboard.press("k");
    await expect(player.root).toHaveAttribute("data-player-state", "playing");
    await page.keyboard.press("End");
    await expect(player.root).toHaveAttribute("data-player-state", "ended");
    await page.keyboard.press("Home");
    await expect.poll(time).toBeLessThan(1);
  });

  test("Space plays and pauses from anywhere, the bar keeps its order, and K works in the player @surface", async ({
    player,
    page,
    hasTouch,
  }) => {
    await player.open();
    await player.play();
    const state = (value: string) =>
      expect(player.root).toHaveAttribute("data-player-state", value);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 120);
    });
    const scrolled = await page.evaluate(() => window.scrollY);
    await page.locator("body").press("Space");
    await state("paused");
    await page.keyboard.press("Space");
    await state("playing");
    // It acted, so the page did not scroll with it.
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
    await player.dockSettled();
    const seek = player.dock.getByRole("slider", { name: "Seek" });
    if (!hasTouch && (await seek.isVisible())) {
      // A wide window with a mouse: the bar's seek takes Space as the page's scrubber does, and
      // Previous follows it in Tab order.
      await seek.focus();
      await page.keyboard.press("Space");
      await state("paused");
      await page.keyboard.press("Space");
      await state("playing");
      await page.keyboard.press("Tab");
      await expect(player.dock.getByRole("button", { name: "Previous story" })).toBeFocused();
    } else {
      // A phone: the bar's own buttons in reading order.
      await player.openButton.focus();
      await page.keyboard.press("Tab");
      await expect(player.dock.getByRole("button", { name: "Pause", exact: true })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(player.dock.getByRole("button", { name: "Next story" })).toBeFocused();
    }
    // Inside the open player K and Space toggle; on a button, Space presses the button instead.
    await player.openPlayer();
    await player.scrubber.focus();
    await page.keyboard.press("k");
    await state("paused");
    await page.keyboard.press("Space");
    await state("playing");
    const story = page.locator(".player-meta .player-story");
    const before = await story.textContent();
    await player.dialog.getByRole("button", { name: "Next story" }).first().focus();
    await page.keyboard.press("Space");
    await expect(story).not.toHaveText(before ?? "");
    await state("playing");
  });
});
