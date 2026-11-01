import { center, expect, line, type PlayerPage, type Point, test } from "./helpers";

/** A point on the page's header that is not a control: the title. */
async function headerSpot(player: PlayerPage): Promise<Point> {
  return center(await player.boxOf(player.dialog.locator(".player-title")));
}

async function opened(player: PlayerPage): Promise<Point> {
  await player.open();
  await player.play();
  await player.openPlayer();
  return headerSpot(player);
}

const coverSpot = async (player: PlayerPage): Promise<Point> =>
  center(await player.boxOf(player.dialog.locator("[data-player-cover]")));

// The drags are real touch sequences, so they run on the phone project only. Release decides, and
// its thresholds are gestureMath.test.ts's. A flick here is three large steps 8 ms apart, about
// 5 px/ms; each event states the time it means (helpers.ts, gestureClock), so a loaded machine
// delivering them late does not turn the flick into a slow drag.
test.describe("opening by gesture", () => {
  test("a flick up opens the page even when the finger travelled little", async ({
    player,
    finger,
  }) => {
    await player.open();
    await player.play();
    const start = center(await player.dockSettled());
    await finger.drag(line(start, { x: start.x, y: start.y - 120 }, 3), 8);
    await player.expanded();
    expect(await player.progress()).toBeCloseTo(1, 2);
  });

  test("a long pull up opens on release, and nothing behind is inert until then", async ({
    player,
    page,
    finger,
  }) => {
    await player.open();
    await player.play();
    const start = center(await player.dockSettled());
    const height = page.viewportSize()?.height ?? 0;
    const held = await finger.drag(line(start, { x: start.x, y: start.y - height * 0.5 }, 14), 30, {
      hold: true,
    });
    await expect(player.surface).toHaveAttribute("data-state", "dragging");
    // Following a finger is not a decision.
    await expect(player.root).toHaveAttribute("data-player", "closed");
    expect(await page.locator("[data-player-inert]").count()).toBe(0);
    await held.release();
    await player.expanded();
  });
});

test("a flick down on the header, a pull down on the cover or on the controls below the seek strip dismisses the page", async ({
  player,
  finger,
  page,
}) => {
  const header = await opened(player);
  await finger.drag(line(header, { x: header.x, y: header.y + 230 }, 3), 8);
  await player.collapsed();
  await expect(player.sheet).toBeHidden();
  await expect(player.openButton).toBeVisible();
  // The whole top of the page is the handle, the cover with it.
  await player.dockSettled();
  await player.openPlayer();
  const cover = await coverSpot(player);
  await finger.drag(line(cover, { x: cover.x, y: cover.y + 260 }, 3), 8);
  await player.collapsed();
  // The thumb's zone too (owner, 2026-11-01): a pull down from the transport, below the seek strip.
  await player.dockSettled();
  await player.openPlayer();
  const play = player.dialog.getByRole("button", { name: /^Play|^Pause/ }).first();
  const transport = center(await player.boxOf(play));
  const state = page.locator("html");
  const before = await state.getAttribute("data-player-state");
  await finger.drag(line(transport, { x: transport.x, y: transport.y + 240 }, 3), 8);
  await player.collapsed();
  // The pull began on a transport button: it dismissed, and pressed nothing.
  await page.waitForTimeout(600);
  expect(await state.getAttribute("data-player-state")).toBe(before);
});

test("inside the page a pull scrolls before it drags: the list, and the top of a scrolled page", async ({
  player,
  page,
  finger,
}) => {
  await page.setViewportSize({ width: 375, height: 553 });
  await opened(player);
  // A pull down on the list scrolls it and never drags the page.
  const row = player.dialog.getByRole("list").last().getByRole("button").last();
  await row.scrollIntoViewIfNeeded();
  const spot = center(await player.boxOf(row));
  await finger.drag(line(spot, { x: spot.x, y: spot.y + 140 }, 6), 8);
  await player.expanded();
  expect(await player.progress()).toBeCloseTo(1, 2);
  // On a scrolled page a pull down on the top scrolls back instead of dismissing.
  await player.sheet.evaluate((element) => {
    element.scrollTop = 60;
  });
  const cover = await coverSpot(player);
  await finger.drag(line(cover, { x: cover.x, y: cover.y + 50 }, 8), 30);
  await expect.poll(() => player.sheet.evaluate((element) => element.scrollTop)).toBeLessThan(40);
  await player.expanded();
  // A pull up on the top scrolls the page.
  await player.sheet.evaluate((element) => {
    element.scrollTop = 0;
  });
  const top = await coverSpot(player);
  await finger.drag(line(top, { x: top.x, y: top.y - 120 }, 8), 30);
  await expect
    .poll(() => player.sheet.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(60);
  await player.expanded();
});

test.describe("closing the page", () => {
  test("closes from the keyboard's close button and gives the document back with the bar in place @desktop", async ({
    player,
    page,
    hasTouch,
  }) => {
    await opened(player);
    await player.closeButton.focus();
    await page.keyboard.press("Enter");
    await player.collapsed();
    await expect(player.sheet).toBeHidden();
    await expect(player.openButton.locator(".player-cover-frame")).toBeVisible();
    // The close control hid with the page; focus is on the bar's open control, not lost to the body.
    if (!hasTouch) await expect(player.openButton).toBeFocused();
  });

  test("closes with Escape and returns focus to the control that opened it @desktop", async ({
    player,
    page,
  }) => {
    await player.open();
    await player.play();
    await player.openButton.focus();
    await page.keyboard.press("Enter");
    await player.expanded();
    // Focus went into the page when it opened.
    expect(
      await page.evaluate(() => document.activeElement?.hasAttribute("data-player-page") ?? false),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await player.collapsed();
    await expect(player.openButton).toBeFocused();
  });

  test("Tab never reaches anything behind the open page @desktop", async ({ player, page }) => {
    await opened(player);
    const seen = new Set<string>();
    for (let press = 0; press < 24; press += 1) {
      await page.keyboard.press("Tab");
      const where = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active || active === document.body) return "outside the document";
        if (active.closest("[data-player-surface]")) {
          return `player: ${active.getAttribute("aria-label") ?? active.textContent?.trim()}`;
        }
        return `behind: ${active.tagName} ${active.textContent?.trim().slice(0, 30)}`;
      });
      expect(where).not.toMatch(/^behind/);
      seen.add(where);
    }
    // It did go round the player's own controls.
    expect([...seen].some((where) => where.startsWith("player: Close the player"))).toBe(true);
    // The timeline is the page's, or on a wide screen with a mouse the bar's.
    expect([...seen].some((where) => /^player: (Playback position|Seek)/.test(where))).toBe(true);
  });
});
