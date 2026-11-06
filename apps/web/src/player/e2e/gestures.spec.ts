import { center, expect, line, type PlayerPage, type Point, serveNarration, test } from "./helpers";

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

  // Bug it prevents (owner, 2026-11-03, Android Chrome): after swiping the bar up, the first tap on
  // Play did nothing. Chrome sends the pointer events but no click for a tap soon after a fast flick.
  test("the first tap after a flick up reaches the page's Play", async ({
    player,
    page,
    audio,
    finger,
  }) => {
    // Time runs as usual until the test moves it on.
    await page.clock.install();
    await player.open();
    await player.play();
    const start = center(await player.dockSettled());
    await finger.drag(line(start, { x: start.x, y: start.y - 120 }, 3), 8);
    await player.expanded();
    const playing = await audio.read();
    expect(playing?.paused).toBe(false);
    await finger.press(player.dialog.locator(".transport [data-primary]"));
    await expect.poll(async () => (await audio.read())?.paused).toBe(true);
    // One tap is one press: it does not pause and play again.
    await page.clock.runFor(600);
    expect((await audio.read())?.paused).toBe(true);
    // A tap the browser clicks for itself is not clicked twice.
    await finger.press(player.dialog.locator(".transport [data-primary]"));
    await expect.poll(async () => (await audio.read())?.paused).toBe(false);
    await page.clock.runFor(600);
    expect((await audio.read())?.paused).toBe(false);
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

// The bar is a carousel of podcasts (owner, 2026-11-01 and 2026-11-02): a swipe goes to the next
// queued one or back to the one before, and a short one does neither nor opens the page.
test("a swipe on the bar switches the podcast without tinting the bar and fades one track for the next; a short one does not and opens nothing", async ({
  player,
  page,
  finger,
}) => {
  await player.open();
  await serveNarration(page, 300, "/d/2026-10-05");
  await page.evaluate(() => {
    document.dispatchEvent(
      new CustomEvent("singularity:queue-add", { detail: { id: "2026-10-05" } }),
    );
  });
  await player.play();
  const playing = () =>
    page.evaluate(() => {
      const raw = localStorage.getItem("singularity:queue-played");
      return raw ? ((JSON.parse(raw) as { current?: string }).current ?? null) : null;
    });
  const first = await playing();
  const spot = center(await player.boxOf(player.openButton.locator(".dock-text")));
  // Too short to be one: the podcast stays, and the page does not open on what is not a tap either.
  await finger.drag(line(spot, { x: spot.x - 20, y: spot.y }, 3), 8);
  await expect(player.openButton).not.toHaveAttribute("data-swipe-out");
  expect(await playing()).toBe(first);
  await player.collapsed();
  // Owner, 2026-11-03: the podcast a swipe goes to shows before the finger lifts. Held a third of the
  // way left, the next one has come in from the right edge, inside the bar and clear of the words;
  // pulled back to where it began, it is gone.
  const bar = await player.boxOf(player.openButton);
  const held = await finger.drag(line(spot, { x: spot.x - 100, y: spot.y }, 4), 8, { hold: true });
  const peek = player.openButton.locator(".dock-peek");
  await expect(peek).toHaveCount(1);
  // Owner, 2026-11-05: the track leaving fades out as the one arriving fades in, both ways. Held a
  // third of the way over, the leaving cover is fainter than at rest and the arriving one has begun
  // to show; back where it began, the leaving one is whole again and the arriving one is gone.
  const own = player.openButton.locator(":scope > .player-thumb");
  const opacity = (el: typeof own) => el.evaluate((node) => Number(getComputedStyle(node).opacity));
  expect(await opacity(own)).toBeLessThan(1);
  expect(await opacity(peek.locator(".player-thumb"))).toBeGreaterThan(0);
  // Owner, 2026-11-04: the bar flashed grey for the whole swipe. Chrome on a phone holds :active for
  // a touch (emulated touch does not, so it is forced), and a finger's press must not tint the bar.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: ".dock-open",
  });
  const layer = () =>
    player.openButton.evaluate((el) => getComputedStyle(el, "::after").backgroundColor);
  const atRest = await layer();
  await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["active"] });
  expect(await layer()).toBe(atRest);
  await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] });
  const coming = await player.boxOf(peek.locator(".player-thumb"));
  expect(coming.x).toBeGreaterThan(spot.x - 100);
  expect(coming.x + coming.width).toBeLessThanOrEqual(bar.x + bar.width + 1);
  await held.move(line({ x: spot.x - 100, y: spot.y }, spot, 4));
  await expect(peek).toHaveCount(0);
  await expect.poll(() => opacity(own)).toBe(1);
  await held.release();
  expect(await playing()).toBe(first);
  await player.collapsed();
  // Left is the next queued podcast; right brings the one before back.
  // A thumb that has gone sideways and then wanders up, past 45 degrees, is still switching: the
  // page is not pulled open under it.
  const turn = { x: spot.x - 50, y: spot.y - 5 };
  await finger.drag(
    [...line(spot, turn, 4), ...line(turn, { x: spot.x - 180, y: spot.y - 190 }, 6)],
    30,
  );
  await expect.poll(playing, { timeout: 10_000 }).toBe("2026-10-05");
  await player.collapsed();
  // A thumb's swipe rises as it goes, here about 25 degrees over a quarter of a second: the bar keeps
  // it, so it switches back and the page is not pulled open (sheetController.ts, the sideways wander).
  await finger.drag(line(spot, { x: spot.x + 160, y: spot.y - 75 }, 8), 30);
  await expect.poll(playing, { timeout: 10_000 }).toBe(first);
  await player.collapsed();
});

test("a flick down on the header, a pull down on the cover or on the controls below the seek strip dismisses the page", async ({
  player,
  finger,
  page,
}) => {
  const header = await opened(player);
  // Owner, 2026-11-03: pulling the page down while it plays left a patch of the cover's blurred light
  // behind the bar. The light was held off during the pull and faded in again as the page landed.
  await page.evaluate(() => {
    const seen: number[] = [];
    (window as unknown as { __light: number[] }).__light = seen;
    const sample = (): void => {
      const state = document.querySelector("[data-player-surface]")?.getAttribute("data-state");
      const light = document.querySelector(".player-cover-glow");
      // From the first frame the page is no longer open, through its landing on the dock.
      if (state && state !== "expanded" && light)
        seen.push(Number(getComputedStyle(light).opacity));
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await finger.drag(line(header, { x: header.x, y: header.y + 230 }, 3), 8);
  await player.collapsed();
  await player.dockSettled();
  const light = await page.evaluate(() => (window as unknown as { __light: number[] }).__light);
  expect(light.length, "the page was seen closing").toBeGreaterThan(0);
  // Compared with itself: once the page is pulled the light only fades, to the end of the landing.
  for (const opacity of light) expect(opacity).toBeLessThanOrEqual(light[0] ?? 0);
  expect(light.at(-1)).toBeLessThan(light[0] ?? 0);
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
