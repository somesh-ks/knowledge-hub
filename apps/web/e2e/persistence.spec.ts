import { expect, hydrated, test } from "./fixtures";

test.describe("playback survives navigation", () => {
  test("the real player keeps narration going when a digest page is left", async ({ page }) => {
    await page.goto("/d/2026-10-07");
    await hydrated(page);
    await page.locator(".hero [data-play-digest]").click();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    await page.getByRole("link", { name: "See all" }).click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    await expect(page.locator("html")).toHaveAttribute("data-mini", "visible");
    // The wordmark, not the Today tab: on a phone the docked player of this build still sits over
    // the bottom navigation until the rebuilt player docks above it.
    await page.locator('a[href="/"]:visible').first().click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
  });
});
