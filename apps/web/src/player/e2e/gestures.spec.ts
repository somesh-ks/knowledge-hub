import { center, expect, type LabPage, line, type Point, test } from "./lab";

/** A point on the page's header that is not a control: the title. */
async function headerSpot(lab: LabPage): Promise<Point> {
  return center(await lab.boxOf(lab.dialog.locator(".player-title")));
}

async function opened(lab: LabPage): Promise<{ header: Point; height: number }> {
  await lab.open();
  await lab.play();
  await lab.openPlayer();
  const { window } = await lab.geometry();
  return { header: await headerSpot(lab), height: window.height };
}

// A flick here is three large steps 8 ms apart, about 5 px/ms; a finger flicks at 1 to 3 px/ms.
// Each event states the time it means (lab.ts, gestureClock), so a loaded machine delivering them
// late does not turn the flick into a slow drag.
test.describe("opening by gesture @surface", () => {
  test("a short, slow pull up goes back down without opening", async ({ lab, finger }) => {
    await lab.open();
    await lab.play();
    const start = center(await lab.dockSettled());
    await finger.drag(line(start, { x: start.x, y: start.y - 60 }, 6), 60);
    await lab.collapsed();
    await expect(lab.sheet).toBeHidden();
    // Not a commit: the page behind was never taken away.
    await expect(lab.root).toHaveAttribute("data-player", "closed");
  });

  test("a flick up opens the page even when the finger travelled little", async ({
    lab,
    finger,
  }) => {
    await lab.open();
    await lab.play();
    const start = center(await lab.dockSettled());
    await finger.drag(line(start, { x: start.x, y: start.y - 120 }, 3), 8);
    await lab.expanded();
    expect(await lab.progress()).toBeCloseTo(1, 2);
  });

  test("a long pull up opens on release, and nothing behind is inert until then", async ({
    lab,
    page,
    finger,
  }) => {
    await lab.open();
    await lab.play();
    const start = center(await lab.dockSettled());
    const { window } = await lab.geometry();
    const held = await finger.drag(
      line(start, { x: start.x, y: start.y - window.height * 0.5 }, 14),
      30,
      { hold: true },
    );
    await expect(lab.surface).toHaveAttribute("data-state", "dragging");
    // Following a finger is not a decision.
    await expect(lab.root).toHaveAttribute("data-player", "closed");
    expect(await page.locator("[data-player-inert]").count()).toBe(0);
    await held.release();
    await lab.expanded();
  });
});

test.describe("closing by gesture @surface", () => {
  test("a flick down on the header dismisses the page along its spring", async ({
    lab,
    finger,
  }) => {
    const { header } = await opened(lab);
    await finger.drag(line(header, { x: header.x, y: header.y + 230 }, 3), 8);
    await lab.collapsed();
    await expect(lab.sheet).toBeHidden();
    await expect(lab.openButton).toBeVisible();
  });

  test("a slow, short drag down snaps back open, because release decides", async ({
    lab,
    finger,
  }) => {
    const { header } = await opened(lab);
    await finger.drag(line(header, { x: header.x, y: header.y + 110 }, 8), 50);
    await lab.expanded();
    expect(await lab.progress()).toBeCloseTo(1, 2);
  });

  test("a long, slow drag down past the threshold dismisses on release", async ({
    lab,
    finger,
  }) => {
    const { header, height } = await opened(lab);
    await finger.drag(line(header, { x: header.x, y: header.y + height * 0.55 }, 10), 60);
    await lab.collapsed();
  });

  test("never dismisses mid-drag: the page follows the pointer and waits for the lift", async ({
    lab,
    finger,
  }) => {
    const { header, height } = await opened(lab);
    const held = await finger.drag(
      line(header, { x: header.x, y: header.y + height * 0.7 }, 12),
      30,
      { hold: true },
    );
    await expect(lab.surface).toHaveAttribute("data-state", "dragging");
    await expect(lab.root).toHaveAttribute("data-player", "open");
    await expect.poll(() => lab.progress()).toBeLessThan(0.45);
    await held.release();
    await lab.collapsed();
  });

  test("a pull down on the cover dismisses too: the whole top of the page is the handle", async ({
    lab,
    finger,
  }) => {
    await opened(lab);
    const cover = center(await lab.boxOf(lab.dialog.locator("[data-player-cover]")));
    await finger.drag(line(cover, { x: cover.x, y: cover.y + 260 }, 3), 8);
    await lab.collapsed();
  });
});

