import type { Page } from "@playwright/test";
import { center, expect, line, SITE, serveNarration, test } from "./helpers";

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
    // Up next is the other view: moved up by its row's handle and the arrow key, the briefing now comes first.
    await player.dialog.getByRole("tab", { name: "Up next" }).click();
    await player.dialog
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

  // The queue's own gestures (owner, 2026-11-02): the browser's long-press drag never started on his
  // phone, so a grip at the row's end lifts it; a swipe to either side removes it.
  test("the grip moves a queued row, a swipe to either side takes one off, and the order survives a reload", async ({
    player,
    finger,
    page,
  }) => {
    await player.open();
    await page.evaluate(() => {
      for (const id of ["ep-20261006-0900", "ep-20261007-1930", "2026-10-05"])
        document.dispatchEvent(new CustomEvent("singularity:queue-add", { detail: { id } }));
    });
    await player.play();
    await player.openPlayer();
    await player.dialog.getByRole("tab", { name: "Up next" }).click();
    const queue = () => page.evaluate(() => localStorage.getItem("singularity:queue"));
    const grip = (id: string) =>
      player.dialog.locator(`[data-queue-id="${id}"] .player-queue-grip`);
    // The art stands lower, so the rows start near the bottom edge: the page is scrolled to bring them up.
    await player.sheet.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const first = center(await player.boxOf(grip("ep-20261006-0900")));
    const last = center(await player.boxOf(grip("2026-10-05")));
    // Lifted from the first place and let go below the last row's middle: it goes to the end.
    await finger.drag(line(first, { x: first.x, y: last.y + 20 }, 12), 24);
    await expect.poll(queue).toBe('["ep-20261007-1930","2026-10-05","ep-20261006-0900"]');
    await page.reload();
    expect(await queue()).toBe('["ep-20261007-1930","2026-10-05","ep-20261006-0900"]');
    await player.play();
    await player.openPlayer();
    await player.dialog.getByRole("tab", { name: "Up next" }).click();
    // A swipe to the right and one to the left each take their row off.
    await player.sheet.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const row = (id: string) => player.dialog.locator(`[data-queue-id="${id}"] .player-queue-row`);
    const right = center(await player.boxOf(row("ep-20261007-1930")));
    // Held past the point where it leaves (owner, 2026-11-03): the row keeps its own look, so it can
    // still be read, and the red lies behind it as a strip that stays where it is.
    const li = player.dialog.locator('[data-queue-id="ep-20261007-1930"]');
    const face = li.locator(".player-queue-face");
    const strip = li.locator(".player-queue-delete");
    const resting = await face.evaluate((el) => getComputedStyle(el).backgroundColor);
    const stripAtRest = await player.boxOf(li);
    const held = await finger.drag(line(right, { x: right.x + 300, y: right.y }, 6), 12, {
      hold: true,
    });
    await expect(strip).toBeVisible();
    await expect(face).toHaveCSS("background-color", resting);
    await expect(li).not.toHaveCSS(
      "background-color",
      await strip.evaluate((el) => getComputedStyle(el).backgroundColor),
    );
    await expect(face.locator(".player-queue-row")).toBeVisible();
    expect(await player.boxOf(li)).toEqual(stripAtRest);
    await held.release();
    await expect.poll(queue).toBe('["2026-10-05","ep-20261006-0900"]');
    const left = center(await player.boxOf(row("2026-10-05")));
    await finger.drag(line(left, { x: left.x - 300, y: left.y }, 6), 12);
    await expect.poll(queue).toBe('["ep-20261006-0900"]');
    // The row that plays is swiped away the same way: it leaves the list, and the audio plays on.
    const playing = player.dialog.locator('[data-state="current"] .player-queue-row');
    const here = center(await player.boxOf(playing));
    await finger.drag(line(here, { x: here.x + 300, y: here.y }, 6), 12);
    await expect(player.dialog.locator('[data-state="current"]')).toHaveCount(0);
  });

  // A mouse has no swipe to remove with (owner, 2026-11-03): the row shows a ⋮ on hover whose menu takes
  // it off, beside Go to podcast, Share and Download.
  test("a queued row shows its handle and ⋮ only under the mouse, and Remove from queue takes the row off @desktop", async ({
    player,
    page,
    hasTouch,
  }) => {
    await player.open();
    await page.evaluate(() => {
      for (const id of ["ep-20261006-0900", "2026-10-05"])
        document.dispatchEvent(new CustomEvent("singularity:queue-add", { detail: { id } }));
    });
    await player.play();
    await player.openPlayer();
    await player.dialog.getByRole("tab", { name: "Up next" }).click();
    const row = player.dialog.locator('[data-queue-id="ep-20261006-0900"]');
    const dots = row.locator(".player-queue-more");
    const grip = row.locator(".player-queue-grip");
    if (hasTouch) {
      // A phone has no hover: the handle stays in view and no dots are drawn.
      await expect(grip).toBeVisible();
      await expect(dots).toBeHidden();
      return;
    }
    await expect(dots).toHaveCSS("opacity", "0");
    await expect(grip).toHaveCSS("opacity", "0");
    await row.hover();
    await expect(dots).toHaveCSS("opacity", "1");
    await expect(grip).toHaveCSS("opacity", "1");
    await expect(grip).toHaveCSS("cursor", "move");
    await dots.click();
    const menu = player.dialog.getByRole("menu");
    for (const name of ["Go to podcast", "Share", "Download", "Remove from queue"])
      await expect(menu.getByRole("menuitem", { name })).toBeVisible();
    await menu.getByRole("menuitem", { name: "Remove from queue" }).click();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("singularity:queue")))
      .toBe('["2026-10-05"]');
  });

  test("switching between Stories and Up next keeps where the page was scrolled", async ({
    player,
    page,
  }) => {
    await player.open();
    await page.evaluate(() => {
      for (const id of ["ep-20261006-0900", "ep-20261007-1930", "2026-10-05"])
        document.dispatchEvent(new CustomEvent("singularity:queue-add", { detail: { id } }));
    });
    await player.play();
    await player.openPlayer();
    await player.sheet.evaluate((element) => {
      element.scrollTop = 140;
    });
    const at = () => player.sheet.evaluate((element) => Math.round(element.scrollTop));
    const kept = await at();
    expect(kept).toBeGreaterThan(60);
    await player.dialog.getByRole("tab", { name: "Up next" }).click();
    await expect(player.dialog.locator("[data-queue-id]").first()).toBeVisible();
    expect(await at()).toBe(kept);
    await player.dialog.getByRole("tab", { name: "Stories" }).click();
    expect(await at()).toBe(kept);
  });

  // D277: a tap on a queued item, even the third, starts it where the player stands. The bar never
  // goes down and comes back (the old road collapsed the sheet and loaded the item's page). What was
  // passed is not listed (D346): the playing row heads the list.
  test("a tap on the third queued item plays it with the bar up, and it heads the list alone", async ({
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
    // The reader scrolled to where they are reading, so the page's own podcast stops following its
    // story down the page for a few seconds (a story change lands in this window on a slow runner).
    await page.evaluate(() => {
      window.scrollTo({ top: 320, behavior: "instant" });
      window.dispatchEvent(new WheelEvent("wheel"));
    });
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
    // Nothing sits above the playing row (owner, 2026-11-03): it heads the list, and what was passed is
    // not listed. The queue the list reads from holds nothing more to come.
    await expect(player.dialog.locator('[data-state="played"]')).toHaveCount(0);
    await expect(
      player.dialog.getByRole("list", { name: "Playing" }).locator("[data-queue-id]"),
    ).toHaveAttribute("data-queue-id", "2026-10-05");
    expect(await page.evaluate(() => localStorage.getItem("singularity:queue"))).toBeNull();
  });
});
