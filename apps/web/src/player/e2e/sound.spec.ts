import { expect, test } from "./lab";

test.describe("Up next", () => {
  test("offers the previous briefing after the last item and plays it on the same audio element", async ({
    lab,
    audio,
    page,
  }) => {
    // The lab has no /d/ route; the previous briefing's page is the earlier lab page.
    await page.route("**/d/2026-01-12", async (route) => {
      const response = await route.fetch({
        url: new URL("/dev/player-lab-older", route.request().url()).toString(),
      });
      await route.fulfill({ response });
    });
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    await page.getByRole("slider", { name: "Playback position" }).focus();
    await page.keyboard.press("End");
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "ended");
    const upNext = page.getByRole("button", { name: /Monday 12 January/ });
    await expect(upNext).toBeVisible();
    // Never an autoplay chain: nothing plays until the listener chooses.
    expect((await audio.read())?.paused).toBe(true);
    await upNext.tap();
    await expect(page).toHaveURL(/\/d\/2026-01-12/);
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing", {
      timeout: 10_000,
    });
    expect((await audio.read())?.src).toContain("#older");
    expect(await audio.count()).toBe(1);
  });
});