test.describe("scrolling inside the page @surface", () => {
  test("scrolling the list never drags the page", async ({ lab, page, finger, browserName }) => {
    test.skip(
      browserName === "webkit",
      "Playwright's mobile WebKit rejects mouse.wheel and has no touch scroll to stand in for it",
    );
    await opened(lab);
    const row = lab.dialog.getByRole("list").last().getByRole("button").last();
    await row.scrollIntoViewIfNeeded();
    const spot = center(await lab.boxOf(row));
    if (finger.touch && browserName === "chromium") {
      await finger.drag(line(spot, { x: spot.x, y: spot.y + 140 }, 6), 8);
    } else {
      await page.mouse.move(spot.x, spot.y);
      await page.mouse.wheel(0, -300);
    }
    await page.waitForTimeout(300);
    await lab.expanded();
    expect(await lab.progress()).toBeCloseTo(1, 2);
  });

  test("on a scrolled page a pull down on the top scrolls back instead of dismissing", async ({
    lab,
    page,
    finger,
    browserName,
  }) => {
    test.skip(!finger.touch || browserName !== "chromium", "needs a real touch sequence");
    await page.setViewportSize({ width: 375, height: 553 });
    await opened(lab);
    await lab.sheet.evaluate((element) => {
      element.scrollTop = 60;
    });
    const cover = center(await lab.boxOf(lab.dialog.locator("[data-player-cover]")));
    await finger.drag(line(cover, { x: cover.x, y: cover.y + 50 }, 8), 30);
    await page.waitForTimeout(500);
    await lab.expanded();
    expect(await lab.sheet.evaluate((element) => element.scrollTop)).toBeLessThan(40);
    // From the top the same pull, carried on, is a dismissal again.
    await lab.sheet.evaluate((element) => {
      element.scrollTop = 0;
    });
    await finger.drag(line(cover, { x: cover.x, y: cover.y + 260 }, 6), 8);
    await lab.collapsed();
  });

  test("a pull up on the top of the page scrolls it", async ({
    lab,
    page,
    finger,
    browserName,
  }) => {
    test.skip(!finger.touch || browserName !== "chromium", "needs a real touch sequence");
    await page.setViewportSize({ width: 375, height: 553 });
    await opened(lab);
    const cover = center(await lab.boxOf(lab.dialog.locator("[data-player-cover]")));
    await finger.drag(line(cover, { x: cover.x, y: cover.y - 120 }, 8), 30);
    await expect.poll(() => lab.sheet.evaluate((element) => element.scrollTop)).toBeGreaterThan(60);
    await lab.expanded();
  });
});

test.describe("closing the page @surface", () => {
  test("closes from the keyboard's close button and gives the document back with the bar in place", async ({
    lab,
    page,
  }) => {
    await opened(lab);
    await lab.closeButton.focus();
    await page.keyboard.press("Enter");
    await lab.collapsed();
    await expect(lab.sheet).toBeHidden();
    await expect(lab.openButton.locator(".player-cover-frame")).toBeVisible();
  });

  test("closes with Escape and returns focus to the control that opened it", async ({
    lab,
    page,
  }) => {
    await lab.open();
    await lab.play();
    await lab.openButton.focus();
    await page.keyboard.press("Enter");
    await lab.expanded();
    // Focus went into the page when it opened.
    expect(
      await page.evaluate(() => document.activeElement?.hasAttribute("data-player-page") ?? false),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await lab.collapsed();
    await expect(lab.openButton).toBeFocused();
  });

  test("Tab never reaches anything behind the open page", async ({ lab, page }) => {
    await opened(lab);
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

  test("the dialog holds page and bar, and one control closes it @surface", async ({
    lab,
    page,
  }) => {
    await opened(lab);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveCount(1);
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    // The bar is inside the dialog, so a screen reader that honours aria-modal reaches its controls.
    await expect(dialog.locator("[data-player-page]")).toHaveCount(1);
    await expect(dialog.locator("[data-player-dock]")).toHaveCount(1);
    const mouseWide = await page.evaluate(
      () => matchMedia("(min-width: 64rem) and (hover: hover) and (pointer: fine)").matches,
    );
    // With a mouse on a wide screen the bar's chevron is the one close; the focus-only pill is not
    // there to be said twice.
    if (mouseWide) {
      await expect(dialog.getByRole("button", { name: "Close the player" })).toHaveCount(1);
    }
    await page.keyboard.press("Escape");
    await lab.collapsed();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
