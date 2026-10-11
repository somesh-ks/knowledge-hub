import { expect, hydrated, test } from "./fixtures";

test.describe("playback survives navigation", () => {
  test("a module-scope audio object keeps playing across client-side navigations", async ({
    page,
  }) => {
    await page.goto("/d/2026-10-07");
    // The audio object lives in script, never in the DOM, exactly as the player keeps it.
    const started = await page.evaluate(async () => {
      const audio = new Audio("/fixtures/audio.wav");
      (window as unknown as { __audio: HTMLAudioElement }).__audio = audio;
      await audio.play();
      return !audio.paused;
    });
    expect(started).toBe(true);

    const before = await page.evaluate(
      () => (window as unknown as { __audio: HTMLAudioElement }).__audio.currentTime,
    );
    await page.getByRole("link", { name: "See all" }).click();
    await expect(page).toHaveURL(/\/library$/);
    await page.getByRole("link", { name: /Monday 5 October/ }).click();
    await expect(page).toHaveURL(/\/d\/2026-10-05$/);
    await page.waitForTimeout(700);

    const after = await page.evaluate(() => {
      const audio = (window as unknown as { __audio: HTMLAudioElement }).__audio;
      return { paused: audio.paused, ended: audio.ended, time: audio.currentTime };
    });
    expect(after.paused).toBe(false);
    expect(after.ended).toBe(false);
    expect(after.time).toBeGreaterThan(before);
  });

  test("the player and sheets islands are the same DOM nodes after a navigation", async ({
    page,
  }) => {
    await page.goto("/");
    const marked = await page.evaluate(() => {
      const islands = [...document.querySelectorAll("astro-island")];
      islands.forEach((island, index) => {
        (island as HTMLElement & { __mark?: number }).__mark = index + 1;
      });
      return islands.length;
    });
    expect(marked).toBe(2);
    await page.getByRole("link", { name: "See all" }).click();
    await expect(page).toHaveURL(/\/library$/);
    const kept = await page.evaluate(() =>
      [...document.querySelectorAll("astro-island")].map(
        (island) => (island as HTMLElement & { __mark?: number }).__mark ?? 0,
      ),
    );
    expect(kept.sort()).toEqual([1, 2]);
  });

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
