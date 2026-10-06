import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

const PLAYER_ROOT = join(import.meta.dirname, "..", "src", "player", "PlayerRoot.tsx");

/** True while src/player/PlayerRoot.tsx is the placeholder that renders nothing. */
function playerIsStub(): boolean {
  return readFileSync(PLAYER_ROOT, "utf8").startsWith("// STUB");
}

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
    await page.getByRole("link", { name: /All briefings/ }).click();
    await expect(page).toHaveURL(/\/archive$/);
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
    await page.getByRole("link", { name: /All briefings/ }).click();
    await expect(page).toHaveURL(/\/archive$/);
    const kept = await page.evaluate(() =>
      [...document.querySelectorAll("astro-island")].map(
        (island) => (island as HTMLElement & { __mark?: number }).__mark ?? 0,
      ),
    );
    expect(kept.sort()).toEqual([1, 2]);
  });

  test("the root attributes the player owns survive a navigation", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const root = document.documentElement;
      root.dataset.mini = "visible";
      root.dataset.playerState = "playing";
      root.dataset.player = "closed";
    });
    await page.getByRole("link", { name: /All briefings/ }).click();
    await expect(page).toHaveURL(/\/archive$/);
    await expect(page.locator("html")).toHaveAttribute("data-mini", "visible");
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    await expect(page.locator("html")).toHaveAttribute("data-view", "archive");
  });

  test("the real player keeps narration going when a digest page is left", async ({ page }) => {
    test.skip(
      playerIsStub(),
      "Skipped until the web-player branch merges: PlayerRoot is still the placeholder. Re-run this " +
        "test after the merge; it presses the hero button, waits for html[data-player-state=playing], " +
        "navigates to the archive and back, and expects the state to stay playing with the mini player visible.",
    );
    await page.goto("/d/2026-10-07");
    await page.locator(".cta[data-play-digest]").click();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    await page.getByRole("link", { name: /All briefings/ }).click();
    await expect(page).toHaveURL(/\/archive$/);
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    await expect(page.locator("html")).toHaveAttribute("data-mini", "visible");
    await page.getByRole("link", { name: "Today" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
  });
});
