import type { Page } from "@playwright/test";
import { center, expect, line, test } from "./lab";

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
    await expect(lab.openButton).toHaveAttribute("aria-expanded", "true");
    await expect(lab.sheet).toHaveAttribute("aria-modal", "true");
  });

  test("the page rises from the bar's top edge, and one cover is on screen all the way", async ({
    lab,
    page,
    finger,
  }) => {
    await lab.open();
    await lab.play();
    const bar = await lab.boxOf(lab.dock);
    const start = center(await lab.dockSettled());
    expect(await visibleCovers(page)).toBe(1);
    // A slow, short pull, held: the page has only just left the bar.
    const held = await finger.drag(line(start, { x: start.x, y: start.y - 48 }, 12), 30, {
      hold: true,
    });
    await expect(lab.surface).toHaveAttribute("data-state", "dragging");
    const p = await lab.progress();
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(0.2);
    const sheetTop = (await lab.boxOf(lab.sheet)).y;
    // Travel is linear in p and ends with the page's top on the bar's top.
    expect(Math.abs(sheetTop - bar.y * (1 - p))).toBeLessThanOrEqual(1.5);
    const viewport = page.viewportSize();
    if (viewport && viewport.width < WIDE_PX) {
      // On a phone the bar rides up on the page's top edge.
      expect(Math.abs((await lab.boxOf(lab.dock)).y - sheetTop)).toBeLessThanOrEqual(1.5);
    } else {
      // On a wide screen the bar does not move.
      expect(Math.abs((await lab.boxOf(lab.dock)).y - bar.y)).toBeLessThanOrEqual(0.5);
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
    const viewport = page.viewportSize();
    const pull = Math.round((viewport?.height ?? 800) * 0.45);
    const held = await finger.drag(line(start, { x: start.x, y: start.y - pull }, 16), 20, {
      hold: true,
    });
    const art = page.locator("[data-player-art], .player-cover-frame[data-size=player]").first();
    await expect(art).toHaveCount(1);
    const flight = await art.evaluate((element) => {
      const matrix = new DOMMatrix(getComputedStyle(element).transform);
      return { scale: matrix.a, x: matrix.m41, y: matrix.m42 };
    });
    expect(flight.scale).toBeGreaterThan(0.05);
    expect(flight.scale).toBeLessThan(0.98);
    expect(Math.abs(flight.x) + Math.abs(flight.y)).toBeGreaterThan(1);
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
    const sheet = await lab.boxOf(lab.dialog);
    const bar = await lab.boxOf(lab.dock);
    const width = viewport?.width ?? 0;
    const height = viewport?.height ?? 0;
    expect(Math.abs(sheet.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(sheet.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(sheet.width - width)).toBeLessThanOrEqual(1);
    expect(Math.abs(sheet.y + sheet.height - bar.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(bar.y + bar.height - height)).toBeLessThanOrEqual(1);
    // The bar is not behind the modal: its own play button still answers.
    await finger.press(lab.dock.getByRole("button", { name: "Pause" }));
    await expect(lab.root).toHaveAttribute("data-player-state", "paused");
    await finger.press(lab.dock.getByRole("button", { name: "Play" }));
    await expect(lab.root).toHaveAttribute("data-player-state", "playing");
    await lab.expanded();
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
    const sheet = await lab.boxOf(lab.dialog);
    const bar = await lab.boxOf(lab.dock);
    expect(Math.abs(sheet.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(sheet.width - 820)).toBeLessThanOrEqual(1);
    expect(Math.abs(sheet.y + sheet.height - bar.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(bar.y + bar.height - 1180)).toBeLessThanOrEqual(1);
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
    const sheet = await lab.boxOf(lab.dialog);
    expect(Math.abs(sheet.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(sheet.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(sheet.width - (viewport?.width ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs(sheet.height - (viewport?.height ?? 0))).toBeLessThanOrEqual(1);
    await expect(lab.openButton).toBeHidden();
  });
});
