import { expect, SITE, serveNarration, test } from "./helpers";

test.describe("the first press of Play on a page with no audio yet", () => {
  test("plays by itself once the first file is made, with no second press @smoke", async ({
    player,
    audio,
    finger,
    page,
  }) => {
    await player.open(`/d/${SITE.earlier}`);
    await serveNarration(page, 1_500);
    await finger.press(player.cta);
    await expect(player.cta).toHaveAttribute("data-state", "preparing");
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing", {
      timeout: 8_000,
    });
    await expect.poll(async () => (await audio.read())?.paused, { timeout: 4_000 }).toBe(false);
    await expect
      .poll(async () => (await audio.read())?.currentTime ?? 0, { timeout: 6_000 })
      .toBeGreaterThan(0.5);
    await expect(page.locator(".dock-btn[data-primary]")).toHaveAttribute("data-loading", "false");
  });

  test("Up next at the end narrates and plays a briefing with no audio", async ({
    player,
    audio,
    page,
    finger,
  }) => {
    await player.open();
    await serveNarration(page, 300, "/d/2026-10-05");
    await player.play();
    await player.openPlayer();
    await player.scrubber.focus();
    await page.keyboard.press("End");
    await expect(player.root).toHaveAttribute("data-player-state", "ended");
    const upNext = player.dialog.getByRole("button", { name: /The previous briefing/ });
    // Never an autoplay chain: nothing plays until the listener chooses.
    expect((await audio.read())?.paused).toBe(true);
    await upNext.scrollIntoViewIfNeeded();
    await finger.press(upNext);
    await expect(page).toHaveURL(new RegExp(`/d/${SITE.earlier}`));
    await expect(player.root).toHaveAttribute("data-player-state", "playing", { timeout: 10_000 });
    expect(await audio.count()).toBe(1);
  });

  // The queue is the listener's choice, so it does chain: a queued item that never started at the
  // end, or started the wrong one, is the failure this guards against.
  test("the end of a recording starts the next queued item by itself", async ({
    player,
    audio,
    page,
  }) => {
    await player.open();
    await serveNarration(page, 300, "/d/2026-10-05");
    await page.evaluate(() => {
      for (const id of ["ep-20261007-1930", "2026-10-05"])
        document.dispatchEvent(new CustomEvent("dispatch:queue-add", { detail: { id } }));
    });
    await player.play();
    await player.openPlayer();
    // Reordered by its handle's keys, in the raised queue: the briefing now comes first.
    await player.dialog.getByRole("button", { name: /^Up next/ }).click();
    await page.getByRole("button", { name: /^Move .*, 2 of 2$/ }).focus();
    await page.keyboard.press("ArrowUp");
    await page.reload();
    await player.play();
    await player.openPlayer();
    await player.scrubber.focus();
    await page.keyboard.press("End");
    await expect(page).toHaveURL(new RegExp(`/d/${SITE.earlier}`));
    await expect(player.root).toHaveAttribute("data-player-state", "playing", { timeout: 10_000 });
    expect(await audio.count()).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem("dispatch:queue"))).toBe(
      '["ep-20261007-1930"]',
    );
  });
});
