import type { Page, Route } from "@playwright/test";
import { center, expect, line, type PlayerPage, SITE, test } from "./helpers";
import { enterPassphrase } from "./passphrase";

/** The player's lazily loaded half, by any name the bundler or the dev server gives it. */
const LAZY_CHUNK = /PlayerPageContent|ExpandedPlayer/;

function reply(route: Route, status: number, body: Record<string, unknown>) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/**
 * Starts a Generate run, closes the sheet, and lets the run finish while the player is open. On the
 * player that is a button on the page; on the site it is New briefing in the latest briefing header's More menu.
 */
async function finishRunBehindThePlayer(page: Page, player: PlayerPage): Promise<void> {
  const id = SITE.earlier;
  await page.route("**/api/generate", (route) =>
    reply(route, 202, { run_id: 91, started_at: "2026-01-14T07:13:00Z" }),
  );
  let calls = 0;
  await page.route("**/api/status**", (route) => {
    calls += 1;
    return reply(
      route,
      200,
      calls === 1
        ? { run_id: 91, state: "running", step: "reading" }
        : {
            run_id: 91,
            state: "completed",
            step: "publishing",
            outcome: "published",
            digest_id: id,
          },
    );
  });
  await player.open();
  await player.play();
  // The store reads its timers from the page clock, so the background check can be hurried.
  await page.clock.install();
  const dialog = await player.openGenerate();
  await enterPassphrase(dialog);
  await player.finger.press(dialog.getByRole("button", { name: "Generate briefing" }));
  await page.clock.runFor(3_100);
  await player.finger.press(dialog.getByRole("button", { name: "Close", exact: true }).first());
  await expect(dialog).toBeHidden();
}

test.describe("paths that used to leave the player stuck", () => {
  test("after Back with the player open, a tap on the bar opens it again @smoke", async ({
    player,
    page,
  }) => {
    await player.open();
    await player.play();
    await player.goToNextPage();
    await player.dockSettled();
    await player.openPlayer();
    // Back dismisses the open player and stays on the page.
    await page.goBack();
    await expect(page).toHaveURL(SITE.nextUrl);
    await player.collapsed();
    // The bar shows its cover again; nothing was left hidden by the navigation.
    await expect(player.openButton.locator(".player-cover-frame")).toBeVisible();
    await player.dockSettled();
    await player.openPlayer();
    await expect(player.scrubber).toBeVisible();
    await page.goBack();
    await player.collapsed();
    // A second Back, with nothing open, leaves the page.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${SITE.path}$`));
    await player.collapsed();
    await page.goForward();
    await expect(page).toHaveURL(SITE.nextUrl);
    await player.collapsed();
    await player.dockSettled();
    await player.openPlayer();
  });

  test("a player closed any other way gives its history entry back @smoke", async ({
    player,
    page,
  }) => {
    await player.open();
    await player.play();
    await player.goToNextPage();
    await player.dockSettled();
    await player.openPlayer();
    await page.keyboard.press("Escape");
    await player.collapsed();
    await expect(page).toHaveURL(SITE.nextUrl);
    // One Back leaves: the entry the open player took was handed back on close.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${SITE.path}$`));
  });

  test("after the toast's Open action with the player open, a tap on the bar opens it again", async ({
    player,
    page,
    finger,
  }) => {
    await finishRunBehindThePlayer(page, player);
    await player.openPlayer();
    await page.clock.runFor(16_000);
    const toast = page.locator(".toast");
    await expect(toast).toBeVisible();
    await finger.press(toast.getByRole("button", { name: "Open" }));
    await expect(page).toHaveURL(new RegExp(`/d/${SITE.earlier}`));
    await player.collapsed();
    await player.dockSettled();
    await player.openPlayer();
    await expect(player.scrubber).toBeVisible();
  });

  test("a sloppy tap that drifts 10 to 12 px still opens the player", async ({
    player,
    finger,
  }) => {
    await player.open();
    await player.play();
    const start = center(await player.dockSettled());
    for (const drift of [10, 12]) {
      // Up and a little sideways, over about 150 ms: a thumb, not a swipe.
      await finger.drag(line(start, { x: start.x + 3, y: start.y - drift }, 5), 30);
      await player.expanded();
      await player.page.keyboard.press("Escape");
      await player.collapsed();
      await player.dockSettled();
    }
  });

  // A second tap 120 ms after an opening one, and a tap 100 or 300 ms into a close: each ends open,
  // and nothing under the tap was pressed by accident.
  for (const { name, opening, delay } of [
    { name: "two taps 120 ms apart end with the player open", opening: true, delay: 120 },
    { name: "a tap on the bar 100 ms into a close opens it again", opening: false, delay: 100 },
    { name: "a tap on the bar 300 ms into a close opens it again", opening: false, delay: 300 },
  ]) {
    test(name, async ({ player, page, finger }) => {
      await player.open();
      await player.play();
      const spot = center(await player.dockSettled());
      if (opening) {
        await finger.pressAt(spot);
      } else {
        await player.openPlayer();
        await page.keyboard.press("Escape");
      }
      await page.waitForTimeout(delay);
      await finger.pressAt(spot);
      await player.expanded();
      await expect(player.root).toHaveAttribute("data-player-state", "playing");
    });
  }
});

test.describe("when the player's lazy half cannot load", () => {
  // A service worker would fetch the chunk where the route below cannot see it.
  test.use({ serviceWorkers: "block" });

  test("the player still opens and offers to try again", async ({ player, page, finger }) => {
    let failing = true;
    await page.route(LAZY_CHUNK, (route) => (failing ? route.abort() : route.continue()));
    await player.open();
    await player.play();
    await finger.press(player.openButton);
    await player.expanded();
    // The shell is there at once: the cover, the title and a way out.
    await expect(player.closeButton).toHaveCount(1);
    const retry = player.dialog.getByRole("button", { name: "Try again" });
    await expect(retry).toBeVisible();
    await expect(player.dialog.getByRole("slider")).toHaveCount(0);
    failing = false;
    await finger.press(retry);
    // The lazy half is back: its controls are there (its scrubber is hidden on a wide screen).
    await expect(player.dialog.getByRole("button", { name: /^Playback speed/ })).toBeVisible();
    await expect(retry).toHaveCount(0);
  });
});

test.describe("a window that changes size", () => {
  test("resizing from a phone to landscape to a desktop keeps the open player whole", async ({
    player,
    page,
    browserName,
    isMobile,
  }) => {
    test.skip(browserName !== "chromium" || !isMobile, "driven from the phone project");
    await player.open();
    await player.play();
    await player.openPlayer();
    for (const size of [
      { width: 844, height: 390 },
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      await player.expanded();
      const sheet = await player.boxOf(player.dialog);
      const wide = size.width >= 640;
      const bar = wide ? await player.boxOf(player.dock) : null;
      const width = await page.evaluate(() => document.documentElement.clientWidth);
      expect(Math.abs(sheet.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(sheet.width - width)).toBeLessThanOrEqual(1);
      expect(Math.abs(sheet.y + sheet.height - (bar ? bar.y : size.height))).toBeLessThanOrEqual(1);
      // The cover on the page is the one on screen, where the layout put it.
      await expect(player.dialog.locator(".player-cover-frame")).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await player.collapsed();
  });
});
