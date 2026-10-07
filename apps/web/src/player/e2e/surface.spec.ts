import type { Page } from "@playwright/test";
import { coverFrame } from "../core/coverMorph";
import { type Box, center, expect, line, test } from "./lab";

const WIDE_PX = 640;

/** How many covers a person can see right now. The morph hands one cover from bar to page. */
function visibleCovers(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      [...document.querySelectorAll(".player-cover-frame")].filter((element) =>
        element.checkVisibility({ visibilityProperty: true, opacityProperty: true }),
      ).length,
  );
}

/** The largest difference between two boxes' left edge, top edge and width. */
function apart(a: Box, b: Box): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.width - b.width));
}

test.describe("one surface @surface", () => {
  test("the bar and the player are one mounted element, and nothing lives in a portal", async ({
    lab,
    page,
  }) => {
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    const facts = await page.evaluate(() => {
      const slider = document.querySelector('[role="slider"][aria-label="Playback position"]');
      const open = [...document.querySelectorAll("button")].find((button) =>
        (button.getAttribute("aria-label") ?? "").startsWith("Open the player"),
      );
      const surface = slider?.closest("[data-player-surface]") ?? null;
      return {
        sharedSurface: surface !== null && surface === open?.closest("[data-player-surface]"),
        surfaces: document.querySelectorAll("[data-player-surface]").length,
        inPortal: document.querySelectorAll(
          '[data-base-ui-portal] [class*="player-"], [data-base-ui-portal] [role="slider"]',
        ).length,
        insideIsland: surface?.closest("astro-island") !== null && surface !== null,
      };
    });
    expect(facts).toEqual({ sharedSurface: true, surfaces: 1, inPortal: 0, insideIsland: true });
  });

  test("the page is in the document before it is opened, collapsed and out of reach", async ({
    lab,
  }) => {
    await lab.open();
    await expect(lab.surface).toHaveCount(1);
    await expect(lab.surface).toHaveAttribute("data-state", "collapsed");
    await expect(lab.sheet).toHaveAttribute("inert", "");
    await expect(lab.sheet).toBeHidden();
    await lab.play();
    await expect(lab.openButton).toHaveAttribute("aria-expanded", "false");
    const controls = await lab.openButton.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    await expect(lab.sheet).toHaveAttribute("id", controls ?? "");
    await lab.openPlayer();
    // By attribute: on a phone the bar is out of the accessibility tree while the page is open.
    await expect(lab.page.locator("[data-player-open]")).toHaveAttribute("aria-expanded", "true");
    await expect(lab.sheet).toHaveAttribute("aria-modal", "true");
  });

  test("the page rises from the bar's top edge, and one cover is on screen all the way", async ({
    lab,
    page,
    finger,
  }) => {
    await lab.open();
    await lab.play();
    const start = center(await lab.dockSettled());
    const rest = await lab.geometry();
    expect(await visibleCovers(page)).toBe(1);
    // A slow, short pull, held: the page has only just left the bar.
    const held = await finger.drag(line(start, { x: start.x, y: start.y - 48 }, 12), 30, {
      hold: true,
    });
    await expect(lab.surface).toHaveAttribute("data-state", "dragging");
    await expect.poll(async () => (await lab.geometry()).p).toBeGreaterThan(0.03);
    const now = await lab.geometry();
    expect(now.p).toBeLessThan(0.2);
    // Travel is linear in p and ends with the page's top on the bar's top.
    expect(Math.abs(now.sheet.y - rest.dock.y * (1 - now.p))).toBeLessThanOrEqual(1);
    if (now.window.width < WIDE_PX) {
      // On a phone the bar rides up on the page's top edge.
      expect(Math.abs(now.dock.y - now.sheet.y)).toBeLessThanOrEqual(1);
    } else {
      // On a wide screen the bar does not move.
      expect(Math.abs(now.dock.y - rest.dock.y)).toBeLessThanOrEqual(0.5);
    }
    expect(await visibleCovers(page)).toBe(1);
    await held.release();
    // A short, slow pull is not a decision: it goes back.
    await lab.collapsed();
    expect(await visibleCovers(page)).toBe(1);
  });

  test("the cover is mid-flight while the page is mid-travel, at any width", async ({
    lab,
    page,
    finger,
  }) => {
    await lab.open();
    await lab.play();
    const start = center(await lab.dockSettled());
    const rest = await lab.geometry();
    const pull = Math.round(rest.window.height * 0.45);
    const held = await finger.drag(line(start, { x: start.x, y: start.y - pull }, 16), 20, {
      hold: true,
    });
    await expect.poll(async () => (await lab.geometry()).p).toBeGreaterThan(0.3);
    const now = await lab.geometry();
    expect(now.state).toBe("dragging");
    expect(now.artTransform.scale).toBeGreaterThan(0.05);
    expect(now.artTransform.scale).toBeLessThan(0.98);
    // The stylesheet's transform is the formula in coverMorph.ts, for the flight script measured.
    const expected = coverFrame(now.p, {
      fromX: now.morph["from-x"] ?? Number.NaN,
      fromY: now.morph["from-y"] ?? Number.NaN,
      toX: now.morph["to-x"] ?? Number.NaN,
      toY: now.morph["to-y"] ?? Number.NaN,
      size: now.morph.size ?? Number.NaN,
      scale: now.morph.scale ?? Number.NaN,
    });
    expect(Math.abs(now.artTransform.x - expected.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(now.artTransform.y - expected.y)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(now.artTransform.scale - expected.scale)).toBeLessThanOrEqual(0.005);
    expect(await visibleCovers(page)).toBe(1);
    // Per-frame motion is custom properties only: the stylesheet owns what they mean.
    const written = await page.evaluate(() =>
      [...document.querySelectorAll("[data-player-surface], [data-player-surface] *")]
        .map((element) => element.getAttribute("style") ?? "")
        .filter((style) => /(^|;)\s*(transform|opacity|top|left|height|width)\s*:/.test(style)),
    );
    expect(written).toEqual([]);
    await held.release();
    // Far enough, and not moving back: it opens.
    await lab.expanded();
    expect(await visibleCovers(page)).toBe(1);
    expect(await lab.progress()).toBeCloseTo(1, 2);
    // At rest nothing that motion wrote is left behind.
    const leftovers = await page.evaluate(() =>
      [...document.querySelectorAll("[data-player-surface] *")]
        .map((element) => element.getAttribute("style") ?? "")
        .filter((style) => /--p\s*:|--art-/.test(style)),
    );
    expect(leftovers).toEqual([]);
  });

  test("the flying cover leaves from the bar's cover and lands on the page's cover", async ({
    lab,
    finger,
  }) => {
    await lab.open();
    await lab.play();
    const start = center(await lab.dockSettled());
    const rest = await lab.geometry();
    // Just past the slop: the cover has taken off and has not gone anywhere yet.
    const first = await finger.drag(line(start, { x: start.x, y: start.y - 14 }, 7), 30, {
      hold: true,
    });
    await expect(lab.surface).toHaveAttribute("data-state", "dragging");
    const takeoff = await lab.geometry();
    expect(takeoff.p).toBeLessThan(0.01);
    // Two pixels past the slop is a quarter of a percent of the way: under two pixels of flight.
    expect(apart(takeoff.art, rest.thumb)).toBeLessThanOrEqual(3);
    await first.release();
    await lab.collapsed();
    // Pulled past the top and held: the page is in place and the cover is on its slot.
    // To the top edge and no further: a pointer that leaves the window ends the gesture.
    const second = await finger.drag(line(start, { x: start.x, y: 3 }, 20), 16, {
      hold: true,
    });
    await expect.poll(async () => (await lab.geometry()).p).toBe(1);
    const landing = await lab.geometry();
    expect(landing.state).toBe("dragging");
    expect(apart(landing.art, landing.slot)).toBeLessThanOrEqual(1);
    await second.release();
    await lab.expanded();
  });

  test("a bottom navigation is told how far the page is, and let go at rest", async ({
    lab,
    page,
    finger,
  }) => {
    await lab.open();
    // The shell's bottom navigation, as its contract describes it: an element and its height.
    await page.evaluate(() => {
      const nav = document.createElement("nav");
      nav.setAttribute("data-bottom-nav", "");
      nav.setAttribute("aria-label", "Sections");
      document.body.append(nav);
      document.documentElement.style.setProperty("--bottom-nav-height", "56px");
    });
    const navP = (): Promise<string> =>
      page.evaluate(
        () =>
          document
            .querySelector<HTMLElement>("[data-bottom-nav]")
            ?.style.getPropertyValue("--player-p") ?? "missing",
      );
    await lab.play();
    const start = center(await lab.dockSettled());
    const rest = await lab.geometry();
    // The bar sits on top of the navigation.
    expect(
      Math.abs(rest.dock.y + rest.dock.height - (rest.window.height - 56)),
    ).toBeLessThanOrEqual(1);
    expect(await navP()).toBe("");
    const held = await finger.drag(line(start, { x: start.x, y: start.y - 120 }, 12), 30, {
      hold: true,
    });
    await expect.poll(async () => (await lab.geometry()).p).toBeGreaterThan(0.1);
    const now = await lab.geometry();
    expect(Number(await navP())).toBeCloseTo(now.p, 3);
    // The page still leaves from the bar's top edge, wherever the navigation put the bar.
    expect(Math.abs(now.sheet.y - rest.dock.y * (1 - now.p))).toBeLessThanOrEqual(1);
    await held.release();
    await lab.collapsed();
    expect(await navP()).toBe("");
    await lab.dockSettled();
    await lab.openPlayer();
    expect(await navP()).toBe("1");
    await page.keyboard.press("Escape");
    await lab.collapsed();
    expect(await navP()).toBe("");
  });

  test("on a wide screen the page fills the window above the bar, and the bar keeps working", async ({
    lab,
    page,
    finger,
  }) => {
    const viewport = page.viewportSize();
    test.skip(!viewport || viewport.width < WIDE_PX, "wide screens only");
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    const now = await lab.geometry();
    // Edge to edge of what the layout has: the window, less a classic scrollbar's gutter.
    expect(now.surface.width).toBeGreaterThan(now.window.width - 20);
    expect(Math.abs(now.sheet.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(now.sheet.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(now.sheet.width - now.surface.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(now.sheet.y + now.sheet.height - now.dock.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(now.dock.y + now.dock.height - now.window.height)).toBeLessThanOrEqual(1);
    // The bar is not behind the modal: its own play button still answers.
    await finger.press(lab.dock.getByRole("button", { name: "Pause" }));
    await expect(lab.root).toHaveAttribute("data-player-state", "paused");
    await finger.press(lab.dock.getByRole("button", { name: "Play", exact: true }));
    await expect(lab.root).toHaveAttribute("data-player-state", "playing");
    await lab.expanded();
    // And its open button closes the page it opened.
    await finger.press(lab.openButton);
    await lab.collapsed();
  });

  test("on a tablet in portrait the page also fills the window above the bar", async ({
    lab,
    page,
    browserName,
    isMobile,
  }) => {
    test.skip(browserName !== "chromium" || Boolean(isMobile), "resized from the desktop project");
    await page.setViewportSize({ width: 820, height: 1180 });
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    const now = await lab.geometry();
    expect(Math.abs(now.sheet.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(now.sheet.width - now.surface.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(now.sheet.y + now.sheet.height - now.dock.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(now.dock.y + now.dock.height - 1180)).toBeLessThanOrEqual(1);
  });

  test("on a phone the page covers the whole screen and the bar steps out", async ({
    lab,
    page,
  }) => {
    const viewport = page.viewportSize();
    test.skip(!viewport || viewport.width >= WIDE_PX, "phones only");
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    const now = await lab.geometry();
    expect(Math.abs(now.sheet.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(now.sheet.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(now.sheet.width - now.window.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(now.sheet.height - now.window.height)).toBeLessThanOrEqual(1);
    await expect(lab.openButton).toBeHidden();
  });
});
