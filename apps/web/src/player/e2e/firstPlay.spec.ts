import type { Page } from "@playwright/test";
import { expect, SITE, serveNarration, test } from "./helpers";

/** The id of the item the queue lists as playing now (D277), whatever page the listener is on. */
async function nowPlaying(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("singularity:queue-played");
    return raw ? ((JSON.parse(raw) as { current?: string }).current ?? null) : null;
  });
}

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

  // Autoplay: with nothing queued the first suggested item (the next older one) starts by itself,
  // and a briefing with no audio is narrated on arrival.
  test("an episode ends with an empty queue and the suggested one starts", async ({
    player,
    audio,
    page,
  }) => {
    await player.open();
    await serveNarration(page, 300, "/d/2026-10-05");
    await player.play();
    await player.openPlayer();
    await player.scrubber.focus();
    await page.keyboard.press("End");
    // D277: the item plays where the player stands; the page does not follow it.
    await expect.poll(() => nowPlaying(page), { timeout: 10_000 }).toBe("ep-20261007-1930");
    await expect(player.root).toHaveAttribute("data-player-state", "playing", { timeout: 10_000 });
    expect(await audio.count()).toBe(1);
  });

  test("the plus on a suggested row adds it to the queue", async ({ player, page }) => {
    await player.open();
    await player.play();
    await player.openPlayer();
    await player.dialog.getByRole("tab", { name: "Up next" }).click();
    await expect(player.dialog.getByText("Suggested", { exact: true })).toBeVisible();
    await player.dialog
      .getByRole("button", { name: /^Add .* to the queue$/ })
      .first()
      .click();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("singularity:queue")))
      .toContain("ep-20261007-1930");
    await expect(player.dialog.getByText("Suggested", { exact: true })).toHaveCount(0);
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
        document.dispatchEvent(new CustomEvent("singularity:queue-add", { detail: { id } }));
    });
    // Opening a queued item's page loads it, idle: it must stay in the queue until it plays.
    await player.open("/d/2026-10-05");
    expect(await page.evaluate(() => localStorage.getItem("singularity:queue"))).toBe(
      '["ep-20261007-1930","2026-10-05"]',
    );
    await player.open();
    await player.play();
    await player.openPlayer();
    // The story tapped opens its transcript under its row; every other story stays a chapter row.
    const stories = player.dialog.getByRole("tabpanel").locator("button.story-row");
    await stories.nth(1).click();
    await expect(stories.nth(1)).toHaveAttribute("aria-current", "true");
    const transcript = player.dialog.getByRole("region", { name: "Transcript" });
    await expect(transcript.locator("[data-turn]")).toHaveCount(1);
    // Up next is the other view: moved up by its row's handle, the briefing now comes first.
    await player.dialog.getByRole("tab", { name: "Up next" }).click();
    await page
      .getByRole("button", { name: /^Move / })
      .nth(1)
      .focus();
    await page.keyboard.press("ArrowUp");
    // Back on Stories the open story is still the one being read.
    await player.dialog.getByRole("tab", { name: "Stories" }).click();
    await expect(transcript.locator("[data-turn]")).toHaveCount(1);
    await page.reload();
    await player.play();
    await player.openPlayer();
    await player.scrubber.focus();
    await page.keyboard.press("End");
    await expect.poll(() => nowPlaying(page), { timeout: 10_000 }).toBe(SITE.earlier);
    await expect(player.root).toHaveAttribute("data-player-state", "playing", { timeout: 10_000 });
    expect(await audio.count()).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem("singularity:queue"))).toBe(
      '["ep-20261007-1930"]',
    );
  });

  // D277: a tap on a queued item, even the third, starts it where the player stands. The bar never
  // goes down and comes back (the old road collapsed the sheet and loaded the item's page), and the
  // list keeps what was passed, as a music app's queue does.
  test("a tap on the third queued item plays it with the bar up, and the list keeps what played", async ({
    player,
    audio,
    page,
  }) => {
    await player.open();
    await serveNarration(page, 300, "/d/2026-10-05");
    await page.evaluate(() => {
      for (const id of ["ep-20261006-0900", "ep-20261007-1930", "2026-10-05"])
        document.dispatchEvent(new CustomEvent("singularity:queue-add", { detail: { id } }));
    });
    await player.play();
    await page.evaluate(() => window.scrollTo({ top: 320, behavior: "instant" }));
    const scrolled = await page.evaluate(() => Math.round(window.scrollY));
    await player.openPlayer();
    await player.dialog.getByRole("tab", { name: "Up next" }).click();
    const url = page.url();
    await page.evaluate(() => {
      const seen: Array<string | null> = [];
      (window as unknown as { __mini: typeof seen }).__mini = seen;
      new MutationObserver(() =>
        seen.push(document.documentElement.getAttribute("data-mini")),
      ).observe(document.documentElement, { attributes: true, attributeFilter: ["data-mini"] });
    });
    await player.finger.press(
      player.dialog.locator('[data-queue-id="2026-10-05"] .player-queue-row'),
    );
    await expect(
      player.dialog.locator('[data-queue-id="2026-10-05"][data-state="current"]'),
    ).toBeVisible({ timeout: 10_000 });
    await expect(player.root).toHaveAttribute("data-player-state", "playing");
    expect(page.url()).toBe(url);
    expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(scrolled);
    expect(await audio.count()).toBe(1);
    expect(
      await page.evaluate(() => (window as unknown as { __mini: unknown[] }).__mini),
    ).not.toContain("hidden");
    // The two skipped items and the one that played first are still listed, behind the current one.
    await expect(player.dialog.locator('[data-state="played"]')).toHaveCount(3);
    expect(await page.evaluate(() => localStorage.getItem("singularity:queue"))).toBeNull();
    // The first item plays again from its row, and what followed it is to come again, in order.
    await player.finger.press(
      player.dialog.locator(`[data-state="played"] .player-queue-row`).first(),
    );
    await expect(player.dialog.locator(`[data-state="current"]`)).toHaveCount(1);
    await expect(player.dialog.getByRole("button", { name: /^Move / })).toHaveCount(3);
    expect(
      await player.dialog
        .locator("[data-queue-id]:not([data-state])")
        .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-queue-id"))),
    ).toEqual(["ep-20261006-0900", "ep-20261007-1930", "2026-10-05"]);
  });
});
